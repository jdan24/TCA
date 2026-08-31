/**
 * Settle-benchmark enrichment for the target-settle report.
 *
 * Deliberately far lighter than enrichmentService: that path makes bar, tick,
 * trade and snapshot calls *per order*, which for a 50-order report is ~200
 * requests. This report needs only two prices per instrument per day, so the
 * work is keyed on (symbol, date, window) and shared across every order that
 * falls in the same bucket — 48 orders over 3 symbols and 2 days cost 12
 * lookups, not 48.
 *
 * The two benchmarks come from different places:
 *
 *   3PM — the contract's official settle, via the bridge's /settle endpoint
 *         (a HistoricalDataRequest; see bridge.py for why a reference request
 *         will not do).
 *   4PM — the last TRADE print strictly before 16:00:00 NY, taken from the
 *         existing /trade-ticks endpoint over a one-minute window.
 *
 * Reference data is fetched once per symbol rather than per order, to supply the
 * point value behind the cash figures and the tick size behind the spread-cost
 * chart.
 *
 * Everything here is paced through a small worker pool rather than fired at
 * once. The reason is not politeness to Bloomberg: the browser caps HTTP/1.1 at
 * six connections per host, and the fetch timeout starts when fetch() is called,
 * not when the request is dispatched. Firing forty requests together therefore
 * left most of them ageing in a browser queue until they aborted — which, since
 * a failed call returned the same empty value as a genuine "no such price",
 * showed up as N/A benchmarks that looked exactly like missing Bloomberg data.
 * The bridge compounds it by opening a fresh blpapi session per request.
 */

import type {
  SettleBenchmark,
  SettleTolerance,
  TradeRecord,
} from "@/types";
import { benchmarkKey, requiredBenchmarks, type BenchmarkRequest } from "@/tca/settle";
import { nyWallClockToUtc } from "@/tca/nyTime";
import {
  fetchReference,
  fetchSettlePriceOutcome,
  fetchTradeTicksOutcome,
} from "./bloombergClient";
import { shiftToUtc } from "./enrichmentService";

/**
 * How many bridge calls may be in flight at once.
 *
 * Four, against the browser's per-host limit of six: the headroom means a
 * benchmark request is never stuck behind an unrelated call to the bridge (the
 * /health poll, say) and so never spends its timeout waiting to be sent.
 */
const MAX_IN_FLIGHT = 4;

/**
 * Run an async job over every item, at most `limit` at a time.
 *
 * Workers pull from a shared cursor rather than the list being pre-sliced into
 * chunks, so one slow request cannot idle the others behind it.
 */
async function mapPooled<T>(
  items: readonly T[],
  limit: number,
  job: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      const item = items[i];
      if (i >= items.length || item === undefined) return;
      await job(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
}

/**
 * How far back from 16:00:00 NY to look for the closing print.
 *
 * One minute matches "the last print in the 15:59:59 second". A contract that
 * does not trade in that minute yields no benchmark rather than a stale one —
 * widen this if that proves too tight in practice.
 */
const CLOSE_LOOKBACK_MIN = 1;

export interface SettleProgress {
  done: number;
  total: number;
}

export interface SettleEnrichment {
  /** Keyed by benchmarkKey(symbol, nyDate, window). */
  benchmarks: Record<string, SettleBenchmark>;
  /** Raw reference fields per resolved Bloomberg symbol, for point values. */
  reference: Record<string, Record<string, unknown>>;
}

/**
 * The last trade print strictly before 16:00:00 NY on a given NY date.
 *
 * Strictly before: a print stamped exactly 16:00:00 belongs to the next
 * session's first instant, not to this close.
 */
async function fetchClosingPrint(
  bbgSymbol: string,
  nyDate: string,
): Promise<{ print: { price: number; time: Date } | null; failed: boolean }> {
  const closeAt = nyWallClockToUtc(nyDate, 16, 0);
  // An unparseable date is our problem, not a failed request — nothing to retry.
  if (closeAt === null) return { print: null, failed: false };
  const from = new Date(closeAt.getTime() - CLOSE_LOOKBACK_MIN * 60_000);

  const { data: raw, failed } = await fetchTradeTicksOutcome(
    bbgSymbol,
    from.toISOString(),
    closeAt.toISOString(),
  );
  if (raw.length === 0) return { print: null, failed };

  // Bloomberg returns naive exchange-local timestamps; the same correction the
  // main enrichment path applies is needed before comparing against a UTC bound.
  const ticks = shiftToUtc(raw, from.getTime());

  let best: { price: number; time: Date } | null = null;
  for (const t of ticks) {
    const time = new Date(t.time);
    if (time.getTime() >= closeAt.getTime()) continue;
    if (best === null || time.getTime() >= best.time.getTime()) {
      best = { price: t.price, time };
    }
  }
  return { print: best, failed: false };
}

/**
 * Fetch every benchmark the given trades need.
 *
 * Trades that fall outside both settle windows need nothing fetched, so a report
 * full of midday orders costs almost no Bloomberg time.
 */
export async function enrichSettleBenchmarks(
  trades: TradeRecord[],
  tolerance: SettleTolerance,
  resolveSymbol: (ric: string) => string,
  onProgress?: (p: SettleProgress) => void,
): Promise<SettleEnrichment> {
  const benchmarks: Record<string, SettleBenchmark> = {};
  const reference: Record<string, Record<string, unknown>> = {};

  const needed = requiredBenchmarks(trades, resolveSymbol, tolerance);
  const symbols = [...new Set(needed.map((n) => n.bbgSymbol))];

  const total = needed.length + symbols.length;
  if (total === 0) {
    onProgress?.({ done: 0, total: 0 });
    return { benchmarks, reference };
  }

  let done = 0;
  const step = () => {
    done += 1;
    onProgress?.({ done, total });
  };
  onProgress?.({ done: 0, total });

  // ── Reference data: once per symbol, for the cash point value ──────────────
  await mapPooled(symbols, MAX_IN_FLIGHT, async (sym) => {
    reference[sym] = await fetchReference(sym, [
      "FUT_VAL_PT",      // preferred: already correct for the quote scale
      "FUT_CONT_SIZE",   // fallback, converted in tca/dollars.ts
      "CRNCY",           // "USd" means cents, not dollars
      "FUT_TICK_SIZE",   // one tick, for the spread-cost chart (tca/tickSize.ts)
    ]);
    step();
  });

  // ── One benchmark per (symbol, date, window) ───────────────────────────────
  const fetchOne = async ({ bbgSymbol, nyDate, window }: BenchmarkRequest) => {
    const key = benchmarkKey(bbgSymbol, nyDate, window);
    if (window === "3pm") {
      const { data: res, failed } = await fetchSettlePriceOutcome(bbgSymbol, nyDate);
      benchmarks[key] = {
        price: res.settle,
        source: "settle",
        field: res.field,
        printTime: null,
        failed,
      };
    } else {
      const { print, failed } = await fetchClosingPrint(bbgSymbol, nyDate);
      benchmarks[key] = {
        price: print?.price ?? null,
        source: "print",
        field: null,
        printTime: print?.time ?? null,
        failed,
      };
    }
  };

  await mapPooled(needed, MAX_IN_FLIGHT, async (req) => {
    await fetchOne(req);
    step();
  });

  // ── One retry for anything that came back without a price ─────────────────
  //
  // Covers a transient hiccup — a request that timed out behind a slow one, or a
  // momentary blpapi refusal — without re-fetching the whole report. Keys that
  // genuinely have no settle are retried too and simply come back empty again,
  // which costs one extra call each and keeps the rule simple: retry what has no
  // answer, not what we guess might be retryable.
  //
  // Progress is not stepped here: the bar has already reached its total, and
  // winding it backwards would read as the fetch having restarted.
  const missing = needed.filter(
    (req) => benchmarks[benchmarkKey(req.bbgSymbol, req.nyDate, req.window)]?.price == null,
  );
  if (missing.length > 0) {
    await mapPooled(missing, MAX_IN_FLIGHT, fetchOne);
  }

  return { benchmarks, reference };
}

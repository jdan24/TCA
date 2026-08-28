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
 * Reference data is fetched once per symbol rather than per order, purely to
 * supply the point value behind the cash figures.
 */

import type {
  SettleBenchmark,
  SettleTolerance,
  TradeRecord,
} from "@/types";
import { benchmarkKey, requiredBenchmarks } from "@/tca/settle";
import { nyWallClockToUtc } from "@/tca/nyTime";
import { fetchReference, fetchSettlePrice, fetchTradeTicks } from "./bloombergClient";
import { shiftToUtc } from "./enrichmentService";

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
): Promise<{ price: number; time: Date } | null> {
  const closeAt = nyWallClockToUtc(nyDate, 16, 0);
  if (closeAt === null) return null;
  const from = new Date(closeAt.getTime() - CLOSE_LOOKBACK_MIN * 60_000);

  const raw = await fetchTradeTicks(bbgSymbol, from.toISOString(), closeAt.toISOString());
  if (raw.length === 0) return null;

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
  return best;
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
  await Promise.all(
    symbols.map(async (sym) => {
      reference[sym] = await fetchReference(sym, [
        "FUT_VAL_PT",      // preferred: already correct for the quote scale
        "FUT_CONT_SIZE",   // fallback, converted in tca/dollars.ts
        "CRNCY",           // "USd" means cents, not dollars
      ]);
      step();
    }),
  );

  // ── One benchmark per (symbol, date, window) ───────────────────────────────
  await Promise.all(
    needed.map(async ({ bbgSymbol, nyDate, window }) => {
      const key = benchmarkKey(bbgSymbol, nyDate, window);
      if (window === "3pm") {
        const res = await fetchSettlePrice(bbgSymbol, nyDate);
        benchmarks[key] = {
          price: res.settle,
          source: "settle",
          field: res.field,
          printTime: null,
        };
      } else {
        const print = await fetchClosingPrint(bbgSymbol, nyDate);
        benchmarks[key] = {
          price: print?.price ?? null,
          source: "print",
          field: null,
          printTime: print?.time ?? null,
        };
      }
      step();
    }),
  );

  return { benchmarks, reference };
}

/**
 * Benchmark enrichment for the cash-open (AZ Open) report.
 *
 * Built the same way as settleService: the 09:30 benchmarks are keyed on
 * (symbol, date) and shared by every order in that bucket, reference data is
 * fetched once per symbol, and every call goes through the same small worker
 * pool — see settleService for why firing them all at once turns timeouts into
 * fake "no data" answers.
 *
 * Three kinds of call:
 *
 *   window  — trade ticks and bid/ask ticks over [09:29, 09:31) NY, once per
 *             (symbol, date). The minute before the open supplies the print and
 *             quote in force going into it.
 *   arrival — bid/ask ticks over the two minutes up to each distinct
 *             (symbol, order creation time), for the arrival mid and far touch.
 *   reference — point value, currency and tick size, once per symbol.
 */

import type {
  ArrivalQuote,
  BidAskTick,
  OpenWindowBenchmark,
  TradeRecord,
  TradeTick,
} from "@/types";
import {
  ARRIVAL_LEAD_IN_MIN,
  arrivalKey,
  firstQuoteAtOrAfter,
  OPEN_LEAD_IN_MIN,
  openWindowKey,
  openWindowOf,
  requiredArrivalQuotes,
  requiredOpenWindows,
  tickTwap,
  tickVwap,
  toQuotePair,
  type ArrivalRequest,
  type OpenWindowRequest,
} from "@/tca/azOpen";
import { quoteAtOrBefore } from "@/tca/spread";
import {
  fetchBidAskTicksOutcome,
  fetchReference,
  fetchTradeTicksOutcome,
} from "./bloombergClient";
import { shiftToUtc } from "./enrichmentService";
import { mapPooled, MAX_IN_FLIGHT, type SettleProgress } from "./settleService";

export interface AzOpenEnrichment {
  /** Keyed by openWindowKey(symbol, nyDate). */
  window: Record<string, OpenWindowBenchmark>;
  /** Keyed by arrivalKey(symbol, orderTime). */
  arrival: Record<string, ArrivalQuote>;
  /** Raw reference fields per resolved Bloomberg symbol. */
  reference: Record<string, Record<string, unknown>>;
}

/** Bid/ask ticks over [from, to], timestamps corrected to UTC. */
async function fetchQuotes(
  bbgSymbol: string,
  from: Date,
  to: Date,
): Promise<{ ticks: BidAskTick[]; source: "ticks" | "bars" | null; failed: boolean }> {
  const { data, failed } = await fetchBidAskTicksOutcome(
    bbgSymbol,
    from.toISOString(),
    to.toISOString(),
  );
  // Bloomberg returns naive exchange-local timestamps; the same correction the
  // main enrichment path applies is needed before comparing against UTC bounds.
  const ticks = shiftToUtc(data.ticks, from.getTime()).map((t) => ({
    time: new Date(t.time),
    bid: t.bid,
    ask: t.ask,
  }));
  return { ticks, source: data.source, failed };
}

/** Trade prints over [from, to), timestamps corrected to UTC. */
async function fetchTrades(
  bbgSymbol: string,
  from: Date,
  to: Date,
): Promise<{ ticks: TradeTick[]; failed: boolean }> {
  const { data, failed } = await fetchTradeTicksOutcome(
    bbgSymbol,
    from.toISOString(),
    to.toISOString(),
  );
  const ticks = shiftToUtc(data, from.getTime()).map((t) => ({
    time: new Date(t.time),
    price: t.price,
    size: t.size,
  }));
  return { ticks, failed };
}

async function fetchOpenWindow({
  bbgSymbol,
  nyDate,
}: OpenWindowRequest): Promise<OpenWindowBenchmark> {
  const win = openWindowOf(nyDate);
  // An unparseable date is our problem, not a failed request — nothing to retry.
  if (win === null) {
    return { vwap: null, twap: null, quote: null, quoteSource: null, tradesFailed: false, quoteFailed: false };
  }
  const from = new Date(win.start.getTime() - OPEN_LEAD_IN_MIN * 60_000);

  // Sequential within one key: the pool already keeps four keys in flight, and
  // doubling up here would put the browser's per-host connection cap back in play.
  const trades = await fetchTrades(bbgSymbol, from, win.end);
  const quotes = await fetchQuotes(bbgSymbol, from, win.end);
  const quote = toQuotePair(firstQuoteAtOrAfter(quotes.ticks, win.start, win.end));

  return {
    vwap: tickVwap(trades.ticks, win.start, win.end),
    twap: tickTwap(trades.ticks, win.start, win.end),
    quote,
    quoteSource: quote === null ? null : quotes.source,
    tradesFailed: trades.failed,
    quoteFailed: quotes.failed,
  };
}

async function fetchArrival({ bbgSymbol, orderTime }: ArrivalRequest): Promise<ArrivalQuote> {
  const from = new Date(orderTime.getTime() - ARRIVAL_LEAD_IN_MIN * 60_000);
  const { ticks, source, failed } = await fetchQuotes(bbgSymbol, from, orderTime);
  const quote = toQuotePair(quoteAtOrBefore(ticks, orderTime));
  return { quote, quoteSource: quote === null ? null : source, failed };
}

/** Fetch every benchmark the given trades need. */
export async function enrichAzOpenBenchmarks(
  trades: TradeRecord[],
  resolveSymbol: (ric: string) => string,
  onProgress?: (p: SettleProgress) => void,
): Promise<AzOpenEnrichment> {
  const window: Record<string, OpenWindowBenchmark> = {};
  const arrival: Record<string, ArrivalQuote> = {};
  const reference: Record<string, Record<string, unknown>> = {};

  const windows = requiredOpenWindows(trades, resolveSymbol);
  const arrivals = requiredArrivalQuotes(trades, resolveSymbol);
  const symbols = [...new Set(trades.map((t) => resolveSymbol(t.symbol)))];

  const total = symbols.length + windows.length + arrivals.length;
  if (total === 0) {
    onProgress?.({ done: 0, total: 0 });
    return { window, arrival, reference };
  }

  let done = 0;
  const step = () => {
    done += 1;
    onProgress?.({ done, total });
  };
  onProgress?.({ done: 0, total });

  await mapPooled(symbols, MAX_IN_FLIGHT, async (sym) => {
    reference[sym] = await fetchReference(sym, [
      "FUT_VAL_PT",      // preferred: already correct for the quote scale
      "FUT_CONT_SIZE",   // fallback, converted in tca/dollars.ts
      "CRNCY",           // "USd" means cents, not dollars
      "FUT_TICK_SIZE",
    ]);
    step();
  });

  const doWindow = async (req: OpenWindowRequest) => {
    window[openWindowKey(req.bbgSymbol, req.nyDate)] = await fetchOpenWindow(req);
  };
  const doArrival = async (req: ArrivalRequest) => {
    arrival[arrivalKey(req.bbgSymbol, req.orderTime)] = await fetchArrival(req);
  };

  await mapPooled(windows, MAX_IN_FLIGHT, async (req) => {
    await doWindow(req);
    step();
  });
  await mapPooled(arrivals, MAX_IN_FLIGHT, async (req) => {
    await doArrival(req);
    step();
  });

  // ── One retry for anything that came back incomplete ──────────────────────
  // Same rule as the settle report: retry what has no answer, not what we guess
  // might be retryable. Progress is not stepped — the bar has already finished.
  const missingWindows = windows.filter((req) => {
    const w = window[openWindowKey(req.bbgSymbol, req.nyDate)];
    return w === undefined || w.vwap === null || w.quote === null;
  });
  if (missingWindows.length > 0) {
    await mapPooled(missingWindows, MAX_IN_FLIGHT, async (req) => {
      const key = openWindowKey(req.bbgSymbol, req.nyDate);
      const prev = window[key];
      const next = await fetchOpenWindow(req);
      // Keep whichever half the first pass already got right.
      window[key] =
        prev === undefined
          ? next
          : {
              vwap: prev.vwap ?? next.vwap,
              twap: prev.vwap !== null ? prev.twap : next.twap,
              tradesFailed: prev.vwap !== null ? false : next.tradesFailed,
              quote: prev.quote ?? next.quote,
              quoteSource: prev.quote !== null ? prev.quoteSource : next.quoteSource,
              quoteFailed: prev.quote !== null ? false : next.quoteFailed,
            };
    });
  }

  const missingArrivals = arrivals.filter(
    (req) => arrival[arrivalKey(req.bbgSymbol, req.orderTime)]?.quote == null,
  );
  if (missingArrivals.length > 0) {
    await mapPooled(missingArrivals, MAX_IN_FLIGHT, doArrival);
  }

  return { window, arrival, reference };
}

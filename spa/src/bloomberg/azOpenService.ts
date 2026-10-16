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
 *   window  — once per (symbol, date), and only the halves its orders use:
 *             trade ticks over [09:30, 09:34) NY for the 2- and 4-minute VWAPs
 *             when TWAP/VWAP orders traded that open, and bid/ask ticks over
 *             [09:29, 09:31) for the 09:30 mid when market orders did. The
 *             minute before the open supplies the quote in force going in.
 *   arrival — bid/ask ticks over the two minutes up to each distinct
 *             (symbol, order creation time) of a market order, for the arrival
 *             mid. TWAP/VWAP orders are not scored on it and skip it.
 *
 * Which orders are which comes from the Algo Mapping at fetch time; an order
 * reclassified afterwards is flagged for a re-fetch (OpenResult.needsRefetch).
 *   reference — point value, currency and tick size, once per symbol.
 *   roll leg  — trade ticks for a roll's front-month leg over [09:30, 09:34),
 *               once per (leg, date), to price the roll's notional. A file with
 *               no calendar-spread orders makes none of these calls.
 */

import type {
  ArrivalQuote,
  BenchmarkKind,
  OpenRollLegPrice,
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
  OPEN_VWAP_MINUTES,
  openWindowKey,
  openWindowOf,
  orderClassOf,
  requiredArrivalQuotes,
  requiredOpenWindows,
  requiredRollLegs,
  rollLegKey,
  tickVwap,
  toQuotePair,
  type ArrivalRequest,
  type OpenWindowRequest,
  type RollLegRequest,
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
  /** Keyed by rollLegKey(frontSymbol, nyDate). */
  rollLeg: Record<string, OpenRollLegPrice>;
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
  needTrades,
  needQuote,
}: OpenWindowRequest): Promise<OpenWindowBenchmark> {
  const empty: OpenWindowBenchmark = {
    vwap2m: null,
    vwap4m: null,
    quote: null,
    quoteSource: null,
    tradesFailed: false,
    quoteFailed: false,
    tradesFetched: needTrades,
    quoteFetched: needQuote,
  };
  const win = openWindowOf(nyDate);
  // An unparseable date is our problem, not a failed request — nothing to retry.
  if (win === null) return empty;
  const out = { ...empty };

  // Sequential within one key: the pool already keeps four keys in flight, and
  // doubling up here would put the browser's per-host connection cap back in play.
  if (needTrades) {
    const trades = await fetchTrades(bbgSymbol, win.start, win.end);
    const after = (min: number) => new Date(win.start.getTime() + min * 60_000);
    out.vwap2m = tickVwap(trades.ticks, win.start, after(OPEN_VWAP_MINUTES.vwap2m));
    out.vwap4m = tickVwap(trades.ticks, win.start, after(OPEN_VWAP_MINUTES.vwap4m));
    out.tradesFailed = trades.failed;
  }
  if (needQuote) {
    const from = new Date(win.start.getTime() - OPEN_LEAD_IN_MIN * 60_000);
    const quotes = await fetchQuotes(bbgSymbol, from, win.quoteEnd);
    const quote = toQuotePair(firstQuoteAtOrAfter(quotes.ticks, win.start, win.quoteEnd));
    out.quote = quote;
    out.quoteSource = quote === null ? null : quotes.source;
    out.quoteFailed = quotes.failed;
  }
  return out;
}

async function fetchArrival({ bbgSymbol, orderTime }: ArrivalRequest): Promise<ArrivalQuote> {
  const from = new Date(orderTime.getTime() - ARRIVAL_LEAD_IN_MIN * 60_000);
  const { ticks, source, failed } = await fetchQuotes(bbgSymbol, from, orderTime);
  const quote = toQuotePair(quoteAtOrBefore(ticks, orderTime));
  return { quote, quoteSource: quote === null ? null : source, failed };
}

/**
 * A roll front leg's price at the open: its VWAP over [09:30, 09:34), or the
 * last print in that window when the prints carry no size.
 */
async function fetchRollLeg({ bbgSymbol, nyDate }: RollLegRequest): Promise<OpenRollLegPrice> {
  const win = openWindowOf(nyDate);
  if (win === null) return { price: null, failed: false };
  const { ticks, failed } = await fetchTrades(bbgSymbol, win.start, win.end);
  let price = tickVwap(ticks, win.start, win.end);
  if (price === null) {
    const inWindow = ticks
      .filter((t) => isFinite(t.price) && t.time >= win.start && t.time < win.end)
      .sort((a, b) => a.time.getTime() - b.time.getTime());
    price = inWindow.length > 0 ? inWindow[inWindow.length - 1]!.price : null;
  }
  return { price, failed };
}

/** Fetch every benchmark the given trades need. */
export async function enrichAzOpenBenchmarks(
  trades: TradeRecord[],
  resolveSymbol: (ric: string) => string,
  resolveAlgo: (algo: string | null) => BenchmarkKind,
  onProgress?: (p: SettleProgress) => void,
): Promise<AzOpenEnrichment> {
  const window: Record<string, OpenWindowBenchmark> = {};
  const arrival: Record<string, ArrivalQuote> = {};
  const reference: Record<string, Record<string, unknown>> = {};
  const rollLeg: Record<string, OpenRollLegPrice> = {};

  const classOf = (t: TradeRecord) => orderClassOf(t.algo, resolveAlgo);
  const windows = requiredOpenWindows(trades, resolveSymbol, classOf);
  const arrivals = requiredArrivalQuotes(trades, resolveSymbol, classOf);
  const rollLegs = requiredRollLegs(trades, resolveSymbol);
  const symbols = [...new Set(trades.map((t) => resolveSymbol(t.symbol)))];

  const total = symbols.length + windows.length + arrivals.length + rollLegs.length;
  if (total === 0) {
    onProgress?.({ done: 0, total: 0 });
    return { window, arrival, reference, rollLeg };
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
  const doRollLeg = async (req: RollLegRequest) => {
    rollLeg[rollLegKey(req.bbgSymbol, req.nyDate)] = await fetchRollLeg(req);
  };
  await mapPooled(rollLegs, MAX_IN_FLIGHT, async (req) => {
    await doRollLeg(req);
    step();
  });

  // ── One retry for anything that came back incomplete ──────────────────────
  // Same rule as the settle report: retry what has no answer, not what we guess
  // might be retryable. Progress is not stepped — the bar has already finished.
  const missingWindows = windows.filter((req) => {
    const w = window[openWindowKey(req.bbgSymbol, req.nyDate)];
    return (
      w === undefined ||
      (req.needTrades && w.vwap4m === null) ||
      (req.needQuote && w.quote === null)
    );
  });
  if (missingWindows.length > 0) {
    await mapPooled(missingWindows, MAX_IN_FLIGHT, async (req) => {
      const key = openWindowKey(req.bbgSymbol, req.nyDate);
      const prev = window[key];
      if (prev === undefined) {
        window[key] = await fetchOpenWindow(req);
        return;
      }
      // Re-request only the half that came back empty; keep the other as is.
      const redoTrades = req.needTrades && prev.vwap4m === null;
      const redoQuote = req.needQuote && prev.quote === null;
      const next = await fetchOpenWindow({ ...req, needTrades: redoTrades, needQuote: redoQuote });
      window[key] = {
        ...(redoTrades
          ? { vwap2m: next.vwap2m, vwap4m: next.vwap4m, tradesFailed: next.tradesFailed }
          : { vwap2m: prev.vwap2m, vwap4m: prev.vwap4m, tradesFailed: prev.tradesFailed }),
        ...(redoQuote
          ? { quote: next.quote, quoteSource: next.quoteSource, quoteFailed: next.quoteFailed }
          : { quote: prev.quote, quoteSource: prev.quoteSource, quoteFailed: prev.quoteFailed }),
        tradesFetched: req.needTrades,
        quoteFetched: req.needQuote,
      };
    });
  }

  const missingArrivals = arrivals.filter(
    (req) => arrival[arrivalKey(req.bbgSymbol, req.orderTime)]?.quote == null,
  );
  if (missingArrivals.length > 0) {
    await mapPooled(missingArrivals, MAX_IN_FLIGHT, doArrival);
  }

  const missingRollLegs = rollLegs.filter(
    (req) => rollLeg[rollLegKey(req.bbgSymbol, req.nyDate)]?.price == null,
  );
  if (missingRollLegs.length > 0) {
    await mapPooled(missingRollLegs, MAX_IN_FLIGHT, doRollLeg);
  }

  return { window, arrival, reference, rollLeg };
}

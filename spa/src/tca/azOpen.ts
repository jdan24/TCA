/**
 * Cash-open metrics (AZ Open report).
 *
 * Futures orders worked into the 09:30 NY equity cash open, judged against six
 * benchmarks taken around that instant and around the order's own creation:
 *
 *   VWAP / TWAP  — trade prints over [09:30:00, 09:31:00) NY.
 *   Mid @ 09:30  — first quote at or after 09:30:00.
 *   Mid @ arrival — the quote in force at the order's creation time.
 *   Far touch    — the same two quotes, taking the side an aggressive order
 *                  would pay: the ask for a buy, the bid for a sell.
 *
 * Every order is scored against the open on the NY date of its first fill, so an
 * order entered the evening before still lands on the open it traded into.
 * Everything here is pure; the fetching lives in bloomberg/azOpenService.ts.
 */

import type {
  ArrivalQuote,
  BidAskTick,
  OpenBenchmarkId,
  OpenResult,
  OpenSlip,
  OpenWindowBenchmark,
  QuotePair,
  TradeRecord,
  TradeTick,
} from "@/types";
import { nyDateOf, nyWallClockToUtc } from "./nyTime";
import { quoteAtOrBefore } from "./spread";
import { computeSettleSlippage } from "./settle";

export const OPEN_HOUR = 9;
export const OPEN_MINUTE = 30;
/** Length of the VWAP/TWAP window after the open. */
export const OPEN_WINDOW_MIN = 1;
/**
 * How far before 09:30 the window fetch starts. The print and quote in force
 * going into the open come from this lead-in: the TWAP carries the last print
 * forward to 09:30, and a market whose quote does not change in the first minute
 * still has one.
 */
export const OPEN_LEAD_IN_MIN = 1;
/** How far before the order's creation the arrival-quote fetch starts. */
export const ARRIVAL_LEAD_IN_MIN = 2;

/** Display labels, shared by every surface that names a benchmark. */
export const OPEN_BENCHMARKS: ReadonlyArray<{
  id: OpenBenchmarkId;
  label: string;
  title: string;
}> = [
  { id: "vwap",       label: "VWAP",            title: "Volume-weighted trade price, 09:30:00–09:31:00 NY" },
  { id: "twap",       label: "TWAP",            title: "Time-weighted trade price, 09:30:00–09:31:00 NY — each print counts for as long as it stood" },
  { id: "mid0930",    label: "Mid @ 09:30",     title: "Bid/ask midpoint of the first quote at or after 09:30:00 NY" },
  { id: "midArrival", label: "Mid @ Arrival",   title: "Bid/ask midpoint in force when the order was created" },
  { id: "far0930",    label: "Far Touch @ 09:30", title: "First quote at or after 09:30:00 NY — the ask for a buy, the bid for a sell" },
  { id: "farArrival", label: "Far Touch @ Arrival", title: "Quote in force when the order was created — the ask for a buy, the bid for a sell" },
];

// ── Dates and keys ────────────────────────────────────────────────────────────

/** The NY date whose open an order is scored against. */
export function openDateOf(trade: TradeRecord): string {
  return nyDateOf(trade.firstFillTime);
}

/** [09:30, 09:31) NY on a date, as UTC instants; null for an unparseable date. */
export function openWindowOf(nyDate: string): { start: Date; end: Date } | null {
  const start = nyWallClockToUtc(nyDate, OPEN_HOUR, OPEN_MINUTE);
  if (start === null) return null;
  return { start, end: new Date(start.getTime() + OPEN_WINDOW_MIN * 60_000) };
}

export function openWindowKey(bbgSymbol: string, nyDate: string): string {
  return `${bbgSymbol}|${nyDate}`;
}

export function arrivalKey(bbgSymbol: string, orderTime: Date): string {
  return `${bbgSymbol}|${orderTime.getTime()}`;
}

export interface OpenWindowRequest {
  bbgSymbol: string;
  nyDate: string;
}

export interface ArrivalRequest {
  bbgSymbol: string;
  orderTime: Date;
}

/** The distinct (symbol, date) pairs a set of trades needs fetched. */
export function requiredOpenWindows(
  trades: TradeRecord[],
  resolveSymbol: (ric: string) => string,
): OpenWindowRequest[] {
  const seen = new Set<string>();
  const out: OpenWindowRequest[] = [];
  for (const t of trades) {
    const bbgSymbol = resolveSymbol(t.symbol);
    const nyDate = openDateOf(t);
    const key = openWindowKey(bbgSymbol, nyDate);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ bbgSymbol, nyDate });
  }
  return out;
}

/** The distinct (symbol, creation time) pairs a set of trades needs fetched. */
export function requiredArrivalQuotes(
  trades: TradeRecord[],
  resolveSymbol: (ric: string) => string,
): ArrivalRequest[] {
  const seen = new Set<string>();
  const out: ArrivalRequest[] = [];
  for (const t of trades) {
    if (isNaN(t.orderTime.getTime())) continue;
    const bbgSymbol = resolveSymbol(t.symbol);
    const key = arrivalKey(bbgSymbol, t.orderTime);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ bbgSymbol, orderTime: t.orderTime });
  }
  return out;
}

// ── Benchmarks from ticks ─────────────────────────────────────────────────────

/** Σ(price×size)/Σsize over prints in [from, to); null with no volume. */
export function tickVwap(ticks: TradeTick[], from: Date, to: Date): number | null {
  const a = from.getTime();
  const b = to.getTime();
  let pv = 0;
  let v = 0;
  for (const t of ticks) {
    const ms = t.time.getTime();
    if (ms < a || ms >= b) continue;
    if (!isFinite(t.price) || !isFinite(t.size) || t.size <= 0) continue;
    pv += t.price * t.size;
    v += t.size;
  }
  return v > 0 ? pv / v : null;
}

/**
 * Time-weighted trade price over [from, to).
 *
 * Each print stands from its own time until the next print or the window end.
 * The last print before `from` covers the stretch up to the first print inside
 * the window, so a quiet first few seconds are not simply dropped. A window
 * with no prints of its own returns null, matching the VWAP — a price carried
 * in from before the open is not a measurement of the open.
 */
export function tickTwap(ticks: TradeTick[], from: Date, to: Date): number | null {
  const a = from.getTime();
  const b = to.getTime();
  const sorted = ticks
    .filter((t) => isFinite(t.price))
    .sort((x, y) => x.time.getTime() - y.time.getTime());

  let opening: TradeTick | null = null;
  const inWindow: TradeTick[] = [];
  for (const t of sorted) {
    const ms = t.time.getTime();
    if (ms < a) opening = t;
    else if (ms < b) inWindow.push(t);
  }
  if (inWindow.length === 0) return null;

  const points: Array<{ ms: number; price: number }> = [];
  if (opening !== null) points.push({ ms: a, price: opening.price });
  for (const t of inWindow) points.push({ ms: t.time.getTime(), price: t.price });

  let weighted = 0;
  let span = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const until = i + 1 < points.length ? points[i + 1]!.ms : b;
    const dt = until - p.ms;
    if (dt <= 0) continue;
    weighted += p.price * dt;
    span += dt;
  }
  // Every print shares one instant (or sits at the window end): fall back to
  // their plain mean rather than reporting nothing.
  if (span === 0) return inWindow.reduce((s, t) => s + t.price, 0) / inWindow.length;
  return weighted / span;
}

/**
 * The first quote at or after `t` and before `until`; failing that, the quote
 * already in force at `t`.
 *
 * The bridge emits a pair only when the quote changes, so a market that sits
 * still through the open has no pair inside the window — the prevailing one is
 * still the quote at 09:30.
 */
export function firstQuoteAtOrAfter(
  ticks: BidAskTick[],
  t: Date,
  until: Date,
): BidAskTick | null {
  const a = t.getTime();
  const b = until.getTime();
  let best: BidAskTick | null = null;
  for (const tk of ticks) {
    const ms = tk.time.getTime();
    if (ms >= a && ms < b && (best === null || ms < best.time.getTime())) best = tk;
  }
  return best ?? quoteAtOrBefore(ticks, t);
}

/** A tick reduced to a usable pair, or null when either side is missing. */
export function toQuotePair(tick: BidAskTick | null): QuotePair | null {
  if (tick === null) return null;
  if (!isFinite(tick.bid) || !isFinite(tick.ask) || tick.bid <= 0 || tick.ask <= 0) {
    return null;
  }
  return { bid: tick.bid, ask: tick.ask };
}

export function midOf(q: QuotePair | null): number | null {
  return q === null ? null : (q.bid + q.ask) / 2;
}

/** The side an aggressive order pays: the ask for a buy, the bid for a sell. */
export function farTouch(side: "BUY" | "SELL", q: QuotePair | null): number | null {
  if (q === null) return null;
  return side === "BUY" ? q.ask : q.bid;
}

// ── Per-order results ─────────────────────────────────────────────────────────

/**
 * Assemble the report's per-order rows: every loaded order, each scored against
 * all six benchmarks. A missing benchmark leaves that order's slippage null
 * rather than dropping the order.
 */
export function computeOpenResults(
  trades: TradeRecord[],
  windows: Record<string, OpenWindowBenchmark>,
  arrivals: Record<string, ArrivalQuote>,
  resolveSymbol: (ric: string) => string,
  pointValueFor: (ric: string) => number | null,
  currencyFor: (ric: string) => string | null = () => null,
): OpenResult[] {
  return trades.map((trade) => {
    const bbgSymbol = resolveSymbol(trade.symbol);
    const nyDate = openDateOf(trade);
    const win = windows[openWindowKey(bbgSymbol, nyDate)];
    const arr = isNaN(trade.orderTime.getTime())
      ? undefined
      : arrivals[arrivalKey(bbgSymbol, trade.orderTime)];
    const pointValue = pointValueFor(trade.symbol);

    const slip = (price: number | null, failed: boolean): OpenSlip => {
      const s = computeSettleSlippage(
        trade.avgFillPrice,
        price,
        trade.side,
        trade.orderQty,
        pointValue,
      );
      return { price, bps: s.bps, usd: s.usd, failed: price === null && failed };
    };

    const quote0930 = win?.quote ?? null;
    const quoteArr = arr?.quote ?? null;
    const tradesFailed = win?.tradesFailed === true;
    const winQuoteFailed = win?.quoteFailed === true;
    const arrFailed = arr?.failed === true;

    return {
      orderId: trade.orderId,
      nyDate,
      bench: {
        vwap:       slip(win?.vwap ?? null, tradesFailed),
        twap:       slip(win?.twap ?? null, tradesFailed),
        mid0930:    slip(midOf(quote0930), winQuoteFailed),
        midArrival: slip(midOf(quoteArr), arrFailed),
        far0930:    slip(farTouch(trade.side, quote0930), winQuoteFailed),
        farArrival: slip(farTouch(trade.side, quoteArr), arrFailed),
      },
      quotesEstimated:
        (quote0930 !== null && win?.quoteSource === "bars") ||
        (quoteArr !== null && arr?.quoteSource === "bars"),
      // Bloomberg's quote currency when known, else the file's — the point value
      // is denominated in it.
      currency: currencyFor(trade.symbol) ?? trade.currency,
    };
  });
}

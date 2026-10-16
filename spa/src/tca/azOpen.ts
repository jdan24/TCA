/**
 * Cash-open metrics (AZ Open report).
 *
 * Futures orders worked into the 09:30 NY equity cash open. The report splits
 * orders in two, by what their algo maps to in the Algo Mapping settings:
 *
 *   Market orders (arrival-mapped, unmapped or blank algo) are judged on
 *     Mid @ 09:30   — first quote at or after 09:30:00.
 *     Mid @ arrival — the quote in force at the order's creation time.
 *   TWAP/VWAP orders are judged on
 *     VWAP 2m / 4m  — trade prints over [09:30:00, 09:32:00) and [09:30, 09:34).
 *
 * Every order is still priced against all four, so the CSV is complete; the
 * tables show each class only its own benchmarks.
 *
 * Every order is scored against the open on the NY date of its first fill, so an
 * order entered the evening before still lands on the open it traded into.
 * Everything here is pure; the fetching lives in bloomberg/azOpenService.ts.
 */

import type {
  ArrivalQuote,
  BenchmarkKind,
  BidAskTick,
  OpenBenchmarkId,
  OpenOrderClass,
  OpenRollLegPrice,
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

/** The report's client-facing name (AIM = Allianz Investment Management). */
export const OPEN_REPORT_TITLE = "AIM LLC Trades — 09:30 Cash Open";

export const OPEN_HOUR = 9;
export const OPEN_MINUTE = 30;
/** Length of each VWAP window after the open, in minutes. */
export const OPEN_VWAP_MINUTES = { vwap2m: 2, vwap4m: 4 } as const;
/** Length of the fetched window after the open — the longest VWAP. */
export const OPEN_WINDOW_MIN = OPEN_VWAP_MINUTES.vwap4m;
/**
 * How far before 09:30 the quote fetch starts. The quote in force going into
 * the open comes from this lead-in, so a market whose quote does not change
 * after 09:30 still has one.
 */
export const OPEN_LEAD_IN_MIN = 1;
/** How far before the order's creation the arrival-quote fetch starts. */
export const ARRIVAL_LEAD_IN_MIN = 2;
/**
 * How long after 09:30 the quote fetch runs. Mid @ 09:30 is the first quote
 * change in [09:30, 09:31), else the quote standing at 09:30 — the minute is
 * only there to find that first change.
 */
export const OPEN_QUOTE_WINDOW_MIN = 1;

/** Display labels, shared by every surface that names a benchmark. */
export const OPEN_BENCHMARKS: ReadonlyArray<{
  id: OpenBenchmarkId;
  label: string;
  title: string;
  /** The order class this benchmark scores. */
  group: OpenOrderClass;
}> = [
  { id: "mid0930",    label: "Mid @ 09:30",   title: "Bid/ask midpoint of the first quote at or after 09:30:00 NY", group: "market" },
  { id: "midArrival", label: "Mid @ Arrival", title: "Bid/ask midpoint in force when the order was created",        group: "market" },
  { id: "vwap2m",     label: "VWAP 2m",       title: "Volume-weighted trade price, 09:30:00–09:32:00 NY",           group: "algo" },
  { id: "vwap4m",     label: "VWAP 4m",       title: "Volume-weighted trade price, 09:30:00–09:34:00 NY",           group: "algo" },
];

/** The benchmarks one order class is judged on, in display order. */
export function benchmarksFor(cls: OpenOrderClass) {
  return OPEN_BENCHMARKS.filter((b) => b.group === cls);
}

/** The benchmark each class is ranked on for the Top/Bottom 5 tables. */
export const PRIMARY_BENCHMARK: Record<OpenOrderClass, OpenBenchmarkId> = {
  market: "midArrival",
  algo: "vwap4m",
};

export const OPEN_ORDER_CLASS_LABEL: Record<OpenOrderClass, string> = {
  market: "Market Orders",
  algo: "TWAP/VWAP Orders",
};

/**
 * An order's class from its algo, via the Algo Mapping settings: algos mapped to
 * TWAP or VWAP are algo orders, everything else (arrival, unmapped, blank) is a
 * market order. The resolver is passed in so this module stays pure.
 */
export function orderClassOf(
  algo: string | null,
  resolve: (algo: string | null) => BenchmarkKind,
): OpenOrderClass {
  const kind = resolve(algo);
  return kind === "twap" || kind === "vwap" ? "algo" : "market";
}

// ── Rolls ─────────────────────────────────────────────────────────────────────

/** Same root, two month/year codes: "ESZ6ESH7". Groups: root, front, back. */
const ROLL_TICKER_RE = /^([A-Z0-9]+?)([FGHJKMNQUVXZ]\d{1,2})\1([FGHJKMNQUVXZ]\d{1,2})$/;

/**
 * A roll is a calendar-spread order. Returns its front-month leg as a Bloomberg
 * symbol ("ESZ6ESH7 Index" → "ESZ6 Index"), or null for an outright.
 */
export function rollLegsOf(bbgSymbol: string): { front: string } | null {
  const [ticker = "", ...rest] = bbgSymbol.trim().split(/\s+/);
  const m = ROLL_TICKER_RE.exec(ticker.toUpperCase());
  if (m === null) return null;
  return { front: [`${m[1]}${m[2]}`, ...rest].join(" ") };
}

export function isRollSymbol(bbgSymbol: string): boolean {
  return rollLegsOf(bbgSymbol) !== null;
}

export interface RollLegRequest {
  /** The front-month leg's Bloomberg symbol. */
  bbgSymbol: string;
  nyDate: string;
}

export function rollLegKey(frontSymbol: string, nyDate: string): string {
  return `${frontSymbol}|${nyDate}`;
}

/** The distinct (front leg, date) pairs the roll orders need priced. */
export function requiredRollLegs(
  trades: TradeRecord[],
  resolveSymbol: (ric: string) => string,
): RollLegRequest[] {
  const byKey = new Map<string, RollLegRequest>();
  for (const t of trades) {
    const legs = rollLegsOf(resolveSymbol(t.symbol));
    if (legs === null) continue;
    const nyDate = openDateOf(t);
    byKey.set(rollLegKey(legs.front, nyDate), { bbgSymbol: legs.front, nyDate });
  }
  return [...byKey.values()];
}

/** "2026-04" → "April 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ── Dates and keys ────────────────────────────────────────────────────────────

/** The NY date whose open an order is scored against. */
export function openDateOf(trade: TradeRecord): string {
  return nyDateOf(trade.firstFillTime);
}

/**
 * The open on a date, as UTC instants; null for an unparseable date.
 * `end` closes the VWAP window [09:30, 09:34); `quoteEnd` closes the 09:30
 * quote search [09:30, 09:31).
 */
export function openWindowOf(nyDate: string): { start: Date; end: Date; quoteEnd: Date } | null {
  const start = nyWallClockToUtc(nyDate, OPEN_HOUR, OPEN_MINUTE);
  if (start === null) return null;
  return {
    start,
    end: new Date(start.getTime() + OPEN_WINDOW_MIN * 60_000),
    quoteEnd: new Date(start.getTime() + OPEN_QUOTE_WINDOW_MIN * 60_000),
  };
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
  /** Some TWAP/VWAP order trades this open: fetch trade prints for the VWAPs. */
  needTrades: boolean;
  /** Some market order trades this open: fetch the 09:30 quote. */
  needQuote: boolean;
}

export interface ArrivalRequest {
  bbgSymbol: string;
  orderTime: Date;
}

/**
 * The distinct (symbol, date) pairs a set of trades needs fetched, and which
 * half of each: trade prints only where TWAP/VWAP orders traded, the quote only
 * where market orders did. A pair with both kinds of order fetches both.
 */
export function requiredOpenWindows(
  trades: TradeRecord[],
  resolveSymbol: (ric: string) => string,
  classOf: (trade: TradeRecord) => OpenOrderClass,
): OpenWindowRequest[] {
  const byKey = new Map<string, OpenWindowRequest>();
  for (const t of trades) {
    const bbgSymbol = resolveSymbol(t.symbol);
    const nyDate = openDateOf(t);
    const key = openWindowKey(bbgSymbol, nyDate);
    let req = byKey.get(key);
    if (!req) {
      req = { bbgSymbol, nyDate, needTrades: false, needQuote: false };
      byKey.set(key, req);
    }
    if (classOf(t) === "algo") req.needTrades = true;
    else req.needQuote = true;
  }
  return [...byKey.values()];
}

/**
 * The distinct (symbol, creation time) pairs a set of trades needs fetched —
 * market orders only, the arrival mid being a market-order benchmark.
 */
export function requiredArrivalQuotes(
  trades: TradeRecord[],
  resolveSymbol: (ric: string) => string,
  classOf: (trade: TradeRecord) => OpenOrderClass,
): ArrivalRequest[] {
  const seen = new Set<string>();
  const out: ArrivalRequest[] = [];
  for (const t of trades) {
    if (classOf(t) !== "market") continue;
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

// ── Per-order results ─────────────────────────────────────────────────────────

/**
 * Assemble the report's per-order rows: every loaded order, classed by its algo
 * and scored against all four benchmarks. A missing benchmark leaves that order's slippage null
 * rather than dropping the order.
 */
export function computeOpenResults(
  trades: TradeRecord[],
  windows: Record<string, OpenWindowBenchmark>,
  arrivals: Record<string, ArrivalQuote>,
  resolveSymbol: (ric: string) => string,
  pointValueFor: (ric: string) => number | null,
  resolveAlgo: (algo: string | null) => BenchmarkKind,
  currencyFor: (ric: string) => string | null = () => null,
  rollLegs: Record<string, OpenRollLegPrice> = {},
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

    const orderClass = orderClassOf(trade.algo, resolveAlgo);
    const legs = rollLegsOf(bbgSymbol);
    // A roll's own price is the gap between its months; its size is the front
    // leg's. Notional is unsigned: it says how much was traded, not which way.
    const notionalPrice =
      legs === null ? trade.avgFillPrice : rollLegs[rollLegKey(legs.front, nyDate)]?.price ?? null;
    const notional =
      pointValue === null || notionalPrice === null || !isFinite(notionalPrice)
        ? null
        : Math.abs(trade.orderQty * notionalPrice * pointValue);
    const quote0930 = win?.quote ?? null;
    const quoteArr = arr?.quote ?? null;
    const tradesFailed = win?.tradesFailed === true;
    const winQuoteFailed = win?.quoteFailed === true;
    const arrFailed = arr?.failed === true;

    return {
      orderId: trade.orderId,
      nyDate,
      month: nyDate.slice(0, 7),
      isRoll: legs !== null,
      notional,
      orderClass,
      bench: {
        vwap2m:     slip(win?.vwap2m ?? null, tradesFailed),
        vwap4m:     slip(win?.vwap4m ?? null, tradesFailed),
        mid0930:    slip(midOf(quote0930), winQuoteFailed),
        midArrival: slip(midOf(quoteArr), arrFailed),
      },
      quotesEstimated:
        (quote0930 !== null && win?.quoteSource === "bars") ||
        (quoteArr !== null && arr?.quoteSource === "bars"),
      // Fetched data exists for this open, but not the half this order's class
      // is scored on — its class changed since the fetch. An order with no
      // window at all is the symbol-mapping banner's case, not this one.
      needsRefetch:
        win !== undefined &&
        (orderClass === "algo"
          ? !win.tradesFetched
          : !win.quoteFetched || (!isNaN(trade.orderTime.getTime()) && arr === undefined)),
      // Bloomberg's quote currency when known, else the file's — the point value
      // is denominated in it.
      currency: currencyFor(trade.symbol) ?? trade.currency,
    };
  });
}

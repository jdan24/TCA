/**
 * Target-settle metrics (Allianz report).
 *
 * Allianz work TWAP/VWAP orders into one of two settlement prints and judge the
 * execution against that print:
 *
 *   3PM NY — the Treasury close, taken from the contract's official settle.
 *   4PM NY — the equity close, taken from the last print before 16:00:00 NY.
 *
 * An order is assigned to whichever settle it finished into, on the evidence of
 * its last fill. Everything here is pure; the fetching lives in
 * bloomberg/settleService.ts.
 */

import type {
  SettleBenchmark,
  SettleResult,
  SettleTolerance,
  SettleWindow,
  TradeRecord,
} from "@/types";
import { nyDateOf, nyWallClockToUtc } from "./nyTime";
import { getTreasuryPrecision } from "./treasuryFrac";
import { dollarSlippage } from "./dollars";
import { sideSign, toBps } from "./tcaUtils";

/** The two settle instants, in NY wall-clock time. */
export const SETTLE_HOURS: Record<Exclude<SettleWindow, "unassigned">, number> = {
  "3pm": 15,
  "4pm": 16,
};

export const DEFAULT_SETTLE_TOLERANCE: SettleTolerance = {
  beforeMin: 30,
  afterMin: 10,
};

/** Human label for a window, used by every surface that shows one. */
export function settleWindowLabel(w: SettleWindow): string {
  return w === "3pm" ? "3PM Settle" : w === "4pm" ? "4PM Close" : "Unassigned";
}

/**
 * Below this a benchmark is treated as unusable for bps: dividing by a price
 * near zero turns rounding noise into a huge percentage. Same reasoning as
 * MIN_ABS_MID in tca/spread.ts.
 */
const MIN_ABS_BENCHMARK = 1e-6;

// ── Window assignment ─────────────────────────────────────────────────────────

export interface SettleAssignment {
  window: SettleWindow;
  /** NY calendar date of the last fill — the date the benchmark comes from. */
  nyDate: string;
}

/**
 * Which settle an order was working into, judged by where its last fill landed
 * in NY time.
 *
 * When a wide tolerance makes the two windows overlap, the nearer settle wins
 * rather than the first one tested — otherwise the result would depend on
 * declaration order, which is not a property anyone should have to know.
 */
export function assignSettleWindow(
  lastFill: Date,
  tol: SettleTolerance = DEFAULT_SETTLE_TOLERANCE,
): SettleAssignment {
  const nyDate = nyDateOf(lastFill);
  const t = lastFill.getTime();

  let best: { window: SettleWindow; distance: number } | null = null;

  for (const w of ["3pm", "4pm"] as const) {
    const settleAt = nyWallClockToUtc(nyDate, SETTLE_HOURS[w], 0);
    if (settleAt === null) continue;
    const delta = t - settleAt.getTime(); // negative = before the settle
    const withinWindow =
      delta >= -tol.beforeMin * 60_000 && delta <= tol.afterMin * 60_000;
    if (!withinWindow) continue;
    const distance = Math.abs(delta);
    if (best === null || distance < best.distance) {
      best = { window: w, distance };
    }
  }

  return { window: best?.window ?? "unassigned", nyDate };
}

// ── Settle-time mismatch ──────────────────────────────────────────────────────

/**
 * True when an order sits in the 3PM bucket but its contract does not settle at
 * 15:00 ET.
 *
 * PX_SETTLE_ACTUAL returns *that contract's own* official settle, whenever it
 * happens to fall — 15:00 ET for CME Treasuries, 16:00 for ES, 14:30 for CL. So
 * an ES order finishing at 14:58 buckets as 3PM but is scored against a 16:00
 * settle. The figure is a real settle and worth reporting; the row is flagged so
 * the mismatch is visible rather than implied away by the column heading.
 *
 * The 4PM window takes a market print at a fixed time, so it never mismatches.
 */
export function hasSettleTimeMismatch(
  window: SettleWindow,
  bbgSymbol: string,
): boolean {
  return window === "3pm" && getTreasuryPrecision(bbgSymbol) === null;
}

// ── Slippage ──────────────────────────────────────────────────────────────────

export interface SettleSlippage {
  bps: number | null;
  price: number | null;
  usd: number | null;
}

const EMPTY_SLIPPAGE: SettleSlippage = { bps: null, price: null, usd: null };

/**
 * Slippage against a settle benchmark, in all three units.
 *
 * Positive is a cost, matching every other signed metric here: you paid above
 * the settle on a buy, or sold below it.
 *
 * The bps denominator uses the benchmark's magnitude so a contract quoted
 * through zero — a calendar spread — cannot flip the sign of the result.
 * Returns nulls rather than zeros whenever an input is missing.
 */
export function computeSettleSlippage(
  fillPrice: number,
  benchmark: number | null,
  side: "BUY" | "SELL",
  quantity: number,
  pointValue: number | null,
): SettleSlippage {
  if (benchmark === null || !isFinite(benchmark)) return EMPTY_SLIPPAGE;
  if (!isFinite(fillPrice)) return EMPTY_SLIPPAGE;

  const price = (fillPrice - benchmark) * sideSign(side);
  const absBenchmark = Math.abs(benchmark);

  return {
    price,
    bps: absBenchmark >= MIN_ABS_BENCHMARK ? toBps(price / absBenchmark) : null,
    usd: dollarSlippage(fillPrice, benchmark, side, quantity, pointValue),
  };
}

// ── Benchmark keys ────────────────────────────────────────────────────────────

/**
 * Cache key for a benchmark. Every order on the same instrument, date and window
 * shares one, which is what keeps the fetch count proportional to instruments
 * and days rather than to orders.
 */
export function benchmarkKey(
  bbgSymbol: string,
  nyDate: string,
  window: SettleWindow,
): string {
  return `${bbgSymbol}|${nyDate}|${window}`;
}

/** One benchmark to fetch: an instrument, a date and which settle. */
export interface BenchmarkRequest {
  bbgSymbol: string;
  nyDate: string;
  window: Exclude<SettleWindow, "unassigned">;
}

/** The distinct (symbol, date, window) triples a set of trades needs fetched. */
export function requiredBenchmarks(
  trades: TradeRecord[],
  resolveSymbol: (ric: string) => string,
  tol: SettleTolerance,
): BenchmarkRequest[] {
  const seen = new Set<string>();
  const out: BenchmarkRequest[] = [];
  for (const t of trades) {
    const { window, nyDate } = assignSettleWindow(t.lastFillTime, tol);
    if (window === "unassigned") continue;
    const bbgSymbol = resolveSymbol(t.symbol);
    const key = benchmarkKey(bbgSymbol, nyDate, window);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ bbgSymbol, nyDate, window });
  }
  return out;
}

// ── Per-order results ─────────────────────────────────────────────────────────

/**
 * Assemble the report's per-order rows.
 *
 * Every order appears, including those in neither window: they carry a null
 * benchmark and null slippage rather than being dropped, so the count on screen
 * always reconciles with the file that was loaded.
 */
export function computeSettleResults(
  trades: TradeRecord[],
  benchmarks: Record<string, SettleBenchmark>,
  tolerance: SettleTolerance,
  resolveSymbol: (ric: string) => string,
  pointValueFor: (ric: string) => number | null,
  currencyFor: (ric: string) => string | null = () => null,
): SettleResult[] {
  return trades.map((trade) => {
    const { window, nyDate } = assignSettleWindow(trade.lastFillTime, tolerance);
    const bbgSymbol = resolveSymbol(trade.symbol);

    const bench =
      window === "unassigned"
        ? undefined
        : benchmarks[benchmarkKey(bbgSymbol, nyDate, window)];

    const benchmark = bench?.price ?? null;
    const slip = computeSettleSlippage(
      trade.avgFillPrice,
      benchmark,
      trade.side,
      trade.orderQty,
      pointValueFor(trade.symbol),
    );

    return {
      orderId: trade.orderId,
      window,
      nyDate,
      benchmark,
      source: bench?.source ?? null,
      field: bench?.field ?? null,
      benchmarkFailed: bench?.failed === true,
      slip_bps: slip.bps,
      slip_price: slip.price,
      slip_usd: slip.usd,
      // Bloomberg's quote currency when known, else the file's — the same rule
      // computeAll uses, since the point value is denominated in it.
      currency: currencyFor(trade.symbol) ?? trade.currency,
      settleTimeMismatch: hasSettleTimeMismatch(window, bbgSymbol),
    };
  });
}

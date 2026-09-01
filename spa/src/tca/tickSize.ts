/**
 * Minimum price increment (one tick) for a futures contract.
 *
 * The target-settle report uses this to answer a question the client actually
 * asks: the order slipped X bps against the settle, but what would it have cost
 * simply to cross and be done? On a liquid future the book is one tick wide
 * nearly all the time, so one tick is the honest stand-in for the quoted width —
 * and half of it, the mid-point cost, is what crossing from the mid costs.
 *
 * Two sources, in priority order:
 *   1. Bloomberg's FUT_TICK_SIZE, from the per-symbol reference call the settle
 *      fetch already makes.
 *   2. A built-in table keyed on the contract root, so the chart still plots
 *      with the bridge offline.
 *
 * Returns null when neither knows the contract — the chart drops those orders
 * rather than plotting a guessed width.
 *
 * Note this is the tick in *decimal price*, matching how avgFillPrice and the
 * settle benchmark are carried everywhere in this app. A Treasury tick is
 * 1/32nd and its fractions, expressed as a decimal: TY's half-32nd is
 * 0.015625, not "0-005".
 */

import { toGenericTicker } from "./genericTicker";
import { asBloombergNumber } from "./tcaUtils";

/**
 * Tick sizes by contract root, in decimal price.
 *
 * Deliberately limited to contracts we have actually seen in Allianz files plus
 * the obvious neighbours. An unknown root yields null rather than a plausible
 * default: a wrong tick moves every point on the chart sideways, and a missing
 * point is far easier to notice than a mislocated one.
 */
const TICK_BY_ROOT: Record<string, number> = {
  // ── US Treasury futures (CME) ──────────────────────────────────────────────
  TU: 1 / 256,   // 2-Year Note   — an eighth of a 32nd
  "3Y": 1 / 128, // 3-Year Note   — quarter of a 32nd
  FV: 1 / 128,   // 5-Year Note   — quarter of a 32nd
  TY: 1 / 64,    // 10-Year Note  — half a 32nd
  UXY: 1 / 64,   // Ultra 10-Year — half a 32nd
  TN: 1 / 64,    // Ultra 10-Year (alternate root)
  US: 1 / 32,    // 30-Year Bond
  WN: 1 / 32,    // Ultra Bond

  // ── Equity index futures ───────────────────────────────────────────────────
  ES: 0.25,      // E-mini S&P 500
  NQ: 0.25,      // E-mini Nasdaq 100
  RTY: 0.1,      // E-mini Russell 2000
  YM: 1,         // E-mini Dow
  EMD: 0.1,      // E-mini S&P MidCap 400
  VG: 1,         // Euro Stoxx 50
  Z: 0.5,        // FTSE 100
  GX: 0.5,       // DAX
  CF: 0.5,       // CAC 40
  NK: 5,         // Nikkei 225
  XP: 1,         // ASX SPI 200

  // ── Non-US rates ───────────────────────────────────────────────────────────
  RX: 0.01,      // Euro-Bund
  OE: 0.01,      // Euro-Bobl
  DU: 0.005,     // Euro-Schatz
  UB: 0.01,      // Euro-Buxl
  IK: 0.01,      // Italian BTP
  OAT: 0.01,     // French OAT
  G: 0.01,       // Long Gilt
  JB: 0.01,      // JGB
  CN: 0.005,     // Canadian 10Y
  XM: 0.005,     // Australian 10Y

  // ── STIR ───────────────────────────────────────────────────────────────────
  ED: 0.0025,    // Eurodollar
  SFR: 0.0025,   // SOFR
  ER: 0.005,     // Euribor
  FF: 0.0025,    // Fed Funds

  // ── Energy / metals ────────────────────────────────────────────────────────
  CL: 0.01,      // WTI Crude
  CO: 0.01,      // Brent
  NG: 0.001,     // Natural Gas
  HO: 0.0001,    // Heating Oil
  XB: 0.0001,    // RBOB
  GC: 0.1,       // Gold
  SI: 0.005,     // Silver
  HG: 0.0005,    // Copper

  // ── FX ─────────────────────────────────────────────────────────────────────
  EC: 0.00005,   // Euro FX
  JY: 0.0000005, // Japanese Yen
  BP: 0.0001,    // British Pound
  AD: 0.0001,    // Australian Dollar
  CD: 0.00005,   // Canadian Dollar
};

/**
 * A Bloomberg reference value is only trusted when it is a positive, finite
 * number. Bloomberg returns empty strings and nulls freely for fields a given
 * security does not carry, and types some numeric fields as strings.
 */
function asPositiveNumber(v: unknown): number | null {
  const n = asBloombergNumber(v);
  return n !== null && n > 0 ? n : null;
}

/**
 * The root of a Bloomberg symbol — "TYU6 Comdty" → "TY".
 *
 * Built on toGenericTicker so the expiry-stripping rules (and the calendar
 * spread exclusion) live in exactly one place. A symbol it cannot parse comes
 * back unchanged, which then simply misses the table.
 */
export function tickRootOf(bbgSymbol: string): string {
  const generic = toGenericTicker(bbgSymbol).trim();
  const lastSpace = generic.lastIndexOf(" ");
  const root = lastSpace === -1 ? generic : generic.slice(0, lastSpace);
  return root.toUpperCase();
}

/** The built-in tick size for a symbol, or null when the root is unknown. */
export function builtInTickSize(bbgSymbol: string): number | null {
  return TICK_BY_ROOT[tickRootOf(bbgSymbol)] ?? null;
}

/**
 * Build a tick-size resolver over the settle report's reference data.
 *
 * Bloomberg wins when it answers, since it is the contract's own published
 * increment and stays right when the exchange changes it. The table is the
 * offline fallback.
 */
export function buildTickSizeResolver(
  reference: Record<string, Record<string, unknown>>,
): (bbgSymbol: string) => number | null {
  return (bbgSymbol: string): number | null => {
    const fromBbg = asPositiveNumber(reference[bbgSymbol]?.["FUT_TICK_SIZE"]);
    if (fromBbg !== null) return fromBbg;
    return builtInTickSize(bbgSymbol);
  };
}

/**
 * Half a one-tick spread, in bps of the benchmark — the mid-point cost.
 *
 * This is what an order that simply crossed would pay against a mid-based
 * benchmark: the book is one tick wide, the mid sits in the middle of it, so
 * lifting the offer costs half the width from there. It is the reference the
 * settle report judges execution against.
 */
export function midSpreadBps(
  tickSize: number | null,
  benchmark: number | null,
): number | null {
  const full = tickSpreadBps(tickSize, benchmark);
  return full === null ? null : full / 2;
}

/**
 * The cost of crossing a one-tick-wide spread, in bps of the benchmark.
 *
 * Measured against the settle benchmark itself rather than the fill, so two
 * orders on the same contract and day share one x-coordinate and the chart
 * reads as "this product's spread cost" rather than as noise.
 *
 * Note the *full* width. What the settle report actually plots is half of it —
 * see midSpreadBps above.
 */
export function tickSpreadBps(
  tickSize: number | null,
  benchmark: number | null,
): number | null {
  if (tickSize === null || !isFinite(tickSize) || tickSize <= 0) return null;
  if (benchmark === null || !isFinite(benchmark)) return null;
  const abs = Math.abs(benchmark);
  // Same guard as tca/spread.ts: a contract quoted through zero makes bps
  // explode, so report nothing rather than a number that swings by orders of
  // magnitude.
  if (abs < 1e-6) return null;
  return (tickSize / abs) * 10_000;
}

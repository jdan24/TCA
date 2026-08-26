/**
 * Slippage in cash terms.
 *
 *   $ = (fillPrice − benchmarkPrice) × sideSign × quantity × pointValue
 *
 * Positive is a cost, matching the bps convention in slippage.ts: you paid more
 * (BUY) or received less (SELL) than the benchmark.
 *
 * Computed from prices rather than from the bps figure so the result does not
 * inherit a second rounding trip through basis points.
 *
 * pointValue is the cash value of a 1.00 price move for one contract, in the
 * contract's own currency — 1000 for a 3Y/10Y Treasury note, 50 for ES. There is
 * no FX conversion anywhere in this app, so a EUR-denominated contract produces
 * a figure in EUR, not dollars.
 *
 * Returns null whenever an input is missing. A missing point value must never
 * degrade to 1: for a futures contract that would understate the cost by three
 * orders of magnitude while looking authoritative.
 */
import { sideSign } from "./tcaUtils";

export function dollarSlippage(
  fillPrice: number,
  benchmarkPrice: number | null,
  side: "BUY" | "SELL",
  quantity: number,
  pointValue: number | null,
): number | null {
  if (benchmarkPrice === null || pointValue === null) return null;
  if (!isFinite(benchmarkPrice) || !isFinite(pointValue)) return null;

  return (fillPrice - benchmarkPrice) * sideSign(side) * quantity * pointValue;
}

/**
 * Bloomberg quotes some contracts in a currency's *minor* unit and signals it
 * with a trailing lowercase letter on the ISO code: USd is US cents, GBp is
 * pence, ZAc South African cents. One hundred minor units make one major unit.
 *
 * This matters far more than a label: FX and several energy futures quote this
 * way, so CDU6 prints as 72.70 (USd per CAD) rather than 0.7270 (USD per CAD).
 * Reading FUT_CONT_SIZE as the point value there overstates every cash figure
 * by 100×.
 */
export function isMinorCurrency(crncy: unknown): boolean {
  if (typeof crncy !== "string") return false;
  const c = crncy.trim();
  // "USd" — at least two uppercase letters followed by one lowercase.
  return /^[A-Z]{2,}[a-z]$/.test(c);
}

/**
 * The major-unit ISO code for a Bloomberg currency: "USd" → "USD", "GBp" →
 * "GBP", "USD" → "USD". Returns null when there is nothing usable to report,
 * so callers fall back to the currency from the file rather than inventing one.
 */
export function toMajorCurrency(crncy: unknown): string | null {
  if (typeof crncy !== "string") return null;
  const c = crncy.trim();
  return c === "" ? null : c.toUpperCase();
}

/**
 * Cash value of a 1.00 price move, as Bloomberg itself reports it (FUT_VAL_PT).
 *
 * Preferred over deriving from FUT_CONT_SIZE because it already accounts for
 * however the contract happens to be quoted. That matters for contracts whose
 * quote scale is not expressible from the currency alone: JYU6 quotes in USd
 * per *100* JPY, so its 12,500,000 JPY notional is worth $1,250 a point rather
 * than the $125,000 the cents rule alone would give.
 *
 * Returns null when the field is absent or unusable, so callers fall through to
 * the FUT_CONT_SIZE derivation below rather than losing the cash figures.
 */
export function pointValueFromValPt(futValPt: unknown): number | null {
  if (typeof futValPt !== "number" || !isFinite(futValPt) || futValPt <= 0) {
    return null;
  }
  return futValPt;
}

/**
 * Cash value of a 1.00 price move for one contract, from Bloomberg's
 * FUT_CONT_SIZE.
 *
 * The fallback for when FUT_VAL_PT is unavailable — see pointValueFromValPt.
 *
 * FUT_CONT_SIZE is the contract's notional size, which only equals the point
 * value when the contract is quoted in currency-per-unit: ES is 50 index points
 * per contract and quotes at ~5000, so a 1.00 move is $50. Two cases need
 * dividing by 100 instead:
 *
 *   Quoted per par — Treasury futures. ZN carries $100,000 face and trades at
 *   ~110, so a 1.00 move is $1,000.
 *
 *   Quoted in a minor unit — FX and some energy futures. 6C carries 100,000 CAD
 *   and quotes in US cents at ~72.70, so a 1.00 (one cent) move is
 *   0.01 × 100,000 = $1,000, not $100,000.
 *
 * The two are independent and neither is known to apply to the same contract,
 * but both are honoured if they ever do.
 *
 * @param futContSize   Raw FUT_CONT_SIZE from Bloomberg reference data.
 * @param quotedPerPar  True when the contract quotes as a percent of par
 *                      (callers pass getTreasuryPrecision(sym) !== null).
 * @param crncy         Raw CRNCY from Bloomberg reference data, e.g. "USd".
 */
export function pointValueFromContractSize(
  futContSize: unknown,
  quotedPerPar: boolean,
  crncy?: unknown,
): number | null {
  if (typeof futContSize !== "number" || !isFinite(futContSize) || futContSize <= 0) {
    return null;
  }
  let pv = quotedPerPar ? futContSize / 100 : futContSize;
  if (isMinorCurrency(crncy)) pv = pv / 100;
  return pv;
}

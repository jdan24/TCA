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
 * Cash value of a 1.00 price move for one contract, from Bloomberg's
 * FUT_CONT_SIZE.
 *
 * FUT_CONT_SIZE is the contract's notional size, which only equals the point
 * value when the contract is quoted in currency-per-unit: ES is 50 index points
 * per contract and quotes at ~5000, so a 1.00 move is $50. Treasury futures
 * instead quote as a percentage of par — ZN carries $100,000 face and trades at
 * ~110 — so a 1.00 move is $1,000, i.e. FUT_CONT_SIZE / 100.
 *
 * @param futContSize   Raw FUT_CONT_SIZE from Bloomberg reference data.
 * @param quotedPerPar  True when the contract quotes as a percent of par
 *                      (callers pass getTreasuryPrecision(sym) !== null).
 */
export function pointValueFromContractSize(
  futContSize: unknown,
  quotedPerPar: boolean,
): number | null {
  if (typeof futContSize !== "number" || !isFinite(futContSize) || futContSize <= 0) {
    return null;
  }
  return quotedPerPar ? futContSize / 100 : futContSize;
}

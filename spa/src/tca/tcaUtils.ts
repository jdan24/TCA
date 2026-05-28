/**
 * Shared helpers used across all TCA metric modules.
 * Kept minimal — pure functions, zero dependencies.
 */

/** +1 for buys (cost increases when you paid more), −1 for sells */
export function sideSign(side: "BUY" | "SELL"): 1 | -1 {
  return side === "BUY" ? 1 : -1;
}

/** Convert a fractional price return to basis points */
export function toBps(fraction: number): number {
  return fraction * 10_000;
}

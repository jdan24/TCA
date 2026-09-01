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

/**
 * Read a Bloomberg reference value as a number, accepting the string form.
 *
 * Reference fields arrive typed however Bloomberg's schema declares them, which
 * is not consistently numeric: for one security the bridge returns
 * `{"FUT_VAL_PT": "420.00", "FUT_CONT_SIZE": 42000.0}` — the same kind of
 * quantity, one a string and one a float. The bridge passes `el.getValue()`
 * through untouched, so the schema's type reaches the app as-is.
 *
 * A `typeof v === "number"` guard therefore silently drops half these fields,
 * and the drop is invisible: the caller falls through to a secondary field and
 * reports a plausible wrong number rather than N/A. That is what made RBOB's
 * cash figures 100x too large — FUT_VAL_PT ("420.00") was rejected, so the
 * point value came from FUT_CONT_SIZE (42,000 gallons) instead.
 *
 * Returns null for anything not finite, so callers keep their existing
 * fall-through behaviour when a field is genuinely absent.
 */
export function asBloombergNumber(v: unknown): number | null {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return isFinite(n) ? n : null;
  }
  return null;
}

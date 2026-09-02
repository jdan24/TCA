/**
 * Generic (continuation) ticker for a futures contract.
 *
 * A report spanning several months carries one symbol per expiry — FVU6, FVZ6,
 * FVH7 — which fragments every aggregation into per-contract rows. The generic
 * ticker drops the expiry so all of them collapse onto the instrument:
 *
 *   "FVU6 Comdty"  →  "FV Comdty"
 *   "ESH5 Index"   →  "ES Index"
 *   "FVU6"         →  "FV"
 *
 * Some roots are quoted with a space between the root and the expiry —
 * "S H7 Comdty" (soybeans), "Z M6 Index" (FTSE 100), "G Z6 Comdty" (long gilt).
 * Those collapse the same way:
 *
 *   "S H7 Comdty"  →  "S Comdty"
 *   "Z M6 Index"   →  "Z Index"
 *
 * Note this is an *aggregation key*, not a queryable Bloomberg security —
 * Bloomberg's own generic form would be "FV1 Comdty". Nothing here is ever sent
 * to the bridge.
 *
 * Anything that does not parse as a single-expiry future is returned unchanged.
 * Guessing would silently merge unrelated instruments into one row, which is
 * far worse than leaving a symbol ungrouped.
 */

import { SPREAD_RE } from "./treasuryFrac";

/**
 * Month code + 1–2 digit year, e.g. "U6" or "H25", optionally separated from
 * the root by a space ("S H7"). Mirrors the root pattern the bridge already
 * uses (`_ROOT_RE` in bloomberg-bridge/bridge.py).
 *
 * The root itself cannot contain the space, so a two-token symbol only matches
 * when its second token really is a month code plus a year — an equity's
 * exchange code ("BP LN Equity", "MSFT US Equity") has no digits and is left
 * alone.
 */
const ROOT_RE = /^([A-Z0-9]+?) ?[FGHJKMNQUVXZ]\d{1,2}$/;

/**
 * Yellow keys we recognise as such. Matching against a known set — rather than
 * assuming the last word is always a yellow key — keeps a RIC that happens to
 * contain a space from being silently truncated.
 *
 * Both spellings of the FX key are accepted: the bridge's inference table emits
 * "Crncy" while the mapping UI offers "Curncy".
 */
const YELLOW_KEYS = new Set([
  "index", "comdty", "equity", "curncy", "crncy",
  "corp", "govt", "mtge", "muni",
]);

/** "comdty" → "Comdty", so two spellings of one key never split a group. */
function canonicalKey(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1).toLowerCase();
}

/**
 * Strip the expiry from a Bloomberg symbol, keeping the root and yellow key.
 * Returns the input unchanged when it is not a single-expiry futures ticker
 * (calendar spreads, equities, already-generic roots, unmapped RICs).
 */
export function toGenericTicker(bbgSymbol: string): string {
  const trimmed = bbgSymbol.trim().replace(/\s+/g, " ");
  if (!trimmed) return bbgSymbol;

  // Split a trailing yellow key off the ticker, if there is one.
  const lastSpace = trimmed.lastIndexOf(" ");
  let ticker = trimmed;
  let key: string | null = null;
  if (lastSpace !== -1) {
    const tail = trimmed.slice(lastSpace + 1);
    if (YELLOW_KEYS.has(tail.toLowerCase())) {
      ticker = trimmed.slice(0, lastSpace);
      key = canonicalKey(tail);
    }
  }

  const upper = ticker.toUpperCase();

  // Calendar spreads first: ROOT_RE matches them by accident and would return a
  // root built from the first leg plus part of the second.
  if (SPREAD_RE.test(upper)) return bbgSymbol;

  const m = ROOT_RE.exec(upper);
  if (!m) return bbgSymbol;

  const root = m[1];
  if (root === undefined || root === "") return bbgSymbol;

  return key !== null ? `${root} ${key}` : root;
}

/**
 * US Treasury futures fractional price notation.
 *
 * Also exports generateTreasuryYTicks() — generates Y-axis tick values snapped
 * to the contract's price grid so each tick formats to a unique 32nds string.
 * Recharts' default tick algorithm distributes ticks uniformly in decimal space,
 * which causes multiple consecutive values to round to the same display string
 * when the visible price range is narrow (a common case for Treasury futures).
 *
 * Treasury futures are quoted in 32nds with optional sub-32nd precision
 * depending on the contract:
 *
 *   whole32   → US, WN          "115-16"   (1/32nd minimum tick)
 *   half32    → TY, UXY         "115-165"  (1/64th minimum tick; '5' = ½ of 1/32)
 *   quarter32 → FV, TU, 3Y      "115-162"  (1/128th minimum tick; '2/5/7' = ¼/½/¾ of 1/32)
 *   eighth32  → calendar spreads "0-03 ¾"  (1/256th; sub-32nd shown as a fraction)
 *
 * Detection uses the Bloomberg ticker prefix + " Comdty" yellow key.
 * The Comdty requirement avoids false matches (e.g. "USD Curncy" vs "US…").
 *
 * Calendar spreads (e.g. "3YU63YZ6 Comdty") get their own precision: they trade
 * in finer increments than the outright — a 3-year spread quoted 0-03¾ / 0-03⅞
 * moves in eighths of a 32nd, which quarter32 cannot represent at all (it rounds
 * 3⅞ to 0-04).  eighth32 is used for every Treasury spread regardless of the
 * contract's own spread tick, since it represents coarser grids exactly too
 * (a half-32nd renders as "½", a quarter as "¼").
 */

export type TreasuryPrecision = "whole32" | "half32" | "quarter32" | "eighth32";

// Longer prefixes (UXY) must be listed before shorter ones that share a prefix.
const PATTERNS: Array<{ re: RegExp; precision: TreasuryPrecision }> = [
  { re: /^UXY/i,  precision: "half32"    }, // Ultra 10-Year (UXY / TN)
  { re: /^TY/i,   precision: "half32"    }, // 10-Year Note
  { re: /^WN/i,   precision: "whole32"   }, // Ultra Bond (30Y Ultra)
  { re: /^US/i,   precision: "whole32"   }, // 30-Year Bond
  { re: /^FV/i,   precision: "quarter32" }, // 5-Year Note
  { re: /^TU/i,   precision: "quarter32" }, // 2-Year Note
  { re: /^3Y/i,   precision: "quarter32" }, // 3-Year Note
];

/**
 * A two-legged calendar spread ticker: the same root and a month/year code
 * twice over, e.g. "3YU63YZ6" or "TUM6TUU6".
 *
 * Exported because tca/genericTicker.ts must recognise spreads too: the
 * single-expiry root pattern matches them by accident and yields nonsense
 * ("3YU63YZ6" → "3YU63Y"), so spreads have to be ruled out first.
 */
export const SPREAD_RE = /^([A-Z0-9]+?)[FGHJKMNQUVXZ]\d{1,2}\1[FGHJKMNQUVXZ]\d{1,2}$/;

/**
 * Returns the fractional-price precision for the given Bloomberg symbol,
 * or null if the symbol is not a recognised US Treasury future.
 */
export function getTreasuryPrecision(bbgSymbol: string): TreasuryPrecision | null {
  const sym = bbgSymbol.trim().replace(/\s+/g, " ").toUpperCase();
  if (!sym.endsWith(" COMDTY")) return null;
  for (const { re, precision } of PATTERNS) {
    if (!re.test(sym)) continue;
    // A calendar spread on a Treasury root prices in eighths of a 32nd.
    return SPREAD_RE.test(sym.slice(0, -" COMDTY".length)) ? "eighth32" : precision;
  }
  return null;
}

/**
 * Generate Y-axis tick values snapped to valid Treasury price boundaries.
 *
 * @param yMin        Lower bound of the data price range (unpadded)
 * @param yMax        Upper bound of the data price range (unpadded)
 * @param precision   Contract precision from getTreasuryPrecision()
 * @param targetTicks Desired tick count (default 5); actual count may differ slightly
 * @returns           Array of decimal prices, each a valid contract price level
 */
export function generateTreasuryYTicks(
  yMin: number,
  yMax: number,
  precision: TreasuryPrecision,
  targetTicks = 5,
): number[] {
  const minTick =
    precision === "whole32"     ? 1 / 32
    : precision === "half32"    ? 1 / 64
    : precision === "quarter32" ? 1 / 128
    : /* eighth32 */              1 / 256;

  const range = yMax - yMin;

  // Degenerate range: return a single centred tick
  if (range < minTick / 2) {
    return [Math.round(((yMin + yMax) / 2) / minTick) * minTick];
  }

  // Candidate steps as powers-of-2 multiples of the minimum tick.
  // Pick the coarsest step that still yields ≤ targetTicks across the range.
  const mults = [1, 2, 4, 8, 16, 32, 64, 128, 256];
  let step = mults[mults.length - 1]! * minTick;
  for (const mult of mults) {
    const candidate = mult * minTick;
    if (range / candidate <= targetTicks) {
      step = candidate;
      break;
    }
  }

  // Snap to the grid boundary at or below yMin, then walk forward.
  // Round via integer minTick units to avoid floating-point drift.
  const startIdx = Math.floor(yMin / step);
  const ticks: number[] = [];
  for (let i = startIdx; ticks.length <= targetTicks + 2; i++) {
    const snapped = Math.round((i * step) / minTick) * minTick;
    if (snapped > yMax + minTick * 0.5) break;
    if (snapped >= yMin - minTick * 0.5) ticks.push(snapped);
  }

  return ticks;
}

/**
 * Convert a decimal price to US Treasury fractional notation.
 *
 * whole32:   "115-16"   (trailing digit omitted — whole 32nds only)
 * half32:    "115-165"  (trailing '0' or '5')
 * quarter32: "115-162"  (trailing '0', '2', '5', or '7')
 * eighth32:  "0-03 ¾"   (sub-32nd as a reduced fraction; spreads only)
 */
export function decToTreasuryFrac(decimal: number, precision: TreasuryPrecision): string {
  if (!isFinite(decimal) || isNaN(decimal)) return "—";

  if (precision === "eighth32") return eighth32ToFrac(decimal);

  const handle   = Math.floor(decimal);
  const fracPart = decimal - handle;

  if (precision === "whole32") {
    const n32 = Math.round(fracPart * 32);
    return `${handle}-${String(n32).padStart(2, "0")}`;
  }

  if (precision === "half32") {
    // Round to nearest 64th (half a 32nd)
    const n64      = Math.round(fracPart * 64);
    const whole32  = Math.floor(n64 / 2);
    const halfTick = n64 % 2;          // 0 → whole 32nd, 1 → +½ 32nd
    const sub      = halfTick === 0 ? "0" : "5";
    return `${handle}-${String(whole32).padStart(2, "0")}${sub}`;
  }

  // quarter32: round to nearest 128th (quarter of a 32nd)
  const n128        = Math.round(fracPart * 128);
  const whole32     = Math.floor(n128 / 4);
  const quarterTick = n128 % 4;        // 0-3
  const SUB = ["0", "2", "5", "7"] as const;
  const sub  = SUB[quarterTick]!;
  return `${handle}-${String(whole32).padStart(2, "0")}${sub}`;
}

/** Sub-32nd eighths, reduced: 2/8 shows as ¼, 4/8 as ½, 6/8 as ¾. */
const EIGHTHS = ["", "⅛", "¼", "⅜", "½", "⅝", "¾", "⅞"] as const;

/**
 * Render a price in 32nds with an eighth-of-a-32nd remainder: "0-03 ¾".
 *
 * Unlike the other precisions this handles sign explicitly.  Calendar spreads
 * trade through zero, and flooring a negative price the way the outright
 * formatters do would turn −0-03¾ into "-1-28 ¼".
 */
function eighth32ToFrac(decimal: number): string {
  const sign = decimal < 0 ? "-" : "";
  const abs  = Math.abs(decimal);

  // Work in integer 256ths so a value on the grid never drifts off it
  const n256    = Math.round(abs * 256);
  const handle  = Math.floor(n256 / 256);
  const rem     = n256 % 256;
  const whole32 = Math.floor(rem / 8);
  const eighths = rem % 8;

  const frac = EIGHTHS[eighths]!;
  return `${sign}${handle}-${String(whole32).padStart(2, "0")}${frac ? ` ${frac}` : ""}`;
}

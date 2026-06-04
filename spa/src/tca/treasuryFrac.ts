/**
 * US Treasury futures fractional price notation.
 *
 * Treasury futures are quoted in 32nds with optional sub-32nd precision
 * depending on the contract:
 *
 *   whole32   → US, WN          "115-16"   (1/32nd minimum tick)
 *   half32    → TY, UXY         "115-165"  (1/64th minimum tick; '5' = ½ of 1/32)
 *   quarter32 → FV, TU, 3Y      "115-162"  (1/128th minimum tick; '2/5/7' = ¼/½/¾ of 1/32)
 *
 * Detection uses the Bloomberg ticker prefix + " Comdty" yellow key.
 * The Comdty requirement avoids false matches (e.g. "USD Curncy" vs "US…").
 */

export type TreasuryPrecision = "whole32" | "half32" | "quarter32";

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
 * Returns the fractional-price precision for the given Bloomberg symbol,
 * or null if the symbol is not a recognised US Treasury future.
 */
export function getTreasuryPrecision(bbgSymbol: string): TreasuryPrecision | null {
  const sym = bbgSymbol.trim().replace(/\s+/g, " ").toUpperCase();
  if (!sym.endsWith(" COMDTY")) return null;
  for (const { re, precision } of PATTERNS) {
    if (re.test(sym)) return precision;
  }
  return null;
}

/**
 * Convert a decimal price to US Treasury fractional notation.
 *
 * whole32:   "115-16"   (trailing digit omitted — whole 32nds only)
 * half32:    "115-165"  (trailing '0' or '5')
 * quarter32: "115-162"  (trailing '0', '2', '5', or '7')
 */
export function decToTreasuryFrac(decimal: number, precision: TreasuryPrecision): string {
  if (!isFinite(decimal) || isNaN(decimal)) return "—";

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

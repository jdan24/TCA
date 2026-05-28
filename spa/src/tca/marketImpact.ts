/**
 * Market impact estimation — Almgren/Chriss square-root model.
 *
 * MI (bps) ≈ σ × sideSign × √(Q / ADV) × 10,000
 *
 *   σ   = realized daily volatility (fraction, e.g. 0.012 for 1.2%)
 *   Q   = order quantity (contracts)
 *   ADV = average daily volume (contracts)
 *
 * The participation fraction Q/ADV is clipped to [0, 1] to avoid unrealistic
 * estimates for very large orders relative to ADV.
 *
 * Positive result = cost (you moved the market against yourself).
 * Requires Bloomberg enrichment (ADV and daily vol). Returns null otherwise.
 */
import type { BloombergEnrichment, TradeRecord } from "@/types";
import { sideSign, toBps } from "./tcaUtils";

export function computeMarketImpact(
  trade: TradeRecord,
  enrichment: BloombergEnrichment | undefined
): number | null {
  if (!enrichment || enrichment.adv === 0 || enrichment.dailyVol === 0) return null;

  const participation = Math.min(trade.orderQty / enrichment.adv, 1);

  return toBps(enrichment.dailyVol * sideSign(trade.side) * Math.sqrt(participation));
}

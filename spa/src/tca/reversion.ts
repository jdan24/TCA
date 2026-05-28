/**
 * Post-trade price reversion — measures temporary vs. permanent market impact.
 *
 * Reversion_t (bps) = (price_t − avgFillPrice) / avgFillPrice × −sideSign × 10,000
 *
 * Measured at +1 min, +5 min, +30 min, and EOD after lastFillTime.
 * Prices at each mark are sourced from Bloomberg intraday bars (Phase 4).
 *
 * Interpretation:
 *   Positive → price reverted back toward arrival (favorable, temporary impact)
 *   Negative → price continued away from fill (adverse, permanent impact / info leakage)
 *
 * For a BUY:  you filled high, price drops back → (price_t < fill) → positive ✓
 * For a SELL: you filled low, price rises back → (price_t > fill) → positive ✓
 */
import type { BloombergEnrichment, TradeRecord } from "@/types";
import { sideSign, toBps } from "./tcaUtils";

export interface ReversionResult {
  reversion_1m_bps: number | null;
  reversion_5m_bps: number | null;
  reversion_30m_bps: number | null;
  reversion_EOD_bps: number | null;
}

function revert(
  priceAtT: number,
  avgFillPrice: number,
  side: "BUY" | "SELL"
): number | null {
  if (avgFillPrice === 0 || priceAtT === 0) return null;
  return toBps(((priceAtT - avgFillPrice) / avgFillPrice) * -sideSign(side));
}

export function computeReversion(
  trade: TradeRecord,
  enrichment: BloombergEnrichment | undefined
): ReversionResult {
  if (!enrichment) {
    return {
      reversion_1m_bps: null,
      reversion_5m_bps: null,
      reversion_30m_bps: null,
      reversion_EOD_bps: null,
    };
  }

  return {
    reversion_1m_bps: revert(enrichment.reversion1m, trade.avgFillPrice, trade.side),
    reversion_5m_bps: revert(enrichment.reversion5m, trade.avgFillPrice, trade.side),
    reversion_30m_bps: revert(enrichment.reversion30m, trade.avgFillPrice, trade.side),
    reversion_EOD_bps: revert(enrichment.reversionEOD, trade.avgFillPrice, trade.side),
  };
}

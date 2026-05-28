// TODO Phase 3
// Reversion_t (bps) = (price_t − avgFillPrice) / avgFillPrice × −sideSign × 10,000
// price_t sourced from Bloomberg intraday bars at +1m, +5m, +30m, EOD
import type { BloombergEnrichment, TradeRecord } from "@/types";

export interface ReversionResult {
  reversion_1m_bps: number | null;
  reversion_5m_bps: number | null;
  reversion_30m_bps: number | null;
  reversion_EOD_bps: number | null;
}

export function computeReversion(
  _trade: TradeRecord,
  _enrichment: BloombergEnrichment | undefined
): ReversionResult {
  return {
    reversion_1m_bps: null,
    reversion_5m_bps: null,
    reversion_30m_bps: null,
    reversion_EOD_bps: null,
  };
}

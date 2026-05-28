// TODO Phase 3
// VWAP_dev (bps) = (avgFillPrice − vwap) / vwap × sideSign × 10,000
// VWAP queried from Bloomberg over [orderTime → lastFillTime] per symbol per day
import type { BloombergEnrichment, TradeRecord } from "@/types";

export function computeVWAPDeviation(
  _trade: TradeRecord,
  _enrichment: BloombergEnrichment | undefined
): number | null {
  return null;
}

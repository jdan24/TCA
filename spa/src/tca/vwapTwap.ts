/**
 * VWAP deviation — measures execution quality against the intraday VWAP.
 *
 * VWAP_dev (bps) = (avgFillPrice − vwap) / vwap × sideSign × 10,000
 *
 * A positive result means you traded worse than VWAP:
 *   - BUY above VWAP (paid more than the market average)
 *   - SELL below VWAP (received less than the market average)
 *
 * Requires Bloomberg enrichment (intraday VWAP over [orderTime → lastFillTime]).
 * Returns null when enrichment is unavailable.
 */
import type { BloombergEnrichment, TradeRecord } from "@/types";
import { sideSign, toBps } from "./tcaUtils";

export function computeVWAPDeviation(
  trade: TradeRecord,
  enrichment: BloombergEnrichment | undefined
): number | null {
  if (!enrichment || enrichment.vwap === 0) return null;

  return toBps(
    ((trade.avgFillPrice - enrichment.vwap) / enrichment.vwap) * sideSign(trade.side)
  );
}

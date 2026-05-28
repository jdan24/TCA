/**
 * TCA computation orchestrator.
 *
 * computeAll() runs all six metric modules over a set of trades and
 * returns a TCAResult[] in the same order as the input trades array.
 *
 * Bloomberg-dependent metrics (VWAP deviation, market impact, reversion, TWAS)
 * return null when enrichment data is not available for a given orderId —
 * the dashboard renders those cells as "N/A".
 */
import type { BloombergEnrichment, TCAResult, TradeRecord } from "@/types";
import { computeMarketImpact } from "./marketImpact";
import { computeReversion } from "./reversion";
import { computeSlippage } from "./slippage";
import { computeTWAS } from "./spread";
import { computeTimeToFill } from "./timing";
import { computeVWAPDeviation } from "./vwapTwap";

export function computeAll(
  trades: TradeRecord[],
  enrichment: Record<string, BloombergEnrichment>
): TCAResult[] {
  return trades.map((trade) => {
    // enrichment is keyed by orderId; undefined when Bloomberg bridge is offline
    const e = enrichment[trade.orderId];
    const rev = computeReversion(trade, e);

    return {
      orderId: trade.orderId,
      IS_bps: computeSlippage(trade),
      VWAP_dev_bps: computeVWAPDeviation(trade, e),
      MI_bps: computeMarketImpact(trade, e),
      timeToFill_ms: computeTimeToFill(trade),
      reversion_1m_bps: rev.reversion_1m_bps,
      reversion_5m_bps: rev.reversion_5m_bps,
      reversion_30m_bps: rev.reversion_30m_bps,
      reversion_EOD_bps: rev.reversion_EOD_bps,
      TWAS_bps: computeTWAS(trade, e?.bidAskTicks ?? []),
    };
  });
}

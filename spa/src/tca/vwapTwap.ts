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
import type { BidAskTick, BloombergEnrichment, IntradayBar, TradeRecord } from "@/types";
import { sideSign, toBps } from "./tcaUtils";

/**
 * Market TWAP over [from, to].
 *
 * Source priority:
 *   1. Simple average of 1-min bar close prices within the window.
 *   2. Average of bid/ask mid prices from ticks (fallback for sub-minute orders
 *      where no complete bar falls inside the window).
 *   3. null when neither source yields any samples.
 */
export function computeMarketTWAP(
  bars: IntradayBar[],
  ticks: BidAskTick[],
  from: Date,
  to: Date,
): number | null {
  const fromMs = from.getTime();
  const toMs = to.getTime();

  // Prefer close prices from 1-min bars
  const closes = bars
    .filter((b) => {
      const t = new Date(b.time).getTime();
      return t >= fromMs && t <= toMs;
    })
    .map((b) => b.close);

  if (closes.length >= 1) {
    return closes.reduce((a, b) => a + b, 0) / closes.length;
  }

  // Fallback: average of bid/ask mid prices from ticks
  const mids = ticks
    .filter((tk) => {
      const ms = tk.time.getTime();
      return ms >= fromMs && ms <= toMs;
    })
    .map((tk) => (tk.bid + tk.ask) / 2);

  return mids.length >= 1
    ? mids.reduce((a, b) => a + b, 0) / mids.length
    : null;
}

/**
 * Slippage of avgFillPrice vs the market TWAP benchmark (bps).
 * Positive = adverse (paid more than TWAP on BUY, received less on SELL).
 */
export function computeTWAPDeviation(
  trade: TradeRecord,
  marketTWAP: number | null,
): number | null {
  if (marketTWAP === null || marketTWAP === 0) return null;
  return toBps(
    ((trade.avgFillPrice - marketTWAP) / marketTWAP) * sideSign(trade.side),
  );
}

export function computeVWAPDeviation(
  trade: TradeRecord,
  enrichment: BloombergEnrichment | undefined
): number | null {
  if (!enrichment || enrichment.vwap === 0) return null;

  return toBps(
    ((trade.avgFillPrice - enrichment.vwap) / enrichment.vwap) * sideSign(trade.side)
  );
}

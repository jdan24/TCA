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
 * Market TWAP over the order execution window [from, to].
 *
 * Boundary alignment: same minute-floor rule as computeVwap — we include
 * the bar that was open at order start and the bar open at last fill, not
 * just bars that started strictly inside (from, to).
 *
 * Price per bar: (open + close) / 2 — the midpoint of the first and last
 * trade in the bar.  This is a better time-weighted estimate than using
 * only the close (end-of-bar price) because it accounts for where price
 * spent more time during the minute.
 *
 * Source priority:
 *   1. Bar midpoints ((open + close) / 2) for bars covering the window.
 *   2. Bid/ask mid prices from ticks (fallback for sub-minute orders).
 *   3. null when neither source has any samples.
 */
export function computeMarketTWAP(
  bars: IntradayBar[],
  ticks: BidAskTick[],
  from: Date,
  to: Date,
): number | null {
  const ONE_MIN_MS = 60_000;
  const fromBarMs = Math.floor(from.getTime() / ONE_MIN_MS) * ONE_MIN_MS;
  const toBarMs   = Math.floor(to.getTime()   / ONE_MIN_MS) * ONE_MIN_MS;

  // Prefer bar midpoints
  const midpoints = bars
    .filter((b) => {
      const t = new Date(b.time).getTime();
      return t >= fromBarMs && t <= toBarMs;
    })
    .map((b) => (b.open + b.close) / 2);

  if (midpoints.length >= 1) {
    return midpoints.reduce((a, b) => a + b, 0) / midpoints.length;
  }

  // Fallback: average of bid/ask mid prices from ticks
  const fromMs = from.getTime();
  const toMs   = to.getTime();
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
  // Prefer Bloomberg VWAP; fall back to file-sourced VWAP when offline.
  const vwap =
    enrichment && enrichment.vwap !== 0
      ? enrichment.vwap
      : (trade.fileVwap ?? null);
  if (vwap === null || vwap === 0) return null;

  return toBps(((trade.avgFillPrice - vwap) / vwap) * sideSign(trade.side));
}

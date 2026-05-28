/**
 * Intraday volatility during the order execution window.
 *
 * computeOrderVol() returns:
 *   price — 1σ (sample std dev) of intraday prices during [orderTime, lastFillTime]
 *   bps   — price / avgFillPrice × 10,000
 *
 * Source priority:
 *   1. Close prices from 1-min bars that fall within the order window
 *   2. Bid/ask mid prices from tick data (fallback when bars are sparse)
 *   3. null when fewer than 2 samples are available
 */

import type { BidAskTick, IntradayBar, TradeRecord } from "@/types";

function sampleStdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

export function computeOrderVol(
  trade: TradeRecord,
  bars: IntradayBar[],
  ticks: BidAskTick[],
): { price: number | null; bps: number | null } {
  const fromMs = trade.orderTime.getTime();
  const toMs = trade.lastFillTime.getTime();

  // ── 1. Try close prices from 1-min bars ─────────────────────────────────
  const barPrices = bars
    .filter((b) => {
      const t = new Date(b.time).getTime();
      return t >= fromMs && t <= toMs;
    })
    .map((b) => b.close);

  const prices = barPrices.length >= 2 ? barPrices : null;

  // ── 2. Fallback: mid prices from bid/ask ticks ───────────────────────────
  const midPrices =
    prices === null
      ? ticks
          .filter((t) => {
            const ms = t.time.getTime();
            return ms >= fromMs && ms <= toMs;
          })
          .map((t) => (t.bid + t.ask) / 2)
      : null;

  const samples = prices ?? midPrices ?? [];
  if (samples.length < 2) return { price: null, bps: null };

  const sigma = sampleStdDev(samples);
  if (sigma === null || trade.avgFillPrice === 0) return { price: null, bps: null };

  const bps = (sigma / trade.avgFillPrice) * 10_000;
  return { price: sigma, bps };
}

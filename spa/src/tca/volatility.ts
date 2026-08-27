/**
 * 1σ of market price during the order execution window [orderTime, lastFillTime].
 *
 * Answers: "how much did the market price vary while this order was executing?"
 *
 * Method
 * ──────
 * For each 1-min bar in the window we take (high + low) / 2 — the bar
 * midpoint.  The midpoint represents where the market genuinely spent time
 * during that minute, rather than the close (last random tick of the minute)
 * which is a single noisy endpoint.
 *
 * We then compute the sample standard deviation of those midpoints.
 * Result: σ_price is in the instrument's native price units (handles for
 * futures); σ_bps normalises by the mean market midpoint so the percentage
 * is relative to where the market was, not where the order filled.
 *
 * Source priority:
 *   1. Bar midpoints (high + low) / 2 for 1-min bars in the window (≥ 2 bars)
 *   2. Bid/ask mid prices from tick data (fallback for sub-minute orders)
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

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function computeOrderVol(
  trade: TradeRecord,
  bars: IntradayBar[],
  ticks: BidAskTick[],
): { price: number | null; bps: number | null } {
  const ONE_MIN_MS = 60_000;
  // Align to bar minute boundaries (same as VWAP/TWAP/participation-rate).
  const fromBarMs = Math.floor(trade.orderTime.getTime()    / ONE_MIN_MS) * ONE_MIN_MS;
  const toBarMs   = Math.floor(trade.lastFillTime.getTime() / ONE_MIN_MS) * ONE_MIN_MS;

  // Exact ms used for the tick fallback only (ticks are sub-minute).
  const fromMs = trade.orderTime.getTime();
  const toMs   = trade.lastFillTime.getTime();

  // ── 1. Bar midpoints: (high + low) / 2 ──────────────────────────────────
  // The midpoint is the centre of the bar's price range and better represents
  // where the market was during the minute than the close (final random tick).
  const barMidpoints = bars
    .filter((b) => {
      const t = new Date(b.time).getTime();
      return t >= fromBarMs && t <= toBarMs;
    })
    .map((b) => (b.high + b.low) / 2);

  const samples: number[] =
    barMidpoints.length >= 2
      ? barMidpoints
      : (() => {
          // ── 2. Tick-mid fallback for very short orders ───────────────────
          return ticks
            .filter((tk) => {
              const ms = tk.time.getTime();
              return ms >= fromMs && ms <= toMs;
            })
            .map((tk) => (tk.bid + tk.ask) / 2);
        })();

  if (samples.length < 2) return { price: null, bps: null };

  const sigma = sampleStdDev(samples);
  if (sigma === null) return { price: null, bps: null };

  // Normalise by the mean market price during the window (not the fill price)
  // so the bps figure reflects market movement, not execution quality.
  const marketMean = mean(samples);
  if (marketMean === 0) return { price: sigma, bps: null };

  const bps = (sigma / marketMean) * 10_000;
  return { price: sigma, bps };
}

// ── Volatility-normalised slippage ───────────────────────────────────────────

/**
 * Below this a σ reading is treated as unusable.
 *
 * computeOrderVol needs only two samples, and two near-identical bar midpoints
 * produce a σ of essentially zero — a sampling artifact far more often than a
 * genuine reading of a dead market. Dividing by it yields thousand-sigma values
 * that would dominate every average they touch. Same reasoning as MIN_ABS_MID
 * in tca/spread.ts.
 */
export const MIN_VOL_BPS = 0.1;

/**
 * Slippage expressed in standard deviations of the market's own movement during
 * the order: IS_bps ÷ σ_bps.
 *
 * An 8 bps miss is a serious failure in a quiet session and unremarkable on a
 * turbulent one; the raw bps figure reports both identically. Dividing by the
 * realised σ over that order's own window separates them.
 *
 * The result is duration-invariant, which is what lets a 30-second and a
 * two-hour order share a column: over a window of length T both σ and a
 * drift-driven IS scale with √T, so the ratio cancels it out.
 *
 * Positive is a cost, matching IS_bps and every other signed metric here.
 * Returns null — never 0 — when either input is missing or σ is unusable.
 */
export function volAdjustedIS(
  is: number | null | undefined,
  vol: number | null | undefined,
): number | null {
  if (typeof is !== "number" || !isFinite(is)) return null;
  if (typeof vol !== "number" || !isFinite(vol)) return null;
  if (Math.abs(vol) < MIN_VOL_BPS) return null;
  return is / vol;
}

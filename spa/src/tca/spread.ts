/**
 * Time-Weighted Average Spread (TWAS) — liquidity environment proxy.
 *
 * spread_i (bps) = (ask_i − bid_i) / |mid_i| × 10,000
 * TWAS (bps)     = Σ(spread_i × Δt_i) / totalOrderDuration
 *
 * where Δt_i is the time each quote was valid (tick i until tick i+1,
 * or until lastFillTime for the final tick).
 *
 * Also returns the same average as a raw price width (ask − bid). On an
 * instrument whose mid sits near zero — a futures calendar spread quoted
 * 0-03¾ / 0-03⅞, say — bps is large and jumpy while the price width is the
 * number a trader actually recognises.
 *
 * Interpretation:
 *   High TWAS + low slippage  → good execution in a wide-spread environment
 *   Low TWAS  + high slippage → poor execution relative to available liquidity
 *
 * Requires Bloomberg bid/ask tick data. Returns nulls when no ticks are provided.
 */
import type { BidAskTick, TradeRecord } from "@/types";

/**
 * Below this the mid is treated as zero: a calendar spread can trade through
 * zero, and (ask − bid) / mid explodes as it does. Better to report no bps than
 * a number that swings by orders of magnitude on the last tick of the mid.
 */
export const MIN_ABS_MID = 1e-6;

export interface TWASResult {
  /** Time-weighted average spread in bps, or null when the mid is unusable. */
  bps: number | null;
  /** Time-weighted average spread as a raw price width (ask − bid). */
  price: number | null;
}

const EMPTY: TWASResult = { bps: null, price: null };

export function computeTWAS(trade: TradeRecord, ticks: BidAskTick[]): TWASResult {
  if (ticks.length === 0) return EMPTY;

  const totalDuration =
    trade.lastFillTime.getTime() - trade.orderTime.getTime();

  // Degenerate case: instantaneous fill or single tick
  if (totalDuration <= 0 || ticks.length === 1) {
    const tick = ticks[0];
    if (!tick) return EMPTY;
    const mid = Math.abs((tick.bid + tick.ask) / 2);
    const width = tick.ask - tick.bid;
    return {
      bps: mid >= MIN_ABS_MID ? (width / mid) * 10_000 : null,
      price: width,
    };
  }

  // Sort ticks chronologically
  const sorted = [...ticks].sort((a, b) => a.time.getTime() - b.time.getTime());

  let bpsWeightedSum = 0;
  let bpsWeight = 0;
  let priceWeightedSum = 0;
  let priceWeight = 0;

  for (let i = 0; i < sorted.length; i++) {
    const tick = sorted[i];
    if (!tick) continue;

    // Each tick is valid until the next tick fires, or until lastFillTime
    const nextTick = sorted[i + 1];
    const nextMs = nextTick?.time.getTime() ?? trade.lastFillTime.getTime();
    const deltaT = nextMs - tick.time.getTime();

    if (deltaT <= 0) continue;

    const width = tick.ask - tick.bid;
    priceWeightedSum += width * deltaT;
    priceWeight += deltaT;

    // The price width is always meaningful; bps only when the mid is usable,
    // so the two carry their own weights rather than sharing one.
    const mid = Math.abs((tick.bid + tick.ask) / 2);
    if (mid < MIN_ABS_MID) continue;

    bpsWeightedSum += (width / mid) * 10_000 * deltaT;
    bpsWeight += deltaT;
  }

  return {
    bps: bpsWeight > 0 ? bpsWeightedSum / bpsWeight : null,
    price: priceWeight > 0 ? priceWeightedSum / priceWeight : null,
  };
}

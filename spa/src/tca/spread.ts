/**
 * Time-Weighted Average Spread (TWAS) — liquidity environment proxy.
 *
 * spread_i (bps) = (ask_i − bid_i) / mid_i × 10,000
 * TWAS (bps)     = Σ(spread_i × Δt_i) / totalOrderDuration
 *
 * where Δt_i is the time each quote was valid (tick i until tick i+1,
 * or until lastFillTime for the final tick).
 *
 * Interpretation:
 *   High TWAS + low slippage  → good execution in a wide-spread environment
 *   Low TWAS  + high slippage → poor execution relative to available liquidity
 *
 * Requires Bloomberg bid/ask tick data. Returns null when no ticks are provided.
 */
import type { BidAskTick, TradeRecord } from "@/types";

export function computeTWAS(trade: TradeRecord, ticks: BidAskTick[]): number | null {
  if (ticks.length === 0) return null;

  const totalDuration =
    trade.lastFillTime.getTime() - trade.orderTime.getTime();

  // Degenerate case: instantaneous fill or single tick
  if (totalDuration <= 0 || ticks.length === 1) {
    const tick = ticks[0];
    if (!tick) return null;
    const mid = (tick.bid + tick.ask) / 2;
    return mid > 0 ? ((tick.ask - tick.bid) / mid) * 10_000 : null;
  }

  // Sort ticks chronologically
  const sorted = [...ticks].sort((a, b) => a.time.getTime() - b.time.getTime());

  let weightedSum = 0;
  let totalWeight = 0;

  for (let i = 0; i < sorted.length; i++) {
    const tick = sorted[i];
    if (!tick) continue;

    // Each tick is valid until the next tick fires, or until lastFillTime
    const nextTick = sorted[i + 1];
    const nextMs = nextTick?.time.getTime() ?? trade.lastFillTime.getTime();
    const deltaT = nextMs - tick.time.getTime();

    if (deltaT <= 0) continue;

    const mid = (tick.bid + tick.ask) / 2;
    if (mid <= 0) continue;

    const spreadBps = ((tick.ask - tick.bid) / mid) * 10_000;
    weightedSum += spreadBps * deltaT;
    totalWeight += deltaT;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : null;
}

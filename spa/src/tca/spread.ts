/**
 * Time-Weighted Average Spread (TWAS) — liquidity environment proxy.
 *
 * spread_i (bps) = (ask_i − bid_i) / |mid_i| × 10,000
 * TWAS (bps)     = Σ(spread_i × Δt_i) / totalOrderDuration
 *
 * where Δt_i is the time each quote was valid (tick i until tick i+1,
 * or until lastFillTime for the final tick).
 *
 * Measured strictly over [orderTime, lastFillTime]. Ticks arrive from two
 * minutes before the order (the bridge needs a lead-in to find the quote in
 * force at arrival), and weighting that lead-in put pre-arrival conditions into
 * the figure — on a fast order it dominated the average outright. windowedTicks
 * below does the clipping, and carries the opening quote forward to the start.
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

/**
 * The quote in force at `t` — the latest tick at or before it.
 *
 * The bridge only emits a pair when the quote actually changes, so on a market
 * that sits still the only relevant pair can predate the moment asked about.
 */
export function quoteAtOrBefore(ticks: BidAskTick[], t: Date): BidAskTick | null {
  const ms = t.getTime();
  let best: BidAskTick | null = null;
  for (const tk of ticks) {
    const tkMs = tk.time.getTime();
    if (tkMs <= ms && (best === null || tkMs > best.time.getTime())) best = tk;
  }
  return best;
}

/**
 * Ticks clipped to `[startMs, endMs]`, sorted, with the quote prevailing at the
 * start carried forward to it.
 *
 * Bid/ask ticks are fetched from two minutes before the order (see
 * fetchBidAskTicks in bloomberg/enrichmentService.ts), so weighting the raw
 * array measures mostly pre-arrival conditions — on a fast order the lead-in
 * dominates the average outright. Carrying the opening quote to the window start
 * rather than dropping it is what keeps a still market from reading as "no
 * spread data", and it closes the gap between the start and the first quote
 * inside the window.
 */
export function windowedTicks(
  ticks: BidAskTick[],
  startMs: number,
  endMs: number,
): BidAskTick[] {
  const sorted = [...ticks].sort((a, b) => a.time.getTime() - b.time.getTime());
  let opening: BidAskTick | null = null;
  const inWindow: BidAskTick[] = [];
  for (const tk of sorted) {
    const ms = tk.time.getTime();
    if (ms <= startMs) opening = tk;
    else if (ms <= endMs) inWindow.push(tk);
  }
  return opening !== null
    ? [{ ...opening, time: new Date(startMs) }, ...inWindow]
    : inWindow;
}

export function computeTWAS(trade: TradeRecord, ticks: BidAskTick[]): TWASResult {
  if (ticks.length === 0) return EMPTY;

  const startMs = trade.orderTime.getTime();
  const endMs = trade.lastFillTime.getTime();
  const totalDuration = endMs - startMs;

  // Everything below works on the order's own window, never the fetch window.
  const sorted = windowedTicks(ticks, startMs, endMs);
  if (sorted.length === 0) return EMPTY;

  // Degenerate case: instantaneous fill or a single quote for the whole order.
  // sorted[0] is the quote prevailing at arrival — taking the raw array's first
  // element here would have taken the oldest tick in the lead-in instead.
  if (totalDuration <= 0 || sorted.length === 1) {
    const tick = sorted[0];
    if (!tick) return EMPTY;
    const mid = Math.abs((tick.bid + tick.ask) / 2);
    const width = tick.ask - tick.bid;
    return {
      bps: mid >= MIN_ABS_MID ? (width / mid) * 10_000 : null,
      price: width,
    };
  }

  let bpsWeightedSum = 0;
  let bpsWeight = 0;
  let priceWeightedSum = 0;
  let priceWeight = 0;

  for (let i = 0; i < sorted.length; i++) {
    const tick = sorted[i];
    if (!tick) continue;

    // Each tick is valid until the next tick fires, or until the window closes
    const nextTick = sorted[i + 1];
    const nextMs = nextTick?.time.getTime() ?? endMs;
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

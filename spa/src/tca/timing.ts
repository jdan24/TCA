// TODO Phase 3
// - timeToFill_ms: lastFillTime − orderTime
// - intraday 30-min bucket assignment for heatmap
// - participation rate: fillQty / bloombergIntradayVolume over execution window
import type { TradeRecord } from "@/types";

/** Returns time-to-fill in milliseconds. */
export function computeTimeToFill(_trade: TradeRecord): number {
  return 0;
}

/** Returns the 30-min intraday bucket index (0–47) for a given timestamp. */
export function intradayBucket(_time: Date): number {
  return 0;
}

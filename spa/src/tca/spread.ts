// TODO Phase 3
// TWAS (bps) = Σ(spread_i × Δt_i) / totalOrderDuration
// spread_i = (ask_i − bid_i) / mid_i × 10,000
// bid/ask ticks sourced from Bloomberg over [orderTime → lastFillTime]
import type { BidAskTick, TradeRecord } from "@/types";

export function computeTWAS(_trade: TradeRecord, _ticks: BidAskTick[]): number | null {
  return null;
}

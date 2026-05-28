// TODO Phase 3
// IS (bps) = (avgFillPrice − arrivalPrice) / arrivalPrice × sideSign × 10,000
// sideSign = +1 for BUY, −1 for SELL
import type { TradeRecord } from "@/types";

export function computeSlippage(_trade: TradeRecord): number | null {
  return null;
}

/**
 * Implementation Shortfall (IS) — slippage vs arrival price.
 *
 * IS (bps) = (avgFillPrice − arrivalPrice) / arrivalPrice × sideSign × 10,000
 *
 * sideSign = +1 for BUY, −1 for SELL.
 * A positive result means cost: you paid more (BUY) or received less (SELL)
 * than the arrival benchmark.
 *
 * Returns null when arrivalPrice is unavailable (Bloomberg bridge offline).
 */
import type { TradeRecord } from "@/types";
import { sideSign, toBps } from "./tcaUtils";

export function computeSlippage(trade: TradeRecord, enrichmentArrivalPrice?: number | null): number | null {
  const { avgFillPrice, side } = trade;
  const arrivalPrice = trade.arrivalPrice ?? enrichmentArrivalPrice ?? null;

  if (arrivalPrice === null || arrivalPrice === 0) return null;

  return toBps(((avgFillPrice - arrivalPrice) / arrivalPrice) * sideSign(side));
}

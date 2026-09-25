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

/**
 * The arrival price an order is measured against: a manual override first,
 * then the file's own column, then Bloomberg's snapshot.
 */
export function effectiveArrivalPrice(
  trade: TradeRecord,
  enrichmentArrivalPrice?: number | null,
): number | null {
  return trade.arrivalPriceOverride ?? trade.arrivalPrice ?? enrichmentArrivalPrice ?? null;
}

export function computeSlippage(trade: TradeRecord, enrichmentArrivalPrice?: number | null): number | null {
  const { avgFillPrice, side } = trade;
  const arrivalPrice = effectiveArrivalPrice(trade, enrichmentArrivalPrice);

  if (arrivalPrice === null || arrivalPrice === 0) return null;

  return toBps(((avgFillPrice - arrivalPrice) / arrivalPrice) * sideSign(side));
}

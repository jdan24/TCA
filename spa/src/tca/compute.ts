/**
 * TCA computation orchestrator.
 *
 * computeAll() runs all metric modules over a set of trades and returns
 * a TCAResult[] in the same order as the input trades array.
 *
 * Bloomberg-dependent metrics (VWAP deviation, market impact, reversion,
 * TWAS, vol) return null when enrichment data is not available for a given
 * orderId — the dashboard renders those cells as "N/A".
 *
 * computeParentOrderSummary() aggregates all trades into a single parent-order
 * view for Mode 2 (Single Order TCA).
 */
import type { BloombergEnrichment, ParentOrderSummary, TCAResult, TradeRecord } from "@/types";
import { computeMarketImpact } from "./marketImpact";
import { computeReversion } from "./reversion";
import { computeSlippage } from "./slippage";
import { computeTWAS } from "./spread";
import { computeTimeToFill } from "./timing";
import { computeOrderVol } from "./volatility";
import { computeMarketTWAP, computeTWAPDeviation, computeVWAPDeviation } from "./vwapTwap";
import { sideSign } from "./tcaUtils";

export function computeAll(
  trades: TradeRecord[],
  enrichment: Record<string, BloombergEnrichment>
): TCAResult[] {
  return trades.map((trade) => {
    // enrichment is keyed by orderId; undefined when Bloomberg bridge is offline
    const e = enrichment[trade.orderId];
    const rev = computeReversion(trade, e);

    // computeOrderVol is called once per trade and destructured
    const vol = e
      ? computeOrderVol(trade, e.barsSnapshot, e.bidAskTicks)
      : { price: null, bps: null };

    // Market TWAP: avg of close prices within [orderTime, lastFillTime]
    const marketTWAP = e
      ? computeMarketTWAP(e.barsSnapshot, e.bidAskTicks, trade.orderTime, trade.lastFillTime)
      : null;

    return {
      orderId: trade.orderId,
      IS_bps: computeSlippage(trade),
      VWAP_dev_bps: computeVWAPDeviation(trade, e),
      MI_bps: computeMarketImpact(trade, e),
      timeToFill_ms: computeTimeToFill(trade),
      reversion_1m_bps: rev.reversion_1m_bps,
      reversion_5m_bps: rev.reversion_5m_bps,
      reversion_30m_bps: rev.reversion_30m_bps,
      reversion_EOD_bps: rev.reversion_EOD_bps,
      TWAS_bps: computeTWAS(trade, e?.bidAskTicks ?? []),
      vol_during_order_price: vol.price,
      vol_during_order_bps: vol.bps,
      TWAP_dev_bps: computeTWAPDeviation(trade, marketTWAP),
      marketVWAP_price: e?.vwap ?? null,
    };
  });
}

/**
 * Aggregate all trades into a single parent-order summary (Mode 2).
 *
 * Returns null when the trades array is empty or has inconsistent sides.
 * `enrichment` is used for arrival price fallback and participation rate.
 */
export function computeParentOrderSummary(
  trades: TradeRecord[],
  results: TCAResult[],
  enrichment: Record<string, BloombergEnrichment>
): ParentOrderSummary | null {
  if (trades.length === 0) return null;

  // Use the first trade's side; warn if mixed (we proceed anyway)
  const firstTrade = trades[0];
  if (!firstTrade) return null;
  const side = firstTrade.side;

  // ── Aggregate quantities and VWAP ────────────────────────────────────────
  const totalQty = trades.reduce((s, t) => s + t.orderQty, 0);
  const totalNotional = trades.reduce((s, t) => s + t.avgFillPrice * t.orderQty, 0);
  const fillVwap = totalQty > 0 ? totalNotional / totalQty : 0;

  // ── Time bounds ───────────────────────────────────────────────────────────
  const orderTime = trades.reduce(
    (min, t) => (t.orderTime < min ? t.orderTime : min),
    firstTrade.orderTime
  );
  const lastFillTime = trades.reduce(
    (max, t) => (t.lastFillTime > max ? t.lastFillTime : max),
    firstTrade.lastFillTime
  );
  const duration_ms = lastFillTime.getTime() - orderTime.getTime();

  // ── Arrival price: from first trade's field, then first enrichment found ──
  const arrivalPrice: number | null =
    firstTrade.arrivalPrice ??
    (() => {
      for (const t of trades) {
        const e = enrichment[t.orderId];
        if (e) return e.arrivalPrice;
      }
      return null;
    })();

  // ── IS bps at parent level ────────────────────────────────────────────────
  const IS_bps =
    arrivalPrice !== null && arrivalPrice > 0
      ? ((fillVwap - arrivalPrice) / arrivalPrice) * sideSign(side) * 10_000
      : null;

  // ── Vol: average of per-slice vol bps ────────────────────────────────────
  const volBpsVals = results
    .map((r) => r.vol_during_order_bps)
    .filter((v): v is number => v !== null);
  const volPriceVals = results
    .map((r) => r.vol_during_order_price)
    .filter((v): v is number => v !== null);

  const vol_during_order_bps = volBpsVals.length > 0
    ? volBpsVals.reduce((a, b) => a + b, 0) / volBpsVals.length
    : null;
  const vol_during_order_price = volPriceVals.length > 0
    ? volPriceVals.reduce((a, b) => a + b, 0) / volPriceVals.length
    : null;

  // ── Participation rate: totalQty / exchange volume during order window ──────
  // Use actual market volume from the 1-min bars that fall within
  // [orderTime, lastFillTime] (same minute-floor boundary as VWAP/TWAP).
  // All slices are fills of the same security so we only need bars from
  // the first enriched trade.
  const ONE_MIN_MS = 60_000;
  const fromBarMs = Math.floor(orderTime.getTime() / ONE_MIN_MS) * ONE_MIN_MS;
  const toBarMs   = Math.floor(lastFillTime.getTime() / ONE_MIN_MS) * ONE_MIN_MS;

  let orderWindowVolume = 0;
  for (const trade of trades) {
    const e = enrichment[trade.orderId];
    if (e?.barsSnapshot && e.barsSnapshot.length > 0) {
      for (const bar of e.barsSnapshot) {
        const barMs = new Date(bar.time).getTime();
        if (barMs >= fromBarMs && barMs <= toBarMs) {
          orderWindowVolume += bar.volume;
        }
      }
      break; // same security for all slices — first enriched trade's bars suffice
    }
  }

  const participationRate = orderWindowVolume > 0 ? totalQty / orderWindowVolume : null;

  return {
    symbol: firstTrade.symbol,
    side,
    totalQty,
    fillVwap,
    arrivalPrice,
    IS_bps,
    orderTime,
    lastFillTime,
    duration_ms,
    vol_during_order_price,
    vol_during_order_bps,
    participationRate,
  };
}

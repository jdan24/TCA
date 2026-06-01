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

    // For orders ≤ 5 min, 1-min bars are too coarse — pass empty bars to force
    // tick-midpoint fallback in computeMarketTWAP and computeOrderVol.
    // e.barsSnapshot is still used below for computeDailyVolFromBars (MI).
    const SHORT_MS = 5 * 60_000;
    const isShortOrder =
      trade.lastFillTime.getTime() - trade.orderTime.getTime() <= SHORT_MS;
    const barsForBenchmarks = isShortOrder ? [] : (e?.barsSnapshot ?? []);

    // computeOrderVol: use tick fallback for short orders (same as TWAP)
    const vol = e
      ? computeOrderVol(trade, barsForBenchmarks, e.bidAskTicks)
      : { price: null, bps: null };

    // Market TWAP: avg of (open+close)/2 per bar (or tick mids for short orders)
    const marketTWAP = e
      ? computeMarketTWAP(barsForBenchmarks, e.bidAskTicks, trade.orderTime, trade.lastFillTime)
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

  // ── Market VWAP (scalar) and running market VWAP (per-fill) ─────────────────
  // Scalar: full-window VWAP shown on the summary card.
  // Running: one point per fill from orderTime up to that fill, shown as an
  //          evolving chart line.  Both use tick midpoints for orders ≤ 5 min
  //          and bar close×volume for longer orders.
  const SHORT_MS_PARENT = 5 * 60_000;
  const isShortParent = lastFillTime.getTime() - orderTime.getTime() <= SHORT_MS_PARENT;
  let marketVwap: number | null = null;
  let runningMarketVwap: Array<{ t: number; vwap: number }> | null = null;

  const sortedFills = [...trades].sort(
    (a, b) => a.lastFillTime.getTime() - b.lastFillTime.getTime()
  );

  for (const trade of trades) {
    const e = enrichment[trade.orderId];
    if (!e) continue;

    if (isShortParent) {
      // Scalar VWAP: true trade VWAP Σ(price×size)/Σ(size) over the full window
      const fromMs = orderTime.getTime();
      const toMs   = lastFillTime.getTime();
      let sumPV = 0, sumV = 0;
      for (const tk of e.tradeTicks) {
        const ms = tk.time.getTime();
        if (ms >= fromMs && ms <= toMs && tk.size > 0) {
          sumPV += tk.price * tk.size;
          sumV  += tk.size;
        }
      }
      marketVwap = sumV > 0 ? sumPV / sumV : null;
    } else {
      // Scalar VWAP: volume-weighted close × volume over the bar window
      let sumPV = 0, sumV = 0;
      for (const bar of e.barsSnapshot) {
        const barMs = new Date(bar.time).getTime();
        if (barMs >= fromBarMs && barMs <= toBarMs) {
          sumPV += bar.close * bar.volume;
          sumV  += bar.volume;
        }
      }
      marketVwap = sumV > 0 ? sumPV / sumV : null;
    }

    // Running VWAP: one point per fill, window = [orderTime, fillTime]
    const points: Array<{ t: number; vwap: number }> = [];
    for (const fill of sortedFills) {
      const fillTimeMs = fill.lastFillTime.getTime();
      let vwap: number | null = null;

      if (isShortParent) {
        // Up to and including the fill second — true VWAP Σ(price×size)/Σ(size)
        const fromMs = orderTime.getTime();
        let sumPV = 0, sumV = 0;
        for (const tk of e.tradeTicks) {
          const ms = tk.time.getTime();
          if (ms >= fromMs && ms <= fillTimeMs && tk.size > 0) {
            sumPV += tk.price * tk.size;
            sumV  += tk.size;
          }
        }
        vwap = sumV > 0 ? sumPV / sumV : null;
      } else {
        // Up to and including the fill minute — bar close × volume
        const fillMinuteMs = Math.floor(fillTimeMs / ONE_MIN_MS) * ONE_MIN_MS;
        let sumPV = 0, sumV = 0;
        for (const bar of e.barsSnapshot) {
          const barMs = new Date(bar.time).getTime();
          if (barMs >= fromBarMs && barMs <= fillMinuteMs) {
            sumPV += bar.close * bar.volume;
            sumV  += bar.volume;
          }
        }
        vwap = sumV > 0 ? sumPV / sumV : null;
      }

      if (vwap !== null) points.push({ t: fillTimeMs, vwap });
    }
    runningMarketVwap = points.length > 0 ? points : null;

    break; // same security for all slices — first enriched trade suffices
  }

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
    marketVwap,
    runningMarketVwap,
  };
}

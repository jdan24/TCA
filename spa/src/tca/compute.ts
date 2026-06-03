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
import type { BidAskTick, BloombergEnrichment, ParentOrderSummary, TCAResult, TradeRecord } from "@/types";
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

    // TWAP: prefer Bloomberg-derived marketTWAP; fall back to file-sourced fileTwap
    const marketTWAPFinal = marketTWAP ?? trade.fileTwap ?? null;

    return {
      orderId: trade.orderId,
      IS_bps: computeSlippage(trade),
      VWAP_dev_bps: computeVWAPDeviation(trade, e),
      MI_bps: computeMarketImpact(trade, e),
      timeToFill_ms: computeTimeToFill(trade),
      reversion_30s_bps: rev.reversion_30s_bps,
      reversion_1m_bps: rev.reversion_1m_bps,
      TWAS_bps: computeTWAS(trade, e?.bidAskTicks ?? []),
      vol_during_order_price: vol.price,
      vol_during_order_bps: vol.bps,
      TWAP_dev_bps: computeTWAPDeviation(trade, marketTWAPFinal),
      // Market VWAP price: Bloomberg scalar, then file VWAP as offline fallback
      marketVWAP_price: (e && e.vwap !== 0 ? e.vwap : null) ?? trade.fileVwap ?? null,
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
  enrichment: Record<string, BloombergEnrichment>,
  /** Optional manual override for the order window — affects all metric computations. */
  timeOverride?: { start: Date; end: Date },
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
  const orderTime = timeOverride?.start ?? trades.reduce(
    (min, t) => (t.orderTime < min ? t.orderTime : min),
    firstTrade.orderTime
  );
  const lastFillTime = timeOverride?.end ?? trades.reduce(
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

  // ── Shared time constants ─────────────────────────────────────────────────
  const ONE_MIN_MS  = 60_000;
  const SHORT_MS    = 5 * 60_000;
  const isShortOrder = duration_ms <= SHORT_MS;
  const orderMs    = orderTime.getTime();
  const lastFillMs = lastFillTime.getTime();
  const fromBarMs  = Math.floor(orderMs    / ONE_MIN_MS) * ONE_MIN_MS;
  const toBarMs    = Math.floor(lastFillMs / ONE_MIN_MS) * ONE_MIN_MS;

  // ── Vol + participation rate — Bloomberg-direct, full parent window ────────
  //
  // Vol: sample std dev of market prices over [orderTime, lastFillTime].
  //   Short orders (≤5 min): std dev of last-traded prices from trade ticks.
  //   Long  orders (>5 min): std dev of bar midpoints (high+low)/2.
  //   Normalised by the window mean → bps.
  //
  // Participation: totalQty / Σ(trade tick sizes in [orderTime, lastFillTime]).
  //   Uses actual prints collected from Bloomberg rather than bar-aggregated
  //   volume, so the denominator matches exactly what traded in the window.
  let vol_during_order_price: number | null = null;
  let vol_during_order_bps:   number | null = null;
  let participationRate:       number | null = null;

  for (const trade of trades) {
    const e = enrichment[trade.orderId];
    if (!e) continue;

    // Vol
    const volSamples: number[] = isShortOrder
      ? e.tradeTicks
          .filter((tk) => { const ms = tk.time.getTime(); return ms >= orderMs && ms <= lastFillMs; })
          .map((tk) => tk.price)
      : e.barsSnapshot
          .filter((b)  => { const t = new Date(b.time).getTime(); return t >= fromBarMs && t <= toBarMs; })
          .map((b)  => (b.high + b.low) / 2);

    if (volSamples.length >= 2) {
      const n   = volSamples.length;
      const mu  = volSamples.reduce((a, b) => a + b, 0) / n;
      const sig = Math.sqrt(volSamples.reduce((s, v) => s + (v - mu) ** 2, 0) / (n - 1));
      vol_during_order_price = sig;
      vol_during_order_bps   = mu > 0 ? (sig / mu) * 10_000 : null;
    }

    // Participation rate from trade tick sizes (actual market prints)
    let mktVol = 0;
    for (const tk of e.tradeTicks) {
      const ms = tk.time.getTime();
      if (ms >= orderMs && ms <= lastFillMs) mktVol += tk.size;
    }
    participationRate = mktVol > 0 ? totalQty / mktVol : null;

    break; // same security for all slices — first enriched trade suffices
  }

  // ── Market VWAP (scalar) and running market VWAP (per-fill) ─────────────────
  // Scalar: full-window VWAP shown on the summary card.
  // Running: one point per fill from orderTime up to that fill, shown as an
  //          evolving chart line.  Both use tick midpoints for orders ≤ 5 min
  //          and bar close×volume for longer orders.
  let marketVwap: number | null = null;
  let runningMarketVwap: Array<{ t: number; vwap: number }> | null = null;
  let runningMarketTwap: Array<{ t: number; twap: number }> | null = null;

  const sortedFills = [...trades].sort(
    (a, b) => a.lastFillTime.getTime() - b.lastFillTime.getTime()
  );

  for (const trade of trades) {
    const e = enrichment[trade.orderId];
    if (!e) continue;

    // ── Scalar market VWAP ────────────────────────────────────────────────
    // True tick VWAP Σ(price×size)/Σ(size) for all order durations.
    // Previously long orders used bar close×volume which diverges from the
    // Bloomberg terminal figure.  Bars are kept as fallback only when the
    // tick stream is empty (e.g. illiquid session, data gap).
    {
      let sumPV = 0, sumV = 0;
      for (const tk of e.tradeTicks) {
        const ms = tk.time.getTime();
        if (ms >= orderMs && ms <= lastFillMs && tk.size > 0) {
          sumPV += tk.price * tk.size;
          sumV  += tk.size;
        }
      }
      if (sumV > 0) {
        marketVwap = sumPV / sumV;
      } else {
        // Bar fallback: Σ(close×volume)/Σ(volume)
        let bPV = 0, bV = 0;
        for (const bar of e.barsSnapshot) {
          const barMs = new Date(bar.time).getTime();
          if (barMs >= fromBarMs && barMs <= toBarMs) {
            bPV += bar.close * bar.volume;
            bV  += bar.volume;
          }
        }
        if (bV > 0) marketVwap = bPV / bV;
      }
    }

    // ── Running market VWAP ───────────────────────────────────────────────
    // Same tick-first / bar-fallback logic, computed up to each fill time.
    const points: Array<{ t: number; vwap: number }> = [];
    for (const fill of sortedFills) {
      const fillTimeMs = fill.lastFillTime.getTime();
      let vwap: number | null = null;

      let sumPV = 0, sumV = 0;
      for (const tk of e.tradeTicks) {
        const ms = tk.time.getTime();
        if (ms >= orderMs && ms <= fillTimeMs && tk.size > 0) {
          sumPV += tk.price * tk.size;
          sumV  += tk.size;
        }
      }
      if (sumV > 0) {
        vwap = sumPV / sumV;
      } else {
        const fillMinuteMs = Math.floor(fillTimeMs / ONE_MIN_MS) * ONE_MIN_MS;
        let bPV = 0, bV = 0;
        for (const bar of e.barsSnapshot) {
          const barMs = new Date(bar.time).getTime();
          if (barMs >= fromBarMs && barMs <= fillMinuteMs) {
            bPV += bar.close * bar.volume;
            bV  += bar.volume;
          }
        }
        if (bV > 0) vwap = bPV / bV;
      }

      if (vwap !== null) points.push({ t: fillTimeMs, vwap });
    }
    runningMarketVwap = points.length > 0 ? points : null;

    // ── Running market TWAP: true time-weighted average ───────────────────
    // Previous approach averaged tick prices equally — bursts of ticks in a
    // busy second dominated quiet periods.  True TWAP weights each price by
    // the duration it prevailed until the next tick (or window end), so a
    // price that held for 30 seconds counts 30× more than one that lasted 1 s.
    //
    // Formula: Σ(price_i × hold_duration_i) / total_window_duration
    // The first tick in each window is extended back to orderMs so the full
    // window is covered even when the first tick arrives slightly after start.
    const twapPoints: Array<{ t: number; twap: number }> = [];
    for (const fill of sortedFills) {
      const fillMs       = fill.lastFillTime.getTime();
      const windowMs     = fillMs - orderMs;
      if (windowMs <= 0) continue;

      const windowTicks = e.tradeTicks.filter((tk) => {
        const ms = tk.time.getTime();
        return ms >= orderMs && ms <= fillMs;
      });

      let twap: number | null = null;
      if (windowTicks.length > 0) {
        let weightedSum = 0;
        for (let i = 0; i < windowTicks.length; i++) {
          // Extend the first tick back to orderMs to cover any gap before it
          const tMs   = i === 0 ? orderMs : windowTicks[i]!.time.getTime();
          const nextMs = i + 1 < windowTicks.length
            ? windowTicks[i + 1]!.time.getTime()
            : fillMs;
          const dur = nextMs - tMs;
          if (dur > 0) weightedSum += windowTicks[i]!.price * dur;
        }
        twap = weightedSum / windowMs;
      }

      if (twap !== null) twapPoints.push({ t: fillMs, twap });
    }
    runningMarketTwap = twapPoints.length > 0 ? twapPoints : null;

    break; // same security for all slices — first enriched trade suffices
  }

  // Scalar TWAP = the TWAP up to the last fill = average over the full window
  const marketTwap = runningMarketTwap !== null && runningMarketTwap.length > 0
    ? runningMarketTwap[runningMarketTwap.length - 1]!.twap
    : null;

  // ── Market Impact (qty-weighted avg across fills) ────────────────────────
  let MI_bps: number | null = null;
  {
    let weightedSum = 0;
    let weightTotal = 0;
    for (const trade of trades) {
      const e = enrichment[trade.orderId];
      const mi = computeMarketImpact(trade, e);
      if (mi !== null) {
        weightedSum += mi * trade.orderQty;
        weightTotal += trade.orderQty;
      }
    }
    if (weightTotal > 0) MI_bps = weightedSum / weightTotal;
  }

  // ── Parent-window TWAS ────────────────────────────────────────────────────
  // Time-weighted average spread over [orderTime, lastFillTime].
  let TWAS_bps: number | null = null;
  {
    for (const trade of trades) {
      const e = enrichment[trade.orderId];
      if (!e || e.bidAskTicks.length === 0) continue;

      const windowStart = orderMs;
      const windowEnd   = lastFillMs;
      const totalDur    = windowEnd - windowStart;

      const ticks = [...e.bidAskTicks]
        .filter((tk) => { const ms = tk.time.getTime(); return ms >= windowStart && ms <= windowEnd; })
        .sort((a: BidAskTick, b: BidAskTick) => a.time.getTime() - b.time.getTime());

      if (ticks.length === 0) break;

      if (totalDur <= 0 || ticks.length === 1) {
        const tk = ticks[0]!;
        const mid = (tk.bid + tk.ask) / 2;
        if (mid > 0) TWAS_bps = ((tk.ask - tk.bid) / mid) * 10_000;
        break;
      }

      let weightedSum = 0;
      let weightTotal = 0;
      for (let i = 0; i < ticks.length; i++) {
        const tk     = ticks[i]!;
        const nextMs2 = i + 1 < ticks.length ? ticks[i + 1]!.time.getTime() : windowEnd;
        const deltaT = nextMs2 - tk.time.getTime();
        if (deltaT <= 0) continue;
        const mid = (tk.bid + tk.ask) / 2;
        if (mid <= 0) continue;
        weightedSum += ((tk.ask - tk.bid) / mid) * 10_000 * deltaT;
        weightTotal += deltaT;
      }
      if (weightTotal > 0) TWAS_bps = weightedSum / weightTotal;
      break; // same security — first enriched trade's ticks cover the window
    }
  }

  // ── 1-minute post-fill price (for benchmark-relative reversion) ───────────
  // Use the enrichment of the trade with the latest lastFillTime.
  let reversion1m_price: number | null = null;
  {
    const latestTrade = trades.reduce(
      (latest, t) => (t.lastFillTime > latest.lastFillTime ? t : latest),
      trades[0]!,
    );
    const e = enrichment[latestTrade.orderId];
    if (e && e.reversion1m && e.reversion1m !== 0) {
      reversion1m_price = e.reversion1m;
    }
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
    marketTwap,
    runningMarketVwap,
    runningMarketTwap,
    MI_bps,
    TWAS_bps,
    reversion1m_price,
  };
}

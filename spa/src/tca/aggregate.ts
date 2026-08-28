/**
 * Multi-order aggregation — group trades + results by various dimensions
 * and compute summary statistics for each group.
 *
 * buildAggregations() is the public entry point.  It returns four sorted
 * AggregateRow arrays: by symbol, by algo, by symbol+algo, by symbol+side.
 * Each row includes orderIds for TradeTable pre-filtering.
 */

import type {
  AggregateRow,
  AggregationSet,
  SpreadSavingsRow,
  TCAResult,
  TradeRecord,
} from "@/types";
import { safeAvg } from "@/components/dashboard/dashboardUtils";

// ── Internal group accumulator ────────────────────────────────────────────────

interface GroupAcc {
  trades: TradeRecord[];
  results: TCAResult[];
}

// ── Generic groupBy helper ────────────────────────────────────────────────────

function groupBy(
  trades: TradeRecord[],
  results: TCAResult[],
  keyFn: (t: TradeRecord) => string,
): AggregateRow[] {
  const resultMap = new Map<string, TCAResult>();
  for (const r of results) resultMap.set(r.orderId, r);

  const groups = new Map<string, GroupAcc>();

  for (const t of trades) {
    const key = keyFn(t);
    let acc = groups.get(key);
    if (!acc) {
      acc = { trades: [], results: [] };
      groups.set(key, acc);
    }
    acc.trades.push(t);
    const r = resultMap.get(t.orderId);
    if (r) acc.results.push(r);
  }

  const rows: AggregateRow[] = [];

  for (const [groupKey, { trades: gTrades, results: gResults }] of groups.entries()) {
    const count = gTrades.length;
    const totalQty = gTrades.reduce((s, t) => s + t.orderQty, 0);

    const avgIS_bps = safeAvg(gResults.map((r) => r.IS_bps));
    const avgVWAP_dev_bps = safeAvg(gResults.map((r) => r.VWAP_dev_bps));
    const avgTWAP_dev_bps = safeAvg(gResults.map((r) => r.TWAP_dev_bps));

    // Cash figures are group totals rather than averages: they are additive, and
    // the total cost of trading a symbol is what gets acted on. Summing across
    // currencies would be meaningless — there is no FX conversion anywhere in
    // this app — so a mixed-currency group reports null rather than a wrong
    // number, the same call SummaryCards makes for its Total Cost tile.
    const currencies = new Set(gResults.map((r) => r.currency));
    const currency = currencies.size === 1 ? [...currencies][0] ?? null : null;
    const sumUsd = (pick: (r: TCAResult) => number | null): number | null => {
      if (currency === null) return null;
      let sum = 0;
      let seen = 0;
      for (const r of gResults) {
        const v = pick(r);
        if (v === null || !isFinite(v)) continue;
        sum += v;
        seen += 1;
      }
      return seen > 0 ? sum : null;
    };
    const totalVWAP_dev_usd = sumUsd((r) => r.VWAP_dev_usd);
    const totalTWAP_dev_usd = sumUsd((r) => r.TWAP_dev_usd);
    const avgMI_bps = safeAvg(gResults.map((r) => r.MI_bps));
    const avgTWAS_bps = safeAvg(gResults.map((r) => r.TWAS_bps));
    // Simple mean — matches avgIS_bps and the rest of this row. Orders with no
    // usable σ return null from volAdjustedIS and safeAvg drops them.
    const avgVolAdjIS = safeAvg(gResults.map((r) => r.volAdjIS));
    const avgTTF_ms = safeAvg(gResults.map((r) => r.timeToFill_ms)) ?? 0;

    // Win rate: fraction of orders with IS_bps <= 0 among those with IS data
    const isVals = gResults.map((r) => r.IS_bps).filter((v): v is number => v !== null);
    const winRate = isVals.length > 0 ? isVals.filter((v) => v <= 0).length / isVals.length : null;

    // Best / worst IS
    const bestIS_bps = isVals.length > 0 ? Math.min(...isVals) : null;
    const worstIS_bps = isVals.length > 0 ? Math.max(...isVals) : null;

    rows.push({
      groupKey,
      count,
      totalQty,
      avgIS_bps,
      avgVWAP_dev_bps,
      avgTWAP_dev_bps,
      totalVWAP_dev_usd,
      totalTWAP_dev_usd,
      currency,
      avgMI_bps,
      avgTWAS_bps,
      avgVolAdjIS,
      avgTTF_ms,
      winRate,
      bestIS_bps,
      worstIS_bps,
      orderIds: gTrades.map((t) => t.orderId),
    });
  }

  // Default sort: count descending
  return rows.sort((a, b) => b.count - a.count);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function buildAggregations(
  trades: TradeRecord[],
  results: TCAResult[],
  /**
   * Maps a trade's symbol to the label it groups under. Pass
   * toGenericTicker∘resolve to collapse expiries onto the instrument
   * ("FVU6"/"FVZ6" → "FV Comdty"); the identity default keeps per-contract rows.
   * byAlgo is unaffected either way — it never keys on the symbol.
   */
  groupSymbol: (ric: string) => string = (s) => s,
): AggregationSet {
  return {
    bySymbol: groupBy(trades, results, (t) => groupSymbol(t.symbol)),
    byAlgo: groupBy(trades, results, (t) => t.algo ?? "(no algo)"),
    bySymbolAlgo: groupBy(
      trades,
      results,
      (t) => `${groupSymbol(t.symbol)} / ${t.algo ?? "(no algo)"}`,
    ),
    bySymbolSide: groupBy(trades, results, (t) => `${groupSymbol(t.symbol)} ${t.side}`),
    bySymbolAlgoSide: groupBy(
      trades,
      results,
      (t) => `${groupSymbol(t.symbol)} / ${t.algo ?? "(no algo)"} ${t.side}`,
    ),
  };
}

// ── Spread savings ────────────────────────────────────────────────────────────

/**
 * Below this an average spread is treated as unusable: dividing by it turns
 * rounding noise into a savings figure that swings by orders of magnitude.
 * Same reasoning as MIN_ABS_MID in tca/spread.ts.
 */
const MIN_SPREAD_BPS = 1e-6;

/** Median of a list of numbers; even counts average the two middle values. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const lo = sorted[mid - 1];
  const hi = sorted[mid];
  return lo !== undefined && hi !== undefined ? (lo + hi) / 2 : null;
}

/**
 * Per-instrument view of how much of the quoted spread the execution kept,
 * alongside the market conditions that produced it.
 *
 * Always grouped by generic ticker — collapsing expiries is the whole point of
 * the table, so it does not follow the dashboard's group-by toggle.
 *
 * On the volatility columns
 * ─────────────────────────
 * Savings divides by the spread, so on a one-tick market the denominator is
 * tiny and the figure reports drift rather than spread capture: ES is ~0.42 bps
 * wide while a 5-minute window carries ~11 bps of movement, which turns an
 * ordinary +3 bps of drift into −664%. Those rows are not wrong, they are
 * outside the metric's domain — so the volatility the orders traded through is
 * reported beside the score rather than the score being suppressed.
 *
 * Every figure is null rather than 0 when its inputs are missing, so a group
 * with no Bloomberg quotes reads as "no data" instead of "paid nothing".
 */
export function buildSpreadSavings(
  trades: TradeRecord[],
  results: TCAResult[],
  genericFor: (ric: string) => string,
): SpreadSavingsRow[] {
  const resultMap = new Map<string, TCAResult>();
  for (const r of results) resultMap.set(r.orderId, r);

  const groups = new Map<string, GroupAcc>();
  for (const t of trades) {
    const key = genericFor(t.symbol);
    let acc = groups.get(key);
    if (!acc) {
      acc = { trades: [], results: [] };
      groups.set(key, acc);
    }
    acc.trades.push(t);
    const r = resultMap.get(t.orderId);
    if (r) acc.results.push(r);
  }

  const rows: SpreadSavingsRow[] = [];

  for (const [groupKey, { trades: gTrades, results: gResults }] of groups.entries()) {
    const avgSpread_bps = safeAvg(gResults.map((r) => r.TWAS_bps));

    // Quantity-weighted IS: a 200-lot should move this figure 200× more than a
    // 1-lot. Orders missing IS are excluded from both sums, not counted as zero.
    let isWeightedSum = 0;
    let isWeight = 0;
    // Savings is computed per order and then quantity-weighted, rather than as a
    // ratio of the group's aggregates. Each order is scored against the spread
    // *it* actually faced, and the resulting mean is comparable with a median.
    let savWeightedSum = 0;
    let savWeight = 0;
    const isValues: number[] = [];
    // Quantity-weighted, matching wAvgIS_bps rather than the simple mean the
    // AggregateTables use — this table weights its IS figures by size.
    let vaWeightedSum = 0;
    let vaWeight = 0;
    const volValues: number[] = [];
    const volRates: number[] = [];

    for (const t of gTrades) {
      const r = resultMap.get(t.orderId);
      if (!r) continue;
      const qty = t.orderQty > 0 ? t.orderQty : 0;
      const is = r.IS_bps !== null && isFinite(r.IS_bps) ? r.IS_bps : null;
      const spread = r.TWAS_bps !== null && isFinite(r.TWAS_bps) ? r.TWAS_bps : null;

      if (is !== null) {
        isValues.push(is);
        if (qty > 0) {
          isWeightedSum += is * qty;
          isWeight += qty;
        }
      }

      // A near-zero spread makes the per-order ratio explode, so that order is
      // dropped instead of being allowed to poison the group's mean.
      if (is !== null && spread !== null && Math.abs(spread) >= MIN_SPREAD_BPS && qty > 0) {
        savWeightedSum += ((spread / 2 - is) / spread) * qty;
        savWeight += qty;
      }

      if (r.volAdjIS !== null && isFinite(r.volAdjIS) && qty > 0) {
        vaWeightedSum += r.volAdjIS * qty;
        vaWeight += qty;
      }

      // Volatility is a reading of the environment, so each order's window counts
      // once — no quantity weighting, matching how avgSpread_bps is built.
      const vol = r.vol_during_order_bps;
      if (vol !== null && isFinite(vol)) {
        volValues.push(vol);
        // σ grows with √duration, so dividing by √minutes turns a total into a
        // rate that is comparable between a 30-second and a two-hour order.
        const minutes = r.timeToFill_ms / 60_000;
        if (minutes > 0) volRates.push(vol / Math.sqrt(minutes));
      }
    }

    rows.push({
      groupKey,
      count: gTrades.length,
      totalQty: gTrades.reduce((s, t) => s + t.orderQty, 0),
      avgSpread_bps,
      wAvgIS_bps: isWeight > 0 ? isWeightedSum / isWeight : null,
      medianIS_bps: median(isValues),
      wAvgVolAdjIS: vaWeight > 0 ? vaWeightedSum / vaWeight : null,
      avgVol_bps: safeAvg(volValues),
      avgVolRate_bps: safeAvg(volRates),
      savingsPct: savWeight > 0 ? savWeightedSum / savWeight : null,
    });
  }

  // Most-traded first, matching the aggregation tables' default sort.
  return rows.sort((a, b) => b.count - a.count);
}

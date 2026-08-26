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
    const avgMI_bps = safeAvg(gResults.map((r) => r.MI_bps));
    const avgTWAS_bps = safeAvg(gResults.map((r) => r.TWAS_bps));
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
      avgMI_bps,
      avgTWAS_bps,
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
  };
}

// ── Spread savings ────────────────────────────────────────────────────────────

/**
 * Below this an average spread is treated as unusable: dividing by it turns
 * rounding noise into a savings figure that swings by orders of magnitude.
 * Same reasoning as MIN_ABS_MID in tca/spread.ts.
 */
const MIN_SPREAD_BPS = 1e-6;

/**
 * Per-instrument view of how much of the quoted spread the execution kept.
 *
 * Always grouped by generic ticker — collapsing expiries is the whole point of
 * the table, so it does not follow the dashboard's group-by toggle.
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
    for (const t of gTrades) {
      const r = resultMap.get(t.orderId);
      if (!r || r.IS_bps === null || !isFinite(r.IS_bps)) continue;
      if (!(t.orderQty > 0)) continue;
      isWeightedSum += r.IS_bps * t.orderQty;
      isWeight += t.orderQty;
    }
    const wAvgIS_bps = isWeight > 0 ? isWeightedSum / isWeight : null;

    const savingsPct =
      avgSpread_bps !== null &&
      Math.abs(avgSpread_bps) >= MIN_SPREAD_BPS &&
      wAvgIS_bps !== null
        ? (avgSpread_bps / 2 - wAvgIS_bps) / avgSpread_bps
        : null;

    rows.push({
      groupKey,
      count: gTrades.length,
      totalQty: gTrades.reduce((s, t) => s + t.orderQty, 0),
      avgSpread_bps,
      wAvgIS_bps,
      savingsPct,
    });
  }

  // Most-traded first, matching the aggregation tables' default sort.
  return rows.sort((a, b) => b.count - a.count);
}

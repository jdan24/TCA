/**
 * Multi-order aggregation — group trades + results by various dimensions
 * and compute summary statistics for each group.
 *
 * buildAggregations() is the public entry point.  It returns four sorted
 * AggregateRow arrays: by symbol, by algo, by symbol+algo, by symbol+side.
 * Each row includes orderIds for TradeTable pre-filtering.
 */

import type { AggregateRow, AggregationSet, TCAResult, TradeRecord } from "@/types";
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
): AggregationSet {
  return {
    bySymbol: groupBy(trades, results, (t) => t.symbol),
    byAlgo: groupBy(trades, results, (t) => t.algo ?? "(no algo)"),
    bySymbolAlgo: groupBy(
      trades,
      results,
      (t) => `${t.symbol} / ${t.algo ?? "(no algo)"}`,
    ),
    bySymbolSide: groupBy(trades, results, (t) => `${t.symbol} ${t.side}`),
  };
}

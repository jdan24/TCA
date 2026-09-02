/**
 * useBenchmarkAggregation — one benchmark's slice of the By Symbol tables.
 *
 * The multi-order dashboard shows By Symbol and Spread Savings three times
 * over: once for arrival-benchmarked orders, once for VWAP, once for TWAP. An
 * order belongs to exactly one of them, decided by the algo → benchmark table
 * in Settings — the same mapping that drives the Order Detail highlight ring
 * and the Total Cost tile.
 *
 * Each slice also carries its own algo include/exclude menu, built on the hook
 * the charts already use. Its options come from that slice's orders alone, so
 * the TWAP table never offers to hide an arrival algo that was never in it.
 *
 * Returned rather than rendered so the Dashboard owns the result: the print
 * layout and the Excel export render the same rows, and would otherwise show a
 * different selection from the screen.
 */

import { useMemo } from "react";
import {
  buildSpreadSavings,
  buildSymbolAggregation,
} from "@/tca/aggregate";
import { useChartAlgoFilter, type ChartAlgoFilter } from "./useChartAlgoFilter";
import type { CashTotaller } from "@/tca/fx";
import type {
  AggregateRow,
  BenchmarkKind,
  SpreadSavingsRow,
  TCAResult,
  TradeRecord,
} from "@/types";

export interface BenchmarkAggregation {
  benchmark: BenchmarkKind;
  /** By Symbol rows for this benchmark, after the algo menu is applied. */
  rows: AggregateRow[];
  /** Spread Savings rows for this benchmark, after the algo menu is applied. */
  savings: SpreadSavingsRow[];
  /** The per-table algo menu state. */
  algoFilter: ChartAlgoFilter;
  /**
   * True when the dataset holds no orders for this benchmark at all — before
   * the algo menu is consulted. The section hides itself rather than printing
   * an empty card for a benchmark nobody traded; an empty table when this is
   * false means the algo menu did it, which is worth showing.
   */
  isEmpty: boolean;
}

export function useBenchmarkAggregation(
  /** Stable id for the stored algo selection, e.g. "agg-symbol-twap". */
  filterId: string,
  benchmark: BenchmarkKind,
  /** Every order already assigned to this benchmark. */
  bucketTrades: TradeRecord[],
  results: TCAResult[],
  groupSymbol: (ric: string) => string,
  genericFor: (ric: string) => string,
  cash: CashTotaller,
): BenchmarkAggregation {
  const algoFilter = useChartAlgoFilter(filterId, bucketTrades);
  const { includes } = algoFilter;

  const trades = useMemo(
    () => bucketTrades.filter(includes),
    [bucketTrades, includes],
  );

  // Results are narrowed to match, so a group's averages can never be formed
  // over an order the algo menu has hidden.
  const scoped = useMemo(() => {
    const ids = new Set(trades.map((t) => t.orderId));
    return results.filter((r) => ids.has(r.orderId));
  }, [trades, results]);

  const rows = useMemo(
    () => buildSymbolAggregation(trades, scoped, benchmark, groupSymbol, cash),
    [trades, scoped, benchmark, groupSymbol, cash],
  );

  // Always by generic ticker: collapsing expiries onto the instrument is the
  // point of this table, so it ignores the dashboard's group-by toggle.
  const savings = useMemo(
    () => buildSpreadSavings(trades, scoped, genericFor, benchmark),
    [trades, scoped, genericFor, benchmark],
  );

  return {
    benchmark,
    rows,
    savings,
    algoFilter,
    isEmpty: bucketTrades.length === 0,
  };
}

/**
 * Split orders into the three benchmark buckets.
 *
 * Anything whose algo has no mapping lands in arrival, matching
 * resolveBenchmark's own fallback — an unrecognised algo is still measured,
 * just against the benchmark the app has always defaulted to.
 */
export function partitionByBenchmark(
  trades: TradeRecord[],
  benchmarkFor: (algo: string | null | undefined) => BenchmarkKind,
): Record<BenchmarkKind, TradeRecord[]> {
  const buckets: Record<BenchmarkKind, TradeRecord[]> = {
    arrival: [],
    vwap: [],
    twap: [],
  };
  for (const t of trades) buckets[benchmarkFor(t.algo)].push(t);
  return buckets;
}

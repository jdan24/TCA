/**
 * Dashboard — Multi-order TCA analytics view (Mode 1).
 *
 * Layout:
 *   ┌─ Toolbar ─────────────────────────────────────────────────────────┐
 *   │ trade count · enriched count · [Fetch Bloomberg] · [↺ New file]  │
 *   ├─ SummaryCards (6 KPI tiles, full width) ──────────────────────────┤
 *   ├─ SlippageChart ──── VWAPDeviation ────────────────────────────────┤
 *   ├─ TimingHeatmap (full width) ──────────────────────────────────────┤
 *   ├─ ReversionChart ── SpreadScatter ─────────────────────────────────┤
 *   ├─ AggregationSection (By Symbol / Algo / Symbol+Algo / Symbol+Side)┤
 *   └─ TradeTable (full width) ──────────────────────────────────────────┘
 */

import { useMemo, useState } from "react";
import type { EnrichProgress } from "@/bloomberg/enrichmentService";
import type { AggregationSet, DataFilter, TCAResult, TradeRecord } from "@/types";
import { EMPTY_FILTER } from "@/types";
import { buildAggregations } from "@/tca/aggregate";
import { ExportBar } from "@/components/export/ExportBar";
import { TradeTable } from "@/components/table/TradeTable";
import { AggregationSection } from "./AggregationSection";
import { FilterBar } from "./FilterBar";
import { ReversionChart } from "./ReversionChart";
import { SlippageChart } from "./SlippageChart";
import { SpreadScatter } from "./SpreadScatter";
import { SummaryCards } from "./SummaryCards";
import { TimingHeatmap } from "./TimingHeatmap";
import { VWAPDeviation } from "./VWAPDeviation";

interface DashboardProps {
  trades: TradeRecord[];
  results: TCAResult[];
  bloombergConnected: boolean;
  enrichedCount: number;
  enrichProgress: EnrichProgress | null;
  onFetchBloomberg: () => void;
  onReset: () => void;
}

export function Dashboard({
  trades,
  results,
  bloombergConnected,
  enrichedCount,
  enrichProgress,
  onFetchBloomberg,
  onReset,
}: DashboardProps) {
  const isFetching = enrichProgress !== null;
  const pct =
    isFetching && enrichProgress.total > 0
      ? Math.round((enrichProgress.done / enrichProgress.total) * 100)
      : 0;

  // ── Dataset filter (local view state; resets when Dashboard unmounts) ────────
  const [filter, setFilter] = useState<DataFilter>(EMPTY_FILTER);

  const filteredTrades = useMemo(() => {
    return trades.filter((t) => {
      if (filter.symbol && t.symbol !== filter.symbol) return false;
      if (filter.accountId && t.accountId !== filter.accountId) return false;
      if (filter.accountDescription && t.accountDescription !== filter.accountDescription)
        return false;
      if (filter.algo && t.algo !== filter.algo) return false;
      const d = t.orderTime.toISOString().slice(0, 10); // "YYYY-MM-DD"
      if (filter.dateFrom && d < filter.dateFrom) return false;
      if (filter.dateTo && d > filter.dateTo) return false;
      return true;
    });
  }, [trades, filter]);

  const filteredResultSet = useMemo(
    () => new Set(filteredTrades.map((t) => t.orderId)),
    [filteredTrades],
  );

  const filteredResults = useMemo(
    () => results.filter((r) => filteredResultSet.has(r.orderId)),
    [results, filteredResultSet],
  );

  const aggregations: AggregationSet = useMemo(
    () => buildAggregations(filteredTrades, filteredResults),
    [filteredTrades, filteredResults],
  );

  const isFiltered = filteredTrades.length !== trades.length;

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-6 space-y-4">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: counts */}
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-gray-900 dark:text-white">
            {filteredTrades.length.toLocaleString()}
            {isFiltered && (
              <span className="font-normal text-gray-400 dark:text-gray-500">
                {" "}of {trades.length.toLocaleString()}
              </span>
            )}
            {" "}trade{filteredTrades.length !== 1 ? "s" : ""}
          </span>
          {enrichedCount > 0 && (
            <span className="text-gray-400 dark:text-gray-500">
              · {enrichedCount} enriched with Bloomberg
            </span>
          )}
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-3">
          {isFetching ? (
            <div className="flex items-center gap-2 min-w-[200px]">
              <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-200"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs text-gray-500 tabular-nums whitespace-nowrap">
                {enrichProgress.done}/{enrichProgress.total}
              </span>
            </div>
          ) : bloombergConnected ? (
            <button
              type="button"
              onClick={onFetchBloomberg}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors"
            >
              {enrichedCount > 0 ? "Re-fetch Bloomberg" : "Fetch Bloomberg Data"}
            </button>
          ) : (
            <span className="text-xs text-gray-400 dark:text-gray-600 italic">
              Bridge offline — no Bloomberg data
            </span>
          )}

          <ExportBar trades={filteredTrades} results={filteredResults} aggregations={aggregations} />

          <button
            type="button"
            onClick={onReset}
            className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            ↺ Load new file
          </button>
        </div>
      </div>

      {/* ── Filter bar ──────────────────────────────────────────────────── */}
      <FilterBar trades={trades} filter={filter} onChange={setFilter} />

      {/* ── KPI tiles ───────────────────────────────────────────────────── */}
      <SummaryCards results={filteredResults} />

      {/* ── Scatter charts (2-col) ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SlippageChart trades={filteredTrades} results={filteredResults} />
        <VWAPDeviation trades={filteredTrades} results={filteredResults} />
      </div>

      {/* ── Timing heatmap (full width) ──────────────────────────────────── */}
      <TimingHeatmap trades={filteredTrades} results={filteredResults} />

      {/* ── Line + scatter (2-col) ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ReversionChart trades={filteredTrades} results={filteredResults} />
        <SpreadScatter results={filteredResults} />
      </div>

      {/* ── Aggregation tables ───────────────────────────────────────────── */}
      <AggregationSection aggregations={aggregations} />

      {/* ── Trade detail table (full width) ──────────────────────────────── */}
      <TradeTable trades={filteredTrades} results={filteredResults} />
    </div>
  );
}

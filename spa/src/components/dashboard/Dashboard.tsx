/**
 * Dashboard — full analytics view shown after trades are loaded.
 *
 * Layout:
 *   ┌─ Toolbar ─────────────────────────────────────────────────────────┐
 *   │ trade count · enriched count · [Fetch Bloomberg] · [↺ New file]  │
 *   ├─ SummaryCards (5 KPI tiles, full width) ──────────────────────────┤
 *   ├─ SlippageChart ──── VWAPDeviation ────────────────────────────────┤
 *   ├─ TimingHeatmap (full width) ──────────────────────────────────────┤
 *   └─ ReversionChart ── SpreadScatter ─────────────────────────────────┘
 */

import type { EnrichProgress } from "@/bloomberg/enrichmentService";
import type { TCAResult, TradeRecord } from "@/types";
import { ExportBar } from "@/components/export/ExportBar";
import { TradeTable } from "@/components/table/TradeTable";
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

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-6 space-y-4">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: counts */}
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-gray-900 dark:text-white">
            {trades.length.toLocaleString()} trade{trades.length !== 1 ? "s" : ""}
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
            /* Progress bar */
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

          <ExportBar trades={trades} results={results} />

          <button
            type="button"
            onClick={onReset}
            className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            ↺ Load new file
          </button>
        </div>
      </div>

      {/* ── KPI tiles ───────────────────────────────────────────────────── */}
      <SummaryCards results={results} />

      {/* ── Scatter charts (2-col) ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SlippageChart trades={trades} results={results} />
        <VWAPDeviation trades={trades} results={results} />
      </div>

      {/* ── Timing heatmap (full width) ──────────────────────────────────── */}
      <TimingHeatmap trades={trades} results={results} />

      {/* ── Line + scatter (2-col) ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ReversionChart trades={trades} results={results} />
        <SpreadScatter results={results} />
      </div>

      {/* ── Trade detail table (full width) ──────────────────────────────── */}
      <TradeTable trades={trades} results={results} />
    </div>
  );
}

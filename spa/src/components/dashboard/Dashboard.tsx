/**
 * Dashboard — Multi-order TCA analytics view (Mode 1).
 *
 * Layout:
 *   ┌─ Toolbar ─────────────────────────────────────────────────────────┐
 *   │ trade count · enriched count · [Fetch Bloomberg] · [↺ New file]  │
 *   ├─ SummaryCards (6 KPI tiles, full width) ──────────────────────────┤
 *   ├─ OrderDetail / TradeTable (full width) ───────────────────────────┤
 *   ├─ SlippageChart ──── VWAPDeviation ────────────────────────────────┤
 *   ├─ ReversionChart ── SpreadScatter ─────────────────────────────────┤
 *   └─ AggregationSection (By Symbol / Algo / Symbol+Algo / Symbol+Side)┘
 */

import { useMemo, useState } from "react";
import { toPng } from "html-to-image";
import type { EnrichProgress } from "@/bloomberg/enrichmentService";
import type { AggregationSet, DataFilter, TCAResult, TradeRecord } from "@/types";
import { EMPTY_FILTER } from "@/types";
import { buildAggregations } from "@/tca/aggregate";
import { MultiOrderPrintLayout, type MOChartImages } from "@/components/export/MultiOrderPrintLayout";
import { TradeTable } from "@/components/table/TradeTable";
import { AggregationSection } from "./AggregationSection";
import { FilterBar } from "./FilterBar";
import { ReversionChart } from "./ReversionChart";
import { SlippageChart } from "./SlippageChart";
import { SpreadScatter } from "./SpreadScatter";
import { SummaryCards } from "./SummaryCards";
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
  const [showPrintLayout, setShowPrintLayout]     = useState(false);
  const [capturingPrint, setCapturingPrint]       = useState(false);
  const [printCharts,    setPrintCharts]           = useState<MOChartImages | null>(null);

  async function handlePrintLayout() {
    setCapturingPrint(true);
    try {
      const capture = async (id: string): Promise<string | null> => {
        const el = document.getElementById(id);
        if (!el) return null;
        return toPng(el, { backgroundColor: "#ffffff", pixelRatio: 2 }).catch(() => null);
      };
      const [slippage, vwapDev, reversion, spread] = await Promise.all([
        capture("mo-chart-slippage"),
        capture("mo-chart-vwap-dev"),
        capture("mo-chart-reversion"),
        capture("mo-chart-spread"),
      ]);
      setPrintCharts({ slippage, vwapDev, reversion, spread });
      setShowPrintLayout(true);
    } finally {
      setCapturingPrint(false);
    }
  }
  const isFetching = enrichProgress !== null;
  const pct =
    isFetching && enrichProgress.total > 0
      ? Math.round((enrichProgress.done / enrichProgress.total) * 100)
      : 0;

  // ── Dataset filter (local view state; resets when Dashboard unmounts) ────────
  const [filter, setFilter] = useState<DataFilter>(EMPTY_FILTER);

  // ── Manually deleted order IDs (session-only) ────────────────────────────────
  const [deletedOrderIds, setDeletedOrderIds] = useState<Set<string>>(new Set());

  function handleDeleteOrder(orderId: string) {
    setDeletedOrderIds((prev) => {
      const next = new Set(prev);
      next.add(orderId);
      return next;
    });
  }

  const filteredTrades = useMemo(() => {
    return trades.filter((t) => {
      if (deletedOrderIds.has(t.orderId)) return false;
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
  }, [trades, filter, deletedOrderIds]);

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

  if (showPrintLayout && printCharts) {
    return (
      <MultiOrderPrintLayout
        trades={filteredTrades}
        results={filteredResults}
        aggregations={aggregations}
        charts={printCharts}
        onBack={() => { setShowPrintLayout(false); setPrintCharts(null); }}
      />
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-6 space-y-4">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: counts */}
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-gray-900 dark:text-white">
            {filteredTrades.length.toLocaleString()}
            {(isFiltered || deletedOrderIds.size > 0) && (
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
          {deletedOrderIds.size > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
              · {deletedOrderIds.size} order{deletedOrderIds.size !== 1 ? "s" : ""} removed
              <button
                type="button"
                onClick={() => setDeletedOrderIds(new Set())}
                className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors underline-offset-2 hover:underline"
                title="Restore all removed orders"
              >
                Restore all
              </button>
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

          <button
            type="button"
            disabled={capturingPrint}
            onClick={() => { void handlePrintLayout(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-wait transition-colors"
            title="Capture charts and open print layout"
          >
            {capturingPrint ? (
              <svg className="h-3.5 w-3.5 animate-spin text-current" fill="none" viewBox="0 0 24 24" aria-hidden>
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
            )}
            {capturingPrint ? "Preparing…" : "Print Layout"}
          </button>

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
      <SummaryCards results={filteredResults} trades={filteredTrades} />

      {/* ── Order detail table (full width) ──────────────────────────────── */}
      <TradeTable
        trades={filteredTrades}
        results={filteredResults}
        title="Order Detail"
        onDeleteOrder={handleDeleteOrder}
      />

      {/* ── Scatter charts (2-col) ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div id="mo-chart-slippage"><SlippageChart trades={filteredTrades} results={filteredResults} /></div>
        <div id="mo-chart-vwap-dev"><VWAPDeviation trades={filteredTrades} results={filteredResults} /></div>
      </div>

      {/* ── Line + scatter (2-col) ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div id="mo-chart-reversion"><ReversionChart trades={filteredTrades} results={filteredResults} /></div>
        <div id="mo-chart-spread"><SpreadScatter results={filteredResults} /></div>
      </div>

      {/* ── Aggregation tables ───────────────────────────────────────────── */}
      <AggregationSection aggregations={aggregations} />
    </div>
  );
}

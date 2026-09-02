/**
 * Dashboard — Multi-order TCA analytics view (Mode 1).
 *
 * Layout:
 *   ┌─ Toolbar ─────────────────────────────────────────────────────────┐
 *   │ trade count · enriched count · [Fetch Bloomberg] · [↺ New file]  │
 *   ├─ SummaryCards (6 KPI tiles, full width) ──────────────────────────┤
 *   ├─ OrderDetail / TradeTable (full width) ───────────────────────────┤
 *   ├─ SlippageChart (full width) ──────────────────────────────────────┤
 *   ├─ VWAP Deviation ──── TWAP Deviation ──────────────────────────────┤
 *   ├─ SpreadScatter (full width) ──────────────────────────────────────┤
 *   └─ AggregationSection (Spread Savings / By Symbol / Algo / …)───────┘
 *
 * By Symbol and Spread Savings each render three times — once per benchmark, over
 * disjoint sets of orders. See AggregationSection for why.
 */

import { useMemo, useState } from "react";
import { toPng } from "html-to-image";
import type { EnrichProgress } from "@/bloomberg/enrichmentService";
import type { AggGroupType, AggregationSet, DataFilter, TCAResult, TradeRecord } from "@/types";
import { EMPTY_FILTER } from "@/types";
import { buildAggregations } from "@/tca/aggregate";
import { toGenericTicker } from "@/tca/genericTicker";
import { decToTreasuryFrac, getTreasuryPrecision } from "@/tca/treasuryFrac";
import { useSymbolMap } from "@/hooks/useSymbolMap";
import { useCashDisplay } from "@/hooks/useCashDisplay";
import { useAlgoMap } from "@/hooks/useAlgoMap";
import {
  partitionByBenchmark,
  useBenchmarkAggregation,
} from "@/hooks/useBenchmarkAggregation";
import { MultiOrderPrintLayout, type MOChartImages } from "@/components/export/MultiOrderPrintLayout";
import { TradeTable } from "@/components/table/TradeTable";
import { AggregationSection } from "./AggregationSection";
import { FilterBar } from "./FilterBar";
import { SlippageChart } from "./SlippageChart";
import { SpreadScatter } from "./SpreadScatter";
import {
  loadSpreadSavingsCols,
  saveSpreadSavingsCols,
  type SpreadSavingsColumnId,
} from "./SpreadSavingsTable";
import {
  loadAggregateCols,
  saveAggregateCols,
  type AggregateColumnId,
} from "./AggregateTable";
import { SummaryCards } from "./SummaryCards";
import { DeviationChart } from "./DeviationChart";

/** Empty selection = no filter on this dimension. */
function matches(selected: string[], value: string | null): boolean {
  return selected.length === 0 || (value !== null && selected.includes(value));
}

// ── Grouping-toggle persistence ───────────────────────────────────────────────

const GROUP_GENERIC_KEY = "tca_agg_generic_v1";

function loadGroupGeneric(): boolean {
  try {
    const raw = localStorage.getItem(GROUP_GENERIC_KEY);
    return raw === null ? true : raw === "true"; // default: generic
  } catch {
    return true;
  }
}

function saveGroupGeneric(v: boolean): void {
  try {
    localStorage.setItem(GROUP_GENERIC_KEY, String(v));
  } catch {
    // localStorage unavailable (private browsing) — the setting just won't persist
  }
}

/** Every grouping that gets its own aggregation table and column preference. */
const AGG_GROUP_TYPES: AggGroupType[] = [
  "symbol", "symbol:vwap", "symbol:twap",
  "algo", "symbol+algo", "symbol+side", "symbol+algo+side",
];

/** One stored column selection per grouping, loaded on first render. */
function loadAllAggregateCols(): Record<AggGroupType, AggregateColumnId[]> {
  return Object.fromEntries(
    AGG_GROUP_TYPES.map((t) => [t, loadAggregateCols(t)]),
  ) as Record<AggGroupType, AggregateColumnId[]>;
}

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
  // Cash display mode + FX rates. Passed into buildAggregations so group totals
  // are formed in whatever currency the report is being read in.
  const cash = useCashDisplay();

  // Per-row price formatter for the table's TWAS (price) column: Treasury
  // futures show 32nds, everything else falls back to plain decimals.
  const { resolve: resolveSymbol } = useSymbolMap();
  const priceFormatterForSymbol = useMemo(
    // Depend on `resolve` itself, not the hook's return object — that object is
    // a fresh literal every render and would defeat the memo, re-creating the
    // table's column definitions on each pass.
    () => (ric: string) => {
      const precision = getTreasuryPrecision(resolveSymbol(ric));
      return precision ? (v: number) => decToTreasuryFrac(v, precision) : null;
    },
    [resolveSymbol],
  );

  // Generic ticker for a file symbol: resolve the RIC to its Bloomberg form
  // first, then drop the expiry — "FVU6"/"FVZ6" both become "FV Comdty".
  // Derived rather than stored on TradeRecord: the import wizard rewrites
  // `symbol` after parsing, so a stored value would go stale.
  const genericFor = useMemo(
    () => (ric: string) => toGenericTicker(resolveSymbol(ric)),
    [resolveSymbol],
  );

  // Group the aggregation tables by generic ticker or by specific expiry.
  // Persisted so the choice survives a reload, like the KPI tile visibility.
  const [groupGeneric, setGroupGeneric] = useState<boolean>(loadGroupGeneric);
  function changeGroupGeneric(v: boolean) {
    setGroupGeneric(v);
    saveGroupGeneric(v);
  }

  // Which Spread Savings columns are shown. Owned here rather than in the table
  // because the print layout renders the same selection.
  const [spreadSavingsColumns, setSpreadSavingsColumns] =
    useState<SpreadSavingsColumnId[]>(loadSpreadSavingsCols);
  function changeSpreadSavingsColumns(ids: SpreadSavingsColumnId[]) {
    setSpreadSavingsColumns(ids);
    saveSpreadSavingsCols(ids);
  }

  // Column selection per aggregation table. Owned here rather than in each
  // table because the print layout renders the same selections.
  const [aggregateColumns, setAggregateColumns] =
    useState<Record<AggGroupType, AggregateColumnId[]>>(loadAllAggregateCols);
  function changeAggregateColumns(type: AggGroupType, ids: AggregateColumnId[]) {
    setAggregateColumns((prev) => ({ ...prev, [type]: ids }));
    saveAggregateCols(type, ids);
  }

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
      const [slippage, vwapDev, twapDev, spread] = await Promise.all([
        capture("mo-chart-slippage"),
        capture("mo-chart-vwap-dev"),
        capture("mo-chart-twap-dev"),
        capture("mo-chart-spread"),
      ]);
      setPrintCharts({ slippage, vwapDev, twapDev, spread });
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
      // An empty selection is "no filter on this dimension", not "match nothing".
      if (!matches(filter.symbols, t.symbol)) return false;
      if (!matches(filter.accountIds, t.accountId)) return false;
      if (!matches(filter.accountDescriptions, t.accountDescription)) return false;
      if (!matches(filter.algos, t.algo)) return false;
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

  // How the symbol tables key their rows: generic ticker or specific expiry.
  const groupSymbol = useMemo(
    () => (groupGeneric ? genericFor : (ric: string) => ric),
    [groupGeneric, genericFor],
  );

  // ── Benchmark split ─────────────────────────────────────────────────────────
  //
  // By Symbol and Spread Savings are rendered once per benchmark, over disjoint
  // sets of orders: averaging a TWAP order's arrival slippage beside a POV
  // order's says nothing about either. The algo → benchmark table in Settings
  // decides which bucket an order lands in, so the split tracks the same
  // mapping as the Order Detail highlight ring and the Total Cost tile.
  const { resolve: benchmarkFor } = useAlgoMap();

  const buckets = useMemo(
    () => partitionByBenchmark(filteredTrades, benchmarkFor),
    [filteredTrades, benchmarkFor],
  );

  // One call per benchmark rather than a loop — each carries its own algo menu,
  // and a hook cannot be called from inside one. Order matches
  // BENCHMARK_SECTIONS in AggregationSection.
  const arrivalSection = useBenchmarkAggregation(
    "agg-symbol-arrival", "arrival", buckets.arrival,
    filteredResults, groupSymbol, genericFor, cash,
  );
  const vwapSection = useBenchmarkAggregation(
    "agg-symbol-vwap", "vwap", buckets.vwap,
    filteredResults, groupSymbol, genericFor, cash,
  );
  const twapSection = useBenchmarkAggregation(
    "agg-symbol-twap", "twap", buckets.twap,
    filteredResults, groupSymbol, genericFor, cash,
  );
  const benchmarkSections = useMemo(
    () => [arrivalSection, vwapSection, twapSection],
    [arrivalSection, vwapSection, twapSection],
  );

  // The groupings that span every benchmark, plus the three symbol tables above.
  const aggregations: AggregationSet = useMemo(
    () => ({
      ...buildAggregations(filteredTrades, filteredResults, groupSymbol, cash),
      bySymbol: arrivalSection.rows,
      bySymbolVwap: vwapSection.rows,
      bySymbolTwap: twapSection.rows,
    }),
    [
      filteredTrades, filteredResults, groupSymbol, cash,
      arrivalSection.rows, vwapSection.rows, twapSection.rows,
    ],
  );

  const isFiltered = filteredTrades.length !== trades.length;

  if (showPrintLayout && printCharts) {
    return (
      <MultiOrderPrintLayout
        trades={filteredTrades}
        results={filteredResults}
        aggregations={aggregations}
        genericFor={genericFor}
        spreadSavingsByBenchmark={{
          arrival: arrivalSection.savings,
          vwap: vwapSection.savings,
          twap: twapSection.savings,
        }}
        spreadSavingsColumns={spreadSavingsColumns}
        aggregateColumns={aggregateColumns}
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
        priceFormatterForSymbol={priceFormatterForSymbol}
        genericFor={genericFor}
        onDeleteOrder={handleDeleteOrder}
      />

      {/* ── IS vs order size (full width) ────────────────────────────────── */}
      <div id="mo-chart-slippage">
        <SlippageChart trades={filteredTrades} results={filteredResults} />
      </div>

      {/* ── Benchmark deviations, side by side so the pair reads together ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div id="mo-chart-vwap-dev">
          <DeviationChart
            trades={filteredTrades}
            results={filteredResults}
            chartId="vwap-dev"
            title="VWAP Deviation"
            benchmark="VWAP"
            valueOf={(r) => r.VWAP_dev_bps}
          />
        </div>
        <div id="mo-chart-twap-dev">
          <DeviationChart
            trades={filteredTrades}
            results={filteredResults}
            chartId="twap-dev"
            title="TWAP Deviation"
            benchmark="TWAP"
            valueOf={(r) => r.TWAP_dev_bps}
          />
        </div>
      </div>

      {/* ── Spread vs slippage (full width) ──────────────────────────────── */}
      <div id="mo-chart-spread">
        <SpreadScatter trades={filteredTrades} results={filteredResults} />
      </div>

      {/* ── Aggregation tables ───────────────────────────────────────────── */}
      <AggregationSection
        aggregations={aggregations}
        benchmarkSections={benchmarkSections}
        spreadSavingsColumns={spreadSavingsColumns}
        onSpreadSavingsColumnsChange={changeSpreadSavingsColumns}
        aggregateColumns={aggregateColumns}
        onAggregateColumnsChange={changeAggregateColumns}
        groupGeneric={groupGeneric}
        onGroupGenericChange={changeGroupGeneric}
      />
    </div>
  );
}

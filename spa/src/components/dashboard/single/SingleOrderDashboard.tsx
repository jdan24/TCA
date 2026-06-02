/**
 * SingleOrderDashboard — Mode 2 analytics view.
 *
 * Layout:
 *   ┌─ Toolbar ──────────────────────────────────────────────────────────┐
 *   ├─ Algo selector ────────────────────────────────────────────────────┤
 *   ├─ ParentSummaryCard (full width) ───────────────────────────────────┤
 *   ├─ CumulativeTWAP ──────── CumulativeVWAP ──────────────────────────┤
 *   ├─ ExecutionTimeline ───── RunningParticipation ────────────────────┤
 *   └─ TradeTable (fill detail, full width) ─────────────────────────────┘
 */

import { useMemo, useState } from "react";
import type { EnrichProgress } from "@/bloomberg/enrichmentService";
import type { BloombergEnrichment, TCAResult, TradeRecord } from "@/types";
import { computeParentOrderSummary } from "@/tca/compute";
import { useTCAStore } from "@/store/useTCAStore";
import { useSymbolMap } from "@/hooks/useSymbolMap";
import { ExportBar } from "@/components/export/ExportBar";
import { TradeTable } from "@/components/table/TradeTable";
import { ParentSummaryCard } from "./ParentSummaryCard";
import { ExecutionTimeline } from "./ExecutionTimeline";
import { CumulativeVWAP } from "./CumulativeVWAP";
import { CumulativeTWAP } from "./CumulativeTWAP";
import { RunningParticipation } from "./RunningParticipation";

const ALGO_OPTIONS = ["TWAP", "VWAP", "POV", "Pegger", "Sniper", "ArtemIS", "Apollo"] as const;
type AlgoOption = typeof ALGO_OPTIONS[number];

/** Which benchmark card to highlight given the selected algo. */
function highlightedBenchmark(algo: AlgoOption | null): "arrival" | "vwap" | "twap" {
  if (algo === "TWAP") return "twap";
  if (algo === "VWAP") return "vwap";
  return "arrival";
}

interface SingleOrderDashboardProps {
  trades: TradeRecord[];
  results: TCAResult[];
  enrichment: Record<string, BloombergEnrichment>;
  bloombergConnected: boolean;
  enrichedCount: number;
  enrichProgress: EnrichProgress | null;
  onFetchBloomberg: () => void;
  onReset: () => void;
}

export function SingleOrderDashboard({
  trades,
  results,
  enrichment,
  bloombergConnected,
  enrichedCount,
  enrichProgress,
  onFetchBloomberg,
  onReset,
}: SingleOrderDashboardProps) {
  const [selectedAlgo, setSelectedAlgo] = useState<AlgoOption | null>(null);
  const symbolMap = useSymbolMap();

  // Time overrides (persisted in store so the Bloomberg fetch in App.tsx can read them)
  const singleOrderTimeOverride    = useTCAStore((s) => s.singleOrderTimeOverride);
  const setSingleOrderTimeOverride = useTCAStore((s) => s.setSingleOrderTimeOverride);
  const singleOrderBbgSymbol       = useTCAStore((s) => s.singleOrderBbgSymbol);
  const setSingleOrderBbgSymbol    = useTCAStore((s) => s.setSingleOrderBbgSymbol);

  const summary = useMemo(
    () => computeParentOrderSummary(trades, enrichment, singleOrderTimeOverride ?? undefined),
    [trades, enrichment, singleOrderTimeOverride],
  );

  // Single pass over the first enriched trade's tradeTicks for [orderTime, lastFillTime].
  const { marketTicks, marketVolTicks } = useMemo<{
    marketTicks: Array<{ t: number; price: number }> | null;
    marketVolTicks: Array<{ t: number; size: number }> | null;
  }>(() => {
    if (summary === null) return { marketTicks: null, marketVolTicks: null };
    const orderMs    = summary.orderTime.getTime();
    const lastFillMs = summary.lastFillTime.getTime();
    for (const trade of trades) {
      const e = enrichment[trade.orderId];
      if (!e || e.tradeTicks.length === 0) continue;
      const filtered = e.tradeTicks.filter((tk) => {
        const ms = tk.time.getTime();
        return ms >= orderMs && ms <= lastFillMs;
      });
      if (filtered.length === 0) return { marketTicks: null, marketVolTicks: null };
      return {
        marketTicks:    filtered.map((tk) => ({ t: tk.time.getTime(), price: tk.price })),
        marketVolTicks: filtered.map((tk) => ({ t: tk.time.getTime(), size: tk.size })),
      };
    }
    return { marketTicks: null, marketVolTicks: null };
  }, [trades, enrichment, summary]);

  const isFetching = enrichProgress !== null;
  const pct =
    isFetching && enrichProgress.total > 0
      ? Math.round((enrichProgress.done / enrichProgress.total) * 100)
      : 0;

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-6 space-y-4">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-gray-900 dark:text-white">
            {trades.length.toLocaleString()} fill{trades.length !== 1 ? "s" : ""}
          </span>
          {enrichedCount > 0 && (
            <span className="text-gray-400 dark:text-gray-500">
              · {enrichedCount} enriched with Bloomberg
            </span>
          )}
        </div>

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

          <ExportBar trades={trades} results={results} summary={summary ?? undefined} />

          <button
            type="button"
            onClick={onReset}
            className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            ↺ Load new file
          </button>
        </div>
      </div>

      {/* ── Bloomberg symbol override ───────────────────────────────────── */}
      {(() => {
        const fallback = trades[0] ? symbolMap.resolve(trades[0].symbol) : "";
        const isOverridden = !!singleOrderBbgSymbol?.trim();
        const isUsingMapping = !isOverridden && fallback !== (trades[0]?.symbol ?? "");
        return (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <label
                htmlFor="bbg-symbol-input"
                className="text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap"
              >
                Bloomberg Symbol
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  id="bbg-symbol-input"
                  type="text"
                  value={singleOrderBbgSymbol ?? ""}
                  placeholder={fallback || "e.g. ESH5 Index"}
                  onChange={(e) => setSingleOrderBbgSymbol(e.target.value || null)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px] font-mono"
                  spellCheck={false}
                />
                {isOverridden && (
                  <button
                    type="button"
                    onClick={() => setSingleOrderBbgSymbol(null)}
                    title="Clear override — revert to symbol mapping"
                    className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              {isOverridden ? (
                <span className="text-[11px] text-blue-600 dark:text-blue-400 font-medium">
                  Using manual override
                </span>
              ) : isUsingMapping ? (
                <span className="text-[11px] text-gray-400 dark:text-gray-500">
                  Using symbol mapping: <span className="font-mono">{fallback}</span>
                </span>
              ) : (
                <span className="text-[11px] text-amber-600 dark:text-amber-400">
                  No mapping found for <span className="font-mono">{trades[0]?.symbol}</span> — type a Bloomberg symbol above
                </span>
              )}
            </div>
            <p className="text-[10px] text-gray-400 dark:text-gray-600 ml-[128px]">
              Ticker + yellow key, e.g.{" "}
              <span className="font-mono">ESH5 Index</span> ·{" "}
              <span className="font-mono">CLZ4 Comdty</span> ·{" "}
              <span className="font-mono">6EH5 Curncy</span>
            </p>
          </div>
        );
      })()}

      {/* ── Algo selector ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <label
          htmlFor="algo-select"
          className="text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap"
        >
          Execution Algo
        </label>
        <select
          id="algo-select"
          value={selectedAlgo ?? ""}
          onChange={(e) => setSelectedAlgo((e.target.value as AlgoOption) || null)}
          className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[140px]"
        >
          <option value="">— select algo —</option>
          {ALGO_OPTIONS.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        {selectedAlgo !== null && (
          <span className="text-[11px] text-gray-400 dark:text-gray-500 italic">
            {selectedAlgo === "TWAP"
              ? "Market TWAP is the primary benchmark for this algo"
              : selectedAlgo === "VWAP"
                ? "Market VWAP is the primary benchmark for this algo"
                : "Arrival price is the primary benchmark for this algo"}
          </span>
        )}
      </div>

      {/* ── Parent order summary ─────────────────────────────────────────── */}
      {summary !== null && (
        <ParentSummaryCard
          summary={summary}
          highlightedBenchmark={selectedAlgo !== null ? highlightedBenchmark(selectedAlgo) : null}
          onOrderTimeChange={(d) =>
            setSingleOrderTimeOverride({
              start: d,
              end: singleOrderTimeOverride?.end ?? summary.lastFillTime,
            })
          }
          onLastFillTimeChange={(d) =>
            setSingleOrderTimeOverride({
              start: singleOrderTimeOverride?.start ?? summary.orderTime,
              end: d,
            })
          }
        />
      )}

      {/* ── Cumulative TWAP + Cumulative VWAP ──────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CumulativeTWAP
          trades={trades}
          arrivalPrice={summary?.arrivalPrice ?? null}
          runningMarketTwap={summary?.runningMarketTwap ?? null}
        />
        <CumulativeVWAP
          trades={trades}
          arrivalPrice={summary?.arrivalPrice ?? null}
          runningMarketVwap={summary?.runningMarketVwap ?? null}
        />
      </div>

      {/* ── Execution timeline + Running participation rate ──────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ExecutionTimeline
          trades={trades}
          arrivalPrice={summary?.arrivalPrice ?? null}
          marketTicks={marketTicks}
        />
        <RunningParticipation
          trades={trades}
          marketVolTicks={marketVolTicks}
          marketTicks={marketTicks}
        />
      </div>

      {/* ── Fill detail table ────────────────────────────────────────────── */}
      <TradeTable trades={trades} results={results} title="Fill Detail" hideMetrics />
    </div>
  );
}

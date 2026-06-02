/**
 * SingleOrderDashboard — Mode 2 analytics view.
 *
 * All uploaded rows are treated as child slices of one parent order.
 *
 * Layout:
 *   ┌─ Toolbar ──────────────────────────────────────────────────────────┐
 *   ├─ ParentSummaryCard (full width) ───────────────────────────────────┤
 *   ├─ ExecutionTimeline ──── CumulativeVWAP ────────────────────────────┤
 *   ├─ CumulativeTWAP ──────── QtyProfile ─────────────────────────────┤
 *   └─ TradeTable (fill detail, full width) ─────────────────────────────┘
 */

import { useMemo } from "react";
import type { EnrichProgress } from "@/bloomberg/enrichmentService";
import type { BloombergEnrichment, TCAResult, TradeRecord } from "@/types";
import { computeParentOrderSummary } from "@/tca/compute";
import { ExportBar } from "@/components/export/ExportBar";
import { TradeTable } from "@/components/table/TradeTable";
import { ParentSummaryCard } from "./ParentSummaryCard";
import { ExecutionTimeline } from "./ExecutionTimeline";
import { QtyProfile } from "./QtyProfile";
import { CumulativeVWAP } from "./CumulativeVWAP";
import { CumulativeTWAP } from "./CumulativeTWAP";

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
  const summary = useMemo(
    () => computeParentOrderSummary(trades, results, enrichment),
    [trades, results, enrichment],
  );

  // Last-traded price ticks for the ExecutionTimeline market-price line.
  // Use the first enriched trade's tradeTicks, filtered to [orderTime, lastFillTime].
  const marketTicks = useMemo<Array<{ t: number; price: number }> | null>(() => {
    if (summary === null) return null;
    const orderMs    = summary.orderTime.getTime();
    const lastFillMs = summary.lastFillTime.getTime();
    for (const trade of trades) {
      const e = enrichment[trade.orderId];
      if (!e || e.tradeTicks.length === 0) continue;
      const ticks = e.tradeTicks
        .filter((tk) => {
          const ms = tk.time.getTime();
          return ms >= orderMs && ms <= lastFillMs;
        })
        .map((tk) => ({ t: tk.time.getTime(), price: tk.price }));
      return ticks.length > 0 ? ticks : null;
    }
    return null;
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

      {/* ── Parent order summary ─────────────────────────────────────────── */}
      {summary !== null && <ParentSummaryCard summary={summary} />}

      {/* ── Execution timeline + Cumulative VWAP ────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ExecutionTimeline
          trades={trades}
          arrivalPrice={summary?.arrivalPrice ?? null}
          marketTicks={marketTicks}
        />
        <CumulativeVWAP
          trades={trades}
          arrivalPrice={summary?.arrivalPrice ?? null}
          runningMarketVwap={summary?.runningMarketVwap ?? null}
        />
      </div>

      {/* ── TWAP chart + Qty profile ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CumulativeTWAP
          trades={trades}
          arrivalPrice={summary?.arrivalPrice ?? null}
          runningMarketTwap={summary?.runningMarketTwap ?? null}
        />
        <QtyProfile trades={trades} />
      </div>

      {/* ── Fill detail table ────────────────────────────────────────────── */}
      <TradeTable trades={trades} results={results} title="Fill Detail" hideMetrics />
    </div>
  );
}

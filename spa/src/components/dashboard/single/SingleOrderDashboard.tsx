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

import { useEffect, useMemo, useState } from "react";
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
  const singleOrderFetchWindow     = useTCAStore((s) => s.singleOrderFetchWindow);
  const singleOrderBbgSymbol       = useTCAStore((s) => s.singleOrderBbgSymbol);
  const setSingleOrderBbgSymbol    = useTCAStore((s) => s.setSingleOrderBbgSymbol);
  const singleOrderPriceScale      = useTCAStore((s) => s.singleOrderPriceScale);
  const setSingleOrderPriceScale   = useTCAStore((s) => s.setSingleOrderPriceScale);

  // Controlled input string for the scale field (separate from the parsed store value)
  const [scaleInputStr, setScaleInputStr] = useState(
    singleOrderPriceScale !== null ? String(singleOrderPriceScale) : "",
  );

  // ── Symbol-map ↔ price scale sync ─────────────────────────────────────────
  // On mount: if no scale is set yet, pre-populate from the saved symbol mapping.
  useEffect(() => {
    if (singleOrderPriceScale !== null) return; // already set (e.g. from a previous session)
    const ric = trades[0]?.symbol;
    if (!ric) return;
    const saved = symbolMap.mappings.find((m) => m.ric === ric);
    const mult  = saved?.priceMultiplier;
    if (mult !== undefined && mult > 0 && mult !== 1) {
      setSingleOrderPriceScale(mult);
      setScaleInputStr(String(mult));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally only on mount

  /** Persist the effective price multiplier back to the symbol map. */
  function persistScaleToMap(mult: number | null) {
    const ric = trades[0]?.symbol;
    if (!ric) return;
    const existing = symbolMap.mappings.find((m) => m.ric === ric);
    if (mult === null || mult === 1) {
      // Remove the multiplier: replace the mapping without the priceMultiplier field.
      // addMapping() does a full replace (filter + append) so the property is gone.
      if (existing) {
        symbolMap.addMapping({ ric: existing.ric, bbgTicker: existing.bbgTicker, bbgYellowKey: existing.bbgYellowKey });
      }
    } else if (existing) {
      symbolMap.updateMapping(ric, { priceMultiplier: mult });
    } else {
      // No Bloomberg mapping yet — create a scale-only entry so it persists.
      // bbgTicker is left empty; resolve() returns the raw RIC until the
      // user fills in the ticker via the Symbol Mapping modal.
      symbolMap.addMapping({ ric, bbgTicker: "", bbgYellowKey: "Index", priceMultiplier: mult });
    }
  }

  function applyScaleInput(s: string) {
    setScaleInputStr(s);
    const n = parseFloat(s);
    if (!s.trim() || isNaN(n) || n <= 0 || n === 1) {
      setSingleOrderPriceScale(null);
      persistScaleToMap(null);
    } else {
      setSingleOrderPriceScale(n);
      persistScaleToMap(n);
    }
  }

  function clearScale() {
    setSingleOrderPriceScale(null);
    setScaleInputStr("");
    persistScaleToMap(null);
  }

  // Apply price scale to fill prices only — timestamps, qty, and Bloomberg prices are unchanged.
  const scale = singleOrderPriceScale ?? 1;
  const scaledTrades = useMemo(() => {
    if (scale === 1) return trades;
    return trades.map((t) => ({ ...t, avgFillPrice: t.avgFillPrice * scale }));
  }, [trades, scale]);

  const summary = useMemo(
    () => computeParentOrderSummary(scaledTrades, enrichment, singleOrderTimeOverride ?? undefined),
    [scaledTrades, enrichment, singleOrderTimeOverride],
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

  // Detect when the current time override is outside the window used for the last
  // Bloomberg fetch.  Relies on singleOrderFetchWindow set by App.tsx after each fetch.
  // Falls back to false when no fetch has been performed yet (no stale indicator needed).
  const bbgStale = useMemo(() => {
    if (!singleOrderTimeOverride || !singleOrderFetchWindow) return false;
    const startMs = singleOrderTimeOverride.start.getTime();
    const endMs   = singleOrderTimeOverride.end.getTime();
    return (
      startMs < singleOrderFetchWindow.start.getTime() ||
      endMs   > singleOrderFetchWindow.end.getTime()
    );
  }, [singleOrderTimeOverride, singleOrderFetchWindow]);

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

          <ExportBar trades={scaledTrades} results={results} summary={summary ?? undefined} />

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

      {/* ── Fill price scale ────────────────────────────────────────────── */}
      {(() => {
        const rawSample    = trades[0]?.avgFillPrice ?? null;
        const scaledSample = rawSample !== null && scale !== 1 ? rawSample * scale : null;
        const isActive     = singleOrderPriceScale !== null && singleOrderPriceScale !== 1;
        return (
          <div className="flex items-center gap-3">
            <label
              htmlFor="price-scale-input"
              className="text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap"
            >
              Fill Price Scale
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id="price-scale-input"
                type="text"
                inputMode="decimal"
                value={scaleInputStr}
                placeholder="1.0"
                onChange={(e) => applyScaleInput(e.target.value)}
                className={`px-3 py-1.5 text-xs rounded-lg border bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 w-28 font-mono ${
                  isActive
                    ? "border-amber-400 dark:border-amber-500"
                    : "border-gray-200 dark:border-gray-700"
                }`}
              />
              {isActive && (
                <button
                  type="button"
                  onClick={clearScale}
                  title="Remove scale override"
                  className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            {isActive && rawSample !== null && scaledSample !== null ? (
              <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                {rawSample.toFixed(4)} × {singleOrderPriceScale} ={" "}
                <span className="font-mono">{scaledSample.toFixed(4)}</span>
              </span>
            ) : (
              <span className="text-[11px] text-gray-400 dark:text-gray-600">
                Multiplier for fill prices — e.g.{" "}
                <span className="font-mono">0.01</span> to divide by 100,{" "}
                <span className="font-mono">100</span> to multiply
              </span>
            )}
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

      {/* ── Stale Bloomberg data indicator ──────────────────────────────── */}
      {bbgStale && enrichedCount > 0 && !isFetching && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 text-xs">
          <span className="text-amber-700 dark:text-amber-400 flex-1">
            Time range extends beyond the fetched Bloomberg window — market lines may be incomplete.
          </span>
          {bloombergConnected && (
            <button
              type="button"
              onClick={onFetchBloomberg}
              className="shrink-0 px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-600 text-white font-medium transition-colors"
            >
              Re-fetch Bloomberg
            </button>
          )}
        </div>
      )}

      {/* ── Cumulative TWAP + Cumulative VWAP ──────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CumulativeTWAP
          trades={scaledTrades}
          arrivalPrice={summary?.arrivalPrice ?? null}
          runningMarketTwap={summary?.runningMarketTwap ?? null}
          orderTime={summary?.orderTime ?? null}
          lastFillTime={summary?.lastFillTime ?? null}
        />
        <CumulativeVWAP
          trades={scaledTrades}
          arrivalPrice={summary?.arrivalPrice ?? null}
          runningMarketVwap={summary?.runningMarketVwap ?? null}
          orderTime={summary?.orderTime ?? null}
          lastFillTime={summary?.lastFillTime ?? null}
        />
      </div>

      {/* ── Execution timeline + Running participation rate ──────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ExecutionTimeline
          trades={scaledTrades}
          arrivalPrice={summary?.arrivalPrice ?? null}
          marketTicks={marketTicks}
          orderTime={summary?.orderTime ?? null}
          lastFillTime={summary?.lastFillTime ?? null}
        />
        <RunningParticipation
          trades={scaledTrades}
          marketVolTicks={marketVolTicks}
          marketTicks={marketTicks}
          orderTime={summary?.orderTime ?? null}
          lastFillTime={summary?.lastFillTime ?? null}
        />
      </div>

      {/* ── Fill detail table ────────────────────────────────────────────── */}
      <TradeTable trades={scaledTrades} results={results} title="Fill Detail" hideMetrics />
    </div>
  );
}

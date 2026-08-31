/**
 * SettleDashboard — the Allianz Target Settle report.
 *
 * Allianz work TWAP/VWAP orders into one of two settlement prints and judge the
 * execution against that print rather than against arrival or intraday VWAP:
 *
 *   3PM NY — the Treasury close, from the contract's official settle.
 *   4PM NY — the equity close, from the last print before 16:00:00 NY.
 *
 * Each order is assigned to whichever settle it finished into, and everything
 * below is measured against that. The bucketing tolerance is adjustable in the
 * header because "working into the settle" is a judgement, not a fixed rule.
 *
 * Layout:
 *   Toolbar (counts, tolerance, fetch, print, reset)
 *   By Settle Window
 *   3PM / 4PM Slippage by Spread Cost & Algo
 *   By Instrument
 *   By Instrument & Algo
 *   Order Detail
 */

import { useMemo, useState } from "react";
import type { SettleTolerance, TradeRecord } from "@/types";
import type { SettleProgress } from "@/bloomberg/settleService";
import { computeSettleResults, DEFAULT_SETTLE_TOLERANCE } from "@/tca/settle";
import {
  buildSettleBySymbol,
  buildSettleBySymbolAlgo,
  buildSettleWindowSummary,
} from "@/tca/settleAggregate";
import { toGenericTicker } from "@/tca/genericTicker";
import { buildPointValueResolver } from "@/tca/pointValue";
import { buildTickSizeResolver } from "@/tca/tickSize";
import {
  pointValueFromContractSize,
  pointValueFromValPt,
  toMajorCurrency,
} from "@/tca/dollars";
import { getTreasuryPrecision } from "@/tca/treasuryFrac";
import { useSymbolMap } from "@/hooks/useSymbolMap";
import { useTCAStore } from "@/store/useTCAStore";
import { SettleWindowSummary } from "./SettleWindowSummary";
import { SettleAlgoDistribution } from "./SettleAlgoDistribution";
import { SettleBySymbol, SettleBySymbolAlgo } from "./SettleBySymbol";
import {
  buildSettleRows,
  loadSettleCols,
  saveSettleCols,
  SETTLE_COLUMNS,
  settleCellText,
  SettleOrderTable,
  type SettleColumnId,
} from "./SettleOrderTable";
import { SettlePrintLayout } from "./SettlePrintLayout";

interface SettleDashboardProps {
  trades: TradeRecord[];
  bloombergConnected: boolean;
  benchmarkCount: number;
  progress: SettleProgress | null;
  onFetch: () => void;
  onReset: () => void;
}

const GROUP_GENERIC_KEY = "tca_settle_generic_v1";

/** The two charted windows, in the order the report reads them. */
const SETTLE_WINDOWS = ["3pm", "4pm"] as const;

function loadGroupGeneric(): boolean {
  try {
    const raw = localStorage.getItem(GROUP_GENERIC_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

export function SettleDashboard({
  trades,
  bloombergConnected,
  benchmarkCount,
  progress,
  onFetch,
  onReset,
}: SettleDashboardProps) {
  const symbolMap = useSymbolMap();
  const settleBenchmarks = useTCAStore((s) => s.settleBenchmarks);
  const settleReference = useTCAStore((s) => s.settleReference);
  const tolerance = useTCAStore((s) => s.settleTolerance);
  const setTolerance = useTCAStore((s) => s.setSettleTolerance);

  const [showPrint, setShowPrint] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<SettleColumnId[]>(loadSettleCols);
  const [groupGeneric, setGroupGeneric] = useState<boolean>(loadGroupGeneric);

  function changeColumns(ids: SettleColumnId[]) {
    setVisibleColumns(ids);
    saveSettleCols(ids);
  }
  function changeGroupGeneric(v: boolean) {
    setGroupGeneric(v);
    try {
      localStorage.setItem(GROUP_GENERIC_KEY, String(v));
    } catch {
      // localStorage unavailable — the setting just won't persist
    }
  }

  const resolveSymbol = symbolMap.resolve;

  // Point value: the manual symbol-map override wins, then Bloomberg's own
  // FUT_VAL_PT, then the FUT_CONT_SIZE derivation — the same priority the
  // multi-order path uses, just sourced from this report's lighter fetch.
  const pointValueFor = useMemo(() => {
    const manual = buildPointValueResolver(symbolMap.mappings, [], {});
    return (ric: string): number | null => {
      const override = manual(ric);
      if (override !== null) return override;
      const bbg = resolveSymbol(ric);
      const ref = settleReference[bbg];
      if (!ref) return null;
      return (
        pointValueFromValPt(ref["FUT_VAL_PT"]) ??
        pointValueFromContractSize(
          ref["FUT_CONT_SIZE"],
          getTreasuryPrecision(bbg) !== null,
          ref["CRNCY"],
        )
      );
    };
  }, [symbolMap.mappings, settleReference, resolveSymbol]);

  const currencyFor = useMemo(
    () => (ric: string): string | null =>
      toMajorCurrency(settleReference[resolveSymbol(ric)]?.["CRNCY"]),
    [settleReference, resolveSymbol],
  );

  const results = useMemo(
    () =>
      computeSettleResults(
        trades,
        settleBenchmarks,
        tolerance,
        resolveSymbol,
        pointValueFor,
        currencyFor,
      ),
    [trades, settleBenchmarks, tolerance, resolveSymbol, pointValueFor, currencyFor],
  );

  const windowSummary = useMemo(
    () => buildSettleWindowSummary(trades, results),
    [trades, results],
  );

  const symbolKeyFor = useMemo(
    () => (ric: string) =>
      groupGeneric ? toGenericTicker(resolveSymbol(ric)) : resolveSymbol(ric),
    [groupGeneric, resolveSymbol],
  );

  const bySymbol = useMemo(
    () => buildSettleBySymbol(trades, results, symbolKeyFor),
    [trades, results, symbolKeyFor],
  );

  // The instrument+algo table follows the same Generic/Expiry toggle, so the two
  // tables can never disagree about what counts as one instrument.
  const bySymbolAlgo = useMemo(
    () => buildSettleBySymbolAlgo(trades, results, symbolKeyFor),
    [trades, results, symbolKeyFor],
  );

  // Tick size for the spread-cost charts: Bloomberg's FUT_TICK_SIZE from the
  // fetch already made for point values, falling back to the built-in table.
  const tickSizeFor = useMemo(
    () => buildTickSizeResolver(settleReference),
    [settleReference],
  );

  const tableRows = useMemo(
    () => buildSettleRows(trades, results, resolveSymbol),
    [trades, results, resolveSymbol],
  );

  function handleExportCsv() {
    const cols = SETTLE_COLUMNS.filter((c) => visibleColumns.includes(c.id));
    const esc = (v: string | number | null): string => {
      if (v === null) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      ["Symbol", ...cols.map((c) => c.label)].map(esc).join(","),
      ...tableRows.map((r) =>
        [r.bbgSymbol, ...cols.map((c) => settleCellText(r, c.id))].map(esc).join(","),
      ),
    ];
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `target-settle_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (showPrint) {
    return (
      <SettlePrintLayout
        windowSummary={windowSummary}
        bySymbol={bySymbol}
        bySymbolAlgo={bySymbolAlgo}
        rows={tableRows}
        visibleColumns={visibleColumns}
        tolerance={tolerance}
        trades={trades}
        results={results}
        tickSizeFor={tickSizeFor}
        resolveSymbol={resolveSymbol}
        onBack={() => setShowPrint(false)}
      />
    );
  }

  const isFetching = progress !== null;
  const pct = isFetching && progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  const unassigned = windowSummary.find((r) => r.window === "unassigned")?.count ?? 0;

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-6 space-y-4">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-gray-900 dark:text-white">
            {trades.length.toLocaleString()} order{trades.length !== 1 ? "s" : ""}
          </span>
          {benchmarkCount > 0 && (
            <span className="text-gray-400 dark:text-gray-500">
              &middot; {benchmarkCount} benchmark{benchmarkCount !== 1 ? "s" : ""} fetched
            </span>
          )}
          {unassigned > 0 && (
            <span
              className="text-amber-600 dark:text-amber-400"
              title="These finished outside both settle windows. Widen the tolerance if they should be included."
            >
              &middot; {unassigned} unassigned
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
                {progress.done}/{progress.total}
              </span>
            </div>
          ) : bloombergConnected ? (
            <button
              type="button"
              onClick={onFetch}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors"
            >
              {benchmarkCount > 0 ? "Re-fetch Benchmarks" : "Fetch Settle Benchmarks"}
            </button>
          ) : (
            <span className="text-xs text-gray-400 dark:text-gray-600 italic">
              Bridge offline — no settle benchmarks
            </span>
          )}

          <button
            type="button"
            onClick={() => setShowPrint(true)}
            className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Print Layout
          </button>

          <button
            type="button"
            onClick={onReset}
            className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            &#8629; Load new file
          </button>
        </div>
      </div>

      {/* ── Bucketing tolerance ─────────────────────────────────────────── */}
      <ToleranceControl value={tolerance} onChange={setTolerance} />

      <SettleWindowSummary rows={windowSummary} />

      {SETTLE_WINDOWS.map((w) => (
        <SettleAlgoDistribution
          key={w}
          window={w}
          trades={trades}
          results={results}
          tickSizeFor={tickSizeFor}
          resolveSymbol={resolveSymbol}
        />
      ))}

      <SettleBySymbol
        rows={bySymbol}
        actions={
          <div className="flex items-center gap-2 print:hidden">
            <span className="text-[11px] text-gray-400 dark:text-gray-500">Group by</span>
            <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <ToggleButton
                label="Generic"
                title="Collapse expiries onto the instrument — FVU6 and FVZ6 both count as FV Comdty"
                active={groupGeneric}
                onClick={() => changeGroupGeneric(true)}
              />
              <ToggleButton
                label="Expiry"
                title="One row per contract"
                active={!groupGeneric}
                onClick={() => changeGroupGeneric(false)}
              />
            </div>
          </div>
        }
      />

      <SettleBySymbolAlgo rows={bySymbolAlgo} />

      <SettleOrderTable
        rows={tableRows}
        visibleColumns={visibleColumns}
        onVisibleColumnsChange={changeColumns}
        onExportCsv={handleExportCsv}
      />
    </div>
  );
}

// ── Tolerance control ─────────────────────────────────────────────────────────

/**
 * How near a settle an order's last fill must land to count as targeting it.
 *
 * Asymmetric by default — orders finish *into* a settle and only rarely well
 * past it — so the reach is spent on the side it is actually needed.
 */
function ToleranceControl({
  value,
  onChange,
}: {
  value: SettleTolerance;
  onChange: (t: SettleTolerance) => void;
}) {
  const isDefault =
    value.beforeMin === DEFAULT_SETTLE_TOLERANCE.beforeMin &&
    value.afterMin === DEFAULT_SETTLE_TOLERANCE.afterMin;

  const clamp = (n: number) => Math.max(0, Math.min(360, Math.round(n)));

  return (
    <div className="flex flex-wrap items-center gap-3 px-1 py-2 border-b border-gray-100 dark:border-gray-800 print:hidden">
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
        Settle window
      </span>
      <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        from
        <input
          type="number"
          min={0}
          max={360}
          value={value.beforeMin}
          onChange={(e) => onChange({ ...value, beforeMin: clamp(Number(e.target.value)) })}
          className="w-16 px-2 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        min before
      </label>
      <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        to
        <input
          type="number"
          min={0}
          max={360}
          value={value.afterMin}
          onChange={(e) => onChange({ ...value, afterMin: clamp(Number(e.target.value)) })}
          className="w-16 px-2 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        min after
      </label>
      <span className="text-[11px] text-gray-400 dark:text-gray-600 tabular-nums">
        3PM {fmtWindow(15, value)} &middot; 4PM {fmtWindow(16, value)} NY
      </span>
      {!isDefault && (
        <button
          type="button"
          onClick={() => onChange(DEFAULT_SETTLE_TOLERANCE)}
          className="text-[11px] text-blue-500 hover:text-blue-600 dark:text-blue-400 transition-colors"
        >
          Reset
        </button>
      )}
      <span className="text-[11px] text-amber-600 dark:text-amber-400">
        Changing this re-buckets orders — re-fetch to pick up any new benchmarks.
      </span>
    </div>
  );
}

function fmtWindow(hour: number, tol: SettleTolerance): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const at = (offsetMin: number) => {
    const total = hour * 60 + offsetMin;
    return `${p(Math.floor(total / 60))}:${p(((total % 60) + 60) % 60)}`;
  };
  return `${at(-tol.beforeMin)}-${at(tol.afterMin)}`;
}

function ToggleButton({
  label,
  title,
  active,
  onClick,
}: {
  label: string;
  title: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={[
        "px-2.5 py-1 text-[11px] font-medium transition-colors",
        active
          ? "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
          : "bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

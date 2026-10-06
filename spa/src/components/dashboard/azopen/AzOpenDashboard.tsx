/**
 * AzOpenDashboard — the AZ Open report.
 *
 * Futures orders worked into the 09:30 NY cash open, each order's average fill
 * scored against VWAP and TWAP over the first minute, the mid and far touch at
 * 09:30, and the mid and far touch when the order was created. See tca/azOpen.ts
 * for the exact definitions.
 *
 * Layout:
 *   Toolbar (counts, fetch, print, reset)
 *   By Benchmark
 *   By Instrument
 *   Order Detail
 */

import { useMemo, useState } from "react";
import type { TradeRecord } from "@/types";
import type { SettleProgress } from "@/bloomberg/settleService";
import { computeOpenResults, OPEN_BENCHMARKS } from "@/tca/azOpen";
import { buildOpenBySymbol, buildOpenOverall } from "@/tca/azOpenAggregate";
import { toGenericTicker } from "@/tca/genericTicker";
import { buildPointValueResolver } from "@/tca/pointValue";
import {
  pointValueFromContractSize,
  pointValueFromValPt,
  toMajorCurrency,
} from "@/tca/dollars";
import { getTreasuryPrecision } from "@/tca/treasuryFrac";
import { useSymbolMap } from "@/hooks/useSymbolMap";
import { useCashDisplay } from "@/hooks/useCashDisplay";
import { useTCAStore } from "@/store/useTCAStore";
import { AzOpenBenchmarkSummary, AzOpenBySymbol } from "./AzOpenSummary";
import {
  AZ_OPEN_COLUMNS,
  AzOpenOrderTable,
  buildOpenRows,
  loadOpenCols,
  openCellText,
  saveOpenCols,
  type OpenColumnId,
} from "./AzOpenOrderTable";
import { AzOpenPrintLayout } from "./AzOpenPrintLayout";

interface AzOpenDashboardProps {
  trades: TradeRecord[];
  bloombergConnected: boolean;
  benchmarkCount: number;
  progress: SettleProgress | null;
  onFetch: () => void;
  onReset: () => void;
}

const GROUP_GENERIC_KEY = "tca_azopen_generic_v1";

function loadGroupGeneric(): boolean {
  try {
    const raw = localStorage.getItem(GROUP_GENERIC_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

export function AzOpenDashboard({
  trades,
  bloombergConnected,
  benchmarkCount,
  progress,
  onFetch,
  onReset,
}: AzOpenDashboardProps) {
  const symbolMap = useSymbolMap();
  const cash = useCashDisplay();
  const windows = useTCAStore((s) => s.azOpenWindow);
  const arrivals = useTCAStore((s) => s.azOpenArrival);
  const reference = useTCAStore((s) => s.azOpenReference);

  const [showPrint, setShowPrint] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<OpenColumnId[]>(loadOpenCols);
  const [groupGeneric, setGroupGeneric] = useState<boolean>(loadGroupGeneric);

  function changeColumns(ids: OpenColumnId[]) {
    setVisibleColumns(ids);
    saveOpenCols(ids);
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

  // Point value: manual symbol-map override, then FUT_VAL_PT, then the
  // FUT_CONT_SIZE derivation — the same priority the settle report uses.
  const pointValueFor = useMemo(() => {
    const manual = buildPointValueResolver(symbolMap.mappings, [], {});
    return (ric: string): number | null => {
      const override = manual(ric);
      if (override !== null) return override;
      const bbg = resolveSymbol(ric);
      const ref = reference[bbg];
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
  }, [symbolMap.mappings, reference, resolveSymbol]);

  const currencyFor = useMemo(
    () => (ric: string): string | null =>
      toMajorCurrency(reference[resolveSymbol(ric)]?.["CRNCY"]),
    [reference, resolveSymbol],
  );

  const results = useMemo(
    () => computeOpenResults(trades, windows, arrivals, resolveSymbol, pointValueFor, currencyFor),
    [trades, windows, arrivals, resolveSymbol, pointValueFor, currencyFor],
  );

  const overall = useMemo(() => buildOpenOverall(trades, results, cash), [trades, results, cash]);

  const symbolKeyFor = useMemo(
    () => (ric: string) =>
      groupGeneric ? toGenericTicker(resolveSymbol(ric)) : resolveSymbol(ric),
    [groupGeneric, resolveSymbol],
  );

  const bySymbol = useMemo(
    () => buildOpenBySymbol(trades, results, symbolKeyFor, cash),
    [trades, results, symbolKeyFor, cash],
  );

  const tableRows = useMemo(
    () => buildOpenRows(trades, results, resolveSymbol),
    [trades, results, resolveSymbol],
  );

  function handleExportCsv() {
    const cols = AZ_OPEN_COLUMNS.filter((c) => visibleColumns.includes(c.id));
    const esc = (v: string | number | null): string => {
      if (v === null) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      ["Symbol", ...cols.map((c) => c.label)].map(esc).join(","),
      ...tableRows.map((r) =>
        [r.bbgSymbol, ...cols.map((c) => openCellText(r, c))].map(esc).join(","),
      ),
    ];
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `az-open_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (showPrint) {
    return (
      <AzOpenPrintLayout
        overall={overall}
        bySymbol={bySymbol}
        rows={tableRows}
        visibleColumns={visibleColumns}
        onBack={() => setShowPrint(false)}
      />
    );
  }

  const isFetching = progress !== null;
  const pct = isFetching && progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  // Orders with at least one benchmark whose request failed, as opposed to
  // Bloomberg answering that there was nothing — worth a re-fetch.
  const failed = results.filter((r) =>
    OPEN_BENCHMARKS.some((b) => r.bench[b.id].failed),
  ).length;
  const estimated = results.filter((r) => r.quotesEstimated).length;

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-6 space-y-4">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-gray-900 dark:text-white">
            {trades.length.toLocaleString()} order{trades.length !== 1 ? "s" : ""}
          </span>
          {benchmarkCount > 0 && (
            <span className="text-gray-400 dark:text-gray-500">
              &middot; {benchmarkCount} open window{benchmarkCount !== 1 ? "s" : ""} fetched
            </span>
          )}
          {failed > 0 && (
            <span
              className="text-amber-600 dark:text-amber-400"
              title="At least one benchmark request for these orders failed twice — it timed out or the bridge errored. Re-fetch to try again."
            >
              &middot; {failed} fetch failed
            </span>
          )}
          {estimated > 0 && (
            <span
              className="text-amber-600 dark:text-amber-400"
              title="Bloomberg had no real quotes for these orders' 09:30 or arrival instant, so the bid/ask was estimated from 1-minute bar ranges"
            >
              &middot; {estimated} with estimated quotes
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
              {benchmarkCount > 0 ? "Re-fetch Benchmarks" : "Fetch Open Benchmarks"}
            </button>
          ) : (
            <span className="text-xs text-gray-400 dark:text-gray-600 italic">
              Bridge offline — no open benchmarks
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

      <AzOpenBenchmarkSummary overall={overall} />

      <AzOpenBySymbol
        rows={bySymbol}
        actions={
          <div className="flex items-center gap-2 print:hidden">
            <span className="text-[11px] text-gray-400 dark:text-gray-500">Group by</span>
            <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <ToggleButton
                label="Generic"
                title="Collapse expiries onto the instrument — ESZ6 and ESH7 both count as ES Index"
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

      <AzOpenOrderTable
        rows={tableRows}
        visibleColumns={visibleColumns}
        onVisibleColumnsChange={changeColumns}
        onExportCsv={handleExportCsv}
      />
    </div>
  );
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

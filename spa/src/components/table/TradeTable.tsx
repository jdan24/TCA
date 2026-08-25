/**
 * Trade detail table — TanStack Table v8.
 *
 * Features:
 *   • Aggregation filter chip: when an AggregationFilter is active, shows a
 *     dismissal chip and pre-filters the table to matching orderIds.
 *   • Global search on symbol and order ID
 *   • Click-to-sort on every column (null values sort to bottom)
 *   • Column visibility toggle
 *   • Pagination: 10 / 25 / 50 rows per page
 *   • Color-coded bps cells
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as XLSX from "xlsx";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type PaginationState,
  type SortingFn,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import type { BloombergEnrichment, TCAResult, TradeRecord } from "@/types";
import { useTCAStore } from "@/store/useTCAStore";
import { resolveBenchmark } from "@/hooks/useAlgoMap";
import { fmtUsd } from "@/components/dashboard/dashboardUtils";

// ── Merged row type ───────────────────────────────────────────────────────────

interface TableRow {
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  orderQty: number;
  avgFillPrice: number;
  arrivalPrice: number | null;
  orderTime: Date;
  firstFillTime: Date;
  lastFillTime: Date;
  algo: string | null;
  timeToFill_ms: number;
  IS_bps: number | null;
  IS_usd: number | null;
  VWAP_dev_bps: number | null;
  VWAP_dev_usd: number | null;
  TWAP_dev_usd: number | null;
  MI_bps: number | null;
  currency: string;
  reversion_30s_bps: number | null;
  reversion_1m_bps: number | null;
  TWAS_bps: number | null;
  TWAS_price: number | null;
  vol_during_order_price: number | null;
  vol_during_order_bps: number | null;
  TWAP_dev_bps: number | null;
  marketVWAP_price: number | null;
}

function mergeRows(trades: TradeRecord[], results: TCAResult[], enrichment: Record<string, BloombergEnrichment>): TableRow[] {
  const resultMap = new Map<string, TCAResult>();
  for (const r of results) resultMap.set(r.orderId, r);
  return trades.map((t) => {
    const r = resultMap.get(t.orderId);
    const e = enrichment[t.orderId];
    return {
      orderId: t.orderId,
      symbol: t.symbol,
      side: t.side,
      orderQty: t.orderQty,
      avgFillPrice: t.avgFillPrice,
      arrivalPrice: t.arrivalPrice ?? e?.arrivalPrice ?? null,
      orderTime: t.orderTime,
      firstFillTime: t.firstFillTime,
      lastFillTime: t.lastFillTime,
      algo: t.algo,
      timeToFill_ms: r?.timeToFill_ms ?? 0,
      IS_bps: r?.IS_bps ?? null,
      IS_usd: r?.IS_usd ?? null,
      VWAP_dev_bps: r?.VWAP_dev_bps ?? null,
      VWAP_dev_usd: r?.VWAP_dev_usd ?? null,
      TWAP_dev_usd: r?.TWAP_dev_usd ?? null,
      currency: t.currency,
      MI_bps: r?.MI_bps ?? null,
      reversion_30s_bps: r?.reversion_30s_bps ?? null,
      reversion_1m_bps: r?.reversion_1m_bps ?? null,
      TWAS_bps: r?.TWAS_bps ?? null,
      TWAS_price: r?.TWAS_price ?? null,
      vol_during_order_price: r?.vol_during_order_price ?? null,
      vol_during_order_bps: r?.vol_during_order_bps ?? null,
      TWAP_dev_bps: r?.TWAP_dev_bps ?? null,
      marketVWAP_price: r?.marketVWAP_price ?? null,
    };
  });
}

// ── Column label map for the visibility toggle ────────────────────────────────

const COLUMN_LABELS: Record<string, string> = {
  orderId: "Order ID",
  symbol: "Symbol",
  side: "Side",
  orderQty: "Qty",
  avgFillPrice: "Fill Price",
  arrivalPrice: "Arrival Price",
  orderTime: "Order Time (UTC)",
  firstFillTime: "First Fill (UTC)",
  lastFillTime: "Last Fill (UTC)",
  algo: "Algo",
  timeToFill_ms: "TTF",
  IS_bps: "IS",
  IS_usd: "IS ($)",
  VWAP_dev_bps: "vs Mkt VWAP",
  VWAP_dev_usd: "vs Mkt VWAP ($)",
  TWAP_dev_usd: "vs Mkt TWAP ($)",
  marketVWAP_price: "Mkt VWAP",
  TWAP_dev_bps: "vs Mkt TWAP",
  MI_bps: "Mkt Impact",
  reversion_30s_bps: "Rev +30s",
  reversion_1m_bps: "Rev +1m",
  TWAS_bps: "TWAS",
  TWAS_price: "TWAS (price)",
  vol_during_order_price: "1σ Vol (price)",
  vol_during_order_bps: "1σ Vol (bps)",
};

// ── Null-safe sort: null values always go to bottom ───────────────────────────

const nullableSort: SortingFn<TableRow> = (rowA, rowB, colId) => {
  const a = rowA.getValue<number | null>(colId);
  const b = rowB.getValue<number | null>(colId);
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
};

// ── Timestamp formatter + UTC edit helpers ────────────────────────────────────

/**
 * Format a Date as "YYYY-MM-DD HH:MM:SS UTC" using UTC values so the display
 * is unambiguous regardless of the viewer's local timezone.
 * FIX timestamps (and Bloomberg bar timestamps after normalization) are UTC.
 */
function fmtUtc(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
  );
}

/** Convert a UTC Date to the datetime-local input value string (treated as UTC). */
function toInputUtc(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/** Parse a datetime-local string as UTC (append Z to force UTC interpretation). */
function parseInputAsUtc(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s + "Z");
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Compact inline editable time cell — same pencil-edit pattern as
 * ParentSummaryCard's EditableTimeRow, adapted for table cells.
 * Changes propagate to the caller via `onChange`; the caller writes
 * the new date back to rawTrades in the Zustand store so Bloomberg
 * re-fetches pick up the corrected time window.
 */
function EditableTimeCellTable({
  date,
  onChange,
}: {
  date: Date;
  onChange: (d: Date) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const [err, setErr] = useState(false);

  function startEdit() {
    setVal(toInputUtc(date));
    setErr(false);
    setEditing(true);
  }
  function confirm() {
    const d = parseInputAsUtc(val);
    if (!d) { setErr(true); return; }
    onChange(d);
    setEditing(false);
    setErr(false);
  }
  function cancel() { setEditing(false); setErr(false); }

  if (editing) {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1">
          <input
            type="datetime-local"
            step="1"
            value={val}
            onChange={(e) => { setVal(e.target.value); setErr(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirm();
              if (e.key === "Escape") cancel();
            }}
            className={[
              "text-[10px] font-mono rounded border px-1 py-0.5 w-36",
              "bg-white dark:bg-gray-800 text-gray-900 dark:text-white",
              "focus:outline-none focus:ring-1 focus:ring-blue-500",
              err ? "border-red-400" : "border-gray-300 dark:border-gray-600",
            ].join(" ")}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          <button type="button" onClick={confirm} title="Confirm (UTC)"
            className="text-green-500 hover:text-green-600 transition-colors">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </button>
          <button type="button" onClick={cancel} title="Cancel"
            className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {err && (
          <span className="text-[9px] text-red-500">Invalid — use YYYY-MM-DDTHH:MM:SS</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 group">
      <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap font-mono">
        {fmtUtc(date)}
      </span>
      <button type="button" onClick={startEdit} title="Edit time (UTC)"
        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-blue-500 dark:text-gray-600 dark:hover:text-blue-400 transition-all">
        <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
        </svg>
      </button>
    </div>
  );
}

// ── Time-to-fill formatter ────────────────────────────────────────────────────

function fmtTtf(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  const s = Math.floor(ms / 1_000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return remS > 0 ? `${m}m ${remS}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
}

// ── CSV export ────────────────────────────────────────────────────────────────

/** Wrap a value in quotes and escape any internal double-quotes. */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // Always quote to handle commas in symbol names, timestamps, etc.
  return `"${s.replace(/"/g, '""')}"`;
}

// ── Exports (visible columns only, in display order) ──────────────────────────
// One definition drives both CSV and XLSX. They used to keep separate lists and
// had already drifted: the CSV list was fixed, so hiding a column in the table
// changed the spreadsheet but not the CSV.

type ExportColDef = { header: string; value: (row: TableRow) => number | string | null };

const EXPORT_COL_DEFS: Record<string, ExportColDef> = {
  orderId:                { header: "Order ID",           value: (r) => r.orderId },
  symbol:                 { header: "Symbol",             value: (r) => r.symbol },
  side:                   { header: "Side",               value: (r) => r.side },
  orderQty:               { header: "Qty",                value: (r) => r.orderQty },
  avgFillPrice:           { header: "Fill Price",         value: (r) => r.avgFillPrice },
  arrivalPrice:           { header: "Arrival Price",      value: (r) => r.arrivalPrice },
  orderTime:              { header: "Order Time (UTC)",   value: (r) => fmtUtc(r.orderTime) },
  firstFillTime:          { header: "First Fill (UTC)",   value: (r) => fmtUtc(r.firstFillTime) },
  lastFillTime:           { header: "Last Fill (UTC)",    value: (r) => fmtUtc(r.lastFillTime) },
  algo:                   { header: "Algo",               value: (r) => r.algo },
  timeToFill_ms:          { header: "TTF",                value: (r) => fmtTtf(r.timeToFill_ms) },
  IS_bps:                 { header: "IS (bps)",           value: (r) => r.IS_bps },
  IS_usd:                 { header: "IS ($)",            value: (r) => r.IS_usd },
  VWAP_dev_bps:           { header: "vs Mkt VWAP (bps)", value: (r) => r.VWAP_dev_bps },
  VWAP_dev_usd:           { header: "vs Mkt VWAP ($)",   value: (r) => r.VWAP_dev_usd },
  TWAP_dev_usd:           { header: "vs Mkt TWAP ($)",   value: (r) => r.TWAP_dev_usd },
  marketVWAP_price:       { header: "Mkt VWAP",          value: (r) => r.marketVWAP_price },
  TWAP_dev_bps:           { header: "vs Mkt TWAP (bps)", value: (r) => r.TWAP_dev_bps },
  MI_bps:                 { header: "Mkt Impact (bps)",  value: (r) => r.MI_bps },
  reversion_30s_bps:      { header: "Rev +30s (bps)",    value: (r) => r.reversion_30s_bps },
  reversion_1m_bps:       { header: "Rev +1m (bps)",     value: (r) => r.reversion_1m_bps },
  TWAS_bps:               { header: "TWAS (bps)",        value: (r) => r.TWAS_bps },
  TWAS_price:             { header: "TWAS (price)",      value: (r) => r.TWAS_price },
  vol_during_order_price: { header: "1σ Vol (price)",     value: (r) => r.vol_during_order_price },
  vol_during_order_bps:   { header: "1σ Vol (bps)",       value: (r) => r.vol_during_order_bps },
};

function exportFillDetailToXlsx(data: TableRow[], visibleColumnIds: string[], filename: string) {
  const cols = visibleColumnIds
    .map((id) => EXPORT_COL_DEFS[id])
    .filter((c): c is ExportColDef => c !== undefined);

  const rows = data.map((row) => {
    const obj: Record<string, unknown> = {};
    for (const c of cols) obj[c.header] = c.value(row) ?? "";
    return obj;
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = cols.map((c) => ({ wch: Math.max(c.header.length + 2, 14) }));
  XLSX.utils.book_append_sheet(wb, ws, "Fill Detail");
  XLSX.writeFile(wb, filename);
}

function exportToCsv(data: TableRow[], visibleColumnIds: string[], filename: string) {
  const cols = visibleColumnIds
    .map((id) => EXPORT_COL_DEFS[id])
    .filter((c): c is ExportColDef => c !== undefined);
  if (cols.length === 0) return;

  const headerRow = cols.map((c) => csvField(c.header)).join(",");
  const dataRows  = data.map((row) =>
    cols.map((c) => csvField(c.value(row))).join(","),
  );
  const csv  = [headerRow, ...dataRows].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function BpsCell({
  value,
  invert = false,
  neutral = false,
  highlighted = false,
}: {
  value: number | null;
  invert?: boolean;
  neutral?: boolean;
  highlighted?: boolean;
}) {
  const ringCls = highlighted
    ? "ring-2 ring-blue-400 dark:ring-blue-500 rounded px-1 py-0.5"
    : "";

  if (value === null) {
    return (
      <span className={`text-gray-300 dark:text-gray-600 text-xs select-none ${ringCls}`}>N/A</span>
    );
  }
  let cls: string;
  if (neutral) {
    cls = "text-gray-700 dark:text-gray-300";
  } else {
    const favorable = invert ? value > 0 : value < 0;
    cls = favorable
      ? "text-green-600 dark:text-green-400"
      : "text-red-500 dark:text-red-400";
  }
  const sign = value > 0 ? "+" : "";
  return (
    <span className={`tabular-nums text-xs font-medium ${cls} ${ringCls}`}>
      {sign}{value.toFixed(1)}
    </span>
  );
}

/** Cash slippage cell — same red/green cost convention as BpsCell. */
function UsdCell({ value, currency }: { value: number | null; currency: string }) {
  if (value === null) {
    return <span className="text-gray-300 dark:text-gray-600 text-xs select-none">N/A</span>;
  }
  const cls = value < 0
    ? "text-green-600 dark:text-green-400"
    : "text-red-500 dark:text-red-400";
  return (
    <span className={`tabular-nums text-xs font-medium ${cls}`}>
      {fmtUsd(value, currency)}
    </span>
  );
}

function AlgoSelectCell({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      onClick={(e) => e.stopPropagation()}
      className="text-xs bg-transparent text-gray-700 dark:text-gray-300 cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500 rounded border border-gray-200 dark:border-gray-700 px-1 py-0.5 max-w-[90px]"
    >
      <option value="">—</option>
      {ALGO_OPTIONS.map((a) => (
        <option key={a} value={a}>{a}</option>
      ))}
    </select>
  );
}

function SortIcon({ direction }: { direction: "asc" | "desc" | false }) {
  if (!direction) {
    return <span className="ml-1 text-[9px] text-gray-300 dark:text-gray-600">⇅</span>;
  }
  return (
    <span className="ml-1 text-[9px] text-blue-500">
      {direction === "asc" ? "↑" : "↓"}
    </span>
  );
}

// ── Column definitions ────────────────────────────────────────────────────────
//
// Split into three static segments so the two editable time columns
// (orderTime, lastFillTime) can be injected with their callback inside
// the component, while the rest stay as module-level constants.

const col = createColumnHelper<TableRow>();

const ALGO_OPTIONS = ["TWAP", "VWAP", "POV", "Pegger", "Sniper", "ArtemIS", "Apollo"] as const;

// Columns that appear before the time block (symbol column is built inside the component)
const PRE_TIME_COLS_NO_SYMBOL = [
  col.accessor("orderId", {
    header: "Order ID",
    cell: (i) => (
      <span className="font-mono text-[11px] text-gray-400 dark:text-gray-500">
        {i.getValue()}
      </span>
    ),
    enableGlobalFilter: true,
  }),
  col.accessor("side", {
    header: "Side",
    cell: (i) => (
      <span
        className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide ${
          i.getValue() === "BUY"
            ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
            : "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400"
        }`}
      >
        {i.getValue()}
      </span>
    ),
    enableGlobalFilter: false,
  }),
  col.accessor("orderQty", {
    header: "Qty",
    cell: (i) => (
      <span className="tabular-nums text-xs">{i.getValue().toLocaleString()}</span>
    ),
    enableGlobalFilter: false,
  }),
  col.accessor("avgFillPrice", {
    header: "Fill Price",
    cell: (i) => (
      <span className="tabular-nums text-xs">
        {i.getValue().toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 6,
        })}
      </span>
    ),
    enableGlobalFilter: false,
  }),
  col.accessor("arrivalPrice", {
    header: "Arrival Price",
    cell: (i) => {
      const v = i.getValue();
      return v !== null ? (
        <span className="tabular-nums text-xs text-gray-700 dark:text-gray-300">
          {v.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 6,
          })}
        </span>
      ) : (
        <span className="text-gray-300 dark:text-gray-600 text-xs select-none">N/A</span>
      );
    },
    sortingFn: nullableSort,
    enableGlobalFilter: false,
  }),
];

// firstFillTime stays static (read-only display)
const FIRST_FILL_COL = col.accessor("firstFillTime", {
  header: "First Fill (UTC)",
  cell: (i) => (
    <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap font-mono">
      {fmtUtc(i.getValue())}
    </span>
  ),
  sortingFn: "datetime",
  enableGlobalFilter: false,
});

// Metric columns — ordered: primary benchmarks (with algo-driven highlight ring),
/**
 * Held as a named column so the component can splice the TWAS (price) column in
 * directly after it — the price column's cell needs a per-row formatter from
 * props, so it cannot live in this module-level array.
 */
const TWAS_BPS_COL = col.accessor("TWAS_bps", {
  header: "TWAS",
  cell: (i) => <BpsCell value={i.getValue()} neutral />,
  sortingFn: nullableSort,
  enableGlobalFilter: false,
});

// TWAS + Vol(bps), then secondary metrics.
// Note: algo column is built inside the component so it can capture the edit callback.
const POST_TIME_COLS = [
  // ── Primary benchmarks (blue ring on the relevant one per row) ────────────
  // Which one is "relevant" comes from the shared algo → benchmark table, so
  // the ring, the single-order highlight and the Total Cost tile all agree.
  col.accessor("IS_bps", {
    header: "IS",
    cell: (i) => (
      <BpsCell
        value={i.getValue()}
        highlighted={resolveBenchmark(i.row.original.algo) === "arrival"}
      />
    ),
    sortingFn: nullableSort,
    enableGlobalFilter: false,
  }),
  col.accessor("IS_usd", {
    header: "IS ($)",
    cell: (i) => <UsdCell value={i.getValue()} currency={i.row.original.currency} />,
    sortingFn: nullableSort,
    enableGlobalFilter: false,
  }),
  col.accessor("VWAP_dev_bps", {
    header: "vs Mkt VWAP",
    cell: (i) => (
      <BpsCell
        value={i.getValue()}
        highlighted={resolveBenchmark(i.row.original.algo) === "vwap"}
      />
    ),
    sortingFn: nullableSort,
    enableGlobalFilter: false,
  }),
  col.accessor("VWAP_dev_usd", {
    header: "vs Mkt VWAP ($)",
    cell: (i) => <UsdCell value={i.getValue()} currency={i.row.original.currency} />,
    sortingFn: nullableSort,
    enableGlobalFilter: false,
  }),
  col.accessor("TWAP_dev_bps", {
    header: "vs Mkt TWAP",
    cell: (i) => (
      <BpsCell
        value={i.getValue()}
        highlighted={resolveBenchmark(i.row.original.algo) === "twap"}
      />
    ),
    sortingFn: nullableSort,
    enableGlobalFilter: false,
  }),
  col.accessor("TWAP_dev_usd", {
    header: "vs Mkt TWAP ($)",
    cell: (i) => <UsdCell value={i.getValue()} currency={i.row.original.currency} />,
    sortingFn: nullableSort,
    enableGlobalFilter: false,
  }),
  // ── Priority secondary ───────────────────────────────────────────────────
  TWAS_BPS_COL,
  col.accessor("vol_during_order_bps", {
    header: () => <>1<span className="normal-case">σ</span> Vol (bps)</>,
    cell: (i) => <BpsCell value={i.getValue()} neutral />,
    sortingFn: nullableSort,
    enableGlobalFilter: false,
  }),
  // ── Everything else ──────────────────────────────────────────────────────
  col.accessor("timeToFill_ms", {
    header: "TTF",
    cell: (i) => (
      <span className="tabular-nums text-xs text-gray-700 dark:text-gray-300">
        {fmtTtf(i.getValue())}
      </span>
    ),
    enableGlobalFilter: false,
  }),
  col.accessor("marketVWAP_price", {
    header: "Mkt VWAP",
    cell: (i) => {
      const v = i.getValue();
      return v !== null ? (
        <span className="tabular-nums text-xs text-gray-700 dark:text-gray-300">
          {v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
        </span>
      ) : (
        <span className="text-gray-300 dark:text-gray-600 text-xs select-none">N/A</span>
      );
    },
    sortingFn: nullableSort,
    enableGlobalFilter: false,
  }),
  col.accessor("MI_bps", {
    header: "Mkt Impact",
    cell: (i) => <BpsCell value={i.getValue()} />,
    sortingFn: nullableSort,
    enableGlobalFilter: false,
  }),
  col.accessor("reversion_30s_bps", {
    header: "Rev +30s",
    cell: (i) => <BpsCell value={i.getValue()} invert />,
    sortingFn: nullableSort,
    enableGlobalFilter: false,
  }),
  col.accessor("reversion_1m_bps", {
    header: "Rev +1m",
    cell: (i) => <BpsCell value={i.getValue()} invert />,
    sortingFn: nullableSort,
    enableGlobalFilter: false,
  }),
  col.accessor("vol_during_order_price", {
    header: () => <>1<span className="normal-case">σ</span> Vol (price)</>,
    cell: (i) => {
      const v = i.getValue();
      return v !== null ? (
        <span className="tabular-nums text-xs text-gray-700 dark:text-gray-300">
          {v.toFixed(4)}
        </span>
      ) : (
        <span className="text-gray-300 dark:text-gray-600 text-xs select-none">N/A</span>
      );
    },
    sortingFn: nullableSort,
    enableGlobalFilter: false,
  }),
];

// ── Main component ────────────────────────────────────────────────────────────

interface TradeTableProps {
  trades: TradeRecord[];
  results: TCAResult[];
  /** Optional title override for Mode 2 (Single Order). */
  title?: string;
  /**
   * When true, only raw input columns are shown (no Bloomberg-dependent
   * metrics, no arrivalPrice, no algo).  Used in the Single Order Fill Detail table.
   */
  hideMetrics?: boolean;
  /** Optional symbol resolver — translates raw RIC to BBG ticker + yellow key. */
  resolveSymbol?: (ric: string) => string;
  /**
   * Per-symbol price formatter for the TWAS (price) column, e.g. 32nds for
   * Treasury futures.  The table is multi-symbol, so precision has to be
   * resolved per row; return null to fall back to 4 decimal places.
   *
   * Deliberately separate from resolveSymbol: passing that in also changes what
   * the Symbol column displays.
   */
  priceFormatterForSymbol?: (ric: string) => ((v: number) => string) | null;
  /** When true, shows an Excel export button in the toolbar. */
  showExcelExport?: boolean;
  /**
   * When provided, a trash icon appears on each row.  Clicking it prompts an
   * inline confirmation; confirming calls this callback with the order ID so
   * the parent can remove all fills for that order from its state.
   */
  onDeleteOrder?: (orderId: string) => void;
}

const PAGE_SIZES = [10, 25, 50] as const;

const DEFAULT_VISIBILITY: VisibilityState = {
  // All reversion columns visible by default; others hidden as needed
};

// Columns hidden in Fill Detail mode (hideMetrics=true):
//   - metric columns requiring Bloomberg enrichment
//   - arrivalPrice and algo (not needed in single-order fill detail)
const METRIC_COLUMN_IDS = new Set([
  "timeToFill_ms", "IS_bps", "VWAP_dev_bps", "VWAP_dev_usd", "marketVWAP_price",
  "TWAP_dev_bps", "TWAP_dev_usd", "MI_bps", "reversion_30s_bps", "reversion_1m_bps",
  "TWAS_bps", "TWAS_price", "vol_during_order_price", "vol_during_order_bps",
  "arrivalPrice", "algo",
]);

export function TradeTable({ trades, results, title = "Trade Detail", hideMetrics = false, resolveSymbol, priceFormatterForSymbol, showExcelExport = false, onDeleteOrder }: TradeTableProps) {
  const aggregationFilter = useTCAStore((s) => s.aggregationFilter);
  const setAggregationFilter = useTCAStore((s) => s.setAggregationFilter);
  const rawTrades   = useTCAStore((s) => s.rawTrades);
  const setRawTrades = useTCAStore((s) => s.setRawTrades);
  const enrichment  = useTCAStore((s) => s.enrichment);

  // Write an edited time back to rawTrades in the store so Bloomberg re-fetches
  // will use the corrected window on the next "Fetch Bloomberg Data" click.
  const handleTimeEdit = useCallback(
    (orderId: string, field: "orderTime" | "lastFillTime", date: Date) => {
      setRawTrades(rawTrades.map((t) =>
        t.orderId === orderId ? { ...t, [field]: date } : t,
      ));
    },
    [rawTrades, setRawTrades],
  );

  const handleAlgoEdit = useCallback(
    (orderId: string, algo: string | null) => {
      setRawTrades(rawTrades.map((t) =>
        t.orderId === orderId ? { ...t, algo } : t,
      ));
    },
    [rawTrades, setRawTrades],
  );

  // Build the symbol + editable columns inside the component so they capture
  // resolveSymbol and the edit callbacks.
  const allColumns = useMemo(() => {
    const symbolCol = col.accessor("symbol", {
      header: "Symbol",
      cell: (i) => (
        <span className="text-xs font-semibold text-gray-900 dark:text-white">
          {resolveSymbol ? resolveSymbol(i.getValue()) : i.getValue()}
        </span>
      ),
      enableGlobalFilter: true,
    });
    const editOrderTime = col.accessor("orderTime", {
      header: "Order Time (UTC)",
      cell: (i) => (
        <EditableTimeCellTable
          date={i.getValue()}
          onChange={(d) => handleTimeEdit(i.row.original.orderId, "orderTime", d)}
        />
      ),
      sortingFn: "datetime",
      enableGlobalFilter: false,
    });
    const editLastFill = col.accessor("lastFillTime", {
      header: "Last Fill (UTC)",
      cell: (i) => (
        <EditableTimeCellTable
          date={i.getValue()}
          onChange={(d) => handleTimeEdit(i.row.original.orderId, "lastFillTime", d)}
        />
      ),
      sortingFn: "datetime",
      enableGlobalFilter: false,
    });
    const algoCol = col.accessor("algo", {
      header: "Algo",
      cell: (i) => (
        <AlgoSelectCell
          value={i.getValue()}
          onChange={(v) => handleAlgoEdit(i.row.original.orderId, v)}
        />
      ),
      enableGlobalFilter: false,
    });
    // New column order:
    //   Order Time · Symbol · Side · Qty · Fill Price · Arrival Price
    //   · Algo · [benchmarks + metrics]
    //   · First Fill · Last Fill · Order ID · [delete — only in multi-order mode]
    // Trash-icon column — only rendered when the parent supplies onDeleteOrder.
    // enableHiding: false keeps it out of the Columns visibility toggle.
    const deleteCol = onDeleteOrder
      ? [col.display({
          id: "_delete",
          header: "",
          enableHiding: false,
          enableSorting: false,
          size: 36,
          cell: ({ row }) => (
            <button
              type="button"
              title="Remove this order"
              onClick={() => setPendingDeleteId(row.original.orderId)}
              className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-all focus:opacity-100"
              aria-label="Delete order"
            >
              <TrashIcon />
            </button>
          ),
        })]
      : [];

    const twasPriceCol = col.accessor("TWAS_price", {
      header: "TWAS (price)",
      cell: (i) => {
        const v = i.getValue();
        if (v === null) {
          return <span className="text-gray-300 dark:text-gray-600 text-xs select-none">N/A</span>;
        }
        const fmt = priceFormatterForSymbol?.(i.row.original.symbol);
        return (
          <span className="tabular-nums text-xs text-gray-700 dark:text-gray-300">
            {fmt ? fmt(v) : v.toFixed(4)}
          </span>
        );
      },
      sortingFn: nullableSort,
      enableGlobalFilter: false,
    });

    return [
      editOrderTime,
      symbolCol,
      ...PRE_TIME_COLS_NO_SYMBOL.slice(1), // side, qty, fillPrice, arrivalPrice
      algoCol,
      // IS, vs VWAP, vs TWAP, TWAS, TWAS (price), Vol(bps), then rest
      ...POST_TIME_COLS.flatMap((c) => (c === TWAS_BPS_COL ? [c, twasPriceCol] : [c])),
      FIRST_FILL_COL,
      editLastFill,
      PRE_TIME_COLS_NO_SYMBOL[0]!,         // Order ID — last
      ...deleteCol,
    ];
  }, [handleTimeEdit, handleAlgoEdit, resolveSymbol, priceFormatterForSymbol, onDeleteOrder]);

  // Pre-filter rows by aggregation selection
  const filteredIds = useMemo(
    () => (aggregationFilter ? new Set(aggregationFilter.orderIds) : null),
    [aggregationFilter],
  );

  const allData = useMemo(() => mergeRows(trades, results, enrichment), [trades, results, enrichment]);
  const data = useMemo(
    () => (filteredIds ? allData.filter((r) => filteredIds.has(r.orderId)) : allData),
    [allData, filteredIds],
  );

  /** orderId of the row currently showing the inline delete confirmation. */
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const [sorting, setSorting] = useState<SortingState>([
    { id: "orderTime", desc: true },
  ]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnVisibility, setColumnVisibility] =
    useState<VisibilityState>(DEFAULT_VISIBILITY);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  });
  // The Columns menu renders in a portal. The card wrapper is overflow-hidden
  // (for its rounded corners), which clipped an absolutely-positioned menu to
  // the card's height — with only a few rows there was barely any room for it.
  // A fixed-position portal anchored to the button escapes every ancestor.
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const colBtnRef = useRef<HTMLButtonElement>(null);
  const colMenuRef = useRef<HTMLDivElement>(null);
  const [colMenuPos, setColMenuPos] = useState<{ top: number; right: number } | null>(null);

  const openColMenu = useCallback(() => {
    const rect = colBtnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setColMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setColMenuOpen(true);
  }, []);

  // Dismiss on outside click, Escape, or anything that moves the anchor.
  useEffect(() => {
    if (!colMenuOpen) return;

    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (colMenuRef.current?.contains(target)) return;
      if (colBtnRef.current?.contains(target)) return; // the button toggles itself
      setColMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setColMenuOpen(false);
    };
    // Reposition would drift out of sync with the button, so just close.
    const onReflow = () => setColMenuOpen(false);

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [colMenuOpen]);

  const visibleColumns = hideMetrics
    ? allColumns.filter((c) => {
        const id = (c as { accessorKey?: string }).accessorKey ?? "";
        return !METRIC_COLUMN_IDS.has(id);
      })
    : allColumns;

  const table = useReactTable({
    data,
    columns: visibleColumns,
    state: { sorting, globalFilter, columnVisibility, pagination },
    onSortingChange: setSorting,
    onGlobalFilterChange: (v: unknown) => {
      setGlobalFilter(String(v ?? ""));
      setPagination((p) => ({ ...p, pageIndex: 0 }));
    },
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    globalFilterFn: "includesString",
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const { pageIndex, pageSize } = table.getState().pagination;
  const totalFiltered = table.getFilteredRowModel().rows.length;
  const pageCount = Math.max(1, table.getPageCount());
  const firstRow = totalFiltered === 0 ? 0 : pageIndex * pageSize + 1;
  const lastRow = Math.min((pageIndex + 1) * pageSize, totalFiltered);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">

      {/* ── Aggregation filter chip ────────────────────────────────────── */}
      {aggregationFilter !== null && (
        <div className="flex items-center gap-2 px-4 pt-3 pb-0">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 text-xs text-blue-700 dark:text-blue-300">
            <span>Filtered: {aggregationFilter.key}</span>
            <span className="text-blue-400 dark:text-blue-500">
              ({aggregationFilter.orderIds.length} order{aggregationFilter.orderIds.length !== 1 ? "s" : ""})
            </span>
            <button
              type="button"
              onClick={() => setAggregationFilter(null)}
              className="ml-0.5 hover:text-blue-900 dark:hover:text-blue-100 transition-colors font-semibold leading-none"
              aria-label="Clear filter"
            >
              ×
            </button>
          </span>
        </div>
      )}

      {/* ── Toolbar ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white shrink-0">
          {title}
        </h3>

        <input
          type="search"
          value={globalFilter}
          onChange={(e) => {
            setGlobalFilter(e.target.value);
            setPagination((p) => ({ ...p, pageIndex: 0 }));
          }}
          placeholder="Search symbol or order ID…"
          className="flex-1 min-w-[160px] max-w-xs px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <div>
          <button
            ref={colBtnRef}
            type="button"
            onClick={() => (colMenuOpen ? setColMenuOpen(false) : openColMenu())}
            className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none"
          >
            Columns ▾
          </button>

          {colMenuOpen && colMenuPos !== null && createPortal(
            <div
              ref={colMenuRef}
              style={{ position: "fixed", top: colMenuPos.top, right: colMenuPos.right }}
              // Capped at 70vh with its own scrollbar so a long column list stays
              // usable on a short screen instead of running off the bottom.
              className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-2 z-50 min-w-[180px] max-h-[70vh] overflow-y-auto"
            >
              {table
                .getAllColumns()
                .filter((c) => c.getCanHide())
                .map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer text-xs text-gray-700 dark:text-gray-300 select-none"
                  >
                    <input
                      type="checkbox"
                      checked={c.getIsVisible()}
                      onChange={c.getToggleVisibilityHandler()}
                      className="rounded accent-blue-500"
                    />
                    {COLUMN_LABELS[c.id] ?? c.id}
                  </label>
                ))}
              <hr className="my-1 border-gray-100 dark:border-gray-800" />
              <button
                type="button"
                onClick={() => setColMenuOpen(false)}
                className="w-full text-[10px] py-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              >
                Close
              </button>
            </div>,
            document.body,
          )}
        </div>

        {/* Export CSV — all rows (ignores filters and pagination), visible columns only */}
        {!hideMetrics && (
          <button
            type="button"
            onClick={() => {
              const visibleIds = table.getVisibleLeafColumns().map((c) => c.id);
              exportToCsv(allData, visibleIds, "trade-detail.csv");
            }}
            title="Export all rows to CSV — every row, but only the columns shown in the table"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors whitespace-nowrap"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export CSV
          </button>
        )}

        {/* Excel export — visible columns only, used in single-order Fill Detail */}
        {showExcelExport && (
          <button
            type="button"
            onClick={() => {
              const visibleIds = table.getVisibleLeafColumns().map((c) => c.id);
              exportFillDetailToXlsx(allData, visibleIds, "fill-detail.xlsx");
            }}
            title="Export visible columns to Excel (.xlsx)"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors whitespace-nowrap"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Excel
          </button>
        )}

        <span className="ml-auto text-xs text-gray-400 dark:text-gray-600 whitespace-nowrap">
          {totalFiltered !== data.length
            ? `${totalFiltered.toLocaleString()} of ${data.length.toLocaleString()} trades`
            : `${data.length.toLocaleString()} trade${data.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      {/* ── Table ─────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[900px]">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr
                key={hg.id}
                className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50"
              >
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className={[
                      "px-3 py-2.5 text-[10px] font-semibold text-gray-500 dark:text-gray-400",
                      "uppercase tracking-wider whitespace-nowrap",
                      header.column.getCanSort()
                        ? "cursor-pointer select-none hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                        : "",
                    ].join(" ")}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    <SortIcon direction={header.column.getIsSorted()} />
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          <tbody>
            {table.getRowModel().rows.map((row, i) => {
              const isPending = pendingDeleteId === row.original.orderId;
              return (
                <tr
                  key={row.id}
                  className={[
                    "group border-b border-gray-50 dark:border-gray-800/50 transition-colors",
                    isPending
                      ? "bg-red-50 dark:bg-red-900/10"
                      : i % 2 === 0
                        ? "bg-white dark:bg-gray-900"
                        : "bg-gray-50/40 dark:bg-gray-800/20",
                    !isPending && "hover:bg-blue-50/50 dark:hover:bg-blue-900/10",
                  ].filter(Boolean).join(" ")}
                >
                  {isPending ? (
                    /* ── Inline delete confirmation ─────────────────────────── */
                    <td colSpan={row.getVisibleCells().length} className="px-4 py-2.5">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                          Remove all fills for order{" "}
                          <span className="font-mono">{row.original.orderId}</span>?
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500 hidden sm:inline">
                          All metrics and charts will update.
                        </span>
                        <div className="flex items-center gap-2 ml-auto">
                          <button
                            type="button"
                            onClick={() => setPendingDeleteId(null)}
                            className="px-3 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteOrder!(row.original.orderId);
                              setPendingDeleteId(null);
                            }}
                            className="px-3 py-1 text-xs rounded-lg bg-red-500 hover:bg-red-600 text-white font-medium transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </td>
                  ) : (
                    /* ── Normal row ─────────────────────────────────────────── */
                    row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2 whitespace-nowrap">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))
                  )}
                </tr>
              );
            })}

            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td
                  colSpan={table.getVisibleLeafColumns().length}
                  className="px-4 py-10 text-center text-sm text-gray-400 dark:text-gray-600 italic"
                >
                  No trades match the current filter
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span>Rows per page</span>
          <select
            value={pageSize}
            onChange={(e) =>
              setPagination({ pageIndex: 0, pageSize: Number(e.target.value) })
            }
            className="rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          {totalFiltered > 0 && (
            <span className="tabular-nums">
              {firstRow}–{lastRow} of {totalFiltered.toLocaleString()}
            </span>
          )}
          <button
            type="button"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
            className="px-2.5 py-1 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            ◄
          </button>
          <span className="tabular-nums">{pageIndex + 1} / {pageCount}</span>
          <button
            type="button"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
            className="px-2.5 py-1 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            ►
          </button>
        </div>
      </div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

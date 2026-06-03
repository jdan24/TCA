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

import { useCallback, useMemo, useState } from "react";
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
import type { TCAResult, TradeRecord } from "@/types";
import { useTCAStore } from "@/store/useTCAStore";

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
  VWAP_dev_bps: number | null;
  MI_bps: number | null;
  reversion_30s_bps: number | null;
  reversion_1m_bps: number | null;
  TWAS_bps: number | null;
  vol_during_order_price: number | null;
  vol_during_order_bps: number | null;
  TWAP_dev_bps: number | null;
  marketVWAP_price: number | null;
}

function mergeRows(trades: TradeRecord[], results: TCAResult[]): TableRow[] {
  const resultMap = new Map<string, TCAResult>();
  for (const r of results) resultMap.set(r.orderId, r);
  return trades.map((t) => {
    const r = resultMap.get(t.orderId);
    return {
      orderId: t.orderId,
      symbol: t.symbol,
      side: t.side,
      orderQty: t.orderQty,
      avgFillPrice: t.avgFillPrice,
      arrivalPrice: t.arrivalPrice,
      orderTime: t.orderTime,
      firstFillTime: t.firstFillTime,
      lastFillTime: t.lastFillTime,
      algo: t.algo,
      timeToFill_ms: r?.timeToFill_ms ?? 0,
      IS_bps: r?.IS_bps ?? null,
      VWAP_dev_bps: r?.VWAP_dev_bps ?? null,
      MI_bps: r?.MI_bps ?? null,
      reversion_30s_bps: r?.reversion_30s_bps ?? null,
      reversion_1m_bps: r?.reversion_1m_bps ?? null,
      TWAS_bps: r?.TWAS_bps ?? null,
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
  VWAP_dev_bps: "vs Mkt VWAP",
  marketVWAP_price: "Mkt VWAP",
  TWAP_dev_bps: "vs Mkt TWAP",
  MI_bps: "Mkt Impact",
  reversion_30s_bps: "Rev +30s",
  reversion_1m_bps: "Rev +1m",
  TWAS_bps: "TWAS",
  vol_during_order_price: "Vol σ (price)",
  vol_during_order_bps: "Vol σ (bps)",
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

// ── Sub-components ────────────────────────────────────────────────────────────

function BpsCell({
  value,
  invert = false,
  neutral = false,
}: {
  value: number | null;
  invert?: boolean;
  neutral?: boolean;
}) {
  if (value === null) {
    return (
      <span className="text-gray-300 dark:text-gray-600 text-xs select-none">N/A</span>
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
    <span className={`tabular-nums text-xs font-medium ${cls}`}>
      {sign}{value.toFixed(1)}
    </span>
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

// Columns that appear before the time block
const PRE_TIME_COLS = [
  col.accessor("orderId", {
    header: "Order ID",
    cell: (i) => (
      <span className="font-mono text-[11px] text-gray-400 dark:text-gray-500">
        {i.getValue()}
      </span>
    ),
    enableGlobalFilter: true,
  }),
  col.accessor("symbol", {
    header: "Symbol",
    cell: (i) => (
      <span className="text-xs font-semibold text-gray-900 dark:text-white">
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

// Columns that appear after the time block (algo, metrics…)
const POST_TIME_COLS = [
  col.accessor("algo", {
    header: "Algo",
    cell: (i) => {
      const v = i.getValue();
      return v ? (
        <span className="text-xs text-gray-700 dark:text-gray-300">{v}</span>
      ) : (
        <span className="text-[10px] text-gray-300 dark:text-gray-600 italic select-none">—</span>
      );
    },
    enableGlobalFilter: false,
  }),
  col.accessor("timeToFill_ms", {
    header: "TTF",
    cell: (i) => (
      <span className="tabular-nums text-xs text-gray-700 dark:text-gray-300">
        {fmtTtf(i.getValue())}
      </span>
    ),
    enableGlobalFilter: false,
  }),
  col.accessor("IS_bps", {
    header: "IS",
    cell: (i) => <BpsCell value={i.getValue()} />,
    sortingFn: nullableSort,
    enableGlobalFilter: false,
  }),
  col.accessor("VWAP_dev_bps", {
    header: "vs Mkt VWAP",
    cell: (i) => <BpsCell value={i.getValue()} />,
    sortingFn: nullableSort,
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
  col.accessor("TWAP_dev_bps", {
    header: "vs Mkt TWAP",
    cell: (i) => <BpsCell value={i.getValue()} />,
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
  col.accessor("TWAS_bps", {
    header: "TWAS",
    cell: (i) => <BpsCell value={i.getValue()} neutral />,
    sortingFn: nullableSort,
    enableGlobalFilter: false,
  }),
  col.accessor("vol_during_order_price", {
    header: "Vol σ (price)",
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
  col.accessor("vol_during_order_bps", {
    header: "Vol σ (bps)",
    cell: (i) => <BpsCell value={i.getValue()} neutral />,
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
   * metrics).  Used in the Single Order Fill Detail table.
   */
  hideMetrics?: boolean;
}

const PAGE_SIZES = [10, 25, 50] as const;

const DEFAULT_VISIBILITY: VisibilityState = {
  // All reversion columns visible by default; others hidden as needed
};

// Columns that require Bloomberg enrichment — hidden when hideMetrics=true
const METRIC_COLUMN_IDS = new Set([
  "timeToFill_ms", "IS_bps", "VWAP_dev_bps", "marketVWAP_price",
  "TWAP_dev_bps", "MI_bps", "reversion_30s_bps", "reversion_1m_bps",
  "TWAS_bps", "vol_during_order_price", "vol_during_order_bps",
]);

export function TradeTable({ trades, results, title = "Trade Detail", hideMetrics = false }: TradeTableProps) {
  const aggregationFilter = useTCAStore((s) => s.aggregationFilter);
  const setAggregationFilter = useTCAStore((s) => s.setAggregationFilter);
  const rawTrades   = useTCAStore((s) => s.rawTrades);
  const setRawTrades = useTCAStore((s) => s.setRawTrades);

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

  // Build the two editable time columns inside the component so they capture
  // the handleTimeEdit callback. firstFillTime remains static (read-only).
  const allColumns = useMemo(() => {
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
    return [...PRE_TIME_COLS, editOrderTime, FIRST_FILL_COL, editLastFill, ...POST_TIME_COLS];
  }, [handleTimeEdit]);

  // Pre-filter rows by aggregation selection
  const filteredIds = useMemo(
    () => (aggregationFilter ? new Set(aggregationFilter.orderIds) : null),
    [aggregationFilter],
  );

  const allData = useMemo(() => mergeRows(trades, results), [trades, results]);
  const data = useMemo(
    () => (filteredIds ? allData.filter((r) => filteredIds.has(r.orderId)) : allData),
    [allData, filteredIds],
  );

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
  const [colMenuOpen, setColMenuOpen] = useState(false);

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

        <div className="relative">
          <button
            type="button"
            onClick={() => setColMenuOpen((o) => !o)}
            className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none"
          >
            Columns ▾
          </button>

          {colMenuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-2 z-20 min-w-[180px]">
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
            </div>
          )}
        </div>

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
            {table.getRowModel().rows.map((row, i) => (
              <tr
                key={row.id}
                className={[
                  "border-b border-gray-50 dark:border-gray-800/50 transition-colors",
                  i % 2 === 0
                    ? "bg-white dark:bg-gray-900"
                    : "bg-gray-50/40 dark:bg-gray-800/20",
                  "hover:bg-blue-50/50 dark:hover:bg-blue-900/10",
                ].join(" ")}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-2 whitespace-nowrap">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}

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

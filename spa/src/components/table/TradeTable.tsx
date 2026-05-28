/**
 * Trade detail table — TanStack Table v8.
 *
 * Features:
 *   • Global search on symbol and order ID
 *   • Click-to-sort on every column (null values sort to bottom)
 *   • Column visibility toggle (three reversion columns hidden by default)
 *   • Pagination: 10 / 25 / 50 rows per page
 *   • Color-coded bps cells (green = favorable, red = adverse, gray = N/A)
 */

import { useMemo, useState } from "react";
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

// ── Merged row type ───────────────────────────────────────────────────────────

interface TableRow {
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  orderQty: number;
  avgFillPrice: number;
  orderTime: Date;
  timeToFill_ms: number;
  IS_bps: number | null;
  VWAP_dev_bps: number | null;
  MI_bps: number | null;
  reversion_1m_bps: number | null;
  reversion_5m_bps: number | null;
  reversion_30m_bps: number | null;
  reversion_EOD_bps: number | null;
  TWAS_bps: number | null;
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
      orderTime: t.orderTime,
      timeToFill_ms: r?.timeToFill_ms ?? 0,
      IS_bps: r?.IS_bps ?? null,
      VWAP_dev_bps: r?.VWAP_dev_bps ?? null,
      MI_bps: r?.MI_bps ?? null,
      reversion_1m_bps: r?.reversion_1m_bps ?? null,
      reversion_5m_bps: r?.reversion_5m_bps ?? null,
      reversion_30m_bps: r?.reversion_30m_bps ?? null,
      reversion_EOD_bps: r?.reversion_EOD_bps ?? null,
      TWAS_bps: r?.TWAS_bps ?? null,
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
  orderTime: "Order Time",
  timeToFill_ms: "TTF",
  IS_bps: "IS",
  VWAP_dev_bps: "VWAP Dev",
  MI_bps: "Mkt Impact",
  reversion_1m_bps: "Rev +1m",
  reversion_5m_bps: "Rev +5m",
  reversion_30m_bps: "Rev +30m",
  reversion_EOD_bps: "Rev EOD",
  TWAS_bps: "TWAS",
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

/**
 * Color-coded bps display cell.
 *   default  — positive = red (adverse), negative = green (favorable)
 *   invert   — positive = green (favorable), used for post-trade reversion
 *   neutral  — no sentiment, used for TWAS (spread width)
 */
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
      <span className="text-gray-300 dark:text-gray-600 text-xs select-none">
        N/A
      </span>
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
      {sign}
      {value.toFixed(1)}
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

const col = createColumnHelper<TableRow>();

// Defined outside the component so it's stable across renders.
const COLUMNS = [
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
  col.accessor("orderTime", {
    header: "Order Time",
    cell: (i) => {
      const d = i.getValue();
      return (
        <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {d.toLocaleDateString()} {d.toLocaleTimeString()}
        </span>
      );
    },
    sortingFn: "datetime",
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
    header: "VWAP Dev",
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
  col.accessor("reversion_1m_bps", {
    header: "Rev +1m",
    cell: (i) => <BpsCell value={i.getValue()} invert />,
    sortingFn: nullableSort,
    enableGlobalFilter: false,
  }),
  col.accessor("reversion_5m_bps", {
    header: "Rev +5m",
    cell: (i) => <BpsCell value={i.getValue()} invert />,
    sortingFn: nullableSort,
    enableGlobalFilter: false,
  }),
  col.accessor("reversion_30m_bps", {
    header: "Rev +30m",
    cell: (i) => <BpsCell value={i.getValue()} invert />,
    sortingFn: nullableSort,
    enableGlobalFilter: false,
  }),
  col.accessor("reversion_EOD_bps", {
    header: "Rev EOD",
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
];

// ── Main component ────────────────────────────────────────────────────────────

interface TradeTableProps {
  trades: TradeRecord[];
  results: TCAResult[];
}

const PAGE_SIZES = [10, 25, 50] as const;

// Reversion sub-columns hidden by default to reduce horizontal scroll;
// users can re-enable via the Columns toggle.
const DEFAULT_VISIBILITY: VisibilityState = {
  reversion_5m_bps: false,
  reversion_30m_bps: false,
  reversion_EOD_bps: false,
};

export function TradeTable({ trades, results }: TradeTableProps) {
  const data = useMemo(() => mergeRows(trades, results), [trades, results]);

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

  const table = useReactTable({
    data,
    columns: COLUMNS,
    state: { sorting, globalFilter, columnVisibility, pagination },
    onSortingChange: setSorting,
    onGlobalFilterChange: (v: unknown) => {
      setGlobalFilter(String(v ?? ""));
      // Reset to page 1 on filter change
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

      {/* ── Toolbar ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white shrink-0">
          Trade Detail
        </h3>

        {/* Search */}
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

        {/* Column visibility */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setColMenuOpen((o) => !o)}
            className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none"
          >
            Columns ▾
          </button>

          {colMenuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-2 z-20 min-w-[164px]">
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

        {/* Trade count */}
        <span className="ml-auto text-xs text-gray-400 dark:text-gray-600 whitespace-nowrap">
          {totalFiltered !== data.length
            ? `${totalFiltered.toLocaleString()} of ${data.length.toLocaleString()} trades`
            : `${data.length.toLocaleString()} trade${data.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      {/* ── Table ─────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[860px]">
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
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
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
        {/* Rows per page */}
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
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Page navigation */}
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
          <span className="tabular-nums">
            {pageIndex + 1} / {pageCount}
          </span>
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

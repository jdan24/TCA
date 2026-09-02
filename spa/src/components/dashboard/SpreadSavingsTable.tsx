/**
 * SpreadSavingsTable — how much of the quoted spread each instrument's
 * executions actually kept.
 *
 * Slippage in bps is hard to judge on its own: 2 bps of cost is excellent in a
 * 6 bps market and poor in a 1 bps one. This table divides one by the other, so
 * every instrument is scored against the liquidity it was actually trading in.
 *
 * Grouped by generic ticker — FVU6 and FVZ6 are the same instrument for this
 * purpose, and a multi-month report would otherwise split them into rows too
 * thin to mean anything.
 *
 * See buildSpreadSavings() in tca/aggregate.ts for the arithmetic.
 */

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { BenchmarkKind, SpreadSavingsRow } from "@/types";
import { usePortalMenu } from "@/hooks/usePortalMenu";
import { ChartCard } from "./dashboardUtils";

// ── Columns ───────────────────────────────────────────────────────────────────
//
// Generic Ticker is deliberately absent: it identifies the row, so hiding it
// would leave a table of unattributable numbers. Everything else is optional.

export type SpreadSavingsColumnId =
  | "count"
  | "totalQty"
  | "avgSpread_bps"
  | "wAvgIS_bps"
  | "medianIS_bps"
  | "avgVol_bps"
  | "avgVolRate_bps"
  | "savingsPct";

export const SPREAD_SAVINGS_COLUMNS: ReadonlyArray<{
  id: SpreadSavingsColumnId;
  label: string;
  /** Header tooltip, for the columns whose meaning is not obvious from the label. */
  title?: string;
}> = [
  { id: "count",         label: "Orders"          },
  { id: "totalQty",      label: "Total Qty"       },
  { id: "avgSpread_bps", label: "Avg Spread Cost" },
  {
    id: "wAvgIS_bps",
    label: "Wtd Avg IS",
    title: "Quantity-weighted average slippage vs arrival",
  },
  {
    id: "medianIS_bps",
    label: "Median IS",
    title: "Median per-order slippage, unweighted — a gap against the weighted average means one order is carrying the group",
  },
  {
    id: "avgVol_bps",
    label: "Avg Vol",
    title: "1σ of market price over each order's own window — the drift the orders were exposed to",
  },
  {
    id: "avgVolRate_bps",
    label: "Vol Rate",
    title: "bps per √minute — volatility normalised for order duration, so orders of different lengths compare",
  },
  { id: "savingsPct",    label: "Spread Savings"  },
];

const ALL_COLUMN_IDS: SpreadSavingsColumnId[] = SPREAD_SAVINGS_COLUMNS.map((c) => c.id);

/** How a benchmark names itself in a column header. */
const BENCHMARK_LABEL: Record<BenchmarkKind, string> = {
  arrival: "IS",
  vwap: "VWAP",
  twap: "TWAP",
};

/**
 * The header for a column in a table built for `benchmark`.
 *
 * Both slippage columns hold deviation vs market VWAP or TWAP in those tables,
 * so labelling them "IS" would name the wrong series. The ids keep their IS
 * names because the stored column selection is keyed on them.
 *
 * Exported so the print layout labels its headers identically.
 */
export function spreadSavingsColumnLabel(
  id: SpreadSavingsColumnId,
  label: string,
  benchmark: BenchmarkKind,
): string {
  if (benchmark === "arrival") return label;
  const b = BENCHMARK_LABEL[benchmark];
  switch (id) {
    case "wAvgIS_bps":   return `Wtd Avg vs ${b}`;
    case "medianIS_bps": return `Median vs ${b}`;
    default:             return label;
  }
}

/** Tooltip for the two slippage columns, naming the series in play. */
export function spreadSavingsColumnTitle(
  id: SpreadSavingsColumnId,
  title: string | undefined,
  benchmark: BenchmarkKind,
): string | undefined {
  if (benchmark === "arrival") return title;
  const b = BENCHMARK_LABEL[benchmark];
  switch (id) {
    case "wAvgIS_bps":
      return `Quantity-weighted average deviation vs market ${b}`;
    case "medianIS_bps":
      return `Median per-order deviation vs market ${b}, unweighted — a gap against the weighted average means one order is carrying the group`;
    default:
      return title;
  }
}

// ── Visibility persistence ────────────────────────────────────────────────────

// What is stored is the set of *hidden* columns, not the visible ones.
//
// Storing visible ids means a saved preference can never contain a column added
// later, so a new column is silently invisible for exactly the people who
// customised the table — the worst possible audience to hide it from. Recording
// hides instead makes anything unnamed visible, so this addition and every
// future one default to on.
//
// The previous "_v1" key held visible ids and is deliberately not migrated: it
// cannot be told apart from a deliberate hide-everything. A customised table
// comes back once with all columns showing.
const HIDDEN_COLS_KEY = "tca_spread_savings_hidden_v1";

/** Visible columns, in canonical order. Anything not recorded as hidden shows. */
export function loadSpreadSavingsCols(): SpreadSavingsColumnId[] {
  try {
    const raw = localStorage.getItem(HIDDEN_COLS_KEY);
    if (raw === null) return [...ALL_COLUMN_IDS];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...ALL_COLUMN_IDS];
    const hidden = new Set(parsed as string[]);
    return ALL_COLUMN_IDS.filter((id) => !hidden.has(id));
  } catch {
    return [...ALL_COLUMN_IDS];
  }
}

export function saveSpreadSavingsCols(ids: SpreadSavingsColumnId[]): void {
  try {
    const visible = new Set(ids);
    const hidden = ALL_COLUMN_IDS.filter((id) => !visible.has(id));
    localStorage.setItem(HIDDEN_COLS_KEY, JSON.stringify(hidden));
  } catch {
    // localStorage unavailable (private browsing) — the setting just won't persist
  }
}

interface SpreadSavingsTableProps {
  rows: SpreadSavingsRow[];
  /** Ids of the optional columns to show, in canonical order. */
  visibleColumns: SpreadSavingsColumnId[];
  onVisibleColumnsChange: (ids: SpreadSavingsColumnId[]) => void;
  title?: string;
  /** Which slippage series was scored against the spread. */
  benchmark?: BenchmarkKind;
  /** Controls rendered left of the Columns menu, e.g. the algo filter. */
  actions?: ReactNode;
}

export function SpreadSavingsTable({
  rows,
  visibleColumns,
  onVisibleColumnsChange,
  title = "Spread Savings by Instrument",
  benchmark = "arrival",
  actions,
}: SpreadSavingsTableProps) {
  const { open, btnRef, menuRef, pos, toggle } = usePortalMenu("right");

  // Render in canonical order regardless of the order ids were toggled in.
  const cols = SPREAD_SAVINGS_COLUMNS.filter((c) => visibleColumns.includes(c.id));

  function toggleColumn(id: SpreadSavingsColumnId) {
    const next = visibleColumns.includes(id)
      ? visibleColumns.filter((x) => x !== id)
      : [...visibleColumns, id];
    onVisibleColumnsChange(ALL_COLUMN_IDS.filter((x) => next.includes(x)));
  }

  const columnsMenu = (
    <div className="print:hidden">
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className="px-2.5 py-1 text-[11px] rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none"
      >
        Columns ▾
      </button>
      {open && pos !== null && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", top: pos.top, right: pos.right }}
          className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-2 z-50 min-w-[180px] max-h-[70vh] overflow-y-auto"
        >
          {SPREAD_SAVINGS_COLUMNS.map((c) => (
            <label
              key={c.id}
              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer text-xs text-gray-700 dark:text-gray-300 select-none"
            >
              <input
                type="checkbox"
                checked={visibleColumns.includes(c.id)}
                onChange={() => toggleColumn(c.id)}
                className="rounded accent-blue-500"
              />
              {c.label}
            </label>
          ))}
          <hr className="my-1 border-gray-100 dark:border-gray-800" />
          <p className="px-2 pb-0.5 text-[10px] text-gray-400 dark:text-gray-600">
            Also applies to the print layout
          </p>
        </div>,
        document.body,
      )}
    </div>
  );

  const headerActions = (
    <div className="flex items-center gap-2">
      {actions}
      {columnsMenu}
    </div>
  );

  if (rows.length === 0) {
    return (
      <ChartCard title={title} actions={headerActions}>
        <p className="py-8 text-center text-xs text-gray-400 dark:text-gray-600 italic">
          No data
        </p>
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title={title}
      subtitle={
        benchmark === "arrival"
          ? "Execution quality measured against the spread that was quoted at the time"
          : `Deviation vs market ${BENCHMARK_LABEL[benchmark]} measured against the spread that was quoted at the time`
      }
      actions={headerActions}
    >
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-xs min-w-[560px]">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800">
              <th className="pb-2 pr-3 text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide whitespace-nowrap">
                Generic Ticker
              </th>
              {cols.map((c) => {
                const title = spreadSavingsColumnTitle(c.id, c.title, benchmark);
                return (
                  <th
                    key={c.id}
                    {...(title !== undefined ? { title } : {})}
                    className={`pb-2 pr-3 text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide whitespace-nowrap${
                      title !== undefined ? " cursor-help" : ""
                    }`}
                  >
                    {spreadSavingsColumnLabel(c.id, c.label, benchmark)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.groupKey}
                className="border-b border-gray-50 dark:border-gray-800/50"
              >
                <td className="py-2 pr-3 font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap">
                  {row.groupKey}
                </td>
                {cols.map((c) => (
                  <td key={c.id} className="py-2 pr-3">
                    {renderCell(row, c.id)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {visibleColumns.includes("savingsPct") && <Legend benchmark={benchmark} />}
    </ChartCard>
  );
}

/**
 * One cell's contents. Shared with the print layout so a column can never
 * render differently in the two places.
 *
 * Spread width is an environment reading rather than a good/bad score, so it is
 * shown neutrally; IS follows the usual negative-is-favourable colouring.
 */
export function renderCell(row: SpreadSavingsRow, id: SpreadSavingsColumnId) {
  switch (id) {
    case "count":
      return <span className="tabular-nums text-gray-600 dark:text-gray-400">{row.count}</span>;
    case "totalQty":
      return (
        <span className="tabular-nums text-gray-600 dark:text-gray-400">
          {row.totalQty.toLocaleString()}
        </span>
      );
    case "avgSpread_bps":
      return <BpsCell value={row.avgSpread_bps} neutral />;
    case "wAvgIS_bps":
      return <BpsCell value={row.wAvgIS_bps} />;
    case "medianIS_bps":
      return <BpsCell value={row.medianIS_bps} />;
    // Volatility describes the environment rather than scoring it, so both vol
    // columns stay neutral instead of taking the good/bad colouring.
    case "avgVol_bps":
      return <BpsCell value={row.avgVol_bps} neutral />;
    case "avgVolRate_bps":
      return <BpsCell value={row.avgVolRate_bps} neutral />;
    case "savingsPct":
      return <SavingsCell value={row.savingsPct} />;
  }
}

// ── Legend ────────────────────────────────────────────────────────────────────

export function Legend({ benchmark = "arrival" }: { benchmark?: BenchmarkKind }) {
  // The arithmetic is identical in all three tables — only what the slippage
  // term measures changes, so the same scale reads differently. 50% is always
  // "matched the benchmark exactly"; for arrival that is a fill at mid.
  const b = BENCHMARK_LABEL[benchmark];
  const items: Array<{ mark: string; text: string }> =
    benchmark === "arrival"
      ? [
          { mark: "100%",     text: "filled at or better than the near touch" },
          { mark: "50%",      text: "filled at mid" },
          { mark: "0%",       text: "paid the full spread" },
          { mark: "below 0%", text: "worse than crossing the spread" },
        ]
      : [
          { mark: "100%",     text: `beat market ${b} by at least half the spread` },
          { mark: "50%",      text: `matched market ${b}` },
          { mark: "0%",       text: `lagged market ${b} by half the spread` },
          { mark: "below 0%", text: "lagged by more than half the spread" },
        ];
  return (
    <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-gray-800 flex flex-wrap gap-x-4 gap-y-1">
      {items.map(({ mark, text }) => (
        <span key={mark} className="text-[10px] text-gray-400 dark:text-gray-500">
          <span className="font-semibold text-gray-500 dark:text-gray-400 tabular-nums">
            {mark}
          </span>{" "}
          {text}
        </span>
      ))}
    </div>
  );
}

// ── Cells ─────────────────────────────────────────────────────────────────────

/** Same conventions as the BpsCell in AggregateTable: negative is favourable. */
function BpsCell({ value, neutral = false }: { value: number | null; neutral?: boolean }) {
  if (value === null) {
    return <span className="text-gray-300 dark:text-gray-600 select-none">N/A</span>;
  }
  const cls = neutral
    ? "text-gray-600 dark:text-gray-400"
    : value <= 0
      ? "text-green-600 dark:text-green-400"
      : "text-red-500 dark:text-red-400";
  const sign = value > 0 ? "+" : "";
  return (
    <span className={`tabular-nums font-medium ${cls}`}>
      {sign}{value.toFixed(1)}
    </span>
  );
}

/**
 * Savings runs the opposite way to the bps columns — more is better — so the
 * colours are keyed to the legend's landmarks rather than to the sign:
 * at-or-better than mid is green, paying more than the full spread is red.
 */
function SavingsCell({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-gray-300 dark:text-gray-600 select-none">N/A</span>;
  }
  const cls =
    value >= 0.5
      ? "text-green-600 dark:text-green-400"
      : value < 0
        ? "text-red-500 dark:text-red-400"
        : "text-amber-600 dark:text-amber-400";
  return (
    <span className={`tabular-nums font-semibold ${cls}`}>
      {(value * 100).toFixed(1)}%
    </span>
  );
}

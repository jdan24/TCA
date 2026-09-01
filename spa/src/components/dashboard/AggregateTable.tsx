/**
 * AggregateTable — one reusable stats table rendered for each grouping
 * (By Symbol, By Algo, By Symbol+Algo, By Symbol+Side, By Symbol+Algo+Side).
 *
 * Clicking a row filters the TradeTable to matching orders.
 * Clicking the same row again deselects it (toggle).
 *
 * Columns are selectable per table: each instance carries its own stored
 * preference, keyed by grouping, so By Algo can show a different set from By
 * Symbol. The column registry and cell renderer below are exported and reused
 * by MultiOrderPrintLayout, so the print view can never render a column
 * differently from the screen.
 */

import { createPortal } from "react-dom";
import type { AggregateRow, AggGroupType } from "@/types";
import { usePortalMenu } from "@/hooks/usePortalMenu";
import {
  ChartCard,
  fmtBps,
  fmtSigma,
  fmtTtf,
  FxNote,
  sigmaBandClass,
  SIGMA_TOOLTIP,
  UnconvertedMark,
} from "./dashboardUtils";
import { useCashDisplay } from "@/hooks/useCashDisplay";

// ── Columns ───────────────────────────────────────────────────────────────────
//
// "Group" is deliberately absent: it identifies the row, and hiding it would
// leave a table of unattributable numbers. Everything else is optional.
//
// Names match the Order Detail table so one metric reads the same everywhere.

export type AggregateColumnId =
  | "count"
  | "totalQty"
  | "avgIS_bps"
  | "avgVolAdjIS"
  | "avgVWAP_dev_bps"
  | "totalVWAP_dev_usd"
  | "avgTWAP_dev_bps"
  | "totalTWAP_dev_usd"
  | "avgMI_bps"
  | "avgTWAS_bps"
  | "avgTTF_ms"
  | "winRate"
  | "bestIS_bps"
  | "worstIS_bps";

export const AGGREGATE_COLUMNS: ReadonlyArray<{
  id: AggregateColumnId;
  label: string;
  /** Header tooltip, for columns whose meaning is not obvious from the label. */
  title?: string;
}> = [
  { id: "count",             label: "Orders"          },
  { id: "totalQty",          label: "Total Qty"       },
  { id: "avgIS_bps",         label: "Avg IS"          },
  { id: "avgVolAdjIS",       label: "Vol-Adj IS",       title: SIGMA_TOOLTIP },
  { id: "avgVWAP_dev_bps",   label: "vs Mkt VWAP"     },
  {
    id: "totalVWAP_dev_usd",
    label: "vs Mkt VWAP ($)",
    title: "Group total, not a per-order average. N/A when the group spans more than one currency — there is no FX conversion in this app.",
  },
  { id: "avgTWAP_dev_bps",   label: "vs Mkt TWAP"     },
  {
    id: "totalTWAP_dev_usd",
    label: "vs Mkt TWAP ($)",
    title: "Group total, not a per-order average. N/A when the group spans more than one currency — there is no FX conversion in this app.",
  },
  { id: "avgMI_bps",         label: "Avg MI"          },
  { id: "avgTWAS_bps",       label: "Avg TWAS"        },
  { id: "avgTTF_ms",         label: "Avg TTF"         },
  { id: "winRate",           label: "Win %"           },
  { id: "bestIS_bps",        label: "Best IS"         },
  { id: "worstIS_bps",       label: "Worst IS"        },
];

const ALL_COLUMN_IDS: AggregateColumnId[] = AGGREGATE_COLUMNS.map((c) => c.id);

// ── Visibility persistence, one entry per grouping ────────────────────────────
//
// Stores the *hidden* ids rather than the visible ones, so a column added later
// defaults to visible instead of vanishing for whoever customised the table.
// Same reasoning as the Spread Savings table.

const HIDDEN_KEY_PREFIX = "tca_agg_hidden_v1:";

export function loadAggregateCols(type: AggGroupType): AggregateColumnId[] {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY_PREFIX + type);
    if (raw === null) return [...ALL_COLUMN_IDS];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...ALL_COLUMN_IDS];
    const hidden = new Set(parsed as string[]);
    return ALL_COLUMN_IDS.filter((id) => !hidden.has(id));
  } catch {
    return [...ALL_COLUMN_IDS];
  }
}

export function saveAggregateCols(type: AggGroupType, ids: AggregateColumnId[]): void {
  try {
    const visible = new Set(ids);
    const hidden = ALL_COLUMN_IDS.filter((id) => !visible.has(id));
    localStorage.setItem(HIDDEN_KEY_PREFIX + type, JSON.stringify(hidden));
  } catch {
    // localStorage unavailable (private browsing) — the setting just won't persist
  }
}

// ── Cell rendering ────────────────────────────────────────────────────────────

/**
 * One cell's contents. Shared with the print layout so a column can never
 * render differently in the two places.
 */
export function renderAggregateCell(row: AggregateRow, id: AggregateColumnId) {
  switch (id) {
    case "count":
      return <span className="tabular-nums text-gray-600 dark:text-gray-400">{row.count}</span>;
    case "totalQty":
      return (
        <span className="tabular-nums text-gray-600 dark:text-gray-400">
          {row.totalQty.toLocaleString()}
        </span>
      );
    case "avgIS_bps":
      return <BpsCell value={row.avgIS_bps} />;
    case "avgVolAdjIS":
      return (
        <span
          className={`tabular-nums font-medium ${sigmaBandClass(row.avgVolAdjIS)}`}
          title={SIGMA_TOOLTIP}
        >
          {fmtSigma(row.avgVolAdjIS)}
        </span>
      );
    case "avgVWAP_dev_bps":
      return <BpsCell value={row.avgVWAP_dev_bps} />;
    case "totalVWAP_dev_usd":
      return <UsdCell value={row.totalVWAP_dev_usd} currency={row.currency} />;
    case "avgTWAP_dev_bps":
      return <BpsCell value={row.avgTWAP_dev_bps} />;
    case "totalTWAP_dev_usd":
      return <UsdCell value={row.totalTWAP_dev_usd} currency={row.currency} />;
    case "avgMI_bps":
      return <BpsCell value={row.avgMI_bps} />;
    case "avgTWAS_bps":
      return <BpsCell value={row.avgTWAS_bps} neutral />;
    case "avgTTF_ms":
      return (
        <span className="tabular-nums text-gray-600 dark:text-gray-400 whitespace-nowrap">
          {fmtTtf(Math.round(row.avgTTF_ms))}
        </span>
      );
    case "winRate":
      return (
        <span className="tabular-nums text-gray-600 dark:text-gray-400">
          {row.winRate !== null ? `${Math.round(row.winRate * 100)}%` : "N/A"}
        </span>
      );
    case "bestIS_bps":
      return row.bestIS_bps !== null ? (
        <span className="text-green-600 dark:text-green-400 tabular-nums font-medium">
          {fmtBps(row.bestIS_bps)}
        </span>
      ) : (
        <NaCell />
      );
    case "worstIS_bps":
      return row.worstIS_bps !== null ? (
        <span className="text-red-500 dark:text-red-400 tabular-nums font-medium">
          {fmtBps(row.worstIS_bps)}
        </span>
      ) : (
        <NaCell />
      );
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface AggregateTableProps {
  title: string;
  rows: AggregateRow[];
  /** groupKey of the currently selected row, or null */
  activeKey: string | null;
  onRowClick: (row: AggregateRow) => void;
  /** Visible optional columns, in canonical order. */
  visibleColumns: AggregateColumnId[];
  onVisibleColumnsChange: (ids: AggregateColumnId[]) => void;
}

export function AggregateTable({
  title,
  rows,
  activeKey,
  onRowClick,
  visibleColumns,
  onVisibleColumnsChange,
}: AggregateTableProps) {
  const { open, btnRef, menuRef, pos, toggle } = usePortalMenu("right");
  const cash = useCashDisplay();

  // Render in canonical order regardless of the order ids were toggled in.
  const cols = AGGREGATE_COLUMNS.filter((c) => visibleColumns.includes(c.id));

  function toggleColumn(id: AggregateColumnId) {
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
          {AGGREGATE_COLUMNS.map((c) => (
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
            This table only · also applies to the print layout
          </p>
        </div>,
        document.body,
      )}
    </div>
  );

  if (rows.length === 0) {
    return (
      <ChartCard title={title} actions={columnsMenu}>
        <p className="py-8 text-center text-xs text-gray-400 dark:text-gray-600 italic">
          No data
        </p>
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title={title}
      subtitle="Click a row to filter the trade detail table"
      actions={columnsMenu}
    >
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-xs min-w-[640px]">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800">
              <th className="pb-2 pr-3 text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide whitespace-nowrap">
                Group
              </th>
              {cols.map((c) => (
                <th
                  key={c.id}
                  {...(c.title !== undefined ? { title: c.title } : {})}
                  className={`pb-2 pr-3 text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide whitespace-nowrap${
                    c.title !== undefined ? " cursor-help" : ""
                  }`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isActive = activeKey === row.groupKey;
              return (
                <tr
                  key={row.groupKey}
                  onClick={() => onRowClick(row)}
                  className={[
                    "cursor-pointer transition-colors border-b border-gray-50 dark:border-gray-800/50",
                    isActive
                      ? "bg-blue-50 dark:bg-blue-900/20 border-l-2 border-l-blue-500"
                      : "hover:bg-gray-50 dark:hover:bg-gray-800/40",
                  ].join(" ")}
                >
                  <td className="py-2 pr-3 font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap">
                    {row.groupKey}
                  </td>
                  {cols.map((c) => (
                    <td key={c.id} className="py-2 pr-3">
                      {renderAggregateCell(row, c.id)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <FxNote text={cash.disclosureFor(rows.map((r) => r.currency ?? "USD"))} />
    </ChartCard>
  );
}

// ── Cells ─────────────────────────────────────────────────────────────────────

function NaCell() {
  return <span className="text-gray-300 dark:text-gray-600 select-none">N/A</span>;
}

function BpsCell({ value, neutral = false }: { value: number | null; neutral?: boolean }) {
  if (value === null) return <NaCell />;
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
 * Group total in cash. null means either no data or a group that cannot be
 * totalled — mixed currencies in native mode, or an unconvertible member in USD
 * mode. Formats through useCashDisplay so the global toggle reaches it.
 */
function UsdCell({ value, currency }: { value: number | null; currency: string | null }) {
  const cash = useCashDisplay();
  if (value === null) return <NaCell />;
  const ccy = currency ?? "USD";
  const cls = value <= 0
    ? "text-green-600 dark:text-green-400"
    : "text-red-500 dark:text-red-400";
  return (
    <span className={`tabular-nums font-medium whitespace-nowrap ${cls}`}>
      {cash.formatCash(value, ccy)}
      {cash.isUnconverted(value, ccy) && <UnconvertedMark />}
    </span>
  );
}

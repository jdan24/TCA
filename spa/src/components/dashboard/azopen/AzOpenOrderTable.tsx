/**
 * AzOpenOrderTable — one row per order, scored against the six cash-open
 * benchmarks.
 *
 * Columns are selectable and the selection drives CSV and the print layout. The
 * column registry and cell renderer are exported so the print view renders from
 * the same definitions and cannot drift. Storage records *hidden* ids, so a
 * column added later defaults to visible for whoever customised the table.
 */

import { createPortal } from "react-dom";
import type { OpenBenchmarkId, OpenResult, OpenSlip, TradeRecord } from "@/types";
import { OPEN_BENCHMARKS } from "@/tca/azOpen";
import { nyTimeOf } from "@/tca/nyTime";
import { usePortalMenu } from "@/hooks/usePortalMenu";
import { useCashDisplay } from "@/hooks/useCashDisplay";
import {
  ChartCard,
  EmptyState,
  fmtBps,
  FxNote,
  slipToneClass,
  UnconvertedMark,
} from "@/components/dashboard/dashboardUtils";
import { priceDecimalText, priceText } from "@/components/dashboard/settle/SettleOrderTable";

// ── Row shape ─────────────────────────────────────────────────────────────────

export interface OpenTableRow {
  orderId: string;
  symbol: string;
  bbgSymbol: string;
  side: "BUY" | "SELL";
  orderQty: number;
  avgFillPrice: number;
  orderTime: Date;
  algo: string | null;
  result: OpenResult;
}

export function buildOpenRows(
  trades: TradeRecord[],
  results: OpenResult[],
  resolveSymbol: (ric: string) => string,
): OpenTableRow[] {
  const byId = new Map(results.map((r) => [r.orderId, r]));
  const rows: OpenTableRow[] = [];
  for (const t of trades) {
    const result = byId.get(t.orderId);
    if (!result) continue;
    rows.push({
      orderId: t.orderId,
      symbol: t.symbol,
      bbgSymbol: resolveSymbol(t.symbol),
      side: t.side,
      orderQty: t.orderQty,
      avgFillPrice: t.avgFillPrice,
      orderTime: t.orderTime,
      algo: t.algo,
      result,
    });
  }
  return rows.sort((a, b) => b.orderTime.getTime() - a.orderTime.getTime());
}

// ── Columns ───────────────────────────────────────────────────────────────────
//
// Symbol is pinned: it identifies the row. Each benchmark contributes a price,
// a bps and a cash column; the price columns start hidden.

type Unit = "px" | "bps" | "usd";

export type OpenColumnId =
  | "nyDate"
  | "algo"
  | "side"
  | "orderQty"
  | "orderTime"
  | "avgFillPrice"
  | "avgFillPriceDec"
  | `${OpenBenchmarkId}_${Unit}`
  | "orderId";

interface OpenColumn {
  id: OpenColumnId;
  label: string;
  title?: string;
  /** Set on benchmark columns. */
  bench?: { id: OpenBenchmarkId; unit: Unit };
}

const UNIT_LABEL: Record<Unit, string> = { px: "px", bps: "bps", usd: "$" };

export const AZ_OPEN_COLUMNS: ReadonlyArray<OpenColumn> = [
  { id: "nyDate",       label: "Date", title: "NY date of the first fill — the open the order is scored against" },
  { id: "algo",         label: "Algo", title: "Algo policy as it appeared in the imported file" },
  { id: "side",         label: "Side" },
  { id: "orderQty",     label: "Qty" },
  { id: "orderTime",    label: "Created (NY)", title: "Order creation time, New York — the arrival instant" },
  { id: "avgFillPrice", label: "Fill Price", title: "In the contract's own notation — 32nds for Treasuries" },
  { id: "avgFillPriceDec", label: "Fill Price (dec)", title: "The average fill price exactly as imported, unrounded" },
  ...OPEN_BENCHMARKS.flatMap((b) =>
    (["px", "bps", "usd"] as const).map((unit): OpenColumn => ({
      id: `${b.id}_${unit}`,
      label: `${b.label} (${UNIT_LABEL[unit]})`,
      title:
        unit === "px"
          ? `${b.title}. Benchmark price.`
          : `Slippage vs ${b.title}. Positive is a cost.`,
      bench: { id: b.id, unit },
    })),
  ),
  { id: "orderId",      label: "Order ID" },
];

const ALL_COLUMN_IDS: OpenColumnId[] = AZ_OPEN_COLUMNS.map((c) => c.id);

/** Hidden until the user asks: the raw benchmark prices and the decimal fill. */
const DEFAULT_HIDDEN: OpenColumnId[] = [
  "avgFillPriceDec",
  ...AZ_OPEN_COLUMNS.filter((c) => c.bench?.unit === "px").map((c) => c.id),
];

const HIDDEN_KEY = "tca_azopen_cols_hidden_v1";

export function loadOpenCols(): OpenColumnId[] {
  const defaults = ALL_COLUMN_IDS.filter((id) => !DEFAULT_HIDDEN.includes(id));
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    if (raw === null) return defaults;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaults;
    const hidden = new Set(parsed as string[]);
    return ALL_COLUMN_IDS.filter((id) => !hidden.has(id));
  } catch {
    return defaults;
  }
}

export function saveOpenCols(ids: OpenColumnId[]): void {
  try {
    const visible = new Set(ids);
    localStorage.setItem(
      HIDDEN_KEY,
      JSON.stringify(ALL_COLUMN_IDS.filter((id) => !visible.has(id))),
    );
  } catch {
    // localStorage unavailable (private browsing) — the setting just won't persist
  }
}

// ── Cells ─────────────────────────────────────────────────────────────────────

function NaCell() {
  return <span className="text-gray-300 dark:text-gray-600 select-none">N/A</span>;
}

function FailedCell() {
  return (
    <span
      className="whitespace-nowrap text-amber-600 dark:text-amber-400"
      title="The benchmark request failed twice — it timed out or the bridge errored. This is not Bloomberg reporting no data. Re-fetch to try again."
    >
      &#9888; failed
    </span>
  );
}

function SlipUsdCell({ slip, currency }: { slip: OpenSlip; currency: string }) {
  const cash = useCashDisplay();
  const v = slip.usd;
  if (v === null) return slip.failed ? <FailedCell /> : <NaCell />;
  return (
    <span className={`tabular-nums font-medium whitespace-nowrap ${slipToneClass(v)}`}>
      {cash.formatCash(v, currency)}
      {cash.isUnconverted(v, currency) && <UnconvertedMark />}
    </span>
  );
}

function renderBenchCell(row: OpenTableRow, bench: OpenBenchmarkId, unit: Unit) {
  const slip = row.result.bench[bench];
  switch (unit) {
    case "px":
      if (slip.price === null) return slip.failed ? <FailedCell /> : <NaCell />;
      return (
        <span className="tabular-nums font-mono text-gray-700 dark:text-gray-300">
          {priceText(slip.price, row.bbgSymbol)}
        </span>
      );
    case "bps":
      if (slip.bps === null) return slip.failed ? <FailedCell /> : <NaCell />;
      return (
        <span className={`tabular-nums font-medium ${slipToneClass(slip.bps)}`}>
          {fmtBps(slip.bps)}
        </span>
      );
    case "usd":
      return <SlipUsdCell slip={slip} currency={row.result.currency} />;
  }
}

/** Shared with the print layout so a column renders identically in both. */
export function renderOpenCell(row: OpenTableRow, col: OpenColumn) {
  if (col.bench) return renderBenchCell(row, col.bench.id, col.bench.unit);
  switch (col.id) {
    case "nyDate":
      return <span className="tabular-nums text-gray-600 dark:text-gray-400">{row.result.nyDate}</span>;
    case "algo":
      return row.algo === null || row.algo.trim() === "" ? (
        <span className="text-gray-300 dark:text-gray-600 select-none">&mdash;</span>
      ) : (
        <span className="text-gray-700 dark:text-gray-300 whitespace-nowrap">{row.algo}</span>
      );
    case "side":
      return (
        <span
          className={`font-semibold ${
            row.side === "BUY" ? "text-blue-600 dark:text-blue-400" : "text-red-500 dark:text-red-400"
          }`}
        >
          {row.side}
        </span>
      );
    case "orderQty":
      return (
        <span className="tabular-nums text-gray-600 dark:text-gray-400">
          {row.orderQty.toLocaleString()}
        </span>
      );
    case "orderTime":
      return isNaN(row.orderTime.getTime()) ? (
        <NaCell />
      ) : (
        <span className="tabular-nums font-mono text-[11px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {nyTimeOf(row.orderTime)}
        </span>
      );
    case "avgFillPrice":
      return (
        <span className="tabular-nums font-mono text-gray-700 dark:text-gray-300">
          {priceText(row.avgFillPrice, row.bbgSymbol)}
        </span>
      );
    case "avgFillPriceDec":
      return (
        <span className="tabular-nums font-mono text-gray-700 dark:text-gray-300">
          {priceDecimalText(row.avgFillPrice)}
        </span>
      );
    case "orderId":
      return (
        <span className="font-mono text-[11px] text-gray-400 dark:text-gray-500">{row.orderId}</span>
      );
    default:
      return null;
  }
}

/** CSV value for a column — plain text, no markup. */
export function openCellText(row: OpenTableRow, col: OpenColumn): string | number | null {
  if (col.bench) {
    const slip = row.result.bench[col.bench.id];
    const v = col.bench.unit === "px" ? slip.price : col.bench.unit === "bps" ? slip.bps : slip.usd;
    return v === null && slip.failed ? "FETCH FAILED" : v;
  }
  switch (col.id) {
    case "nyDate":          return row.result.nyDate;
    case "algo":            return row.algo;
    case "side":            return row.side;
    case "orderQty":        return row.orderQty;
    case "orderTime":       return isNaN(row.orderTime.getTime()) ? null : nyTimeOf(row.orderTime);
    case "avgFillPrice":    return row.avgFillPrice;
    case "avgFillPriceDec": return row.avgFillPrice;
    case "orderId":         return row.orderId;
    default:                return null;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface AzOpenOrderTableProps {
  rows: OpenTableRow[];
  visibleColumns: OpenColumnId[];
  onVisibleColumnsChange: (ids: OpenColumnId[]) => void;
  onExportCsv: () => void;
}

export function AzOpenOrderTable({
  rows,
  visibleColumns,
  onVisibleColumnsChange,
  onExportCsv,
}: AzOpenOrderTableProps) {
  const { open, btnRef, menuRef, pos, toggle } = usePortalMenu("right");
  const cash = useCashDisplay();
  const cols = AZ_OPEN_COLUMNS.filter((c) => visibleColumns.includes(c.id));

  function toggleColumn(id: OpenColumnId) {
    const next = visibleColumns.includes(id)
      ? visibleColumns.filter((x) => x !== id)
      : [...visibleColumns, id];
    onVisibleColumnsChange(ALL_COLUMN_IDS.filter((x) => next.includes(x)));
  }

  const actions = (
    <div className="flex items-center gap-2 print:hidden">
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className="px-2.5 py-1 text-[11px] rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none"
      >
        Columns &#9662;
      </button>
      <button
        type="button"
        onClick={onExportCsv}
        className="px-2.5 py-1 text-[11px] rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none"
      >
        Export CSV
      </button>
      {open && pos !== null && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", top: pos.top, right: pos.right }}
          className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-2 z-50 min-w-[200px] max-h-[70vh] overflow-y-auto"
        >
          {AZ_OPEN_COLUMNS.map((c) => (
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
            Also applies to CSV and print
          </p>
        </div>,
        document.body,
      )}
    </div>
  );

  if (rows.length === 0) {
    return (
      <ChartCard title="Order Detail" actions={actions}>
        <EmptyState message="No orders to show" />
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title="Order Detail"
      subtitle="Slippage of each order's average fill against the 09:30 open and arrival benchmarks"
      actions={actions}
    >
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-xs min-w-[720px]">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800">
              <th className="pb-2 pr-3 text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide whitespace-nowrap">
                Symbol
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
            {rows.map((row) => (
              <tr key={row.orderId} className="border-b border-gray-50 dark:border-gray-800/50">
                <td className="py-2 pr-3 font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                  {row.bbgSymbol}
                  {row.result.quotesEstimated && (
                    <span
                      className="ml-1 text-amber-600 dark:text-amber-400"
                      title="No real Bloomberg quotes for at least one quote benchmark — its bid/ask was estimated from 1-minute bar ranges"
                    >
                      &#9888;
                    </span>
                  )}
                </td>
                {cols.map((c) => (
                  <td key={c.id} className="py-2 pr-3">
                    {renderOpenCell(row, c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <FxNote text={cash.disclosureFor(rows.map((r) => r.result.currency))} />
    </ChartCard>
  );
}

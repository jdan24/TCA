/**
 * SettleOrderTable — one row per order, with its window, benchmark and slippage.
 *
 * Columns are selectable and the selection drives the print layout, matching the
 * other tables. The column registry and cell renderer are exported so the print
 * view renders from the same definitions and cannot drift.
 *
 * Storage records *hidden* ids rather than visible ones, so a column added later
 * defaults to visible instead of disappearing for whoever customised the table.
 */

import { createPortal } from "react-dom";
import type { SettleResult, TradeRecord } from "@/types";
import { settleWindowLabel } from "@/tca/settle";
import { getTreasuryPrecision, decToTreasuryFrac } from "@/tca/treasuryFrac";
import { usePortalMenu } from "@/hooks/usePortalMenu";
import {
  ChartCard,
  EmptyState,
  fmtBps,
  fmtUsd,
  slipToneClass,
} from "@/components/dashboard/dashboardUtils";

// ── Row shape ─────────────────────────────────────────────────────────────────

export interface SettleTableRow {
  orderId: string;
  symbol: string;
  bbgSymbol: string;
  side: "BUY" | "SELL";
  orderQty: number;
  avgFillPrice: number;
  lastFillTime: Date;
  /** Algo policy from the file; null when the column was not mapped. */
  algo: string | null;
  result: SettleResult;
}

export function buildSettleRows(
  trades: TradeRecord[],
  results: SettleResult[],
  resolveSymbol: (ric: string) => string,
): SettleTableRow[] {
  const byId = new Map(results.map((r) => [r.orderId, r]));
  const rows: SettleTableRow[] = [];
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
      lastFillTime: t.lastFillTime,
      algo: t.algo,
      result,
    });
  }
  return rows.sort((a, b) => b.lastFillTime.getTime() - a.lastFillTime.getTime());
}

// ── Columns ───────────────────────────────────────────────────────────────────
//
// Symbol is pinned: it identifies the row.

export type SettleColumnId =
  | "window"
  | "nyDate"
  | "algo"
  | "side"
  | "orderQty"
  | "avgFillPrice"
  | "avgFillPriceDec"
  | "benchmark"
  | "source"
  | "slip_bps"
  | "slip_price"
  | "slip_usd"
  | "lastFillTime"
  | "orderId";

export const SETTLE_COLUMNS: ReadonlyArray<{
  id: SettleColumnId;
  label: string;
  title?: string;
}> = [
  { id: "window",       label: "Window" },
  { id: "nyDate",       label: "Settle Date", title: "NY calendar date of the last fill — the date the benchmark is taken from" },
  { id: "algo",         label: "Algo", title: "Algo policy as it appeared in the imported file" },
  { id: "side",         label: "Side" },
  { id: "orderQty",     label: "Qty" },
  { id: "avgFillPrice", label: "Fill Price", title: "In the contract's own notation — 32nds for Treasuries, which rounds to the nearest tick" },
  { id: "avgFillPriceDec", label: "Fill Price (dec)", title: "The average fill price exactly as imported, in decimal, unrounded" },
  { id: "benchmark",    label: "Benchmark" },
  { id: "source",       label: "Source", title: "Official settle, or the last print before 16:00:00 NY" },
  { id: "slip_bps",     label: "Slip (bps)", title: "Slippage vs the settle benchmark. Positive is a cost." },
  { id: "slip_price",   label: "Slip (px)" },
  { id: "slip_usd",     label: "Slip ($)" },
  { id: "lastFillTime", label: "Last Fill (UTC)" },
  { id: "orderId",      label: "Order ID" },
];

const ALL_COLUMN_IDS: SettleColumnId[] = SETTLE_COLUMNS.map((c) => c.id);

const HIDDEN_KEY = "tca_settle_cols_hidden_v1";

export function loadSettleCols(): SettleColumnId[] {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    if (raw === null) return [...ALL_COLUMN_IDS];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...ALL_COLUMN_IDS];
    const hidden = new Set(parsed as string[]);
    return ALL_COLUMN_IDS.filter((id) => !hidden.has(id));
  } catch {
    return [...ALL_COLUMN_IDS];
  }
}

export function saveSettleCols(ids: SettleColumnId[]): void {
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

function SignedBps({ v }: { v: number | null }) {
  if (v === null) return <NaCell />;
  return (
    <span className={`tabular-nums font-medium ${slipToneClass(v)}`}>{fmtBps(v)}</span>
  );
}

/** Price in the contract's own notation — 32nds for Treasuries, decimal otherwise. */
function priceText(value: number, bbgSymbol: string): string {
  const precision = getTreasuryPrecision(bbgSymbol);
  return precision
    ? decToTreasuryFrac(value, precision)
    : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

/**
 * The price exactly as it came off the import, in decimal.
 *
 * priceText() above renders a Treasury in 32nds, which is what a trader reads —
 * but 32nds notation is a grid, so a fill averaged across many prints snaps to
 * the nearest tick and the sub-tick detail disappears. This column carries the
 * unrounded number the slippage was actually computed from.
 *
 * toLocaleString would apply grouping separators and cap the fraction digits, so
 * the value is stringified directly and only trailing zeros are trimmed.
 */
function rawDecimalText(value: number): string {
  if (!isFinite(value)) return "N/A";
  const s = String(value);
  return s.includes("e") ? value.toFixed(10).replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** Shared with the print layout so a column renders identically in both. */
export function renderSettleCell(row: SettleTableRow, id: SettleColumnId) {
  const r = row.result;
  switch (id) {
    case "window":
      return (
        <span className="whitespace-nowrap text-gray-700 dark:text-gray-300">
          {settleWindowLabel(r.window)}
          {r.settleTimeMismatch && (
            <span
              className="ml-1 text-amber-600 dark:text-amber-400"
              title={`${row.bbgSymbol} does not settle at 15:00 ET — this benchmark is that contract's own official settle`}
            >
              &#9888;
            </span>
          )}
        </span>
      );
    case "nyDate":
      return <span className="tabular-nums text-gray-600 dark:text-gray-400">{r.nyDate}</span>;
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
    case "avgFillPrice":
      return (
        <span className="tabular-nums font-mono text-gray-700 dark:text-gray-300">
          {priceText(row.avgFillPrice, row.bbgSymbol)}
        </span>
      );
    case "avgFillPriceDec":
      return (
        <span className="tabular-nums font-mono text-gray-700 dark:text-gray-300">
          {rawDecimalText(row.avgFillPrice)}
        </span>
      );
    case "benchmark":
      // A failed fetch is not the same as "no such price", and must not read as
      // one — that conflation is what made a queue of timed-out requests look
      // like missing Bloomberg history.
      return r.benchmark === null ? (
        r.benchmarkFailed ? (
          <span
            className="whitespace-nowrap text-amber-600 dark:text-amber-400"
            title="The benchmark request failed twice — it timed out or the bridge errored. This is not Bloomberg reporting no settle. Re-fetch to try again."
          >
            &#9888; failed
          </span>
        ) : (
          <NaCell />
        )
      ) : (
        <span className="tabular-nums font-mono text-gray-700 dark:text-gray-300">
          {priceText(r.benchmark, row.bbgSymbol)}
        </span>
      );
    case "source":
      return r.source === null ? (
        <NaCell />
      ) : (
        <span
          className="text-[11px] text-gray-500 dark:text-gray-400 whitespace-nowrap"
          title={r.field ?? "Last trade before 16:00:00 NY"}
        >
          {r.source === "settle" ? r.field ?? "settle" : "16:00 print"}
        </span>
      );
    case "slip_bps":
      return <SignedBps v={r.slip_bps} />;
    case "slip_price":
      return r.slip_price === null ? (
        <NaCell />
      ) : (
        <span className={`tabular-nums font-mono ${slipToneClass(r.slip_price)}`}>
          {r.slip_price > 0 ? "+" : ""}
          {r.slip_price.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}
        </span>
      );
    case "slip_usd":
      return r.slip_usd === null ? (
        <NaCell />
      ) : (
        <span
          className={`tabular-nums font-medium whitespace-nowrap ${slipToneClass(r.slip_usd)}`}
        >
          {fmtUsd(r.slip_usd, r.currency)}
        </span>
      );
    case "lastFillTime":
      return (
        <span className="tabular-nums font-mono text-[11px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {row.lastFillTime.toISOString().replace("T", " ").slice(0, 19)}
        </span>
      );
    case "orderId":
      return (
        <span className="font-mono text-[11px] text-gray-400 dark:text-gray-500">
          {row.orderId}
        </span>
      );
  }
}

/** CSV value for a column — plain text, no markup. */
export function settleCellText(row: SettleTableRow, id: SettleColumnId): string | number | null {
  const r = row.result;
  switch (id) {
    case "window":       return settleWindowLabel(r.window);
    case "nyDate":       return r.nyDate;
    case "algo":         return row.algo;
    case "side":         return row.side;
    case "orderQty":     return row.orderQty;
    case "avgFillPrice": return row.avgFillPrice;
    case "avgFillPriceDec": return row.avgFillPrice;
    case "benchmark":    return r.benchmark === null && r.benchmarkFailed ? "FETCH FAILED" : r.benchmark;
    case "source":       return r.source === "settle" ? r.field ?? "settle" : r.source === "print" ? "16:00 print" : null;
    case "slip_bps":     return r.slip_bps;
    case "slip_price":   return r.slip_price;
    case "slip_usd":     return r.slip_usd;
    case "lastFillTime": return row.lastFillTime.toISOString();
    case "orderId":      return row.orderId;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface SettleOrderTableProps {
  rows: SettleTableRow[];
  visibleColumns: SettleColumnId[];
  onVisibleColumnsChange: (ids: SettleColumnId[]) => void;
  onExportCsv: () => void;
}

export function SettleOrderTable({
  rows,
  visibleColumns,
  onVisibleColumnsChange,
  onExportCsv,
}: SettleOrderTableProps) {
  const { open, btnRef, menuRef, pos, toggle } = usePortalMenu("right");
  const cols = SETTLE_COLUMNS.filter((c) => visibleColumns.includes(c.id));

  function toggleColumn(id: SettleColumnId) {
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
          className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-2 z-50 min-w-[180px] max-h-[70vh] overflow-y-auto"
        >
          {SETTLE_COLUMNS.map((c) => (
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
      subtitle="Slippage against the settle benchmark for each order"
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
              <tr
                key={row.orderId}
                className="border-b border-gray-50 dark:border-gray-800/50"
              >
                <td className="py-2 pr-3 font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                  {row.bbgSymbol}
                </td>
                {cols.map((c) => (
                  <td key={c.id} className="py-2 pr-3">
                    {renderSettleCell(row, c.id)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}

/**
 * SettlePrintLayout — print/PDF view of the Target Settle report.
 *
 * Renders the same tables and charts the screen shows, from the same shared
 * column definitions, cell renderers and chart components, so the two can never
 * disagree about what a figure means. Branding comes from the corporate
 * template, as in the other print layouts.
 *
 * The charts are the live components rather than captured images — this app
 * never sets Tailwind's `dark` class, so they render light here without the
 * PNG-capture step the multi-order layout needs.
 */

import type { SettleResult, SettleTolerance, SettleWindow, TradeRecord } from "@/types";
import type { SettleGroupRow } from "@/tca/settleAggregate";
import { settleWindowLabel } from "@/tca/settle";
import { useCorporateTemplate } from "@/hooks/useCorporateTemplate";
import { fmtBps, fmtUsd } from "@/components/dashboard/dashboardUtils";
import {
  renderSettleCell,
  SETTLE_COLUMNS,
  type SettleColumnId,
  type SettleTableRow,
} from "./SettleOrderTable";
import { SettleAlgoDistribution } from "./SettleAlgoDistribution";
import { SettleSpreadScatter } from "./SettleSpreadScatter";

/** The two charted windows, in the order the report reads them. */
const SETTLE_WINDOWS: ReadonlyArray<Exclude<SettleWindow, "unassigned">> = ["3pm", "4pm"];

interface SettlePrintLayoutProps {
  windowSummary: SettleGroupRow[];
  bySymbol: SettleGroupRow[];
  bySymbolAlgo: SettleGroupRow[];
  rows: SettleTableRow[];
  visibleColumns: SettleColumnId[];
  tolerance: SettleTolerance;
  /** Chart inputs — the print view renders the live chart components. */
  trades: TradeRecord[];
  results: SettleResult[];
  tickSizeFor: (bbgSymbol: string) => number | null;
  resolveSymbol: (ric: string) => string;
  onBack: () => void;
}

export function SettlePrintLayout({
  windowSummary,
  bySymbol,
  bySymbolAlgo,
  rows,
  visibleColumns,
  tolerance,
  trades,
  results,
  tickSizeFor,
  resolveSymbol,
  onBack,
}: SettlePrintLayoutProps) {
  const { logoDataUrl, disclaimerText, reportTitle, contactName, contactEmail, contactPhone } =
    useCorporateTemplate();

  const cols = SETTLE_COLUMNS.filter((c) => visibleColumns.includes(c.id));
  const dates = [...new Set(rows.map((r) => r.result.nyDate))].sort();
  const dateRange =
    dates.length === 0
      ? ""
      : dates.length === 1
        ? dates[0]!
        : `${dates[0]} to ${dates[dates.length - 1]}`;

  return (
    <div className="bg-white text-gray-900">
      {/* ── Screen-only controls ─────────────────────────────────────────── */}
      <div className="print:hidden sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-6 py-3">
        <p className="text-sm font-semibold">Print Layout — Target Settle</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors"
          >
            Print
          </button>
          <button
            type="button"
            onClick={onBack}
            className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs text-gray-600 hover:bg-gray-100 transition-colors"
          >
            Back
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-8 py-6 space-y-6">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-6 border-b border-gray-200 pb-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500">
              {reportTitle || "Transaction Cost Analysis"}
            </p>
            <h1 className="mt-1 text-xl font-semibold">Allianz — Target Settle</h1>
            <p className="mt-1 text-xs text-gray-500">
              {rows.length.toLocaleString()} order{rows.length !== 1 ? "s" : ""}
              {dateRange && <> &middot; {dateRange}</>}
              {" "}&middot; window {tolerance.beforeMin} min before to {tolerance.afterMin} min after each settle
            </p>
          </div>
          {logoDataUrl && (
            <img src={logoDataUrl} alt="" className="h-10 w-auto object-contain" />
          )}
        </div>

        {/* ── Methodology ────────────────────────────────────────────────── */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-2">
            Benchmarks
          </p>
          <div className="grid grid-cols-2 gap-4 text-xs text-gray-600 leading-relaxed">
            <p>
              <span className="font-semibold text-gray-900">3PM Settle</span> — the
              contract&rsquo;s official settlement price for the order&rsquo;s date
              (PX_SETTLE_ACTUAL). Note this is the contract&rsquo;s own settle, which for
              instruments other than CME Treasuries does not fall at 15:00 ET; those rows
              are marked.
            </p>
            <p>
              <span className="font-semibold text-gray-900">4PM Close</span> — the last
              traded print strictly before 16:00:00 New York on the order&rsquo;s date.
            </p>
          </div>
          <p className="mt-2 text-xs text-gray-600">
            Orders are assigned to the settle they finished into, judged by the last fill
            time. Slippage is positive when the execution cost money against the benchmark.
          </p>
        </div>

        <PrintGroupTable title="By Settle Window" rows={windowSummary} showWindowColumn={false} />

        {/* ── Charts ─────────────────────────────────────────────────────── */}
        {SETTLE_WINDOWS.map((w) => (
          <div key={`algo-${w}`} className="break-inside-avoid">
            <SettleAlgoDistribution
              window={w}
              trades={trades}
              results={results}
              tickSizeFor={tickSizeFor}
              resolveSymbol={resolveSymbol}
            />
          </div>
        ))}
        {SETTLE_WINDOWS.map((w) => (
          <div key={`spread-${w}`} className="break-inside-avoid">
            <SettleSpreadScatter
              window={w}
              trades={trades}
              results={results}
              tickSizeFor={tickSizeFor}
              resolveSymbol={resolveSymbol}
            />
          </div>
        ))}

        <PrintGroupTable title="By Instrument" rows={bySymbol} showWindowColumn />
        <PrintGroupTable title="By Instrument & Algo" rows={bySymbolAlgo} showWindowColumn showAlgoColumn />

        {/* ── Order detail ───────────────────────────────────────────────── */}
        <div className="break-inside-avoid">
          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-1.5">
            Order Detail
          </p>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-left">
                  <th className="px-2 py-1.5 font-semibold">Symbol</th>
                  {cols.map((c) => (
                    <th key={c.id} className="px-2 py-1.5 font-semibold whitespace-nowrap">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                {rows.map((row, i) => (
                  <tr key={row.orderId} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
                    <td className="px-2 py-1 font-semibold whitespace-nowrap">{row.bbgSymbol}</td>
                    {cols.map((c) => (
                      <td key={c.id} className="px-2 py-1">
                        {renderSettleCell(row, c.id)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        {(contactName || contactEmail || contactPhone) && (
          <div className="border-t border-gray-200 pt-3 text-[10px] text-gray-500">
            {[contactName, contactEmail, contactPhone].filter(Boolean).join(" · ")}
          </div>
        )}
        {disclaimerText && (
          <p className="text-[9px] leading-relaxed text-gray-400">{disclaimerText}</p>
        )}
      </div>
    </div>
  );
}

/** Print-friendly rendering of either grouping — no dark-mode classes. */
function PrintGroupTable({
  title,
  rows,
  showWindowColumn,
  showAlgoColumn = false,
}: {
  title: string;
  rows: SettleGroupRow[];
  showWindowColumn: boolean;
  showAlgoColumn?: boolean;
}) {
  if (rows.length === 0) return null;
  const headers = showWindowColumn
    ? [
        "Window",
        "Instrument",
        ...(showAlgoColumn ? ["Algo"] : []),
        "# Orders",
        "Total Qty",
        "Avg Slip (bps)",
        "Total Slip",
      ]
    : ["Window", "# Orders", "Total Qty", "Avg Slip (bps)", "Total Slip", "Benchmarked"];

  return (
    <div className="break-inside-avoid">
      <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-1.5">
        {title}
      </p>
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-left">
              {headers.map((h, i) => (
                <th
                  key={h}
                  className={`px-2 py-1.5 font-semibold ${i === 0 ? "text-left" : "text-right"}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-700">
            {rows.map((row, i) => (
              <tr
                key={`${row.window}|${row.key}|${row.algo ?? ""}`}
                className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}
              >
                <td className="px-2 py-1.5 font-medium whitespace-nowrap">
                  {settleWindowLabel(row.window)}
                </td>
                {showWindowColumn && (
                  <td className="px-2 py-1.5 text-right font-medium whitespace-nowrap">
                    {row.key}
                  </td>
                )}
                {showAlgoColumn && (
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    {row.algo ?? "—"}
                  </td>
                )}
                <td className="px-2 py-1.5 text-right tabular-nums">{row.count}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {row.totalQty.toLocaleString()}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {row.avgSlip_bps === null ? "—" : fmtBps(row.avgSlip_bps)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                  {row.totalSlip_usd === null
                    ? "—"
                    : fmtUsd(row.totalSlip_usd, row.currency ?? "USD")}
                </td>
                {!showWindowColumn && (
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {row.window === "unassigned" ? "—" : `${row.withBenchmark} of ${row.count}`}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

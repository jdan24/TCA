/**
 * AzOpenPrintLayout — print/PDF view of the AZ Open report.
 *
 * Renders the same summary tables the screen shows and the order table from the
 * same column definitions and cell renderer, so the two can never disagree
 * about what a figure means. Laid out the way SettlePrintLayout is: landscape
 * letter via an injected @page rule, the body pinned to the printable width,
 * and the `settle-print` class keeping background colours on paper.
 */

import { useEffect } from "react";
import type { OpenGroupRow } from "@/tca/azOpenAggregate";
import { useCorporateTemplate } from "@/hooks/useCorporateTemplate";
import { AZ_OPEN_COLUMNS, renderOpenCell, type OpenColumnId, type OpenTableRow } from "./AzOpenOrderTable";
import { AzOpenBenchmarkSummary, AzOpenBySymbol } from "./AzOpenSummary";

/** Letter landscape less the @page side margins — see SettlePrintLayout. */
const PRINT_PAGE_WIDTH_PX = 920;

interface AzOpenPrintLayoutProps {
  overall: OpenGroupRow;
  bySymbol: OpenGroupRow[];
  rows: OpenTableRow[];
  visibleColumns: OpenColumnId[];
  onBack: () => void;
}

export function AzOpenPrintLayout({
  overall,
  bySymbol,
  rows,
  visibleColumns,
  onBack,
}: AzOpenPrintLayoutProps) {
  const { logoDataUrl, disclaimerText, reportTitle, contactName, contactEmail, contactPhone } =
    useCorporateTemplate();

  useEffect(() => {
    const style = document.createElement("style");
    style.id = "azopen-print-layout-page";
    style.textContent = "@media print { @page { size: letter landscape; margin: 15mm 18mm; } }";
    document.head.appendChild(style);
    return () => { document.getElementById("azopen-print-layout-page")?.remove(); };
  }, []);

  const cols = AZ_OPEN_COLUMNS.filter((c) => visibleColumns.includes(c.id));
  const dates = [...new Set(rows.map((r) => r.result.nyDate))].sort();
  const dateRange =
    dates.length === 0
      ? ""
      : dates.length === 1
        ? dates[0]!
        : `${dates[0]} to ${dates[dates.length - 1]}`;

  return (
    <div className="settle-print bg-white text-gray-900">
      {/* ── Screen-only controls ─────────────────────────────────────────── */}
      <div className="print:hidden sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-6 py-3">
        <p className="text-sm font-semibold">Print Layout — AZ Open</p>
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

      <div className="mx-auto px-8 py-6 space-y-6" style={{ width: PRINT_PAGE_WIDTH_PX }}>
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-6 border-b border-gray-200 pb-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500">
              {reportTitle || "Transaction Cost Analysis"}
            </p>
            <h1 className="mt-1 text-xl font-semibold">AZ Open — 09:30 Cash Open</h1>
            <p className="mt-1 text-xs text-gray-500">
              {rows.length.toLocaleString()} order{rows.length !== 1 ? "s" : ""}
              {dateRange && <> &middot; {dateRange}</>}
            </p>
          </div>
          {logoDataUrl && <img src={logoDataUrl} alt="" className="h-10 w-auto object-contain" />}
        </div>

        {/* ── Methodology ────────────────────────────────────────────────── */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-2">
            Benchmarks
          </p>
          <div className="grid grid-cols-2 gap-4 text-xs text-gray-600 leading-relaxed">
            <p>
              <span className="font-semibold text-gray-900">VWAP / TWAP</span> — trade prints
              from 09:30:00 to 09:31:00 New York on the date of the order&rsquo;s first fill.
              TWAP weights each print by how long it stood; the last print before 09:30
              covers the time up to the first print of the minute.
            </p>
            <p>
              <span className="font-semibold text-gray-900">Mid / Far touch</span> — at 09:30,
              the first quote at or after 09:30:00; at arrival, the quote in force when the
              order was created. Far touch is the ask for a buy and the bid for a sell.
            </p>
          </div>
          <p className="mt-2 text-xs text-gray-600">
            Each order&rsquo;s average fill price is measured against every benchmark.
            Slippage is positive when the execution cost money against the benchmark.
          </p>
        </div>

        <div className="break-inside-avoid"><AzOpenBenchmarkSummary overall={overall} /></div>
        <div className="break-inside-avoid"><AzOpenBySymbol rows={bySymbol} /></div>

        {/* ── Order detail ───────────────────────────────────────────────── */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-1.5">
            Order Detail
          </p>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-[9px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-left">
                  <th className="px-1.5 py-1.5 font-semibold">Symbol</th>
                  {cols.map((c) => (
                    <th key={c.id} className="px-1.5 py-1.5 font-semibold">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                {rows.map((row, i) => (
                  <tr key={row.orderId} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
                    <td className="px-1.5 py-1 font-semibold whitespace-nowrap">{row.bbgSymbol}</td>
                    {cols.map((c) => (
                      <td key={c.id} className="px-1.5 py-1">
                        {renderOpenCell(row, c)}
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

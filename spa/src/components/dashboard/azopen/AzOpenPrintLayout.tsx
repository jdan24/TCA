/**
 * AzOpenPrintLayout — print/PDF view of the AZ Open report.
 *
 * Renders the same summary tables the screen shows and the order table from the
 * same column definitions and cell renderer, so the two can never disagree
 * about what a figure means. Laid out the way SettlePrintLayout is: landscape
 * letter via an injected @page rule, the body pinned to the printable width,
 * and the `settle-print` class keeping background colours on paper.
 *
 * Each order class gets its own summary, instrument and order tables, showing
 * only that class's benchmarks — which is also what keeps every table inside
 * the page width. The screen cards' scroll wrappers and minimum widths are
 * switched off under print (print:overflow-visible / print:min-w-0), so a table
 * that is still too wide squeezes instead of being clipped at the right edge.
 */

import { useEffect } from "react";
import type { OpenOrderClass } from "@/types";
import type { OpenGroupRow } from "@/tca/azOpenAggregate";
import { OPEN_ORDER_CLASS_LABEL, OPEN_REPORT_TITLE } from "@/tca/azOpen";
import { useCorporateTemplate } from "@/hooks/useCorporateTemplate";
import { columnsFor, renderOpenCell, type OpenColumnId, type OpenTableRow } from "./AzOpenOrderTable";
import {
  AzOpenBenchmarkSummary,
  AzOpenByMonth,
  AzOpenBySymbol,
  AzOpenSlippageNote,
  AzOpenTopBottom,
} from "./AzOpenSummary";

/** Letter landscape less the @page side margins — see SettlePrintLayout. */
const PRINT_PAGE_WIDTH_PX = 920;

/**
 * Above this many columns (Symbol included) the order table drops a point size,
 * so a user who has switched every price column on still fits the page.
 */
const DENSE_COLUMN_COUNT = 12;

const ORDER_CLASSES: readonly OpenOrderClass[] = ["market", "algo"];

/** Everything one order class contributes to the report. */
export interface OpenClassSection {
  overall: OpenGroupRow;
  bySymbol: OpenGroupRow[];
  /** Best and worst orders by cash slippage vs the class's primary benchmark. */
  topBottom: { best: OpenTableRow[]; worst: OpenTableRow[] };
  /** This class's orders only. */
  rows: OpenTableRow[];
}

interface AzOpenPrintLayoutProps {
  sections: Record<OpenOrderClass, OpenClassSection>;
  byMonth: OpenGroupRow[];
  /** Whether roll trades are in the report — stated on the paper. */
  includeRolls: boolean;
  /** Every order, for the header count and date range. */
  rows: OpenTableRow[];
  visibleColumns: OpenColumnId[];
  onBack: () => void;
}

export function AzOpenPrintLayout({
  sections,
  byMonth,
  includeRolls,
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

  // A class with no orders is left off the paper entirely.
  const present = ORDER_CLASSES.filter((cls) => sections[cls].rows.length > 0);
  const dates = [...new Set(rows.map((r) => r.result.nyDate))].sort();
  const dateRange =
    dates.length === 0
      ? ""
      : dates.length === 1
        ? dates[0]!
        : `${dates[0]} to ${dates[dates.length - 1]}`;
  const rollsText = includeRolls ? "Rolls included" : "Rolls excluded";

  // The browser names a saved PDF after the document title, so set it while
  // this view is up and put the previous one back on the way out.
  const pdfTitle = [OPEN_REPORT_TITLE, dateRange, `(${rollsText.toLowerCase()})`]
    .filter(Boolean)
    .join(" ");
  useEffect(() => {
    const previous = document.title;
    document.title = pdfTitle;
    return () => { document.title = previous; };
  }, [pdfTitle]);

  return (
    <div className="settle-print bg-white text-gray-900">
      {/* ── Screen-only controls ─────────────────────────────────────────── */}
      <div className="print:hidden sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-6 py-3">
        <p className="text-sm font-semibold">Print Layout — {OPEN_REPORT_TITLE}</p>
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
            <h1 className="mt-1 text-xl font-semibold">{OPEN_REPORT_TITLE}</h1>
            <p className="mt-1 text-xs text-gray-500">
              {rows.length.toLocaleString()} order{rows.length !== 1 ? "s" : ""}
              {dateRange && <> &middot; {dateRange}</>}
              {" "}&middot; {rollsText}
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
              <span className="font-semibold text-gray-900">Market orders</span> — judged on
              the mid. <span className="font-semibold text-gray-900">Mid @ 09:30</span> is the
              first quote at or after 09:30:00 New York on the date of the order&rsquo;s first
              fill; <span className="font-semibold text-gray-900">Mid @ Arrival</span> is the
              quote in force when the order was created.
            </p>
            <p>
              <span className="font-semibold text-gray-900">TWAP/VWAP orders</span> — judged on
              the volume-weighted trade price from 09:30:00 New York over the next
              2 minutes (<span className="font-semibold text-gray-900">VWAP 2m</span>) and
              4 minutes (<span className="font-semibold text-gray-900">VWAP 4m</span>).
            </p>
          </div>
          <p className="mt-2 text-xs text-gray-600">
            An order is a TWAP/VWAP order when its algo maps to TWAP or VWAP in the Algo
            Mapping settings; every other order, including one with no algo, is a market
            order. Slippage is positive when the execution cost money against the benchmark.
          </p>
          <p className="mt-2 text-xs text-gray-600">
            <span className="font-semibold text-gray-900">Amount</span> is the notional traded:
            quantity &times; price &times; contract point value.{" "}
            <span className="font-semibold text-gray-900">Rolls</span> are calendar-spread
            orders; their notional uses the front-month contract&rsquo;s price at the open.
            This report has {rollsText.toLowerCase()}.
          </p>
        </div>

        {present.map((cls) => (
          <div key={`bench-${cls}`} className="break-inside-avoid">
            <AzOpenBenchmarkSummary cls={cls} overall={sections[cls].overall} />
          </div>
        ))}
        {present.map((cls) => (
          <div key={`sym-${cls}`} className="break-inside-avoid">
            <AzOpenBySymbol cls={cls} rows={sections[cls].bySymbol} />
          </div>
        ))}

        <div className="break-inside-avoid"><AzOpenByMonth rows={byMonth} /></div>

        <div className="break-inside-avoid"><AzOpenSlippageNote /></div>

        {present.map((cls) => (
          <div key={`top-${cls}`} className="break-inside-avoid">
            <AzOpenTopBottom
              cls={cls}
              best={sections[cls].topBottom.best}
              worst={sections[cls].topBottom.worst}
            />
          </div>
        ))}

        {/* ── Order detail ───────────────────────────────────────────────── */}
        {present.map((cls) => (
          <PrintOrderTable
            key={`orders-${cls}`}
            cls={cls}
            rows={sections[cls].rows}
            visibleColumns={visibleColumns}
          />
        ))}

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

/**
 * One class's orders. Not break-inside-avoid: a long list runs on across pages,
 * and the <thead> repeats at the top of each.
 */
function PrintOrderTable({
  cls,
  rows,
  visibleColumns,
}: {
  cls: OpenOrderClass;
  rows: OpenTableRow[];
  visibleColumns: OpenColumnId[];
}) {
  const cols = columnsFor(cls, visibleColumns);
  const dense = cols.length + 1 > DENSE_COLUMN_COUNT;
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-1.5">
        Order Detail — {OPEN_ORDER_CLASS_LABEL[cls]}
      </p>
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className={`w-full ${dense ? "text-[8px]" : "text-[9px]"}`}>
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-left align-bottom">
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
  );
}

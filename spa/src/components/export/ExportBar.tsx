/**
 * Export bar — Excel (.xlsx) and PDF export buttons.
 *
 * Both heavy libraries (SheetJS for Excel, jsPDF + autotable for PDF) are
 * loaded via dynamic import() so they never appear in the initial bundle.
 * The buttons are disabled while an export is in flight.
 *
 * Exported columns (all metrics; nulls exported as empty string):
 *   Order ID · Symbol · Side · Qty · Fill Price · Arrival Price
 *   Order Time · First Fill · Last Fill · TTF (ms)
 *   IS · VWAP Dev · Mkt Impact · Rev +1m/+5m/+30m/EOD · TWAS  (all in bps)
 */

import { useState } from "react";
import type { TCAResult, TradeRecord } from "@/types";

interface ExportBarProps {
  trades: TradeRecord[];
  results: TCAResult[];
}

// ── Export data builder ───────────────────────────────────────────────────────

type ExportRow = Record<string, string | number>;

function buildRows(trades: TradeRecord[], results: TCAResult[]): ExportRow[] {
  const resultMap = new Map<string, TCAResult>();
  for (const r of results) resultMap.set(r.orderId, r);

  return trades.map((t) => {
    const r = resultMap.get(t.orderId);
    const fmt = (v: number | null): number | "" => (v === null ? "" : v);
    return {
      "Order ID": t.orderId,
      Symbol: t.symbol,
      Side: t.side,
      Qty: t.orderQty,
      "Fill Price": t.avgFillPrice,
      "Arrival Price": t.arrivalPrice ?? "",
      "Order Time": t.orderTime.toISOString(),
      "First Fill": t.firstFillTime.toISOString(),
      "Last Fill": t.lastFillTime.toISOString(),
      "TTF (ms)": r?.timeToFill_ms ?? "",
      "IS (bps)": fmt(r?.IS_bps ?? null),
      "VWAP Dev (bps)": fmt(r?.VWAP_dev_bps ?? null),
      "Mkt Impact (bps)": fmt(r?.MI_bps ?? null),
      "Rev +1m (bps)": fmt(r?.reversion_1m_bps ?? null),
      "Rev +5m (bps)": fmt(r?.reversion_5m_bps ?? null),
      "Rev +30m (bps)": fmt(r?.reversion_30m_bps ?? null),
      "Rev EOD (bps)": fmt(r?.reversion_EOD_bps ?? null),
      "TWAS (bps)": fmt(r?.TWAS_bps ?? null),
    };
  });
}

function datestamp(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// ── Export handlers ───────────────────────────────────────────────────────────

async function doExcelExport(rows: ExportRow[]): Promise<void> {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.json_to_sheet(rows);

  // Column widths
  const colWidths = [
    20, 10, 6, 8, 12, 12, 22, 22, 22,
    10, 10, 12, 14, 12, 12, 13, 12, 10,
  ];
  ws["!cols"] = colWidths.map((wch) => ({ wch }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Trades");
  XLSX.writeFile(wb, `tca_${datestamp()}.xlsx`);
}

async function doPdfExport(rows: ExportRow[]): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();

  // Header
  doc.setFontSize(13);
  doc.setTextColor(17, 24, 39); // gray-900
  doc.text("TCA Export", 20, 24);
  doc.setFontSize(8);
  doc.setTextColor(107, 114, 128); // gray-500
  doc.text(`Generated ${new Date().toLocaleString()}`, 20, 34);
  doc.text(`${rows.length} trade${rows.length !== 1 ? "s" : ""}`, pageW - 80, 24);

  if (rows.length === 0) {
    doc.setFontSize(10);
    doc.setTextColor(156, 163, 175);
    doc.text("No trades to export.", 20, 60);
    doc.save(`tca_${datestamp()}.pdf`);
    return;
  }

  const headers = Object.keys(rows[0] ?? {});
  const body = rows.map((r) =>
    Object.values(r).map((v) => (v === "" ? "—" : String(v)))
  );

  autoTable(doc, {
    startY: 44,
    head: [headers],
    body,
    styles: {
      fontSize: 6.5,
      cellPadding: 2.5,
      overflow: "ellipsize",
    },
    headStyles: {
      fillColor: "#3b82f6",
      textColor: "#ffffff",
      fontStyle: "bold",
      fontSize: 7,
    },
    alternateRowStyles: {
      fillColor: "#f8fafc",
    },
    margin: { left: 15, right: 15 },
    tableWidth: "auto",
  });

  doc.save(`tca_${datestamp()}.pdf`);
}

// ── Component ─────────────────────────────────────────────────────────────────

type Exporting = "excel" | "pdf" | null;

export function ExportBar({ trades, results }: ExportBarProps) {
  const [exporting, setExporting] = useState<Exporting>(null);

  async function handleExcel() {
    if (exporting !== null) return;
    setExporting("excel");
    try {
      await doExcelExport(buildRows(trades, results));
    } catch (err) {
      console.error("Excel export failed:", err);
    } finally {
      setExporting(null);
    }
  }

  async function handlePdf() {
    if (exporting !== null) return;
    setExporting("pdf");
    try {
      await doPdfExport(buildRows(trades, results));
    } catch (err) {
      console.error("PDF export failed:", err);
    } finally {
      setExporting(null);
    }
  }

  const busy = exporting !== null;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => { void handleExcel(); }}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-wait transition-colors"
        title="Export to Excel (.xlsx)"
      >
        {exporting === "excel" ? (
          <Spinner />
        ) : (
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        )}
        {exporting === "excel" ? "Exporting…" : "Excel"}
      </button>

      <button
        type="button"
        disabled={busy}
        onClick={() => { void handlePdf(); }}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-wait transition-colors"
        title="Export to PDF"
      >
        {exporting === "pdf" ? (
          <Spinner />
        ) : (
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        )}
        {exporting === "pdf" ? "Exporting…" : "PDF"}
      </button>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin text-current"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

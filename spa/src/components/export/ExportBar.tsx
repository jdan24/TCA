/**
 * Export bar — Excel (.xlsx), Print Preview, and (multi-order only) PDF buttons.
 *
 * Single-order mode:
 *   "Print Preview" — captures live charts via html-to-image, builds a
 *   CSS-rendered A4 print-preview document, and opens it in a new browser tab.
 *   The user clicks "Print / Save PDF" inside that tab to invoke the browser's
 *   native print dialog.  Corporate logo + disclaimer are configured once via
 *   the Branding ⚙ popover and persisted in localStorage.
 *
 * Multi-order mode:
 *   "PDF" — existing landscape A4 jsPDF export (3 pages, unchanged).
 */

import { useEffect, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { toPng } from "html-to-image";
import * as XLSX from "xlsx";
import type { AggregateRow, AggregationSet, ParentOrderSummary, TCAResult, TradeRecord } from "@/types";
import { buildReportHtml, type ChartCaptures } from "@/utils/buildReportHtml";
import { useCorporateTemplate } from "@/hooks/useCorporateTemplate";

interface ExportBarProps {
  trades: TradeRecord[];
  results: TCAResult[];
  aggregations?: AggregationSet;
  summary?: ParentOrderSummary | undefined;
}

type ExportRow = Record<string, string | number>;

// ── Formatters ────────────────────────────────────────────────────────────────

function datestamp(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Excel data builders ────────────────────────────────────────────────────────

function buildTradeRows(trades: TradeRecord[], results: TCAResult[]): ExportRow[] {
  const resultMap = new Map<string, TCAResult>();
  for (const r of results) resultMap.set(r.orderId, r);
  return trades.map((t) => {
    const r = resultMap.get(t.orderId);
    const fmt = (v: number | null): number | "" => (v === null ? "" : v);
    return {
      "Order ID":          t.orderId,
      Symbol:              t.symbol,
      Side:                t.side,
      Algo:                t.algo ?? "",
      Qty:                 t.orderQty,
      "Fill Price":        t.avgFillPrice,
      "Arrival Price":     t.arrivalPrice ?? "",
      "Order Time":        t.orderTime.toISOString(),
      "First Fill":        t.firstFillTime.toISOString(),
      "Last Fill":         t.lastFillTime.toISOString(),
      "TTF (ms)":          r?.timeToFill_ms ?? "",
      "IS (bps)":          fmt(r?.IS_bps ?? null),
      "vs Mkt VWAP (bps)": fmt(r?.VWAP_dev_bps ?? null),
      "Mkt VWAP":          fmt(r?.marketVWAP_price ?? null),
      "vs Mkt TWAP (bps)": fmt(r?.TWAP_dev_bps ?? null),
      "Mkt Impact (bps)":  fmt(r?.MI_bps ?? null),
      "Rev +30s (bps)":    fmt(r?.reversion_30s_bps ?? null),
      "Rev +1m (bps)":     fmt(r?.reversion_1m_bps ?? null),
      "TWAS (bps)":        fmt(r?.TWAS_bps ?? null),
      "Vol σ (price)":     fmt(r?.vol_during_order_price ?? null),
      "Vol σ (bps)":       fmt(r?.vol_during_order_bps ?? null),
    };
  });
}

function buildAggRows(rows: AggregateRow[]): ExportRow[] {
  const fmt = (v: number | null): number | "" => (v === null ? "" : v);
  return rows.map((r) => ({
    Group:                r.groupKey,
    "# Orders":           r.count,
    "Total Qty":          r.totalQty,
    "Avg IS (bps)":       fmt(r.avgIS_bps),
    "Avg VWAP Dev (bps)": fmt(r.avgVWAP_dev_bps),
    "Avg MI (bps)":       fmt(r.avgMI_bps),
    "Avg TWAS (bps)":     fmt(r.avgTWAS_bps),
    "Avg TTF (ms)":       Math.round(r.avgTTF_ms),
    "Win %":              r.winRate !== null ? Math.round(r.winRate * 100) : "",
    "Best IS (bps)":      fmt(r.bestIS_bps),
    "Worst IS (bps)":     fmt(r.worstIS_bps),
  }));
}

// ── Excel export ──────────────────────────────────────────────────────────────

function doExcelExport(tradeRows: ExportRow[], aggregations?: AggregationSet): void {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(tradeRows);
  const colWidths = [20, 10, 6, 10, 8, 12, 12, 22, 22, 22, 10, 10, 14, 12, 14, 14, 12, 12, 13, 12, 10];
  ws["!cols"] = colWidths.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, "Trades");
  if (aggregations) {
    for (const [name, rows] of [
      ["By Symbol",      aggregations.bySymbol],
      ["By Algo",        aggregations.byAlgo],
      ["By Symbol+Algo", aggregations.bySymbolAlgo],
      ["By Symbol+Side", aggregations.bySymbolSide],
    ] as const) {
      if (rows.length === 0) continue;
      const aggWs = XLSX.utils.json_to_sheet(buildAggRows(rows));
      aggWs["!cols"] = [20, 8, 10, 12, 14, 12, 12, 12, 8, 12, 12].map((wch) => ({ wch }));
      XLSX.utils.book_append_sheet(wb, aggWs, name);
    }
  }
  XLSX.writeFile(wb, `tca_${datestamp()}.xlsx`);
}

// ── Multi-order PDF export ────────────────────────────────────────────────────

function doPdfExport(rows: ExportRow[]): void {
  const doc   = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFontSize(13); doc.setTextColor(17, 24, 39);
  doc.text("TCA Export", 20, 24);
  doc.setFontSize(8); doc.setTextColor(107, 114, 128);
  doc.text(`Generated ${new Date().toLocaleString()}`, 20, 34);
  doc.text(`${rows.length} trade${rows.length !== 1 ? "s" : ""}`, pageW - 80, 24);
  if (rows.length === 0) {
    doc.setFontSize(10); doc.setTextColor(156, 163, 175);
    doc.text("No trades to export.", 20, 60);
    doc.save(`tca_${datestamp()}.pdf`);
    return;
  }
  const headers = Object.keys(rows[0] ?? {});
  const body    = rows.map((r) => Object.values(r).map((v) => (v === "" ? "—" : String(v))));
  autoTable(doc, {
    startY: 44, head: [headers], body,
    styles: { fontSize: 6.5, cellPadding: 2.5, overflow: "ellipsize" },
    headStyles: { fillColor: [59, 130, 246], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 15, right: 15 },
  });
  doc.save(`tca_${datestamp()}.pdf`);
}

// ── Chart capture ─────────────────────────────────────────────────────────────

async function captureChartById(id: string): Promise<string | null> {
  const el = document.getElementById(id);
  if (!el) return null;
  try {
    return await toPng(el, { backgroundColor: "#ffffff", pixelRatio: 2 });
  } catch {
    return null;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

type Exporting = "excel" | "pdf" | null;

export function ExportBar({ trades, results, aggregations, summary }: ExportBarProps) {
  const { logoDataUrl, disclaimerText, setLogo, setDisclaimer } = useCorporateTemplate();

  const [exporting,     setExporting]     = useState<Exporting>(null);
  const [generating,    setGenerating]    = useState(false);
  const [showBranding,  setShowBranding]  = useState(false);

  const brandingRef  = useRef<HTMLDivElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Close branding popover on outside click
  useEffect(() => {
    if (!showBranding) return;
    function handleClick(e: MouseEvent) {
      if (brandingRef.current && !brandingRef.current.contains(e.target as Node)) {
        setShowBranding(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showBranding]);

  function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result;
      if (typeof result === "string") setLogo(result);
    };
    reader.readAsDataURL(file);
  }

  function handleExcel() {
    if (exporting !== null || generating) return;
    setExporting("excel");
    try { doExcelExport(buildTradeRows(trades, results), aggregations); }
    catch (err) { console.error("Excel export failed:", err); }
    finally { setExporting(null); }
  }

  async function handlePdf() {
    if (exporting !== null || generating) return;
    setExporting("pdf");
    try { doPdfExport(buildTradeRows(trades, results)); }
    catch (err) { console.error("PDF export failed:", err); }
    finally { setExporting(null); }
  }

  function handlePrintPreview() {
    if (generating || !summary) return;
    setShowBranding(false);

    // Open new tab synchronously from the click event to avoid popup blocking.
    const win = window.open("", "_blank");
    if (!win) {
      alert("Popups are blocked — please allow popups for this page and try again.");
      return;
    }

    // Show a loading state in the new tab immediately.
    win.document.write(
      `<!DOCTYPE html><html><head><title>Generating report…</title>` +
      `<style>body{font-family:Helvetica,sans-serif;display:flex;align-items:center;` +
      `justify-content:center;height:100vh;margin:0;color:#64748b;background:#f1f5f9}</style>` +
      `</head><body><p>Capturing charts, please wait…</p></body></html>`
    );
    win.document.close();

    setGenerating(true);

    Promise.all([
      captureChartById("so-chart-twap"),
      captureChartById("so-chart-vwap"),
      captureChartById("so-chart-timeline"),
      captureChartById("so-chart-participation"),
    ]).then((captures) => {
      const charts: ChartCaptures = {
        twap:          captures[0],
        vwap:          captures[1],
        timeline:      captures[2],
        participation: captures[3],
      };
      const html = buildReportHtml({ summary, trades, charts, logoDataUrl, disclaimerText });
      win.document.open();
      win.document.write(html);
      win.document.close();
    }).catch((err) => {
      console.error("Print preview failed:", err);
      win.close();
    }).finally(() => {
      setGenerating(false);
    });
  }

  const busy = exporting !== null || generating;
  const hasBranding = !!(logoDataUrl || disclaimerText.trim());

  return (
    <div className="flex items-center gap-2">

      {/* ── Single-order: Print Preview + Branding gear ───────────────────── */}
      {summary && (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={handlePrintPreview}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-wait transition-colors"
            title="Open print preview in a new tab"
          >
            {generating ? <Spinner /> : <PrinterIcon />}
            {generating ? "Generating…" : "Print Preview"}
          </button>

          {/* Branding settings gear */}
          <div ref={brandingRef} className="relative">
            <button
              type="button"
              disabled={busy}
              onClick={() => setShowBranding((v) => !v)}
              className={`relative flex items-center justify-center w-7 h-7 rounded-lg border transition-colors disabled:opacity-40 ${
                showBranding
                  ? "border-blue-400 bg-blue-50 text-blue-600 dark:border-blue-600 dark:bg-blue-900/40 dark:text-blue-400"
                  : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              }`}
              title="Configure corporate branding (logo + disclaimer)"
              aria-label="Branding settings"
            >
              <GearIcon />
              {/* Blue dot indicator when branding is set */}
              {hasBranding && !showBranding && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-blue-500 border border-white dark:border-gray-900" />
              )}
            </button>

            {/* Branding popover */}
            {showBranding && (
              <div className="absolute right-0 top-9 z-30 w-80 bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-4">
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-3">Corporate Branding</p>

                {/* Logo */}
                <div className="mb-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Logo</p>
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleLogoFile}
                  />
                  {logoDataUrl ? (
                    <div className="flex items-center gap-2">
                      <img
                        src={logoDataUrl}
                        alt="Logo"
                        className="h-8 w-auto max-w-[140px] object-contain rounded border border-gray-200 dark:border-gray-700 bg-white p-0.5"
                      />
                      <button
                        type="button"
                        onClick={() => setLogo(null)}
                        className="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                        title="Remove logo"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      className="text-xs px-3 py-1.5 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors w-full text-left"
                    >
                      Upload PNG / JPG / SVG…
                    </button>
                  )}
                </div>

                {/* Disclaimer */}
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Disclaimer text <span className="text-gray-400">(appears as last page)</span></p>
                  <textarea
                    value={disclaimerText}
                    onChange={(e) => setDisclaimer(e.target.value)}
                    placeholder="Paste your disclaimer here…"
                    rows={4}
                    className="w-full text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-2.5 py-1.5 resize-y focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-gray-400"
                  />
                </div>

                <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                  Saved automatically to this browser.
                </p>
              </div>
            )}
          </div>

          <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 shrink-0" />
        </>
      )}

      {/* ── Excel (always) ────────────────────────────────────────────────── */}
      <button
        type="button"
        disabled={busy}
        onClick={handleExcel}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-wait transition-colors"
        title="Export to Excel (.xlsx)"
      >
        {exporting === "excel" ? <Spinner /> : <DownloadIcon />}
        {exporting === "excel" ? "Exporting…" : "Excel"}
      </button>

      {/* ── PDF (multi-order only) ─────────────────────────────────────────── */}
      {!summary && (
        <button
          type="button"
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-wait transition-colors"
          title="Export to PDF"
          onClick={() => { void handlePdf(); }}
        >
          {exporting === "pdf" ? <Spinner /> : <PdfIcon />}
          {exporting === "pdf" ? "Exporting…" : "PDF"}
        </button>
      )}

    </div>
  );
}

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin text-current" fill="none" viewBox="0 0 24 24" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
function DownloadIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  );
}
function PdfIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
}
function PrinterIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

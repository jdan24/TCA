/**
 * Export bar — Excel (.xlsx), PDF, and Print Preview buttons.
 *
 * Libraries are imported statically (not dynamically) because the app is
 * built as a single self-contained HTML file with codeSplitting:false;
 * dynamic import() calls are not inlined by Rollup in that mode.
 *
 * Single-order PDF (landscape A4, 3 pages):
 *   Page 1 — styled summary card drawn with jsPDF primitives
 *   Page 2 — 4 chart visualisations captured via html-to-image, 2-per-row
 *   Page 3 — fill detail table (all trade records)
 *
 * Single-order Print Preview:
 *   Opens a full-screen modal with the report rendered as print-ready HTML
 *   inside an <iframe>.  The browser's native Ctrl+P / print dialog is used
 *   to save to PDF — corporate logo and disclaimer are added via localStorage.
 *
 * Multi-order PDF: landscape A4, header + autotable of trades.
 */

import { useState } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { toPng } from "html-to-image";
import * as XLSX from "xlsx";
import type { AggregateRow, AggregationSet, ParentOrderSummary, TCAResult, TradeRecord } from "@/types";
import { fmtBps, fmtTtf } from "@/components/dashboard/dashboardUtils";
import { PrintPreviewModal } from "@/components/export/PrintPreviewModal";

interface ExportBarProps {
  trades: TradeRecord[];
  results: TCAResult[];
  aggregations?: AggregationSet;
  summary?: ParentOrderSummary | undefined;
}

type ExportRow = Record<string, string | number>;

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtPrice(v: number | null): string {
  return v !== null
    ? v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })
    : "N/A";
}
function fmtPct(v: number | null): string {
  return v !== null ? `${(v * 100).toFixed(2)}%` : "N/A";
}
function fmtUtcStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`
  );
}
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

// ── Single-order PDF: chart capture ──────────────────────────────────────────

interface CapturedChart { img: string; w: number; h: number }

async function captureChartById(id: string): Promise<CapturedChart | null> {
  const el = document.getElementById(id);
  if (!el) return null;
  try {
    // html-to-image handles SVG (Recharts) far better than html2canvas;
    // it serialises the DOM via XMLSerializer rather than trying to repaint it.
    const dataUrl = await toPng(el, { backgroundColor: "#ffffff", pixelRatio: 2 });
    return { img: dataUrl, w: el.offsetWidth, h: el.offsetHeight };
  } catch {
    return null;
  }
}

// ── Single-order PDF: summary card drawn with jsPDF primitives ────────────────

function drawSummaryCard(doc: jsPDF, summary: ParentOrderSummary): void {
  const PW    = doc.internal.pageSize.getWidth();
  const PH    = doc.internal.pageSize.getHeight();
  const ML    = 28;
  const cardW = PW - 2 * ML;

  // Shadow
  doc.setFillColor(226, 232, 240);
  doc.roundedRect(ML + 2, 22, cardW, PH - 44, 6, 6, "F");

  // Card background
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(ML, 20, cardW, PH - 44, 6, 6, "F");

  // Header band
  doc.setFillColor(37, 99, 235);
  doc.roundedRect(ML, 20, cardW, 48, 6, 6, "F");
  doc.setFillColor(37, 99, 235);
  doc.rect(ML, 44, cardW, 24, "F");

  // Title
  doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(255, 255, 255);
  doc.text("Single Order TCA  ·  Transaction Cost Analysis", ML + 14, 40);

  // Subtitle
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(147, 197, 253);
  doc.text(`Generated ${new Date().toLocaleString()}`, ML + 14, 58);

  // Symbol + side badge
  const sideIsBuy = summary.side === "BUY";
  doc.setFillColor(...(sideIsBuy ? [219, 234, 254] : [254, 226, 226]) as [number,number,number]);
  doc.roundedRect(PW - ML - 110, 28, 104, 28, 5, 5, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.setTextColor(...(sideIsBuy ? [30, 64, 175] : [185, 28, 28]) as [number,number,number]);
  doc.text(`${summary.symbol}  ${summary.side}`, PW - ML - 104, 46);

  // Metrics grid
  const GRID_TOP  = 82;
  const COL_W     = cardW / 2;
  const ROW_H     = 38;
  const LBL_COLOR: [number,number,number] = [100, 116, 139];
  const VAL_COLOR: [number,number,number] = [15,  23,  42 ];
  const ALT_BG:    [number,number,number] = [248, 250, 252];
  const WHITE:     [number,number,number] = [255, 255, 255];

  const isGood = summary.IS_bps !== null && summary.IS_bps <= 0;
  const isBad  = summary.IS_bps !== null && summary.IS_bps > 0;
  const IS_COLOR: [number,number,number] = isGood ? [22, 163, 74] : isBad ? [220, 38, 38] : VAL_COLOR;

  const metrics: Array<[string, string, string, string, [number,number,number]?]> = [
    ["Total Qty",         summary.totalQty.toLocaleString(),   "Duration",            fmtTtf(summary.duration_ms)],
    ["Order Avg. Price",  fmtPrice(summary.fillVwap),          "Arrival Price",       fmtPrice(summary.arrivalPrice)],
    ["IS (bps)",          fmtBps(summary.IS_bps),              "Market VWAP (BBG)",   fmtPrice(summary.marketVwap), IS_COLOR],
    ["Market TWAP (BBG)", fmtPrice(summary.marketTwap),        "Participation Rate",  fmtPct(summary.participationRate)],
    ["1σ Vol (price)",    summary.vol_during_order_price !== null
                            ? summary.vol_during_order_price.toFixed(4) : "N/A",
                                                               "1σ Vol (bps)",        fmtBps(summary.vol_during_order_bps)],
  ];

  for (let i = 0; i < metrics.length; i++) {
    const [lbl1, val1, lbl2, val2, overrideColor] = metrics[i]!;
    const rowY = GRID_TOP + i * ROW_H;
    const bg   = i % 2 === 0 ? ALT_BG : WHITE;

    doc.setFillColor(...bg);
    doc.rect(ML, rowY, cardW, ROW_H, "F");

    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.5);
    doc.line(ML + COL_W, rowY + 4, ML + COL_W, rowY + ROW_H - 4);

    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...LBL_COLOR);
    doc.text(lbl1, ML + 12, rowY + 13);
    doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    doc.setTextColor(...(i === 2 && overrideColor ? overrideColor : VAL_COLOR));
    doc.text(val1, ML + 12, rowY + 27);

    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...LBL_COLOR);
    doc.text(lbl2, ML + COL_W + 12, rowY + 13);
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...VAL_COLOR);
    doc.text(val2, ML + COL_W + 12, rowY + 27);
  }

  // Timing footer band
  const footerY = GRID_TOP + metrics.length * ROW_H;
  doc.setFillColor(241, 245, 249);
  doc.rect(ML, footerY, cardW, 36, "F");
  doc.setFillColor(241, 245, 249);
  doc.rect(ML, footerY + 30, cardW, 6, "F");
  doc.roundedRect(ML, footerY + 24, cardW, 12, 0, 6, "F");

  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...LBL_COLOR);
  doc.text("Order Start (UTC)",  ML + 12,         footerY + 12);
  doc.text("Last Fill (UTC)",    ML + COL_W + 12, footerY + 12);
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(...VAL_COLOR);
  doc.text(fmtUtcStr(summary.orderTime),    ML + 12,         footerY + 25);
  doc.text(fmtUtcStr(summary.lastFillTime), ML + COL_W + 12, footerY + 25);

  // Card border
  doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.75);
  doc.roundedRect(ML, 20, cardW, PH - 44, 6, 6, "S");
}

// ── Single-order PDF export (landscape A4, 3 pages) ──────────────────────────

async function doPdfExportSingle(
  summary: ParentOrderSummary,
  trades: TradeRecord[],
  _results: TCAResult[],
): Promise<void> {
  const CHART_IDS = [
    "so-chart-twap",
    "so-chart-vwap",
    "so-chart-timeline",
    "so-chart-participation",
  ] as const;

  const rawCaptures = await Promise.all(CHART_IDS.map(captureChartById));
  const [twapCap, vwapCap, timelineCap, partCap] =
    rawCaptures.map((c) => c ?? null) as [
      CapturedChart|null, CapturedChart|null,
      CapturedChart|null, CapturedChart|null
    ];

  // Page 1: Summary card
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  drawSummaryCard(doc, summary);

  // Page 2: Charts 2×2
  doc.addPage();
  const PW   = doc.internal.pageSize.getWidth();
  const PH   = doc.internal.pageSize.getHeight();
  const MARG = 16;
  const GAP  = 8;
  const colW = (PW - 2 * MARG - GAP) / 2;

  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
  doc.text(`${summary.symbol}  ${summary.side}  ·  Charts`, MARG, 11);
  let curY = 16;

  function placeChart(cap: CapturedChart | null, x: number, y: number): number {
    if (!cap) return 0;
    const h = (cap.h / cap.w) * colW;
    doc.addImage(cap.img, "PNG", x, y, colW, h);
    return h;
  }

  const r1h = twapCap || vwapCap
    ? Math.max(
        twapCap ? (twapCap.h / twapCap.w) * colW     : 0,
        vwapCap ? (vwapCap.h / vwapCap.w) * colW     : 0,
      )
    : 0;
  const r2h = timelineCap || partCap
    ? Math.max(
        timelineCap ? (timelineCap.h / timelineCap.w) * colW : 0,
        partCap     ? (partCap.h     / partCap.w)     * colW : 0,
      )
    : 0;

  placeChart(twapCap,  MARG,             curY);
  placeChart(vwapCap,  MARG + colW + GAP, curY);
  curY += (r1h > 0 ? r1h : (PH - 2 * MARG) / 2) + GAP;

  if (curY + r2h > PH - MARG) { doc.addPage(); curY = MARG; }

  placeChart(timelineCap, MARG,             curY);
  placeChart(partCap,     MARG + colW + GAP, curY);

  // Page 3: Fill detail table
  doc.addPage();
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
  doc.text(`${summary.symbol}  ${summary.side}  ·  Fill Detail`, MARG, 11);

  const fillBody = trades.map((t) => [
    t.orderId,
    t.symbol,
    t.side,
    t.orderQty.toLocaleString(),
    fmtPrice(t.avgFillPrice),
    t.arrivalPrice !== null ? fmtPrice(t.arrivalPrice) : "—",
    fmtUtcStr(t.orderTime),
    fmtUtcStr(t.firstFillTime),
    fmtUtcStr(t.lastFillTime),
    t.algo ?? "—",
  ]);

  autoTable(doc, {
    startY: 16,
    head: [["Order ID", "Symbol", "Side", "Qty", "Fill Price", "Arrival Price",
            "Order Time (UTC)", "First Fill (UTC)", "Last Fill (UTC)", "Algo"]],
    body: fillBody,
    styles: { fontSize: 6.5, cellPadding: 2.5, overflow: "ellipsize" },
    headStyles: { fillColor: [59, 130, 246], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: MARG, right: MARG, bottom: 15 },
  });

  doc.save(`tca_${summary.symbol}_${summary.side}_${datestamp()}.pdf`);
}

// ── Component ─────────────────────────────────────────────────────────────────

type Exporting = "excel" | "pdf" | null;

export function ExportBar({ trades, results, aggregations, summary }: ExportBarProps) {
  const [exporting,       setExporting]       = useState<Exporting>(null);
  const [showPrintPreview, setShowPrintPreview] = useState(false);

  function handleExcel() {
    if (exporting !== null) return;
    setExporting("excel");
    try { doExcelExport(buildTradeRows(trades, results), aggregations); }
    catch (err) { console.error("Excel export failed:", err); }
    finally { setExporting(null); }
  }

  async function handlePdf() {
    if (exporting !== null) return;
    setExporting("pdf");
    try {
      if (summary) {
        await doPdfExportSingle(summary, trades, results);
      } else {
        doPdfExport(buildTradeRows(trades, results));
      }
    } catch (err) { console.error("PDF export failed:", err); }
    finally { setExporting(null); }
  }

  const busy = exporting !== null;

  return (
    <>
      <div className="flex items-center gap-2">
        {/* Print Preview — single-order mode only */}
        {summary && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => setShowPrintPreview(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Open branded print preview (logo + disclaimer)"
            >
              <PrinterIcon />
              Print Preview
            </button>
            <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 shrink-0" />
          </>
        )}

        <button type="button" disabled={busy} onClick={handleExcel}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-wait transition-colors"
          title="Export to Excel (.xlsx)">
          {exporting === "excel" ? <Spinner /> : <DownloadIcon />}
          {exporting === "excel" ? "Exporting…" : "Excel"}
        </button>
        <button type="button" disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-wait transition-colors"
          title="Export to PDF"
          onClick={() => { void handlePdf(); }}>
          {exporting === "pdf" ? <Spinner /> : <PdfIcon />}
          {exporting === "pdf" ? "Exporting…" : "PDF"}
        </button>
      </div>

      {showPrintPreview && summary && (
        <PrintPreviewModal
          summary={summary}
          trades={trades}
          results={results}
          onClose={() => setShowPrintPreview(false)}
        />
      )}
    </>
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

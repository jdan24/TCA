/**
 * Export bar — Excel (.xlsx) and PDF export buttons.
 *
 * Libraries are imported statically (not dynamically) because the app is
 * built as a single self-contained HTML file with codeSplitting:false;
 * dynamic import() calls are not inlined by Rollup in that mode.
 *
 * Single-order PDF (2 pages, landscape A4):
 *   Page 1 — styled summary card drawn with jsPDF primitives
 *   Page 2 — all 4 chart visualizations captured via html-to-image, 2-per-row
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
  const doc  = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
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
    // it serializes the DOM via XMLSerializer rather than trying to repaint it.
    const dataUrl = await toPng(el, {
      backgroundColor: "#ffffff",
      pixelRatio: 2,
    });
    return { img: dataUrl, w: el.offsetWidth, h: el.offsetHeight };
  } catch {
    return null;
  }
}

// ── Single-order PDF: summary card drawn with jsPDF primitives ────────────────

function drawSummaryCard(doc: jsPDF, summary: ParentOrderSummary): void {
  const PW   = doc.internal.pageSize.getWidth();
  const PH   = doc.internal.pageSize.getHeight();
  const ML   = 28; // margin left/right
  const cardW = PW - 2 * ML;

  // ── Outer card shadow (very subtle — simulate with a dark rect offset) ──
  doc.setFillColor(226, 232, 240); // slate-200 shadow
  doc.roundedRect(ML + 2, 22, cardW, PH - 44, 6, 6, "F");

  // ── Card background ───────────────────────────────────────────────────────
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(ML, 20, cardW, PH - 44, 6, 6, "F");

  // ── Header band ──────────────────────────────────────────────────────────
  doc.setFillColor(37, 99, 235); // blue-700
  doc.roundedRect(ML, 20, cardW, 48, 6, 6, "F");
  // Fill bottom corners of header (no bottom-radius on header)
  doc.setFillColor(37, 99, 235);
  doc.rect(ML, 44, cardW, 24, "F");

  // Header title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text("Single Order TCA  ·  Transaction Cost Analysis", ML + 14, 40);

  // Subtitle: generated date
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(147, 197, 253); // blue-300
  doc.text(`Generated ${new Date().toLocaleString()}`, ML + 14, 58);

  // Symbol + side badge (top-right of header)
  const sideIsBuy = summary.side === "BUY";
  doc.setFillColor(...(sideIsBuy ? [219, 234, 254] : [254, 226, 226]) as [number,number,number]); // blue-100 / red-100
  doc.roundedRect(PW - ML - 110, 28, 104, 28, 5, 5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...(sideIsBuy ? [30, 64, 175] : [185, 28, 28]) as [number,number,number]); // blue-800 / red-700
  doc.text(`${summary.symbol}  ${summary.side}`, PW - ML - 104, 46);

  // ── Metrics grid ──────────────────────────────────────────────────────────
  // 2 columns × 5 rows of metrics, then 1 full-width timing row
  const GRID_TOP  = 82;
  const COL_W     = cardW / 2;
  const ROW_H     = 38;
  const LBL_COLOR: [number,number,number] = [100, 116, 139]; // slate-500
  const VAL_COLOR: [number,number,number] = [15,  23,  42 ]; // slate-950
  const ALT_BG:    [number,number,number] = [248, 250, 252]; // slate-50
  const WHITE:     [number,number,number] = [255, 255, 255];

  const isGood = summary.IS_bps !== null && summary.IS_bps <= 0;
  const isBad  = summary.IS_bps !== null && summary.IS_bps >  0;
  const IS_COLOR: [number,number,number] = isGood
    ? [22, 163, 74]   // green-600
    : isBad ? [220, 38, 38] : VAL_COLOR; // red-600

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

    // Row background (full width)
    doc.setFillColor(...bg);
    doc.rect(ML, rowY, cardW, ROW_H, "F");

    // Vertical divider between columns
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(ML + COL_W, rowY + 4, ML + COL_W, rowY + ROW_H - 4);

    // Left column
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...LBL_COLOR);
    doc.text(lbl1, ML + 12, rowY + 13);
    doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    doc.setTextColor(...(i === 2 && overrideColor ? overrideColor : VAL_COLOR));
    doc.text(val1, ML + 12, rowY + 27);

    // Right column
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...LBL_COLOR);
    doc.text(lbl2, ML + COL_W + 12, rowY + 13);
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...VAL_COLOR);
    doc.text(val2, ML + COL_W + 12, rowY + 27);
  }

  // ── Timing footer band ────────────────────────────────────────────────────
  const footerY = GRID_TOP + metrics.length * ROW_H;
  doc.setFillColor(241, 245, 249); // slate-100
  doc.rect(ML, footerY, cardW, 36, "F");
  // bottom corners rounded to match card
  doc.setFillColor(241, 245, 249);
  doc.rect(ML, footerY + 30, cardW, 6, "F");
  doc.roundedRect(ML, footerY + 24, cardW, 12, 0, 6, "F");

  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...LBL_COLOR);
  doc.text("Order Start (UTC)",  ML + 12,          footerY + 12);
  doc.text("Last Fill (UTC)",    ML + COL_W + 12,  footerY + 12);
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(...VAL_COLOR);
  doc.text(fmtUtcStr(summary.orderTime),    ML + 12,         footerY + 25);
  doc.text(fmtUtcStr(summary.lastFillTime), ML + COL_W + 12, footerY + 25);

  // Card border
  doc.setDrawColor(203, 213, 225); // slate-300
  doc.setLineWidth(0.75);
  doc.roundedRect(ML, 20, cardW, PH - 44, 6, 6, "S");
}

// ── Single-order PDF export ───────────────────────────────────────────────────

async function doPdfExportSingle(
  summary: ParentOrderSummary,
  _trades: TradeRecord[],
  _results: TCAResult[],
): Promise<void> {
  // Capture all 4 charts before opening the PDF doc
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

  // ── Page 1: Summary card (landscape A4) ───────────────────────────────────
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  drawSummaryCard(doc, summary);

  // ── Page 2: Charts 2×2 (landscape A4) ────────────────────────────────────
  doc.addPage();
  const PW   = doc.internal.pageSize.getWidth();
  const PH   = doc.internal.pageSize.getHeight();
  const MARG = 16;
  const GAP  = 8;
  const colW = (PW - 2 * MARG - GAP) / 2;

  // Tiny header on charts page
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(`${summary.symbol}  ${summary.side}  ·  Charts`, MARG, 11);

  let curY = 16;

  function placeChart(cap: CapturedChart | null, x: number, y: number): number {
    if (!cap) return 0;
    const h = (cap.h / cap.w) * colW;
    doc.addImage(cap.img, "PNG", x, y, colW, h);
    return h;
  }

  // Check if both rows fit on this page; if a row would overflow, add a new page
  const r1h = twapCap || vwapCap
    ? Math.max(
        twapCap     ? (twapCap.h / twapCap.w) * colW     : 0,
        vwapCap     ? (vwapCap.h / vwapCap.w) * colW     : 0,
      )
    : 0;

  const r2h = timelineCap || partCap
    ? Math.max(
        timelineCap ? (timelineCap.h / timelineCap.w) * colW : 0,
        partCap     ? (partCap.h     / partCap.w)     * colW : 0,
      )
    : 0;

  // Row 1: Cumulative TWAP | Cumulative VWAP
  placeChart(twapCap,  MARG,           curY);
  placeChart(vwapCap,  MARG + colW + GAP, curY);
  curY += (r1h > 0 ? r1h : (PH - 2 * MARG) / 2) + GAP;

  // If row 2 overflows this page, add a new page
  if (curY + r2h > PH - MARG) {
    doc.addPage();
    curY = MARG;
  }

  // Row 2: Execution Timeline | Running Participation
  placeChart(timelineCap, MARG,             curY);
  placeChart(partCap,     MARG + colW + GAP, curY);

  doc.save(`tca_${summary.symbol}_${summary.side}_${datestamp()}.pdf`);
}

// ── Component ─────────────────────────────────────────────────────────────────

type Exporting = "excel" | "pdf" | null;

export function ExportBar({ trades, results, aggregations, summary }: ExportBarProps) {
  const [exporting, setExporting] = useState<Exporting>(null);

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
    <div className="flex items-center gap-2">
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

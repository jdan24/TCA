/**
 * Export bar — Excel (.xlsx) and PDF export buttons.
 *
 * Libraries are imported statically (not dynamically) because the app is
 * built as a single self-contained HTML file with codeSplitting:false;
 * dynamic import() calls are not inlined by Rollup in that mode.
 *
 * Single-order PDF — two modes:
 *
 *   Without .docx template (default):
 *     Landscape A4, 3 pages:
 *       Page 1 — styled summary card
 *       Page 2 — 4 charts (2×2)
 *       Page 3 — fill detail table
 *
 *   With .docx template:
 *     Portrait A4, N+1 pages:
 *       Page 1 — company logo (from Word header) + summary card
 *       Page 2 — 4 charts (2×2, portrait-sized)
 *       Page 3+ — fill detail table
 *       Last   — dedicated disclaimer page (text from Word body)
 *
 * Multi-order PDF: landscape A4, header + autotable of trades (unchanged).
 */

import { useRef, useState } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { toPng } from "html-to-image";
import * as XLSX from "xlsx";
import type { AggregateRow, AggregationSet, ParentOrderSummary, TCAResult, TradeRecord } from "@/types";
import { fmtBps, fmtTtf } from "@/components/dashboard/dashboardUtils";
import { type DocxTemplate, parseDocxTemplate } from "@/utils/docxTemplateParser";

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
function fmtTimeUtc(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`;
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

// ── Single-order PDF: logo header (portrait, first page only) ─────────────────
//
// Returns the total vertical space consumed (logo height + divider + gap),
// which is used as topOffset for the summary card below it.

function drawLogoHeader(doc: jsPDF, logoDataUrl: string, logoAspect: number): number {
  const PW    = doc.internal.pageSize.getWidth();
  const ML    = 28;
  const maxW  = PW - 2 * ML;
  const maxH  = 72; // cap logo height at ~25 mm

  let logoW = maxW;
  let logoH = logoW / Math.max(logoAspect, 0.1);
  if (logoH > maxH) {
    logoH = maxH;
    logoW = logoH * logoAspect;
  }

  const x = (PW - logoW) / 2; // horizontally centred
  const y = 16;

  doc.addImage(logoDataUrl, x, y, logoW, logoH);

  // Thin divider below logo
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.5);
  doc.line(ML, y + logoH + 6, PW - ML, y + logoH + 6);

  return logoH + 16; // total space: logo + divider + 10 pt gap
}

// ── Single-order PDF: summary card drawn with jsPDF primitives ────────────────
//
// topOffset   — vertical space at top already consumed (logo, etc.)
// bottomOffset — space to leave at the bottom (unused in portrait mode)
// fixedCardH   — if provided, overrides the page-filling height calculation;
//                use for portrait so the card is content-sized, not page-filling

function drawSummaryCard(
  doc: jsPDF,
  summary: ParentOrderSummary,
  topOffset  = 0,
  bottomOffset = 0,
  fixedCardH?: number,
): void {
  const PW     = doc.internal.pageSize.getWidth();
  const PH     = doc.internal.pageSize.getHeight();
  const ML     = 28;
  const cardW  = PW - 2 * ML;
  const CARD_TOP = 20 + topOffset;
  const CARD_H   = fixedCardH ?? (PH - 44 - topOffset - bottomOffset);

  // ── Outer card shadow ────────────────────────────────────────────────────────
  doc.setFillColor(226, 232, 240);
  doc.roundedRect(ML + 2, CARD_TOP + 2, cardW, CARD_H, 6, 6, "F");

  // ── Card background ──────────────────────────────────────────────────────────
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(ML, CARD_TOP, cardW, CARD_H, 6, 6, "F");

  // ── Header band ─────────────────────────────────────────────────────────────
  doc.setFillColor(37, 99, 235);
  doc.roundedRect(ML, CARD_TOP, cardW, 48, 6, 6, "F");
  doc.setFillColor(37, 99, 235);
  doc.rect(ML, CARD_TOP + 24, cardW, 24, "F");

  // Header title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text("Single Order TCA  ·  Transaction Cost Analysis", ML + 14, CARD_TOP + 20);

  // Subtitle: generated date
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(147, 197, 253);
  doc.text(`Generated ${new Date().toLocaleString()}`, ML + 14, CARD_TOP + 38);

  // Symbol + side badge (top-right of header)
  const sideIsBuy = summary.side === "BUY";
  doc.setFillColor(...(sideIsBuy ? [219, 234, 254] : [254, 226, 226]) as [number,number,number]);
  doc.roundedRect(PW - ML - 110, CARD_TOP + 8, 104, 28, 5, 5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...(sideIsBuy ? [30, 64, 175] : [185, 28, 28]) as [number,number,number]);
  doc.text(`${summary.symbol}  ${summary.side}`, PW - ML - 104, CARD_TOP + 26);

  // ── Metrics grid ─────────────────────────────────────────────────────────────
  const GRID_TOP  = CARD_TOP + 62;
  const COL_W     = cardW / 2;
  const ROW_H     = 38;
  const LBL_COLOR: [number,number,number] = [100, 116, 139];
  const VAL_COLOR: [number,number,number] = [15,  23,  42 ];
  const ALT_BG:    [number,number,number] = [248, 250, 252];
  const WHITE:     [number,number,number] = [255, 255, 255];

  const isGood = summary.IS_bps !== null && summary.IS_bps <= 0;
  const isBad  = summary.IS_bps !== null && summary.IS_bps >  0;
  const IS_COLOR: [number,number,number] = isGood
    ? [22, 163, 74]
    : isBad ? [220, 38, 38] : VAL_COLOR;

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

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
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

  // ── Timing footer band ───────────────────────────────────────────────────────
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
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.75);
  doc.roundedRect(ML, CARD_TOP, cardW, CARD_H, 6, 6, "S");
}

// ── Single-order PDF: disclaimer page (portrait, last page) ──────────────────

function drawDisclaimerPage(doc: jsPDF, paragraphs: string[]): void {
  const PW       = doc.internal.pageSize.getWidth();
  const PH       = doc.internal.pageSize.getHeight();
  const ML       = 28;
  const contentW = PW - 2 * ML;
  const LINE_H   = 10; // pt per line at 7.5pt font
  const PARA_GAP = 6;  // extra gap between paragraphs

  // Thin top rule
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.5);
  doc.line(ML, 24, PW - ML, 24);

  let y = 36;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105); // slate-600

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    const lines = doc.splitTextToSize(trimmed, contentW) as string[];
    const blockH = lines.length * LINE_H;

    if (y + blockH > PH - 24) break; // don't bleed past page bottom

    doc.text(lines, ML, y);
    y += blockH + PARA_GAP;
  }
}

// ── Single-order PDF export ───────────────────────────────────────────────────

// Content-height for the summary card in portrait mode:
// header(48) + header-to-grid gap(14) + 5 rows(190) + footer band(36) + padding(8) = 296pt
const PORTRAIT_CARD_H = 296;

async function doPdfExportSingle(
  summary: ParentOrderSummary,
  trades: TradeRecord[],
  _results: TCAResult[],
  docxTemplate: DocxTemplate | null,
): Promise<void> {
  const isPortrait = docxTemplate !== null;

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

  const orientation = isPortrait ? "portrait" : "landscape";
  const doc = new jsPDF({ orientation, unit: "pt", format: "a4" });
  const PW  = doc.internal.pageSize.getWidth();
  const PH  = doc.internal.pageSize.getHeight();

  // ── Page 1: Summary card ──────────────────────────────────────────────────────
  let topOffset = 0;
  if (isPortrait && docxTemplate?.logoDataUrl) {
    topOffset = drawLogoHeader(doc, docxTemplate.logoDataUrl, docxTemplate.logoAspect);
  }
  drawSummaryCard(
    doc, summary,
    topOffset, 0,
    isPortrait ? PORTRAIT_CARD_H : undefined,
  );

  // ── Page 2: Charts 2×2 ───────────────────────────────────────────────────────
  doc.addPage();
  const MARG = 16;
  const GAP  = 8;
  const colW = (PW - 2 * MARG - GAP) / 2;

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
  const availH = PH - 2 * MARG;

  // Row 1: Cumulative TWAP | Cumulative VWAP
  placeChart(twapCap,  MARG,             curY);
  placeChart(vwapCap,  MARG + colW + GAP, curY);
  curY += (r1h > 0 ? r1h : availH / 2) + GAP;

  if (curY + r2h > PH - MARG) {
    doc.addPage();
    curY = MARG;
  }

  // Row 2: Execution Timeline | Running Participation
  placeChart(timelineCap, MARG,             curY);
  placeChart(partCap,     MARG + colW + GAP, curY);

  // ── Page 3: Fill Detail table ─────────────────────────────────────────────────
  doc.addPage();
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(`${summary.symbol}  ${summary.side}  ·  Fill Detail`, MARG, 11);

  // In portrait, timestamp columns are condensed to HH:MM:SS UTC to fit.
  const fillBody = trades.map((t) => {
    const timeStr = isPortrait ? fmtTimeUtc : fmtUtcStr;
    return [
      t.orderId,
      t.symbol,
      t.side,
      t.orderQty.toLocaleString(),
      fmtPrice(t.avgFillPrice),
      t.arrivalPrice !== null ? fmtPrice(t.arrivalPrice) : "—",
      timeStr(t.orderTime),
      timeStr(t.firstFillTime),
      timeStr(t.lastFillTime),
      t.algo ?? "—",
    ];
  });

  const timeHeader = isPortrait ? ["Order Time (UTC)", "First Fill (UTC)", "Last Fill (UTC)"]
                                : ["Order Time (UTC)", "First Fill (UTC)", "Last Fill (UTC)"];

  autoTable(doc, {
    startY: 16,
    head: [["Order ID", "Symbol", "Side", "Qty", "Fill Price", "Arrival Price",
            ...timeHeader, "Algo"]],
    body: fillBody,
    styles: { fontSize: isPortrait ? 6 : 6.5, cellPadding: 2.5, overflow: "ellipsize" },
    headStyles: { fillColor: [59, 130, 246], textColor: [255, 255, 255], fontStyle: "bold", fontSize: isPortrait ? 6.5 : 7 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: MARG, right: MARG, bottom: 15 },
  });

  // ── Last page: Disclaimer (portrait / docx template only) ────────────────────
  if (isPortrait && docxTemplate && docxTemplate.disclaimerParagraphs.length > 0) {
    doc.addPage();
    drawDisclaimerPage(doc, docxTemplate.disclaimerParagraphs);
  }

  doc.save(`tca_${summary.symbol}_${summary.side}_${datestamp()}.pdf`);
}

// ── Component ─────────────────────────────────────────────────────────────────

type Exporting = "excel" | "pdf" | null;

export function ExportBar({ trades, results, aggregations, summary }: ExportBarProps) {
  const [exporting,     setExporting]     = useState<Exporting>(null);
  const [docxTemplate,  setDocxTemplate]  = useState<DocxTemplate | null>(null);
  const [templateName,  setTemplateName]  = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const templateInputRef = useRef<HTMLInputElement>(null);

  async function handleTemplateFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setTemplateError(null);
    try {
      const buffer   = await file.arrayBuffer();
      const template = await parseDocxTemplate(buffer);
      setDocxTemplate(template);
      setTemplateName(file.name);
    } catch (err) {
      console.error("Failed to parse .docx template:", err);
      setTemplateError("Could not read template — make sure it is a valid .docx file.");
      setDocxTemplate(null);
      setTemplateName(null);
    }
  }

  function clearTemplate() {
    setDocxTemplate(null);
    setTemplateName(null);
    setTemplateError(null);
  }

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
        await doPdfExportSingle(summary, trades, results, docxTemplate);
      } else {
        doPdfExport(buildTradeRows(trades, results));
      }
    } catch (err) { console.error("PDF export failed:", err); }
    finally { setExporting(null); }
  }

  const busy = exporting !== null;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {/* Corporate template upload (single-order mode only) */}
        {summary && (
          <>
            <input
              ref={templateInputRef}
              type="file"
              accept=".docx"
              className="hidden"
              onChange={(e) => { void handleTemplateFile(e); }}
            />
            {templateName ? (
              <span className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300 max-w-[180px]">
                <TemplateIcon />
                <span className="truncate flex-1 min-w-0">{templateName}</span>
                <button
                  type="button"
                  onClick={clearTemplate}
                  className="shrink-0 ml-0.5 leading-none hover:text-blue-900 dark:hover:text-blue-100"
                  title="Remove template"
                  aria-label="Remove corporate template"
                >
                  ×
                </button>
              </span>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => templateInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-transparent text-gray-500 dark:text-gray-400 hover:border-gray-400 hover:text-gray-600 dark:hover:border-gray-500 dark:hover:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Upload corporate .docx template"
              >
                <TemplateIcon />
                Template
              </button>
            )}
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

      {/* Inline error for template parse failures */}
      {templateError && (
        <p className="text-xs text-red-500 dark:text-red-400">{templateError}</p>
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
function TemplateIcon() {
  return (
    <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

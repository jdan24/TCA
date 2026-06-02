/**
 * Export bar — Excel (.xlsx) and PDF export buttons.
 *
 * Libraries are imported statically (not dynamically) because the app is
 * built as a single self-contained HTML file with codeSplitting:false;
 * dynamic import() calls are not inlined by Rollup in that mode.
 *
 * Excel output:
 *   Sheet "Trades"         — all trade + metric columns
 *   Sheet "By Symbol"      — aggregation by symbol (when aggregations prop provided)
 *   Sheet "By Algo"        — aggregation by algo
 *   Sheet "By Symbol+Algo" — aggregation by symbol+algo combination
 *   Sheet "By Symbol+Side" — aggregation by symbol+side
 *
 * PDF output (multi-order): landscape A4, header + autotable of trades.
 * PDF output (single-order): portrait A4, full summary card + fill detail table.
 */

import { useState } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import type { AggregateRow, AggregationSet, ParentOrderSummary, TCAResult, TradeRecord } from "@/types";
import { fmtBps, fmtTtf } from "@/components/dashboard/dashboardUtils";

interface ExportBarProps {
  trades: TradeRecord[];
  results: TCAResult[];
  aggregations?: AggregationSet;
  /** When provided (Single Order mode), generates a richer single-order PDF. */
  summary?: ParentOrderSummary | undefined;
}

type ExportRow = Record<string, string | number>;

// ── Data builders ─────────────────────────────────────────────────────────────

function buildTradeRows(trades: TradeRecord[], results: TCAResult[]): ExportRow[] {
  const resultMap = new Map<string, TCAResult>();
  for (const r of results) resultMap.set(r.orderId, r);
  return trades.map((t) => {
    const r = resultMap.get(t.orderId);
    const fmt = (v: number | null): number | "" => (v === null ? "" : v);
    return {
      "Order ID":         t.orderId,
      Symbol:             t.symbol,
      Side:               t.side,
      Algo:               t.algo ?? "",
      Qty:                t.orderQty,
      "Fill Price":       t.avgFillPrice,
      "Arrival Price":    t.arrivalPrice ?? "",
      "Order Time":       t.orderTime.toISOString(),
      "First Fill":       t.firstFillTime.toISOString(),
      "Last Fill":        t.lastFillTime.toISOString(),
      "TTF (ms)":         r?.timeToFill_ms ?? "",
      "IS (bps)":         fmt(r?.IS_bps ?? null),
      "vs Mkt VWAP (bps)": fmt(r?.VWAP_dev_bps ?? null),
      "Mkt VWAP":         fmt(r?.marketVWAP_price ?? null),
      "vs Mkt TWAP (bps)": fmt(r?.TWAP_dev_bps ?? null),
      "Mkt Impact (bps)": fmt(r?.MI_bps ?? null),
      "Rev +30s (bps)":   fmt(r?.reversion_30s_bps ?? null),
      "Rev +1m (bps)":    fmt(r?.reversion_1m_bps ?? null),
      "TWAS (bps)":       fmt(r?.TWAS_bps ?? null),
      "Vol σ (price)":    fmt(r?.vol_during_order_price ?? null),
      "Vol σ (bps)":      fmt(r?.vol_during_order_bps ?? null),
    };
  });
}

function buildAggRows(rows: AggregateRow[]): ExportRow[] {
  const fmt = (v: number | null): number | "" => (v === null ? "" : v);
  return rows.map((r) => ({
    Group:               r.groupKey,
    "# Orders":          r.count,
    "Total Qty":         r.totalQty,
    "Avg IS (bps)":      fmt(r.avgIS_bps),
    "Avg VWAP Dev (bps)": fmt(r.avgVWAP_dev_bps),
    "Avg MI (bps)":      fmt(r.avgMI_bps),
    "Avg TWAS (bps)":    fmt(r.avgTWAS_bps),
    "Avg TTF (ms)":      Math.round(r.avgTTF_ms),
    "Win %":             r.winRate !== null ? Math.round(r.winRate * 100) : "",
    "Best IS (bps)":     fmt(r.bestIS_bps),
    "Worst IS (bps)":    fmt(r.worstIS_bps),
  }));
}

function datestamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtPrice(v: number | null): string {
  return v !== null ? v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }) : "N/A";
}
function fmtPct(v: number | null): string {
  return v !== null ? `${(v * 100).toFixed(2)}%` : "N/A";
}
function fmtUtcStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ` +
         `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

// ── Export handlers ───────────────────────────────────────────────────────────

function doExcelExport(tradeRows: ExportRow[], aggregations?: AggregationSet): void {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(tradeRows);
  const colWidths = [20,10,6,10,8,12,12,22,22,22,10,10,14,12,14,14,12,12,13,12,10];
  ws["!cols"] = colWidths.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, "Trades");
  if (aggregations) {
    const aggSheets: Array<{ name: string; rows: AggregateRow[] }> = [
      { name: "By Symbol",      rows: aggregations.bySymbol },
      { name: "By Algo",        rows: aggregations.byAlgo },
      { name: "By Symbol+Algo", rows: aggregations.bySymbolAlgo },
      { name: "By Symbol+Side", rows: aggregations.bySymbolSide },
    ];
    for (const { name, rows } of aggSheets) {
      if (rows.length === 0) continue;
      const aggWs = XLSX.utils.json_to_sheet(buildAggRows(rows));
      aggWs["!cols"] = [20,8,10,12,14,12,12,12,8,12,12].map((wch) => ({ wch }));
      XLSX.utils.book_append_sheet(wb, aggWs, name);
    }
  }
  XLSX.writeFile(wb, `tca_${datestamp()}.xlsx`);
}

function doPdfExport(rows: ExportRow[]): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFontSize(13); doc.setTextColor(17,24,39);
  doc.text("TCA Export", 20, 24);
  doc.setFontSize(8); doc.setTextColor(107,114,128);
  doc.text(`Generated ${new Date().toLocaleString()}`, 20, 34);
  doc.text(`${rows.length} trade${rows.length !== 1 ? "s" : ""}`, pageW - 80, 24);
  if (rows.length === 0) {
    doc.setFontSize(10); doc.setTextColor(156,163,175);
    doc.text("No trades to export.", 20, 60);
    doc.save(`tca_${datestamp()}.pdf`);
    return;
  }
  const headers = Object.keys(rows[0] ?? {});
  const body = rows.map((r) => Object.values(r).map((v) => (v === "" ? "—" : String(v))));
  autoTable(doc, {
    startY: 44, head: [headers], body,
    styles: { fontSize: 6.5, cellPadding: 2.5, overflow: "ellipsize" },
    headStyles: { fillColor: [59,130,246], textColor: [255,255,255], fontStyle: "bold", fontSize: 7 },
    alternateRowStyles: { fillColor: [248,250,252] },
    margin: { left: 15, right: 15 },
  });
  doc.save(`tca_${datestamp()}.pdf`);
}

function doPdfExportSingle(
  summary: ParentOrderSummary,
  trades: TradeRecord[],
  results: TCAResult[],
): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();

  // ── Header ───────────────────────────────────────────────────────────────
  doc.setFontSize(15); doc.setTextColor(17, 24, 39);
  doc.text(`Single Order TCA  ·  ${summary.symbol}  ${summary.side}`, 20, 30);
  doc.setFontSize(8); doc.setTextColor(107, 114, 128);
  doc.text(`Generated ${new Date().toLocaleString()}`, 20, 42);
  doc.text(`${trades.length} fill${trades.length !== 1 ? "s" : ""}`, pageW - 60, 30);

  // ── Summary table ────────────────────────────────────────────────────────
  const summaryBody: string[][] = [
    ["Symbol",            summary.symbol,                     "Side",               summary.side],
    ["Total Qty",         summary.totalQty.toLocaleString(),  "Duration",           fmtTtf(summary.duration_ms)],
    ["Order Avg. Price",  fmtPrice(summary.fillVwap),         "Arrival Price",      fmtPrice(summary.arrivalPrice)],
    ["IS (bps)",          fmtBps(summary.IS_bps),             "Market VWAP (BBG)",  fmtPrice(summary.marketVwap)],
    ["Market TWAP (BBG)", fmtPrice(summary.marketTwap),       "Participation Rate", fmtPct(summary.participationRate)],
    ["1σ Vol (price)",    summary.vol_during_order_price !== null ? summary.vol_during_order_price.toFixed(4) : "N/A",
                                                              "1σ Vol (bps)",       fmtBps(summary.vol_during_order_bps)],
    ["Order Start (UTC)", fmtUtcStr(summary.orderTime),       "Last Fill (UTC)",    fmtUtcStr(summary.lastFillTime)],
  ];

  autoTable(doc, {
    startY: 52,
    body: summaryBody,
    theme: "plain",
    styles: { fontSize: 8.5, cellPadding: 4 },
    columnStyles: {
      0: { fontStyle: "bold", fillColor: [248,250,252], cellWidth: 110 },
      1: { cellWidth: 130 },
      2: { fontStyle: "bold", fillColor: [248,250,252], cellWidth: 110 },
      3: { cellWidth: 130 },
    },
    margin: { left: 20, right: 20 },
  });

  // ── Running benchmarks table (VWAP, TWAP per fill) ────────────────────────
  type AutoTableDoc = typeof doc & { lastAutoTable: { finalY: number } };
  const afterSummary = (doc as AutoTableDoc).lastAutoTable.finalY + 14;

  doc.setFontSize(9); doc.setTextColor(17, 24, 39);
  doc.text("Running Benchmarks at Each Fill", 20, afterSummary);

  const vwapMap = new Map((summary.runningMarketVwap ?? []).map((p) => [p.t, p.vwap]));
  const twapMap = new Map((summary.runningMarketTwap  ?? []).map((p) => [p.t, p.twap]));

  const sortedTrades = [...trades].sort((a, b) => a.lastFillTime.getTime() - b.lastFillTime.getTime());
  const resultMap    = new Map(results.map((r) => [r.orderId, r]));

  const benchHeaders = ["Time (UTC)", "Fill Price", "Qty", "IS (bps)", "Mkt VWAP", "Mkt TWAP", "vs VWAP (bps)", "vs TWAP (bps)"];
  const benchBody = sortedTrades.map((t) => {
    const r = resultMap.get(t.orderId);
    const ms = t.lastFillTime.getTime();
    return [
      fmtUtcStr(t.lastFillTime),
      t.avgFillPrice.toFixed(4),
      t.orderQty.toLocaleString(),
      fmtBps(r?.IS_bps ?? null),
      vwapMap.has(ms) ? vwapMap.get(ms)!.toFixed(4) : "—",
      twapMap.has(ms) ? twapMap.get(ms)!.toFixed(4) : "—",
      fmtBps(r?.VWAP_dev_bps ?? null),
      fmtBps(r?.TWAP_dev_bps ?? null),
    ];
  });

  autoTable(doc, {
    startY: afterSummary + 6,
    head: [benchHeaders],
    body: benchBody,
    styles: { fontSize: 7, cellPadding: 2.5, overflow: "ellipsize" },
    headStyles: { fillColor: [59,130,246], textColor: [255,255,255], fontStyle: "bold", fontSize: 7 },
    alternateRowStyles: { fillColor: [248,250,252] },
    margin: { left: 20, right: 20 },
  });

  // ── Full fill detail table ────────────────────────────────────────────────
  const afterBench = (doc as AutoTableDoc).lastAutoTable.finalY + 14;
  doc.setFontSize(9); doc.setTextColor(17, 24, 39);
  doc.text("Full Fill Detail", 20, afterBench);

  const tradeRows = buildTradeRows(trades, results);
  if (tradeRows.length > 0) {
    const headers = Object.keys(tradeRows[0]!);
    const body    = tradeRows.map((r) => Object.values(r).map((v) => (v === "" ? "—" : String(v))));
    autoTable(doc, {
      startY: afterBench + 6,
      head: [headers],
      body,
      styles: { fontSize: 6, cellPadding: 2, overflow: "ellipsize" },
      headStyles: { fillColor: [59,130,246], textColor: [255,255,255], fontStyle: "bold", fontSize: 6 },
      alternateRowStyles: { fillColor: [248,250,252] },
      margin: { left: 20, right: 20 },
    });
  }

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

  function handlePdf() {
    if (exporting !== null) return;
    setExporting("pdf");
    try {
      if (summary) {
        doPdfExportSingle(summary, trades, results);
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
      <button type="button" disabled={busy} onClick={handlePdf}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-wait transition-colors"
        title="Export to PDF">
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

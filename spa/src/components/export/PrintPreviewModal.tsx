/**
 * PrintPreviewModal — opens a full-screen overlay that renders the single-order
 * TCA report as print-ready HTML inside an <iframe>.
 *
 * The user clicks "Print / Save PDF" which calls contentWindow.print(), opening
 * the browser's native print dialog. Selecting "Save as PDF" produces a
 * correctly-paged A4 portrait PDF — no JS-to-PDF library required.
 *
 * Corporate branding (logo image + disclaimer text) is stored in localStorage
 * via useCorporateTemplate so it only needs to be set once.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import type { ParentOrderSummary, TradeRecord, TCAResult } from "@/types";
import { fmtBps, fmtTtf } from "@/components/dashboard/dashboardUtils";
import { useCorporateTemplate } from "@/hooks/useCorporateTemplate";

interface PrintPreviewModalProps {
  summary:  ParentOrderSummary;
  trades:   TradeRecord[];
  results:  TCAResult[];
  onClose:  () => void;
}

// ── Local formatters (duplicated from ExportBar to keep this file self-contained) ─

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

// ── Chart capture ─────────────────────────────────────────────────────────────

interface ChartImages {
  twap:          string | null;
  vwap:          string | null;
  timeline:      string | null;
  participation: string | null;
}

async function captureChart(id: string): Promise<string | null> {
  const el = document.getElementById(id);
  if (!el) return null;
  try {
    return await toPng(el, { backgroundColor: "#ffffff", pixelRatio: 2 });
  } catch {
    return null;
  }
}

// ── HTML builder ──────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPrintHtml({
  summary,
  trades,
  charts,
  logoDataUrl,
  disclaimerText,
}: {
  summary:       ParentOrderSummary;
  trades:        TradeRecord[];
  charts:        ChartImages;
  logoDataUrl:   string | null;
  disclaimerText: string;
}): string {
  const sideIsBuy   = summary.side === "BUY";
  const badgeBg     = sideIsBuy ? "#dbeafe" : "#fee2e2";
  const badgeText   = sideIsBuy ? "#1e40af" : "#b91c1c";
  const isGood      = summary.IS_bps !== null && summary.IS_bps <= 0;
  const isBad       = summary.IS_bps !== null && summary.IS_bps > 0;
  const isColor     = isGood ? "#16a34a" : isBad ? "#dc2626" : "#0f172a";
  const generatedAt = new Date().toLocaleString();

  const metrics: [string, string, string, string, string?][] = [
    ["Total Qty",         summary.totalQty.toLocaleString(),  "Duration",           fmtTtf(summary.duration_ms)],
    ["Order Avg. Price",  fmtPrice(summary.fillVwap),         "Arrival Price",      fmtPrice(summary.arrivalPrice)],
    ["IS (bps)",          fmtBps(summary.IS_bps),             "Market VWAP (BBG)",  fmtPrice(summary.marketVwap), isColor],
    ["Market TWAP (BBG)", fmtPrice(summary.marketTwap),       "Participation Rate", fmtPct(summary.participationRate)],
    ["1σ Vol (price)",    summary.vol_during_order_price?.toFixed(4) ?? "N/A",
                                                              "1σ Vol (bps)",       fmtBps(summary.vol_during_order_bps)],
  ];

  const metricRows = metrics.map(([l1, v1, l2, v2, col], i) => {
    const bg = i % 2 === 0 ? "#f8fafc" : "#ffffff";
    return `
      <tr style="background:${bg}">
        <td style="padding:8px 12px;width:50%;border-right:1px solid #e2e8f0;vertical-align:top">
          <div style="font-size:7pt;color:#64748b;margin-bottom:2px">${esc(l1)}</div>
          <div style="font-size:10pt;font-weight:700;color:${col ?? "#0f172a"}">${esc(v1)}</div>
        </td>
        <td style="padding:8px 12px;width:50%;vertical-align:top">
          <div style="font-size:7pt;color:#64748b;margin-bottom:2px">${esc(l2)}</div>
          <div style="font-size:10pt;font-weight:700;color:#0f172a">${esc(v2)}</div>
        </td>
      </tr>`;
  }).join("");

  const chartImgs = [
    [charts.twap,          "Cumulative TWAP"],
    [charts.vwap,          "Cumulative VWAP"],
    [charts.timeline,      "Execution Timeline"],
    [charts.participation, "Running Participation"],
  ] as [string | null, string][];

  const chartGrid = chartImgs.map(([src, alt]) =>
    src
      ? `<img src="${src}" alt="${esc(alt)}" style="width:100%;height:auto;display:block">`
      : `<div style="background:#f1f5f9;aspect-ratio:2/1;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:7pt">${esc(alt)} unavailable</div>`
  ).join("\n");

  const fillRows = trades.map((t, i) => {
    const bg = i % 2 === 0 ? "#f8fafc" : "#ffffff";
    return `<tr style="background:${bg}">
      <td>${esc(t.orderId)}</td>
      <td>${esc(t.symbol)}</td>
      <td>${esc(t.side)}</td>
      <td style="text-align:right">${t.orderQty.toLocaleString()}</td>
      <td style="text-align:right">${esc(fmtPrice(t.avgFillPrice))}</td>
      <td style="text-align:right">${t.arrivalPrice !== null ? esc(fmtPrice(t.arrivalPrice)) : "—"}</td>
      <td>${esc(fmtUtcStr(t.orderTime))}</td>
      <td>${esc(fmtUtcStr(t.firstFillTime))}</td>
      <td>${esc(fmtUtcStr(t.lastFillTime))}</td>
      <td>${esc(t.algo ?? "—")}</td>
    </tr>`;
  }).join("\n");

  const disclaimerPage = disclaimerText.trim() ? `
    <div class="page-break" id="p-disclaimer">
      <hr style="border:none;border-top:1px solid #e2e8f0;margin-bottom:14pt">
      <p style="font-size:7.5pt;color:#475569;white-space:pre-wrap;line-height:1.7;margin:0">${esc(disclaimerText.trim())}</p>
    </div>` : "";

  const logoHtml = logoDataUrl
    ? `<div style="margin-bottom:10pt;text-align:center">
         <img src="${logoDataUrl}" alt="Company logo" style="max-height:60pt;max-width:100%;display:inline-block">
       </div>
       <hr style="border:none;border-top:1px solid #e2e8f0;margin-bottom:14pt">`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  @page { size: A4 portrait; margin: 15mm 18mm; }
  * { box-sizing: border-box; }
  body {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 9pt;
    color: #0f172a;
    margin: 0;
    padding: 0;
  }
  .page-break { break-before: page; }
  table { border-collapse: collapse; width: 100%; }
  #p-summary table { border: 1px solid #cbd5e1; }
  #p-fills table {
    font-size: 6pt;
    border: 1px solid #e2e8f0;
  }
  #p-fills th {
    background: #3b82f6;
    color: white;
    padding: 5px 4px;
    text-align: left;
    font-size: 6.5pt;
    font-weight: 600;
  }
  #p-fills td {
    padding: 4px;
    border-bottom: 1px solid #f1f5f9;
    font-size: 6pt;
    vertical-align: middle;
  }
  .section-label {
    font-size: 8pt;
    color: #64748b;
    margin: 0 0 6pt;
  }
  .charts-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8pt;
  }
</style>
</head>
<body>

<!-- Page 1: Summary -->
<div id="p-summary">
  ${logoHtml}
  <div style="background:#2563eb;border-radius:6px 6px 0 0;padding:11px 14px;display:flex;justify-content:space-between;align-items:flex-start">
    <div>
      <div style="color:white;font-size:13pt;font-weight:700">Single Order TCA &middot; Transaction Cost Analysis</div>
      <div style="color:#93c5fd;font-size:7pt;margin-top:3px">Generated ${esc(generatedAt)}</div>
    </div>
    <div style="background:${badgeBg};border-radius:4px;padding:4px 10px;color:${badgeText};font-weight:700;font-size:10pt;white-space:nowrap;margin-left:12px;flex-shrink:0">
      ${esc(summary.symbol)}&nbsp;&nbsp;${esc(summary.side)}
    </div>
  </div>
  <!-- fill bottom corners of header -->
  <div style="background:#2563eb;height:6px;margin-top:-6px"></div>

  <table>
    <tbody>
      ${metricRows}
      <tr style="background:#f1f5f9">
        <td style="padding:8px 12px;border-right:1px solid #e2e8f0;vertical-align:top">
          <div style="font-size:7pt;color:#64748b;margin-bottom:2px">Order Start (UTC)</div>
          <div style="font-size:8.5pt;font-weight:700;color:#0f172a">${esc(fmtUtcStr(summary.orderTime))}</div>
        </td>
        <td style="padding:8px 12px;vertical-align:top">
          <div style="font-size:7pt;color:#64748b;margin-bottom:2px">Last Fill (UTC)</div>
          <div style="font-size:8.5pt;font-weight:700;color:#0f172a">${esc(fmtUtcStr(summary.lastFillTime))}</div>
        </td>
      </tr>
    </tbody>
  </table>
  <div style="border:1px solid #cbd5e1;border-top:none;border-radius:0 0 6px 6px;height:6px"></div>
</div>

<!-- Page 2: Charts -->
<div class="page-break" id="p-charts">
  <p class="section-label">${esc(summary.symbol)}&nbsp;&nbsp;${esc(summary.side)}&nbsp;&middot;&nbsp;Charts</p>
  <div class="charts-grid">${chartGrid}</div>
</div>

<!-- Page 3+: Fill Detail -->
<div class="page-break" id="p-fills">
  <p class="section-label">${esc(summary.symbol)}&nbsp;&nbsp;${esc(summary.side)}&nbsp;&middot;&nbsp;Fill Detail</p>
  <table>
    <thead>
      <tr>
        <th>Order ID</th><th>Symbol</th><th>Side</th><th>Qty</th>
        <th>Fill Price</th><th>Arrival Price</th>
        <th>Order Time (UTC)</th><th>First Fill (UTC)</th><th>Last Fill (UTC)</th>
        <th>Algo</th>
      </tr>
    </thead>
    <tbody>${fillRows}</tbody>
  </table>
</div>

${disclaimerPage}

</body>
</html>`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PrintPreviewModal({ summary, trades, onClose }: PrintPreviewModalProps) {
  const { logoDataUrl, disclaimerText, setLogo, setDisclaimer } = useCorporateTemplate();

  const [capturing, setCapturing]     = useState(true);
  const [charts, setCharts]           = useState<ChartImages | null>(null);
  const logoInputRef                  = useRef<HTMLInputElement>(null);
  const iframeRef                     = useRef<HTMLIFrameElement>(null);

  // Capture chart images on mount
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      captureChart("so-chart-twap"),
      captureChart("so-chart-vwap"),
      captureChart("so-chart-timeline"),
      captureChart("so-chart-participation"),
    ]).then(([twap, vwap, timeline, participation]) => {
      if (!cancelled) {
        setCharts({ twap, vwap, timeline, participation });
        setCapturing(false);
      }
    }).catch(() => {
      if (!cancelled) setCapturing(false);
    });
    return () => { cancelled = true; };
  }, []);

  // Rebuild HTML whenever charts or branding changes
  const printHtml = useMemo(() => {
    if (!charts) return null;
    return buildPrintHtml({ summary, trades, charts, logoDataUrl, disclaimerText });
  }, [summary, trades, charts, logoDataUrl, disclaimerText]);

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

  function handlePrint() {
    iframeRef.current?.contentWindow?.print();
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/60 backdrop-blur-sm">
      {/* ── Modal chrome ───────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-h-0 mx-auto w-full max-w-4xl my-4 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Print Preview</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={capturing || !printHtml}
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-40 disabled:cursor-wait transition-colors"
              title="Open browser print dialog — select 'Save as PDF'"
            >
              <PrinterIcon />
              {capturing ? "Capturing charts…" : "Print / Save PDF"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors"
              aria-label="Close print preview"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        {/* ── Branding panel ─────────────────────────────────────────────── */}
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 shrink-0">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2.5 uppercase tracking-wide">Corporate Branding</p>
          <div className="flex flex-wrap gap-4">

            {/* Logo upload */}
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs text-gray-600 dark:text-gray-400 shrink-0">Logo</span>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleLogoFile}
              />
              {logoDataUrl ? (
                <div className="flex items-center gap-1.5">
                  <img src={logoDataUrl} alt="Logo preview" className="h-7 w-auto max-w-[120px] object-contain rounded border border-gray-200 dark:border-gray-600 bg-white p-0.5" />
                  <button
                    type="button"
                    onClick={() => setLogo(null)}
                    className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                    title="Remove logo"
                  >×</button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  className="text-xs px-2 py-1 rounded border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  Upload PNG / JPG / SVG
                </button>
              )}
            </div>

            {/* Disclaimer text */}
            <div className="flex items-start gap-2 flex-1 min-w-[200px]">
              <span className="text-xs text-gray-600 dark:text-gray-400 shrink-0 mt-1">Disclaimer</span>
              <textarea
                value={disclaimerText}
                onChange={(e) => setDisclaimer(e.target.value)}
                placeholder="Paste your disclaimer text here — it will appear on its own last page…"
                rows={2}
                className="flex-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-2 py-1 resize-y focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-gray-400"
              />
            </div>

          </div>
        </div>

        {/* ── iframe preview ──────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 relative">
          {capturing && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 z-10">
              <div className="flex flex-col items-center gap-2 text-gray-500 dark:text-gray-400">
                <svg className="h-6 w-6 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden>
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-xs">Capturing charts…</span>
              </div>
            </div>
          )}
          <iframe
            ref={iframeRef}
            title="Print Preview"
            srcDoc={printHtml ?? ""}
            className="w-full h-full border-0"
            sandbox="allow-same-origin allow-modals"
          />
        </div>

        {/* Footer hint */}
        <div className="px-5 py-2 border-t border-gray-200 dark:border-gray-700 shrink-0">
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
            Click <strong>Print / Save PDF</strong>, then in the print dialog choose <em>Save as PDF</em> and set paper size to <strong>A4</strong>.
          </p>
        </div>
      </div>
    </div>
  );
}

function PrinterIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

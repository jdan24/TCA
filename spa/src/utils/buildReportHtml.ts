/**
 * Builds a self-contained HTML document for the TCA single-order print report.
 *
 * On screen the document renders as A4-sized white "page cards" floating on a
 * gray background — exactly the newspaper print-preview feel.  A sticky top bar
 * holds a "Print / Save PDF" button that calls window.print().
 *
 * On print (via @media print / @page CSS) the page cards become actual paper
 * pages, the top bar is hidden, and @page sets A4 portrait with correct margins.
 */

import type { ParentOrderSummary, TradeRecord } from "@/types";
import { fmtBps, fmtTtf } from "@/components/dashboard/dashboardUtils";

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
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
/* ── Reset & base ─────────────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: Helvetica, Arial, sans-serif;
  font-size: 9pt;
  color: #0f172a;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* ── Screen: newspaper-style print preview ───────────────────────────────── */
@media screen {
  body { background: #cbd5e1; }

  .print-bar {
    position: sticky;
    top: 0;
    z-index: 100;
    background: #ffffff;
    border-bottom: 1px solid #e2e8f0;
    padding: 10px 24px;
    display: flex;
    align-items: center;
    gap: 14px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  }
  .print-bar-title {
    font-size: 12px;
    font-weight: 600;
    color: #334155;
    flex: 1;
  }
  .print-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #2563eb;
    color: #ffffff;
    border: none;
    border-radius: 8px;
    padding: 7px 16px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.15s;
  }
  .print-btn:hover { background: #1d4ed8; }
  .print-hint {
    font-size: 11px;
    color: #94a3b8;
  }

  /* A4 portrait page cards */
  .page {
    width: 794px;
    min-height: 1123px;
    margin: 28px auto;
    background: #ffffff;
    padding: 56px 66px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.14);
    border-radius: 2px;
  }
}

/* ── Print ───────────────────────────────────────────────────────────────── */
@media print {
  @page { size: A4 portrait; margin: 15mm 18mm; }
  .print-bar { display: none !important; }
  body { background: none; }
  .page { width: auto; min-height: auto; padding: 0; margin: 0; box-shadow: none; }
  .page + .page { break-before: page; }
}

/* ── Logo ─────────────────────────────────────────────────────────────────── */
.logo-wrap {
  text-align: center;
  margin-bottom: 14pt;
}
.logo-wrap img {
  max-height: 60pt;
  max-width: 100%;
  display: inline-block;
}
.logo-rule {
  border: none;
  border-top: 0.75px solid #e2e8f0;
  margin-bottom: 16pt;
}

/* ── Summary card ─────────────────────────────────────────────────────────── */
.summary-card {
  border: 0.75px solid #cbd5e1;
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 2px 2px 0 0 #e2e8f0;
}
.card-header {
  background: #2563eb;
  padding: 12px 14px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.card-title  { color: #ffffff; font-size: 14pt; font-weight: 700; }
.card-sub    { color: #93c5fd; font-size: 7.5pt; margin-top: 3px; }
.card-badge  {
  border-radius: 5px;
  padding: 4px 10px;
  font-size: 11pt;
  font-weight: 700;
  white-space: nowrap;
  flex-shrink: 0;
  margin-left: 12px;
  align-self: center;
}
.badge-buy  { background: #dbeafe; color: #1e40af; }
.badge-sell { background: #fee2e2; color: #b91c1c; }

.metrics-table { width: 100%; border-collapse: collapse; }
.metrics-table td {
  padding: 8px 12px;
  vertical-align: top;
  width: 50%;
  border-bottom: 1px solid #e2e8f0;
}
.metrics-table td:first-child { border-right: 1px solid #e2e8f0; }
.metrics-table tr:nth-child(odd)  td { background: #f8fafc; }
.metrics-table tr:nth-child(even) td { background: #ffffff; }
.metrics-table .timing-row td  { background: #f1f5f9 !important; border-bottom: none; }
.metric-lbl   { font-size: 7.5pt; color: #64748b; margin-bottom: 2px; }
.metric-val   { font-size: 10pt; font-weight: 700; color: #0f172a; }
.metric-val.good { color: #16a34a; }
.metric-val.bad  { color: #dc2626; }
.timing-val   { font-size: 8.5pt; font-weight: 700; color: #0f172a; }

/* ── Section label ─────────────────────────────────────────────────────────── */
.section-label {
  font-size: 8pt;
  color: #64748b;
  margin-bottom: 8pt;
}

/* ── Charts ─────────────────────────────────────────────────────────────────── */
.charts-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10pt;
}
.charts-grid img  { width: 100%; height: auto; display: block; }
.chart-placeholder {
  aspect-ratio: 2 / 1;
  background: #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  font-size: 7pt;
}

/* ── Fills table ───────────────────────────────────────────────────────────── */
.fills-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 6pt;
}
.fills-table th {
  background: #3b82f6;
  color: #ffffff;
  padding: 5px 4px;
  text-align: left;
  font-size: 6.5pt;
  font-weight: 600;
}
.fills-table td {
  padding: 4px;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
}
.fills-table tr:nth-child(even) td { background: #f8fafc; }
.fills-table .num { text-align: right; }

/* ── Disclaimer ────────────────────────────────────────────────────────────── */
.disclaimer-rule {
  border: none;
  border-top: 0.75px solid #e2e8f0;
  margin-bottom: 14pt;
}
.disclaimer-text {
  font-size: 7.5pt;
  color: #475569;
  white-space: pre-wrap;
  line-height: 1.7;
}
`;

// ── HTML builder ──────────────────────────────────────────────────────────────

export interface ChartCaptures {
  twap:          string | null;
  vwap:          string | null;
  timeline:      string | null;
  participation: string | null;
}

export function buildReportHtml({
  summary,
  trades,
  charts,
  logoDataUrl,
  disclaimerText,
}: {
  summary:       ParentOrderSummary;
  trades:        TradeRecord[];
  charts:        ChartCaptures;
  logoDataUrl:   string | null;
  disclaimerText: string;
}): string {
  const sideIsBuy = summary.side === "BUY";
  const isGood    = summary.IS_bps !== null && summary.IS_bps <= 0;
  const isBad     = summary.IS_bps !== null && summary.IS_bps > 0;
  const isClass   = isGood ? "good" : isBad ? "bad" : "";
  const dateStr   = new Date().toLocaleString();
  const title     = `TCA Report — ${summary.symbol} ${summary.side} — ${new Date().toLocaleDateString()}`;

  // ── Summary card ───────────────────────────────────────────────────────────

  const metricRows = [
    ["Total Qty",         summary.totalQty.toLocaleString(),   "Duration",            fmtTtf(summary.duration_ms),          ""],
    ["Order Avg. Price",  fmtPrice(summary.fillVwap),          "Arrival Price",       fmtPrice(summary.arrivalPrice),       ""],
    ["IS (bps)",          fmtBps(summary.IS_bps),              "Market VWAP (BBG)",   fmtPrice(summary.marketVwap),         isClass],
    ["Market TWAP (BBG)", fmtPrice(summary.marketTwap),        "Participation Rate",  fmtPct(summary.participationRate),    ""],
    ["1σ Vol (price)", summary.vol_during_order_price?.toFixed(4) ?? "N/A",
                                                               "1σ Vol (bps)",   fmtBps(summary.vol_during_order_bps), ""],
  ] as [string, string, string, string, string][];

  const metricRowsHtml = metricRows.map(([l1, v1, l2, v2, cls]) => `
    <tr>
      <td><div class="metric-lbl">${esc(l1)}</div><div class="metric-val ${cls}">${esc(v1)}</div></td>
      <td><div class="metric-lbl">${esc(l2)}</div><div class="metric-val">${esc(v2)}</div></td>
    </tr>`).join("");

  const summaryCard = `
    <div class="summary-card">
      <div class="card-header">
        <div>
          <div class="card-title">Single Order TCA &middot; Transaction Cost Analysis</div>
          <div class="card-sub">Generated ${esc(dateStr)}</div>
        </div>
        <div class="card-badge ${sideIsBuy ? "badge-buy" : "badge-sell"}">${esc(summary.symbol)}&nbsp;&nbsp;${esc(summary.side)}</div>
      </div>
      <table class="metrics-table">
        <tbody>
          ${metricRowsHtml}
          <tr class="timing-row">
            <td>
              <div class="metric-lbl">Order Start (UTC)</div>
              <div class="timing-val">${esc(fmtUtcStr(summary.orderTime))}</div>
            </td>
            <td>
              <div class="metric-lbl">Last Fill (UTC)</div>
              <div class="timing-val">${esc(fmtUtcStr(summary.lastFillTime))}</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>`;

  // ── Logo section (page 1 top) ──────────────────────────────────────────────

  const logoHtml = logoDataUrl ? `
    <div class="logo-wrap"><img src="${logoDataUrl}" alt="Company logo"></div>
    <hr class="logo-rule">` : "";

  // ── Charts (2×2 grid) ──────────────────────────────────────────────────────

  const chartItems = [
    [charts.twap,          "Cumulative TWAP"],
    [charts.vwap,          "Cumulative VWAP"],
    [charts.timeline,      "Execution Timeline"],
    [charts.participation, "Running Participation"],
  ] as [string | null, string][];

  const chartsGrid = `
    <div class="charts-grid">
      ${chartItems.map(([src, alt]) =>
        src
          ? `<img src="${src}" alt="${esc(alt)}">`
          : `<div class="chart-placeholder">${esc(alt)} unavailable</div>`
      ).join("\n      ")}
    </div>`;

  // ── Fill detail table ──────────────────────────────────────────────────────

  const fillRows = trades.map((t, i) => {
    const bg = i % 2 === 0 ? "" : "style=\"background:#f8fafc\"";
    return `<tr ${bg}>
      <td>${esc(t.orderId)}</td>
      <td>${esc(t.symbol)}</td>
      <td>${esc(t.side)}</td>
      <td class="num">${t.orderQty.toLocaleString()}</td>
      <td class="num">${esc(fmtPrice(t.avgFillPrice))}</td>
      <td class="num">${t.arrivalPrice !== null ? esc(fmtPrice(t.arrivalPrice)) : "&mdash;"}</td>
      <td>${esc(fmtUtcStr(t.orderTime))}</td>
      <td>${esc(fmtUtcStr(t.firstFillTime))}</td>
      <td>${esc(fmtUtcStr(t.lastFillTime))}</td>
      <td>${esc(t.algo ?? "&mdash;")}</td>
    </tr>`;
  }).join("\n");

  const fillsTable = `
    <table class="fills-table">
      <thead>
        <tr>
          <th>Order ID</th><th>Symbol</th><th>Side</th>
          <th>Qty</th><th>Fill Price</th><th>Arrival Price</th>
          <th>Order Time (UTC)</th><th>First Fill (UTC)</th><th>Last Fill (UTC)</th>
          <th>Algo</th>
        </tr>
      </thead>
      <tbody>${fillRows}</tbody>
    </table>`;

  // ── Disclaimer page ────────────────────────────────────────────────────────

  const disclaimerPage = disclaimerText.trim() ? `
  <div class="page">
    <hr class="disclaimer-rule">
    <p class="disclaimer-text">${esc(disclaimerText.trim())}</p>
  </div>` : "";

  // ── Assemble ───────────────────────────────────────────────────────────────

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <style>${CSS}</style>
</head>
<body>

  <!-- Sticky top bar (screen only) -->
  <div class="print-bar">
    <span class="print-bar-title">${esc(title)}</span>
    <button class="print-btn" onclick="window.print()">
      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/>
      </svg>
      Print / Save PDF
    </button>
    <span class="print-hint">In print dialog &rarr; paper: <strong>A4</strong>, orientation: <strong>Portrait</strong></span>
  </div>

  <!-- Page 1: Logo + Summary -->
  <div class="page">
    ${logoHtml}
    ${summaryCard}
  </div>

  <!-- Page 2: Charts -->
  <div class="page">
    <p class="section-label">${esc(summary.symbol)}&nbsp;&nbsp;${esc(summary.side)}&nbsp;&middot;&nbsp;Charts</p>
    ${chartsGrid}
  </div>

  <!-- Page 3+: Fill Detail -->
  <div class="page">
    <p class="section-label">${esc(summary.symbol)}&nbsp;&nbsp;${esc(summary.side)}&nbsp;&middot;&nbsp;Fill Detail</p>
    ${fillsTable}
  </div>

  ${disclaimerPage}

</body>
</html>`;
}

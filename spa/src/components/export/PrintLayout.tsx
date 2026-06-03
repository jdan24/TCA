/**
 * PrintLayout — full-screen view that replaces the single-order dashboard
 * when the user clicks "Print Layout".
 *
 * On screen: a sticky bar with Back / Print / Branding controls sits above
 * a scrollable preview of the report content.  Dashed "page break" dividers
 * show where Ctrl+P will split the output.
 *
 * On print (Ctrl+P): the sticky bar is hidden via `print:hidden` Tailwind,
 * `break-before-page` forces each section onto its own sheet, and an injected
 * @page rule sets A4 Portrait with 15 mm / 18 mm margins.
 *
 * Content: company logo (optional) → summary card → 4 charts → disclaimer (optional).
 */

import { useEffect, useRef, useState } from "react";
import type { ParentOrderSummary } from "@/types";
import { fmtBps, fmtTtf } from "@/components/dashboard/dashboardUtils";
import { useCorporateTemplate } from "@/hooks/useCorporateTemplate";
import type { ChartImages } from "@/components/export/ExportBar";

interface PrintLayoutProps {
  summary: ParentOrderSummary;
  charts:  ChartImages;
  onBack:  () => void;
}

// ── Local formatters ──────────────────────────────────────────────────────────

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

// ── Component ─────────────────────────────────────────────────────────────────

export function PrintLayout({ summary, charts, onBack }: PrintLayoutProps) {
  const { logoDataUrl, disclaimerText, setLogo, setDisclaimer } = useCorporateTemplate();
  const [showBranding, setShowBranding] = useState(false);
  const brandingRef  = useRef<HTMLDivElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Inject @page rule — Tailwind can't express this, so we add it to <head>.
  useEffect(() => {
    const style = document.createElement("style");
    style.id    = "print-layout-page";
    style.textContent = "@media print { @page { size: A4 portrait; margin: 15mm 18mm; } }";
    document.head.appendChild(style);
    return () => { document.getElementById("print-layout-page")?.remove(); };
  }, []);

  // Close branding popover on outside click.
  useEffect(() => {
    if (!showBranding) return;
    function handler(e: MouseEvent) {
      if (brandingRef.current && !brandingRef.current.contains(e.target as Node)) {
        setShowBranding(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showBranding]);

  function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => {
      const r = ev.target?.result;
      if (typeof r === "string") setLogo(r);
    };
    reader.readAsDataURL(file);
  }

  // ── Summary card data ───────────────────────────────────────────────────────

  const sideIsBuy = summary.side === "BUY";
  const isGood    = summary.IS_bps !== null && summary.IS_bps <= 0;
  const isBad     = summary.IS_bps !== null && summary.IS_bps >  0;
  const isColor   = isGood ? "text-green-600" : isBad ? "text-red-600" : "text-slate-900";
  const hasBranding = !!(logoDataUrl || disclaimerText.trim());

  const metrics: [string, string, string, string, string][] = [
    ["Total Qty",         summary.totalQty.toLocaleString(),   "Duration",            fmtTtf(summary.duration_ms),         ""],
    ["Order Avg. Price",  fmtPrice(summary.fillVwap),          "Arrival Price",       fmtPrice(summary.arrivalPrice),      ""],
    ["IS (bps)",          fmtBps(summary.IS_bps),              "Market VWAP (BBG)",   fmtPrice(summary.marketVwap),        isColor],
    ["Market TWAP (BBG)", fmtPrice(summary.marketTwap),        "Participation Rate",  fmtPct(summary.participationRate),   ""],
    ["1σ Vol (price)",    summary.vol_during_order_price?.toFixed(4) ?? "N/A",
                                                               "1σ Vol (bps)",        fmtBps(summary.vol_during_order_bps), ""],
  ];

  const chartList: [string | null, string][] = [
    [charts.twap,          "Cumulative TWAP"],
    [charts.vwap,          "Cumulative VWAP"],
    [charts.timeline,      "Execution Timeline"],
    [charts.participation, "Running Participation"],
  ];

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-white dark:bg-white">

      {/* ── Screen-only sticky bar ─────────────────────────────────────────── */}
      <div className="print:hidden sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center gap-3 px-6 py-2.5">

          {/* Back button */}
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back
          </button>

          <div className="w-px h-5 bg-gray-200 shrink-0" />

          <span className="text-sm font-semibold text-gray-700">
            Print Layout — {summary.symbol} {summary.side}
          </span>

          <div className="flex-1" />

          {/* Branding gear */}
          <div ref={brandingRef} className="relative">
            <button
              type="button"
              onClick={() => setShowBranding((v) => !v)}
              className={`relative flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                showBranding
                  ? "border-blue-400 bg-blue-50 text-blue-600"
                  : "border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100"
              }`}
              title="Configure corporate branding"
            >
              <GearIcon />
              Branding
              {hasBranding && !showBranding && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-blue-500 border border-white" />
              )}
            </button>

            {showBranding && (
              <div className="absolute right-0 top-9 z-30 w-80 bg-white rounded-xl shadow-xl border border-gray-200 p-4">
                <p className="text-xs font-semibold text-gray-700 mb-3">Corporate Branding</p>

                {/* Logo */}
                <div className="mb-3">
                  <p className="text-xs text-gray-500 mb-1.5">Logo</p>
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
                        alt="Logo preview"
                        className="h-8 w-auto max-w-[140px] object-contain rounded border border-gray-200 bg-white p-0.5"
                      />
                      <button
                        type="button"
                        onClick={() => setLogo(null)}
                        className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      className="text-xs px-3 py-1.5 rounded-lg border border-dashed border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-600 transition-colors w-full text-left"
                    >
                      Upload PNG / JPG / SVG…
                    </button>
                  )}
                </div>

                {/* Disclaimer */}
                <div>
                  <p className="text-xs text-gray-500 mb-1.5">
                    Disclaimer <span className="text-gray-400">(own last page)</span>
                  </p>
                  <textarea
                    value={disclaimerText}
                    onChange={(e) => setDisclaimer(e.target.value)}
                    placeholder="Paste disclaimer text here…"
                    rows={4}
                    className="w-full text-xs rounded-lg border border-gray-300 bg-white text-gray-900 px-2.5 py-1.5 resize-y focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-gray-400"
                  />
                </div>
                <p className="text-xs text-gray-400 mt-2">Saved automatically to this browser.</p>
              </div>
            )}
          </div>

          {/* Print button */}
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
          >
            <PrinterIcon />
            Print / Save PDF
          </button>

          <span className="text-xs text-gray-400 hidden xl:block">
            In print dialog → paper: <strong>A4</strong>, orientation: <strong>Portrait</strong>
          </span>
        </div>
      </div>

      {/* ── Report content ─────────────────────────────────────────────────── */}
      {/*
          On screen: centred, max 760 px, generous padding.
          On print:  remove max-width / padding — @page margins take over.
      */}
      <div className="max-w-[760px] mx-auto px-10 py-8 print:max-w-none print:mx-0 print:px-0 print:py-0">

        {/* ── PAGE 1: Logo + Summary card ──────────────────────────────────── */}
        <section>
          {logoDataUrl && (
            <>
              <div className="mb-3 text-center">
                <img
                  src={logoDataUrl}
                  alt="Company logo"
                  className="max-h-16 max-w-full inline-block"
                />
              </div>
              <hr className="mb-5 border-slate-200" />
            </>
          )}

          {/* Summary card — mirrors the TCA dashboard visual style */}
          <div className="rounded-lg overflow-hidden border border-slate-200 shadow-sm">

            {/* Blue header band */}
            <div className="bg-blue-700 px-4 py-3 flex justify-between items-start">
              <div>
                <div className="text-white font-bold text-base leading-snug">
                  Single Order TCA &nbsp;&middot;&nbsp; Transaction Cost Analysis
                </div>
                <div className="text-blue-300 text-xs mt-0.5">
                  Generated {new Date().toLocaleString()}
                </div>
              </div>
              <div className={`ml-4 flex-shrink-0 px-3 py-1 rounded font-bold text-sm ${
                sideIsBuy ? "bg-blue-100 text-blue-800" : "bg-red-100 text-red-700"
              }`}>
                {summary.symbol}&nbsp;&nbsp;{summary.side}
              </div>
            </div>

            {/* Metrics grid */}
            <table className="w-full border-collapse">
              <tbody>
                {metrics.map(([l1, v1, l2, v2, cls], i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-slate-50" : "bg-white"}>
                    <td className="px-4 py-2.5 w-1/2 border-r border-slate-200 align-top">
                      <div className="text-[10px] text-slate-500 mb-0.5">{l1}</div>
                      <div className={`font-bold text-sm ${cls || "text-slate-900"}`}>{v1}</div>
                    </td>
                    <td className="px-4 py-2.5 w-1/2 align-top">
                      <div className="text-[10px] text-slate-500 mb-0.5">{l2}</div>
                      <div className="font-bold text-sm text-slate-900">{v2}</div>
                    </td>
                  </tr>
                ))}

                {/* Timing footer row */}
                <tr className="bg-slate-100">
                  <td className="px-4 py-2.5 border-r border-slate-200 align-top">
                    <div className="text-[10px] text-slate-500 mb-0.5">Order Start (UTC)</div>
                    <div className="font-bold text-sm text-slate-900">{fmtUtcStr(summary.orderTime)}</div>
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <div className="text-[10px] text-slate-500 mb-0.5">Last Fill (UTC)</div>
                    <div className="font-bold text-sm text-slate-900">{fmtUtcStr(summary.lastFillTime)}</div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Page-break indicator (screen only) + PAGE 2: Charts ──────────── */}
        <div className="print:hidden my-8 flex items-center gap-3 text-xs text-slate-400 select-none">
          <div className="flex-1 border-t border-dashed border-slate-300" />
          <span>page break</span>
          <div className="flex-1 border-t border-dashed border-slate-300" />
        </div>

        <section className="break-before-page">
          <p className="text-xs text-slate-500 mb-3">
            {summary.symbol}&nbsp;&nbsp;{summary.side}&nbsp;&middot;&nbsp;Charts
          </p>
          <div className="grid grid-cols-2 gap-4">
            {chartList.map(([src, alt], i) =>
              src ? (
                <img key={i} src={src} alt={alt} className="w-full h-auto rounded" />
              ) : (
                <div
                  key={i}
                  className="aspect-[2/1] bg-slate-100 rounded flex items-center justify-center text-xs text-slate-400"
                >
                  {alt} unavailable
                </div>
              )
            )}
          </div>
        </section>

        {/* ── Page-break indicator + Disclaimer (if set) ────────────────────── */}
        {disclaimerText.trim() && (
          <>
            <div className="print:hidden my-8 flex items-center gap-3 text-xs text-slate-400 select-none">
              <div className="flex-1 border-t border-dashed border-slate-300" />
              <span>page break</span>
              <div className="flex-1 border-t border-dashed border-slate-300" />
            </div>

            <section className="break-before-page">
              <hr className="border-slate-200 mb-5" />
              <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">
                {disclaimerText.trim()}
              </p>
            </section>
          </>
        )}

        {/* Bottom padding so last section isn't flush against browser chrome */}
        <div className="print:hidden h-16" />
      </div>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function PrinterIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

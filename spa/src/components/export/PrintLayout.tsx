/**
 * PrintLayout — full-screen view that replaces the single-order dashboard
 * when the user clicks "Print Layout".
 *
 * On screen: sticky bar with Back / Branding / Print controls; scrollable
 * content showing the same components as the live dashboard (ParentSummaryCard
 * + captured chart images), with optional corporate logo and disclaimer.
 * Dashed dividers indicate where Ctrl+P will split pages.
 *
 * On print (Ctrl+P): sticky bar is hidden via print:hidden, break-before-page
 * creates page breaks, and an injected @page rule sets A4 Portrait with
 * 15 mm / 18 mm margins.
 */

import { useEffect, useRef, useState } from "react";
import type { ParentOrderSummary } from "@/types";
import { useCorporateTemplate } from "@/hooks/useCorporateTemplate";
import { ParentSummaryCard } from "@/components/dashboard/single/ParentSummaryCard";
import type { ChartImages } from "@/components/export/ExportBar";

interface PrintLayoutProps {
  summary:         ParentOrderSummary;
  charts:          ChartImages;
  onBack:          () => void;
  resolveSymbol?:  (ric: string) => string;
}

export function PrintLayout({ summary, charts, onBack, resolveSymbol }: PrintLayoutProps) {
  const { logoDataUrl, disclaimerText, reportTitle, setLogo, setDisclaimer, setTitle } = useCorporateTemplate();
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

  const hasBranding = !!(logoDataUrl || disclaimerText.trim() || reportTitle.trim());

  const page1Charts: [string | null, string][] = [
    [charts.twap,  "Cumulative TWAP"],
    [charts.vwap,  "Cumulative VWAP"],
  ];
  const page2Charts: [string | null, string][] = [
    [charts.timeline,      "Execution Timeline"],
    [charts.participation, "Running Participation"],
  ];
  const vwapProfile = charts.vwapProfile ?? null;

  function ChartCell({ src, alt }: { src: string | null; alt: string }) {
    return src ? (
      <img
        src={src}
        alt={alt}
        className="w-full h-auto print:h-full print:w-full print:object-contain"
      />
    ) : (
      <div className="w-full h-52 print:h-full bg-gray-50 flex items-center justify-center text-xs text-gray-400">
        {alt} unavailable
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">

      {/* ── Screen-only sticky bar ────────────────────────────────────────── */}
      <div className="print:hidden sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center gap-3 px-6 py-2.5">

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

                <div className="mb-3">
                  <p className="text-xs text-gray-500 mb-1.5">Report Title</p>
                  <input
                    type="text"
                    value={reportTitle}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Wells Fargo Futures TCA Report"
                    className="w-full text-xs rounded-lg border border-gray-300 bg-white text-gray-900 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-gray-400"
                  />
                </div>

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

          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
          >
            <PrinterIcon />
            Print / Save PDF
          </button>

          <span className="text-xs text-gray-400 hidden xl:block">
            paper: <strong>A4</strong> · orientation: <strong>Portrait</strong>
          </span>
        </div>
      </div>

      {/* ── Report content ────────────────────────────────────────────────── */}
      <div className="max-w-4xl mx-auto px-6 py-6 print:max-w-none print:mx-0 print:px-0 print:py-0">

        {/*
          PAGE 1: Logo → Summary (3-col) → TWAP + VWAP charts
          On print: flex column filling exactly one A4 page.
            - Logo + rule + summary card: shrink-0 (take natural height)
            - Charts row: flex-1, min-h-0 so it fills remaining vertical space
        */}
        <section className="print:h-screen print:flex print:flex-col print:overflow-hidden">

          {/* ── Branding logo — full width, first element on print ───────── */}
          {logoDataUrl && (
            <div className="mb-2 print:mb-2 print:shrink-0">
              <img
                src={logoDataUrl}
                alt="Company logo"
                className="w-full object-contain max-h-20"
              />
            </div>
          )}

          {/* ── Report title — below logo, above separator ────────────────── */}
          {reportTitle.trim() && (
            <p className="text-base font-semibold text-gray-800 mb-3 print:mb-2 print:shrink-0">
              {reportTitle.trim()}
            </p>
          )}

          <hr className="mb-4 border-gray-200 print:mb-3 print:shrink-0" />

          {/* ── Parent Order Summary (3-column, same as live dashboard) ─── */}
          <div className="print:shrink-0">
            <ParentSummaryCard
              summary={summary}
              highlightedBenchmark={null}
              onOrderTimeChange={() => {}}
              onLastFillTimeChange={() => {}}
              {...(resolveSymbol ? { resolveSymbol } : {})}
            />
          </div>

          {/* ── TWAP then VWAP — stacked, inside a card matching the summary ─ */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mt-4 flex flex-col gap-4 print:mt-3 print:gap-3 print:flex-1 print:min-h-0">
            {page1Charts.map(([src, alt], i) => (
              <div key={i} className="print:flex-1 print:min-h-0">
                <ChartCell src={src} alt={alt} />
              </div>
            ))}
          </div>
        </section>

        {/* ── Page break indicator (screen only) ───────────────────────────── */}
        <div className="print:hidden my-8 flex items-center gap-3 text-xs text-gray-400 select-none">
          <div className="flex-1 border-t border-dashed border-gray-300" />
          <span>page break</span>
          <div className="flex-1 border-t border-dashed border-gray-300" />
        </div>

        {/*
          PAGE 2: Execution Timeline + Running Participation (+ VWAP profile)
          On print: flex column filling exactly one A4 page.
            - Timeline + Participation 2-col grid: flex-1 (fills page) unless VWAP profile present
            - VWAP profile (if present): ~40% height below the grid
        */}
        <section className="break-before-page print:h-screen print:flex print:flex-col print:overflow-hidden">
          <p className="text-xs text-gray-400 mb-3 print:mb-2 print:shrink-0">
            {summary.symbol}&nbsp;&nbsp;{summary.side}&nbsp;&middot;&nbsp;Execution Detail
          </p>

          <div className={[
            "bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5",
            "flex flex-col gap-4 print:gap-3",
            vwapProfile
              ? "print:h-[57%] print:shrink-0"
              : "print:flex-1 print:min-h-0",
          ].join(" ")}>
            {page2Charts.map(([src, alt], i) => (
              <div key={i} className="print:flex-1 print:min-h-0">
                <ChartCell src={src} alt={alt} />
              </div>
            ))}
          </div>

          {vwapProfile && (
            <img
              src={vwapProfile}
              alt="VWAP Volume Profile"
              className="w-full h-auto mt-4 print:mt-2 print:flex-1 print:min-h-0 print:object-contain rounded border border-gray-100"
            />
          )}
        </section>

        {/* ── Disclaimer (if set) ───────────────────────────────────────────── */}
        {disclaimerText.trim() && (
          <>
            <div className="print:hidden my-8 flex items-center gap-3 text-xs text-gray-400 select-none">
              <div className="flex-1 border-t border-dashed border-gray-300" />
              <span>page break</span>
              <div className="flex-1 border-t border-dashed border-gray-300" />
            </div>

            <section className="break-before-page">
              <hr className="border-gray-200 mb-5" />
              <p className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">
                {disclaimerText.trim()}
              </p>
            </section>
          </>
        )}

        <div className="print:hidden h-16" />
      </div>
    </div>
  );
}

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

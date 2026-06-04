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
  summary:              ParentOrderSummary;
  charts:               ChartImages;
  onBack:               () => void;
  resolveSymbol?:       (ric: string) => string;
  /** Mirror of the live dashboard's algo selection — highlights the matching benchmark card. */
  highlightedBenchmark?: "arrival" | "vwap" | "twap" | null;
  /** Manual Order ID override carried from the live dashboard into the print view. */
  brokerOrderId?: string | null | undefined;
}

export function PrintLayout({ summary, charts, onBack, resolveSymbol, highlightedBenchmark = null, brokerOrderId }: PrintLayoutProps) {
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

  // Set document.title to the Order ID while the print layout is active.
  // The browser uses document.title as the PDF filename and Acrobat tab name.
  // Falls back to "symbol SIDE" when no Order ID is set.
  useEffect(() => {
    const effectiveOrderId = brokerOrderId ?? summary.brokerOrderId ?? null;
    const title = effectiveOrderId
      ? effectiveOrderId
      : `${summary.symbol} ${summary.side}`;
    const previous = document.title;
    document.title = title;
    return () => { document.title = previous; };
  }, [brokerOrderId, summary.brokerOrderId, summary.symbol, summary.side]);

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
        className="w-full h-auto"
      />
    ) : (
      <div className="w-full h-52 bg-gray-50 flex items-center justify-center text-xs text-gray-400">
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
                    Disclaimer <span className="text-gray-400">(follows content, can span pages)</span>
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
          PAGE 1: Logo → Title → Summary (3-col) → TWAP + VWAP charts
          On print: natural flow — browser places page breaks between blocks.
          break-inside-avoid on every card prevents a card from being
          split mid-render; the browser moves the whole card to the next
          page instead of clipping it at the paper edge.
        */}
        <section>

          {/* ── Branding logo — full width, first element on print ───────── */}
          {logoDataUrl && (
            <div className="mb-2 print:mb-2">
              <img
                src={logoDataUrl}
                alt="Company logo"
                className="w-full object-contain object-left max-h-20"
              />
            </div>
          )}

          {/* ── Report title — below logo, above separator ────────────────── */}
          {reportTitle.trim() && (
            <p className="text-[30px] font-semibold text-gray-800 mb-3 print:mb-2">
              {reportTitle.trim()}
            </p>
          )}

          <hr className="mb-4 border-gray-200 print:mb-3" />

          {/* ── Parent Order Summary (3-column) — never split across pages ── */}
          <div className="break-inside-avoid">
            <ParentSummaryCard
              summary={summary}
              highlightedBenchmark={highlightedBenchmark}
              brokerOrderId={brokerOrderId}
              onOrderTimeChange={() => {}}
              onLastFillTimeChange={() => {}}
              {...(resolveSymbol ? { resolveSymbol } : {})}
            />
          </div>

          {/* ── TWAP then VWAP — each chart in its own avoid-break wrapper ─ */}
          <div className="mt-4 print:mt-3 flex flex-col gap-4 print:gap-3">
            {page1Charts.map(([src, alt], i) => (
              <div key={i} className="break-inside-avoid bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
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
          break-before-page forces a new page here regardless of where
          the page 1 content ended.  Each chart card has break-inside-avoid
          so it is never split at the paper edge.
        */}
        <section className="break-before-page">
          <p className="text-xs text-gray-400 mb-3 print:mb-2">
            {summary.symbol}&nbsp;&nbsp;{summary.side}&nbsp;&middot;&nbsp;Execution Detail
          </p>

          <div className="flex flex-col gap-4 print:gap-3">
            {page2Charts.map(([src, alt], i) => (
              <div key={i} className="break-inside-avoid bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                <ChartCell src={src} alt={alt} />
              </div>
            ))}
          </div>

          {vwapProfile && (
            <div className="break-inside-avoid mt-4 print:mt-2">
              <img
                src={vwapProfile}
                alt="VWAP Volume Profile"
                className="w-full h-auto"
              />
            </div>
          )}
        </section>

        {/* ── Notes / Methodology ─────────────────────────────────────────────
             Static descriptions (no formulas) for the reader's reference.
             Matches the formatting of the on-screen Methodology modal.
        */}
        <section className="break-before-page">
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-4">Methodology Notes</h2>

            {/* ── Execution Benchmarks ─────────────────────────────────────── */}
            <div className="mb-6">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-3 pb-1 border-b border-gray-100">
                Execution Benchmarks
              </h3>
              <div className="space-y-3">

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <p className="text-sm font-semibold text-gray-900 mb-1.5">Arrival Price</p>
                  <p className="text-xs text-gray-600 leading-relaxed">The mid-price of the security at Order Start time, derived from the best bid and ask at the moment the order was submitted. This is the theoretical "zero-impact" price — what you could have traded at before any execution activity. Used as the reference for Implementation Shortfall.</p>
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <p className="text-sm font-semibold text-gray-900">Implementation Shortfall (IS)</p>
                    <NotesPill type="gray">bps</NotesPill>
                  </div>
                  <div className="flex gap-3 mb-1.5 text-xs">
                    <span className="text-gray-500">Favorable:</span><NotesPill type="green">negative</NotesPill>
                    <span className="text-gray-500 ml-2">Adverse:</span><NotesPill type="red">positive</NotesPill>
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed">Measures the total execution cost relative to the decision price. A BUY that fills above arrival, or a SELL that fills below arrival, incurs a positive (adverse) IS. Negative IS means the order filled better than the arrival price. Reported at the parent order level using the qty-weighted average fill price.</p>
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <p className="text-sm font-semibold text-gray-900">VWAP Deviation</p>
                    <NotesPill type="gray">bps</NotesPill>
                  </div>
                  <div className="flex gap-3 mb-1.5 text-xs">
                    <span className="text-gray-500">Favorable:</span><NotesPill type="green">negative</NotesPill>
                    <span className="text-gray-500 ml-2">Adverse:</span><NotesPill type="red">positive</NotesPill>
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed">Compares the average fill price to the market's volume-weighted average price over the execution window, computed from actual exchange prints. Negative is favorable — you filled below market VWAP on a buy or above it on a sell. The primary benchmark for VWAP-algo orders.</p>
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <p className="text-sm font-semibold text-gray-900">TWAP Deviation</p>
                    <NotesPill type="gray">bps</NotesPill>
                  </div>
                  <div className="flex gap-3 mb-1.5 text-xs">
                    <span className="text-gray-500">Favorable:</span><NotesPill type="green">negative</NotesPill>
                    <span className="text-gray-500 ml-2">Adverse:</span><NotesPill type="red">positive</NotesPill>
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed">Compares the average fill price to the market's time-weighted average price, where each market print is weighted by how long it prevailed rather than by volume. Negative is favorable. The primary benchmark for TWAP-algo orders. Because price is weighted by hold duration, a 30-second quiet period weighs more than a burst of prints at the same price level.</p>
                </div>
              </div>
            </div>

            {/* ── Market Context ───────────────────────────────────────────── */}
            <div className="mb-6">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-3 pb-1 border-b border-gray-100">
                Market Context
              </h3>
              <div className="space-y-3">

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <p className="text-sm font-semibold text-gray-900">Market Impact</p>
                    <NotesPill type="gray">bps · Almgren/Chriss model</NotesPill>
                  </div>
                  <div className="flex gap-3 mb-1.5 text-xs">
                    <span className="text-gray-500">Always:</span><NotesPill type="red">positive (cost)</NotesPill>
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed">An estimate of the price impact caused by the order itself, scaled by daily volatility and the order's share of average daily volume. Larger orders in more volatile, less liquid names produce higher estimated impact. This is always a cost — it represents what you paid to move the market against yourself.</p>
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <p className="text-sm font-semibold text-gray-900">1σ Volatility</p>
                    <NotesPill type="gray">price &amp; bps</NotesPill>
                  </div>
                  <div className="flex gap-3 mb-1.5 text-xs">
                    <NotesPill type="gray">context only</NotesPill>
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed">The one-standard-deviation price range of the market during the execution window. High volatility during a low-IS order indicates strong execution quality in a turbulent environment. It is a contextual measure of market conditions, not a direct cost metric.</p>
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <p className="text-sm font-semibold text-gray-900">TWAS — Time-Weighted Average Spread</p>
                    <NotesPill type="gray">bps</NotesPill>
                  </div>
                  <div className="flex gap-3 mb-1.5 text-xs">
                    <NotesPill type="gray">context only</NotesPill>
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed">The average bid/ask spread during the order window, weighted by the time each quote was valid. A liquidity environment proxy: wider spreads indicate a less liquid market. Comparing TWAS to IS helps distinguish execution skill from market conditions — high IS in a wide-spread environment is less alarming than the same IS when spreads are tight.</p>
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <p className="text-sm font-semibold text-gray-900">Trend Cost</p>
                    <NotesPill type="gray">bps · IS decomposition</NotesPill>
                  </div>
                  <div className="flex gap-3 mb-1.5 text-xs">
                    <span className="text-gray-500">Favorable:</span><NotesPill type="green">negative</NotesPill>
                    <span className="text-gray-500 ml-2">Adverse:</span><NotesPill type="red">positive</NotesPill>
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed">The residual portion of IS after removing the two explainable components: estimated market impact and half the time-weighted spread. What remains is attributed to adverse market drift — the market moving against you during execution for reasons unrelated to your order. Negative means the market drifted in your favour; positive means it continued away from arrival.</p>
                </div>
              </div>
            </div>

            {/* ── Post-Trade Price Reversion ───────────────────────────────── */}
            <div className="mb-6">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-3 pb-1 border-b border-gray-100">
                Post-Trade Price Reversion
              </h3>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <p className="text-sm font-semibold text-gray-900">Reversion +30 s / +1 m</p>
                  <NotesPill type="gray">bps</NotesPill>
                </div>
                <div className="flex gap-3 mb-1.5 text-xs flex-wrap">
                  <span className="text-gray-500">Favorable:</span><NotesPill type="green">positive (price reverts)</NotesPill>
                  <span className="text-gray-500 ml-2">Adverse:</span><NotesPill type="red">negative (price persists)</NotesPill>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed mb-1.5">Measures whether the price movement caused by the order was temporary or permanent. A BUY that filled high but saw the price fall back within 30 seconds or 1 minute registers positive (favorable) reversion — the market impact was transient. Consistently negative reversion (price continuing away after completion) may indicate permanent market impact or information leakage.</p>
                <p className="text-xs text-gray-600 leading-relaxed">On the Parent Order Summary, reversion is measured relative to the selected algo's primary benchmark — answering: "did the market return to the benchmark level after the order completed?" The benchmark follows the algo selected in the Execution Algo dropdown.</p>
              </div>
            </div>

            {/* ── Sign Convention Summary ──────────────────────────────────── */}
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-3 pb-1 border-b border-gray-100">
                Sign Convention Summary
              </h3>
              <div className="rounded-lg border border-gray-200 overflow-hidden text-xs">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-100 text-gray-500 text-left">
                      <th className="px-3 py-2 font-medium">Metric</th>
                      <th className="px-3 py-2 font-medium">Favorable</th>
                      <th className="px-3 py-2 font-medium">Adverse</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-gray-700">
                    {([
                      ["IS (bps)",                   "green", "negative",               "red",  "positive"],
                      ["VWAP Deviation (bps)",        "green", "negative",               "red",  "positive"],
                      ["TWAP Deviation (bps)",        "green", "negative",               "red",  "positive"],
                      ["Market Impact (bps)",         "gray",  "— (always a cost)",      "red",  "positive"],
                      ["Trend Cost (bps)",            "green", "negative",               "red",  "positive"],
                      ["Reversion +30s / +1m (bps)", "green", "positive (reverts)",     "red",  "negative (persists)"],
                      ["TWAS (bps)",                 "gray",  "context only",            "gray", "context only"],
                      ["Volatility",                 "gray",  "context only",            "gray", "context only"],
                      ["Participation Rate",         "gray",  "context only",            "gray", "context only"],
                    ] as const).map(([metric, favType, fav, advType, adv]) => (
                      <tr key={metric}>
                        <td className="px-3 py-2 font-mono text-[11px]">{metric}</td>
                        <td className="px-3 py-2"><NotesPill type={favType}>{fav}</NotesPill></td>
                        <td className="px-3 py-2"><NotesPill type={advType}>{adv}</NotesPill></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* ── Disclaimer (if set) ───────────────────────────────────────────── */}
        {disclaimerText.trim() && (
          <div className="mt-8 print:mt-6">
            <hr className="border-gray-200 mb-5" />
            <p className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">
              {disclaimerText.trim()}
            </p>
          </div>
        )}

        <div className="print:hidden h-16" />
      </div>
    </div>
  );
}

function NotesPill({ children, type }: { children: React.ReactNode; type: "green" | "red" | "gray" }) {
  const cls =
    type === "green" ? "bg-emerald-100 text-emerald-700"
    : type === "red" ? "bg-red-100 text-red-600"
    : "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${cls}`}>
      {children}
    </span>
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

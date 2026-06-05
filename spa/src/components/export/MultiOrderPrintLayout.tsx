/**
 * MultiOrderPrintLayout — modular print/PDF view for multi-order TCA.
 *
 * Up to 10 sections are independently toggleable via the Sections popover in
 * the sticky toolbar.  The layout renders cleanly via browser Ctrl+P (injected
 * @page rule, A4 portrait, 15 mm / 18 mm margins), following the same approach
 * as the single-order PrintLayout.
 *
 * Charts are passed in as captured PNG data-URLs (html-to-image) so they
 * always print crisply.  Aggregation and order-detail tables are rendered as
 * static HTML — no store interactions, no dark-mode classes.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { AggregationSet, AggregateRow, TCAResult, TradeRecord } from "@/types";
import { useCorporateTemplate } from "@/hooks/useCorporateTemplate";
import { fmtBps, fmtTtf, safeAvg } from "@/components/dashboard/dashboardUtils";

// ── Section type & constants ──────────────────────────────────────────────────

export type SectionId =
  | "kpi"
  | "slippage"
  | "vwap_dev"
  | "reversion"
  | "spread"
  | "by_symbol"
  | "by_algo"
  | "by_symbol_algo"
  | "by_symbol_side"
  | "order_table";

export const ALL_SECTIONS: SectionId[] = [
  "kpi",
  "slippage", "vwap_dev", "reversion", "spread",
  "by_symbol", "by_algo", "by_symbol_algo", "by_symbol_side",
  "order_table",
];

interface SectionItem  { id: SectionId; label: string; }
interface SectionGroup { heading: string | null; items: SectionItem[]; }

const SECTION_GROUPS: SectionGroup[] = [
  {
    heading: null,
    items: [{ id: "kpi", label: "KPI Summary" }],
  },
  {
    heading: "Charts",
    items: [
      { id: "slippage",  label: "IS vs Order Size" },
      { id: "vwap_dev",  label: "VWAP Deviation"   },
      { id: "reversion", label: "Price Reversion"   },
      { id: "spread",    label: "Spread vs IS"      },
    ],
  },
  {
    heading: "Aggregation Tables",
    items: [
      { id: "by_symbol",      label: "By Symbol"        },
      { id: "by_algo",        label: "By Algo"           },
      { id: "by_symbol_algo", label: "By Symbol + Algo"  },
      { id: "by_symbol_side", label: "By Symbol + Side"  },
    ],
  },
  {
    heading: "Detail",
    items: [{ id: "order_table", label: "Order Detail Table" }],
  },
];

// ── Exported types (imported by Dashboard.tsx) ────────────────────────────────

export interface MOChartImages {
  slippage:  string | null;
  vwapDev:   string | null;
  reversion: string | null;
  spread:    string | null;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface MultiOrderPrintLayoutProps {
  trades:       TradeRecord[];
  results:      TCAResult[];
  aggregations: AggregationSet;
  charts:       MOChartImages;
  onBack:       () => void;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function fmtUtc(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Colour-coded bps cell for static print tables. */
function BpsPrint({
  v, neutral = false, invert = false,
}: { v: number | null; neutral?: boolean; invert?: boolean }) {
  if (v === null) return <span className="text-gray-400">—</span>;
  const txt = fmtBps(v);
  if (neutral) return <span className="text-gray-700">{txt}</span>;
  const favorable = invert ? v > 0 : v <= 0;
  return <span className={favorable ? "text-emerald-600" : "text-red-500"}>{txt}</span>;
}

/** Single KPI tile for the print summary row. */
function PrintKpiTile({
  label, value, sub, sentiment = "neutral",
}: { label: string; value: string; sub: string; sentiment?: "good" | "bad" | "neutral" }) {
  const valueColor =
    sentiment === "good" ? "text-emerald-600"
    : sentiment === "bad" ? "text-red-500"
    : "text-gray-900";
  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-500 mb-1">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${valueColor}`}>{value}</p>
      <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>
    </div>
  );
}

/** Static print-friendly aggregation table — no click handlers, no dark-mode classes. */
function PrintAggTable({ title, rows }: { title: string; rows: AggregateRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="break-inside-avoid mb-5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-1.5">{title}</p>
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-left">
              {(["Group","# Orders","Total Qty","Avg IS","Avg VWAP Dev","Avg MI","Avg TWAS","Avg TTF","Win %"] as const).map((h, i) => (
                <th key={h} className={`px-2 py-1.5 font-semibold ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-700">
            {rows.map((row, i) => (
              <tr key={row.groupKey} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
                <td className="px-2 py-1.5 font-medium">{row.groupKey}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{row.count}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{row.totalQty.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right tabular-nums"><BpsPrint v={row.avgIS_bps} /></td>
                <td className="px-2 py-1.5 text-right tabular-nums"><BpsPrint v={row.avgVWAP_dev_bps} /></td>
                <td className="px-2 py-1.5 text-right tabular-nums"><BpsPrint v={row.avgMI_bps} neutral /></td>
                <td className="px-2 py-1.5 text-right tabular-nums"><BpsPrint v={row.avgTWAS_bps} neutral /></td>
                <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">{fmtTtf(row.avgTTF_ms)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {row.winRate !== null ? `${Math.round(row.winRate * 100)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MultiOrderPrintLayout({
  trades, results, aggregations, charts, onBack,
}: MultiOrderPrintLayoutProps) {
  const {
    logoDataUrl, disclaimerText, reportTitle,
    setLogo, setDisclaimer, setTitle,
  } = useCorporateTemplate();

  const [visibleSections, setVisibleSections] = useState<Set<SectionId>>(
    () => new Set<SectionId>(ALL_SECTIONS),
  );
  const [showSections, setShowSections] = useState(false);
  const [showBranding, setShowBranding] = useState(false);

  const sectionsRef  = useRef<HTMLDivElement>(null);
  const brandingRef  = useRef<HTMLDivElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // ── @page CSS injection ───────────────────────────────────────────────────
  useEffect(() => {
    const style = document.createElement("style");
    style.id    = "mo-print-layout-page";
    style.textContent = "@media print { @page { size: A4 portrait; margin: 15mm 18mm; } }";
    document.head.appendChild(style);
    return () => { document.getElementById("mo-print-layout-page")?.remove(); };
  }, []);

  // ── Close popovers on outside click ──────────────────────────────────────
  useEffect(() => {
    if (!showSections) return;
    const h = (e: MouseEvent) => {
      if (sectionsRef.current && !sectionsRef.current.contains(e.target as Node))
        setShowSections(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showSections]);

  useEffect(() => {
    if (!showBranding) return;
    const h = (e: MouseEvent) => {
      if (brandingRef.current && !brandingRef.current.contains(e.target as Node))
        setShowBranding(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showBranding]);

  // ── Logo file handler ─────────────────────────────────────────────────────
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

  // ── Section helpers ───────────────────────────────────────────────────────
  const vis = (id: SectionId) => visibleSections.has(id);
  const toggle = (id: SectionId) => {
    setVisibleSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ── KPI data ──────────────────────────────────────────────────────────────
  const n          = results.length;
  const isVals     = results.map((r) => r.IS_bps);
  const vwapVals   = results.map((r) => r.VWAP_dev_bps);
  const twasVals   = results.map((r) => r.TWAS_bps);
  const avgIS      = safeAvg(isVals);
  const avgVwap    = safeAvg(vwapVals);
  const avgTwas    = safeAvg(twasVals);
  const avgTtf     = safeAvg(results.map((r) => r.timeToFill_ms));
  const isCount    = isVals.filter((v) => v !== null).length;
  const vwapCount  = vwapVals.filter((v) => v !== null).length;
  const twasCount  = twasVals.filter((v) => v !== null).length;
  const uniqueOrds = new Set(results.map((r) => r.orderId)).size;
  const totalQty   = trades.reduce((s, t) => s + t.orderQty, 0);

  function kpiSub(count: number) {
    return count === n
      ? `${n} order${n !== 1 ? "s" : ""}`
      : `${count} of ${n} orders`;
  }
  function bpsSentiment(v: number | null): "good" | "bad" | "neutral" {
    if (v === null) return "neutral";
    return v <= 0 ? "good" : "bad";
  }

  // ── Chart defs ────────────────────────────────────────────────────────────
  const CHART_DEFS = [
    { id: "slippage"  as SectionId, label: "IS vs Order Size", src: charts.slippage  },
    { id: "vwap_dev"  as SectionId, label: "VWAP Deviation",   src: charts.vwapDev   },
    { id: "reversion" as SectionId, label: "Price Reversion",  src: charts.reversion },
    { id: "spread"    as SectionId, label: "Spread vs IS",     src: charts.spread    },
  ];
  const enabledCharts = CHART_DEFS.filter((c) => vis(c.id));

  // ── Aggregation table defs ────────────────────────────────────────────────
  const AGG_DEFS = [
    { id: "by_symbol"      as SectionId, label: "By Symbol",        rows: aggregations.bySymbol      },
    { id: "by_algo"        as SectionId, label: "By Algo",          rows: aggregations.byAlgo        },
    { id: "by_symbol_algo" as SectionId, label: "By Symbol + Algo", rows: aggregations.bySymbolAlgo  },
    { id: "by_symbol_side" as SectionId, label: "By Symbol + Side", rows: aggregations.bySymbolSide  },
  ];
  const enabledAggs = AGG_DEFS.filter((a) => vis(a.id) && a.rows.length > 0);

  const hasAnyChart = enabledCharts.length > 0;
  const hasAnyAgg   = enabledAggs.length > 0;

  // ── Order detail rows (sorted by order time desc) ─────────────────────────
  const resultMap = useMemo(
    () => new Map(results.map((r) => [r.orderId, r])),
    [results],
  );
  const sortedTrades = useMemo(
    () => [...trades].sort((a, b) => b.orderTime.getTime() - a.orderTime.getTime()),
    [trades],
  );

  // ── Build ordered content groups ──────────────────────────────────────────
  // Each group is { key, node }.  The first gets no break; subsequent groups
  // get break-before-page.

  const contentGroups: { key: string; node: React.ReactNode }[] = [];

  // — KPI Summary ————————————————————————————————————————————————————————————
  if (vis("kpi")) {
    contentGroups.push({
      key: "kpi",
      node: (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-3">
            KPI Summary
          </p>
          <div className="grid grid-cols-3 gap-3">
            <PrintKpiTile
              label="Avg IS"
              value={fmtBps(avgIS)}
              sub={kpiSub(isCount)}
              sentiment={bpsSentiment(avgIS)}
            />
            <PrintKpiTile
              label="Avg VWAP Dev"
              value={fmtBps(avgVwap)}
              sub={kpiSub(vwapCount)}
              sentiment={bpsSentiment(avgVwap)}
            />
            <PrintKpiTile
              label="Avg TWAS"
              value={fmtBps(avgTwas)}
              sub={kpiSub(twasCount)}
              sentiment="neutral"
            />
            <PrintKpiTile
              label="Avg Time-to-Fill"
              value={avgTtf !== null ? fmtTtf(Math.round(avgTtf)) : "N/A"}
              sub={`${n} order${n !== 1 ? "s" : ""}`}
              sentiment="neutral"
            />
            <PrintKpiTile
              label="# Orders"
              value={uniqueOrds.toLocaleString()}
              sub={`unique order${uniqueOrds !== 1 ? "s" : ""}`}
              sentiment="neutral"
            />
            <PrintKpiTile
              label="Total Contracts"
              value={totalQty.toLocaleString()}
              sub={`${n} order${n !== 1 ? "s" : ""}`}
              sentiment="neutral"
            />
          </div>
        </div>
      ),
    });
  }

  // — Charts ————————————————————————————————————————————————————————————————
  if (hasAnyChart) {
    contentGroups.push({
      key: "charts",
      node: (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-3">
            Charts
          </p>
          <div className="flex flex-col gap-4 print:gap-3">
            {enabledCharts.map(({ id, label, src }) =>
              src ? (
                <div key={id} className="break-inside-avoid rounded-xl border border-gray-200 p-5">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    {label}
                  </p>
                  <img src={src} alt={label} className="w-full h-auto" />
                </div>
              ) : (
                <div key={id} className="break-inside-avoid rounded-xl border border-gray-200 p-5">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    {label}
                  </p>
                  <div className="h-24 flex items-center justify-center text-xs text-gray-400 italic">
                    Data unavailable
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
      ),
    });
  }

  // — Aggregation tables ————————————————————————————————————————————————————
  if (hasAnyAgg) {
    contentGroups.push({
      key: "agg",
      node: (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-3">
            Aggregation
          </p>
          {enabledAggs.map((a) => (
            <PrintAggTable key={a.id} title={a.label} rows={a.rows} />
          ))}
        </div>
      ),
    });
  }

  // — Order detail table ————————————————————————————————————————————————————
  if (vis("order_table")) {
    contentGroups.push({
      key: "order_table",
      node: (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-3">
            Order Detail
          </p>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-left">
                  {[
                    "Order Time (UTC)", "Symbol", "Side", "Qty", "Fill Price",
                    "Algo", "IS (bps)", "VWAP Dev (bps)", "TWAS (bps)", "TTF", "1σ Vol (bps)",
                  ].map((h) => (
                    <th key={h} className="px-1.5 py-1.5 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                {sortedTrades.map((t, i) => {
                  const r = resultMap.get(t.orderId);
                  return (
                    <tr key={`${t.orderId}-${i}`} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
                      <td className="px-1.5 py-1 font-mono whitespace-nowrap">{fmtUtc(t.orderTime)}</td>
                      <td className="px-1.5 py-1 font-semibold">{t.symbol}</td>
                      <td className="px-1.5 py-1">
                        <span className={`font-semibold ${t.side === "BUY" ? "text-blue-600" : "text-red-500"}`}>
                          {t.side}
                        </span>
                      </td>
                      <td className="px-1.5 py-1 tabular-nums">{t.orderQty.toLocaleString()}</td>
                      <td className="px-1.5 py-1 tabular-nums font-mono">
                        {t.avgFillPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                      </td>
                      <td className="px-1.5 py-1">{t.algo ?? "—"}</td>
                      <td className="px-1.5 py-1 tabular-nums"><BpsPrint v={r?.IS_bps ?? null} /></td>
                      <td className="px-1.5 py-1 tabular-nums"><BpsPrint v={r?.VWAP_dev_bps ?? null} /></td>
                      <td className="px-1.5 py-1 tabular-nums"><BpsPrint v={r?.TWAS_bps ?? null} neutral /></td>
                      <td className="px-1.5 py-1 tabular-nums text-gray-700">{r ? fmtTtf(r.timeToFill_ms) : "—"}</td>
                      <td className="px-1.5 py-1 tabular-nums"><BpsPrint v={r?.vol_during_order_bps ?? null} neutral /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[9px] text-gray-400 mt-1.5">
            {sortedTrades.length} order{sortedTrades.length !== 1 ? "s" : ""} · exported {new Date().toLocaleDateString()}
          </p>
        </div>
      ),
    });
  }

  // ── Screen-only page break divider ────────────────────────────────────────
  const PageBreakDivider = () => (
    <div className="print:hidden my-8 flex items-center gap-3 text-xs text-gray-400 select-none">
      <div className="flex-1 border-t border-dashed border-gray-300" />
      <span>page break</span>
      <div className="flex-1 border-t border-dashed border-gray-300" />
    </div>
  );

  const hasBranding = !!(logoDataUrl || disclaimerText.trim() || reportTitle.trim());

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white">

      {/* ── Screen-only sticky toolbar ──────────────────────────────────── */}
      <div className="print:hidden sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center gap-3 px-6 py-2.5">

          {/* Back */}
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
            Print Layout — Multi-Order TCA&nbsp;&nbsp;·&nbsp;&nbsp;
            {n} trade{n !== 1 ? "s" : ""}
          </span>

          <div className="flex-1" />

          {/* ── Sections popover ────────────────────────────────────────── */}
          <div ref={sectionsRef} className="relative">
            <button
              type="button"
              onClick={() => setShowSections((v) => !v)}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                showSections
                  ? "border-blue-400 bg-blue-50 text-blue-600"
                  : "border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100"
              }`}
              title="Choose which sections to include"
            >
              <ColumnsIcon />
              Sections
              <span className="text-[10px] text-gray-400 tabular-nums">
                {visibleSections.size}/{ALL_SECTIONS.length}
              </span>
            </button>

            {showSections && (
              <div className="absolute right-0 top-9 z-30 w-60 bg-white rounded-xl shadow-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-gray-700">Report Sections</p>
                  <div className="flex gap-2.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setVisibleSections(new Set(ALL_SECTIONS))}
                      className="text-blue-500 hover:underline"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setVisibleSections(new Set())}
                      className="text-gray-400 hover:underline"
                    >
                      None
                    </button>
                  </div>
                </div>
                {SECTION_GROUPS.map((group, gi) => (
                  <div key={gi} className={gi > 0 ? "mt-2" : ""}>
                    {group.heading && (
                      <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-1 mt-1">
                        {group.heading}
                      </p>
                    )}
                    {group.items.map((item) => (
                      <label
                        key={item.id}
                        className="flex items-center gap-2 py-0.5 cursor-pointer text-xs text-gray-700 hover:text-gray-900 select-none"
                      >
                        <input
                          type="checkbox"
                          checked={vis(item.id)}
                          onChange={() => toggle(item.id)}
                          className="rounded accent-blue-500"
                        />
                        {item.label}
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Branding popover ────────────────────────────────────────── */}
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
                  <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoFile} />
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
                    Disclaimer <span className="text-gray-400">(follows content)</span>
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

          {/* ── Print button ─────────────────────────────────────────────── */}
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

      {/* ── Report content ───────────────────────────────────────────────── */}
      <div className="max-w-4xl mx-auto px-6 py-6 print:max-w-none print:mx-0 print:px-0 print:py-0">

        {/* Branding header (always first on every report) */}
        {logoDataUrl && (
          <div className="mb-2 print:mb-2">
            <img
              src={logoDataUrl}
              alt="Company logo"
              className="w-full object-contain object-left max-h-20"
            />
          </div>
        )}
        {reportTitle.trim() && (
          <p className="text-[30px] font-semibold text-gray-800 mb-3 print:mb-2">
            {reportTitle.trim()}
          </p>
        )}
        <hr className="mb-4 border-gray-200 print:mb-3" />

        {/* Content groups */}
        {contentGroups.length === 0 ? (
          <div className="print:hidden flex flex-col items-center justify-center py-20 text-center gap-3">
            <svg className="h-10 w-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm text-gray-500">No sections selected.</p>
            <p className="text-xs text-gray-400">Use the <strong>Sections</strong> button above to choose what to include.</p>
          </div>
        ) : (
          contentGroups.map((group, i) => (
            <div key={group.key}>
              {i > 0 && <PageBreakDivider />}
              <div className={i > 0 ? "break-before-page" : ""}>
                {group.node}
              </div>
            </div>
          ))
        )}

        {/* Disclaimer */}
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

// ── Icons ─────────────────────────────────────────────────────────────────────

function ColumnsIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
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

function PrinterIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
    </svg>
  );
}

/**
 * ParentSummaryCard — top-of-dashboard summary for Single Order TCA (Mode 2).
 *
 * Three-column layout:
 *   Col 1 — Order Details        (factual order data; Order Start / Last Fill are editable)
 *   Col 2 — Market Conditions    (vol, impact, reversion, spread)
 *   Col 3 — Benchmark Performance (avg fill price vs each benchmark, highlighted by algo)
 */

import { useState } from "react";
import type { ParentOrderSummary } from "@/types";
import { fmtTtf } from "@/components/dashboard/dashboardUtils";

// ── UTC helpers ───────────────────────────────────────────────────────────────

function fmtUtcDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function fmtUtcTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`;
}

function toInputUtc(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

function parseInputAsUtc(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s + "Z");
  return isNaN(d.getTime()) ? null : d;
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtPrice(v: number | null): string {
  return v !== null
    ? v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })
    : "N/A (needs BBG)";
}

function fmtPct(v: number | null): string {
  return v !== null ? `${(v * 100).toFixed(2)}%` : "N/A (needs BBG)";
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface ParentSummaryCardProps {
  summary: ParentOrderSummary;
  highlightedBenchmark: "arrival" | "vwap" | "twap" | null;
  onOrderTimeChange: (d: Date) => void;
  onLastFillTimeChange: (d: Date) => void;
  resolveSymbol?: (ric: string) => string;
  /** Manual override for the broker/exchange order ID (FIX tag 37). undefined = use summary value. */
  brokerOrderId?: string | null | undefined;
  onBrokerOrderIdChange?: (id: string | null) => void;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-3">
      {children}
    </p>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <span className="text-[11px] text-gray-500 dark:text-gray-400 shrink-0">{label}</span>
      <span className={`text-xs font-semibold text-gray-900 dark:text-white tabular-nums text-right ${mono ? "font-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function BpsRow({
  label,
  value,
  invert = false,
  neutral = false,
}: {
  label: string;
  value: number | null;
  invert?: boolean;
  neutral?: boolean;
}) {
  let displayStr: string;
  let colorClass: string;

  if (value === null) {
    displayStr = "N/A (needs BBG)";
    colorClass = "text-gray-400 dark:text-gray-600";
  } else {
    const sign = value > 0 ? "+" : "";
    displayStr = `${sign}${value.toFixed(1)} bps`;
    if (neutral) {
      colorClass = "text-gray-700 dark:text-gray-300";
    } else {
      const favorable = invert ? value > 0 : value < 0;
      colorClass = favorable ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400";
    }
  }

  return (
    <div className="flex items-baseline justify-between gap-2 py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <span className="text-[11px] text-gray-500 dark:text-gray-400 shrink-0">{label}</span>
      <span className={`text-xs font-semibold tabular-nums text-right ${colorClass}`}>
        {displayStr}
      </span>
    </div>
  );
}

function EditableTimeRow({
  label,
  date,
  onChange,
}: {
  label: string;
  date: Date;
  onChange: (d: Date) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [error, setError] = useState(false);

  function startEdit() {
    setInputVal(toInputUtc(date));
    setError(false);
    setEditing(true);
  }
  function confirm() {
    const d = parseInputAsUtc(inputVal);
    if (!d) { setError(true); return; }
    onChange(d);
    setEditing(false);
    setError(false);
  }
  function cancel() { setEditing(false); setError(false); }

  return (
    <div className="py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
      {/* Label on its own line */}
      <span className="text-[11px] text-gray-500 dark:text-gray-400">{label}</span>

      {editing ? (
        <div className="flex items-center gap-1 mt-0.5">
          <input
            type="datetime-local"
            step="1"
            value={inputVal}
            onChange={(e) => { setInputVal(e.target.value); setError(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") confirm(); if (e.key === "Escape") cancel(); }}
            className={`text-[11px] font-mono rounded border px-1.5 py-0.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 ${
              error ? "border-red-400" : "border-gray-300 dark:border-gray-600"
            }`}
            autoFocus
          />
          <button type="button" onClick={confirm} title="Confirm (UTC)"
            className="p-0.5 text-green-600 hover:text-green-700 dark:text-green-400">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </button>
          <button type="button" onClick={cancel} title="Cancel"
            className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ) : (
        /* Date on line 2, time on line 3 */
        <div className="mt-0.5">
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-xs font-semibold font-mono text-gray-900 dark:text-white tabular-nums">
              {fmtUtcDate(date)}
            </span>
            <button type="button" onClick={startEdit} title="Edit time (UTC)"
              className="print:hidden p-0.5 text-gray-300 hover:text-blue-500 dark:text-gray-600 dark:hover:text-blue-400 transition-colors">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
              </svg>
            </button>
          </div>
          <span className="text-xs font-mono text-gray-700 dark:text-gray-300 tabular-nums">
            {fmtUtcTime(date)}
          </span>
        </div>
      )}
      {error && (
        <p className="text-[10px] text-red-500 mt-0.5">
          Invalid date — use format YYYY-MM-DDTHH:MM:SS
        </p>
      )}
    </div>
  );
}

function EditableStringRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState("");

  function startEdit() { setInputVal(value ?? ""); setEditing(true); }
  function confirm() { onChange(inputVal.trim() || null); setEditing(false); }
  function cancel() { setEditing(false); }

  return (
    <div className="flex items-baseline justify-between gap-2 py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <span className="text-[11px] text-gray-500 dark:text-gray-400 shrink-0">{label}</span>
      {editing ? (
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") confirm(); if (e.key === "Escape") cancel(); }}
            placeholder="Enter value…"
            className="text-[11px] font-mono rounded border border-gray-300 dark:border-gray-600 px-1.5 py-0.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 w-36"
            autoFocus
          />
          <button type="button" onClick={confirm} title="Confirm"
            className="p-0.5 text-green-600 hover:text-green-700 dark:text-green-400">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </button>
          <button type="button" onClick={cancel} title="Cancel"
            className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold font-mono text-gray-900 dark:text-white tabular-nums text-right">
            {value ?? <span className="text-gray-400 dark:text-gray-600 font-normal">—</span>}
          </span>
          <button type="button" onClick={startEdit} title="Edit"
            className="print:hidden p-0.5 text-gray-300 hover:text-blue-500 dark:text-gray-600 dark:hover:text-blue-400 transition-colors">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

interface BenchmarkRowProps {
  benchmarkLabel: string;
  benchmarkValue: string;
  slippageLabel: string;
  slippageBps: number | null;
  missing?: boolean;
  highlighted: boolean;
}

function BenchmarkRow({
  benchmarkLabel, benchmarkValue,
  slippageLabel, slippageBps,
  missing, highlighted,
}: BenchmarkRowProps) {
  const favorable = slippageBps !== null && slippageBps <= 0;
  const adverse   = slippageBps !== null && slippageBps >  0;
  const bpsClass  = favorable
    ? "text-green-600 dark:text-green-400"
    : adverse
      ? "text-red-500 dark:text-red-400"
      : "text-gray-400 dark:text-gray-600";
  const bpsText = missing || slippageBps === null
    ? "N/A (needs BBG)"
    : `${slippageBps > 0 ? "+" : ""}${slippageBps.toFixed(1)} bps`;

  return (
    <div className={`rounded-lg border p-3 transition-all duration-200 ${
      highlighted
        ? "border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-400 dark:ring-blue-500 ring-offset-1"
        : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40"
    }`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-0.5">
            {benchmarkLabel}
          </p>
          <p className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
            {benchmarkValue}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-0.5">
            {slippageLabel}
          </p>
          <p className={`text-sm font-semibold tabular-nums ${bpsClass}`}>
            {bpsText}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ParentSummaryCard({
  summary,
  highlightedBenchmark,
  onOrderTimeChange,
  onLastFillTimeChange,
  resolveSymbol,
  brokerOrderId: brokerOrderIdProp,
  onBrokerOrderIdChange,
}: ParentSummaryCardProps) {
  // Effective order ID: manual override takes priority over the value from the file
  const effectiveBrokerOrderId = brokerOrderIdProp !== undefined
    ? brokerOrderIdProp
    : (summary.brokerOrderId ?? null);
  const sideSign = summary.side === "BUY" ? 1 : -1;

  const vwapSlippage: number | null =
    summary.marketVwap !== null && summary.marketVwap > 0
      ? ((summary.fillVwap - summary.marketVwap) / summary.marketVwap) * sideSign * 10_000
      : null;

  const twapSlippage: number | null =
    summary.marketTwap !== null && summary.marketTwap > 0
      ? ((summary.fillVwap - summary.marketTwap) / summary.marketTwap) * sideSign * 10_000
      : null;

  const noBloomberg = summary.arrivalPrice === null;

  // Trend Cost = IS − MI − TWAS/2  (IS decomposition: residual after impact and spread)
  const trendCost_bps: number | null =
    summary.IS_bps !== null && summary.MI_bps !== null && summary.TWAS_bps !== null
      ? summary.IS_bps - summary.MI_bps - summary.TWAS_bps / 2
      : null;

  // Benchmark-relative reversion: uses the benchmark selected by the active algo.
  // Defaults to arrival price when no algo is selected.
  const benchmarkPrice: number | null =
    highlightedBenchmark === "vwap"  ? summary.marketVwap  :
    highlightedBenchmark === "twap"  ? summary.marketTwap  :
    summary.arrivalPrice;

  const reversion1m_bps: number | null =
    summary.reversion1m_price !== null && benchmarkPrice !== null && benchmarkPrice > 0
      ? ((summary.reversion1m_price - benchmarkPrice) / benchmarkPrice) * -sideSign * 10_000
      : null;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">

      {/* ── Title row ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-5">
        <span className="text-lg font-bold text-gray-900 dark:text-white font-mono">
          {resolveSymbol ? resolveSymbol(summary.symbol) : summary.symbol}
        </span>
        <span className={`px-2 py-0.5 rounded text-xs font-bold tracking-wide ${
          summary.side === "BUY"
            ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
            : "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400"
        }`}>
          {summary.side}
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500">Parent Order Summary</span>
      </div>

      {/* ── Three-column body ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 print:grid-cols-3 gap-6 lg:gap-8 print:gap-4">

        {/* ── COL 1: Order Details ────────────────────────────────────────── */}
        <div>
          <SectionLabel>Order Details</SectionLabel>
          <div>
            <EditableStringRow
              label="Order ID (Tag 37)"
              value={effectiveBrokerOrderId}
              onChange={onBrokerOrderIdChange ?? (() => {})}
            />
            <DetailRow label="Total Qty"        value={summary.totalQty.toLocaleString()} />
            <DetailRow label="Order Avg. Price" value={summary.fillVwap.toLocaleString(undefined, {
              minimumFractionDigits: 2, maximumFractionDigits: 6,
            })} />
            <DetailRow label="Duration"          value={fmtTtf(summary.duration_ms)} />
            <DetailRow label="Participation Rate" value={fmtPct(summary.participationRate)} />
            <EditableTimeRow
              label="Order Start (UTC)"
              date={summary.orderTime}
              onChange={onOrderTimeChange}
            />
            <EditableTimeRow
              label="Order End Time (UTC)"
              date={summary.lastFillTime}
              onChange={onLastFillTimeChange}
            />
          </div>
        </div>

        {/* ── COL 2: Market Conditions ────────────────────────────────────── */}
        <div>
          <SectionLabel>Market Conditions</SectionLabel>
          <div>
            <BpsRow label="1σ Vol (bps)"    value={summary.vol_during_order_bps} neutral />
            <DetailRow label="1σ Vol (price)" value={
              summary.vol_during_order_price !== null
                ? summary.vol_during_order_price.toFixed(4)
                : "N/A (needs BBG)"
            } />
            <BpsRow label="Impact (bps)"       value={summary.MI_bps} neutral />
            <BpsRow label="Reversion 1m (bps)" value={reversion1m_bps} invert />
            <BpsRow label="TWAS (bps)"         value={summary.TWAS_bps} neutral />
            <BpsRow label="Trend Cost (bps)"   value={trendCost_bps} />
          </div>
        </div>

        {/* ── COL 3: Benchmark Performance ────────────────────────────────── */}
        <div>
          <SectionLabel>Benchmark Performance</SectionLabel>
          <div className="space-y-2.5">
            <BenchmarkRow
              benchmarkLabel="Arrival Price"
              benchmarkValue={fmtPrice(summary.arrivalPrice)}
              slippageLabel="IS (bps)"
              slippageBps={summary.IS_bps}
              missing={noBloomberg}
              highlighted={highlightedBenchmark === "arrival"}
            />
            <BenchmarkRow
              benchmarkLabel="Market VWAP (BBG)"
              benchmarkValue={fmtPrice(summary.marketVwap)}
              slippageLabel="VWAP Slippage (bps)"
              slippageBps={vwapSlippage}
              missing={summary.marketVwap === null}
              highlighted={highlightedBenchmark === "vwap"}
            />
            <BenchmarkRow
              benchmarkLabel="Market TWAP (BBG)"
              benchmarkValue={fmtPrice(summary.marketTwap)}
              slippageLabel="TWAP Slippage (bps)"
              slippageBps={twapSlippage}
              missing={summary.marketTwap === null}
              highlighted={highlightedBenchmark === "twap"}
            />
          </div>
        </div>

      </div>
    </div>
  );
}

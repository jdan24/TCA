/**
 * ParentSummaryCard — top-of-dashboard summary for Single Order TCA (Mode 2).
 *
 * Two-column layout:
 *   Left  — Order Details  (factual order data)
 *   Right — Benchmark Performance  (avg fill price vs each benchmark)
 */

import type { ParentOrderSummary } from "@/types";
import { fmtBps, fmtTtf } from "@/components/dashboard/dashboardUtils";

function fmtUtc(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
  );
}

function fmtPrice(v: number | null): string {
  return v !== null
    ? v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })
    : "N/A (needs BBG)";
}

function fmtPct(v: number | null): string {
  return v !== null ? `${(v * 100).toFixed(2)}%` : "N/A (needs BBG)";
}

interface ParentSummaryCardProps {
  summary: ParentOrderSummary;
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

interface BenchmarkRowProps {
  benchmarkLabel: string;
  benchmarkValue: string;
  slippageLabel: string;
  slippageBps: number | null;
  /** When true the slippage value does not exist yet (Bloomberg not connected). */
  missing?: boolean;
}

function BenchmarkRow({ benchmarkLabel, benchmarkValue, slippageLabel, slippageBps, missing }: BenchmarkRowProps) {
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
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 p-3">
      <div className="flex items-start justify-between gap-4">
        {/* Benchmark price */}
        <div className="min-w-0">
          <p className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-0.5">
            {benchmarkLabel}
          </p>
          <p className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
            {benchmarkValue}
          </p>
        </div>
        {/* Slippage */}
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

export function ParentSummaryCard({ summary }: ParentSummaryCardProps) {
  const sideSign = summary.side === "BUY" ? 1 : -1;

  // Slippage of order avg price vs each benchmark (same sign convention as IS)
  const vwapSlippage: number | null =
    summary.marketVwap !== null && summary.marketVwap > 0
      ? ((summary.fillVwap - summary.marketVwap) / summary.marketVwap) * sideSign * 10_000
      : null;

  const twapSlippage: number | null =
    summary.marketTwap !== null && summary.marketTwap > 0
      ? ((summary.fillVwap - summary.marketTwap) / summary.marketTwap) * sideSign * 10_000
      : null;

  const noBloomberg = summary.arrivalPrice === null;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">

      {/* ── Title row ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-5">
        <span className="text-lg font-bold text-gray-900 dark:text-white font-mono">
          {summary.symbol}
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

      {/* ── Two-column body ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">

        {/* ── LEFT: Order Details ────────────────────────────────────────── */}
        <div>
          <SectionLabel>Order Details</SectionLabel>
          <div>
            <DetailRow label="Total Qty"       value={summary.totalQty.toLocaleString()} />
            <DetailRow label="Order Avg. Price" value={summary.fillVwap.toLocaleString(undefined, {
              minimumFractionDigits: 2, maximumFractionDigits: 6,
            })} />
            <DetailRow label="Duration"         value={fmtTtf(summary.duration_ms)} />
            <DetailRow label="1σ Vol (bps)"     value={fmtBps(summary.vol_during_order_bps)} />
            <DetailRow label="1σ Vol (price)"   value={
              summary.vol_during_order_price !== null
                ? summary.vol_during_order_price.toFixed(4)
                : "N/A (needs BBG)"
            } />
            <DetailRow label="Participation Rate" value={fmtPct(summary.participationRate)} />
            <DetailRow label="Order Start (UTC)" value={fmtUtc(summary.orderTime)} mono />
            <DetailRow label="Last Fill (UTC)"   value={fmtUtc(summary.lastFillTime)} mono />
          </div>
        </div>

        {/* ── RIGHT: Benchmark Performance ──────────────────────────────── */}
        <div>
          <SectionLabel>Benchmark Performance</SectionLabel>
          <div className="space-y-2.5">
            <BenchmarkRow
              benchmarkLabel="Arrival Price"
              benchmarkValue={fmtPrice(summary.arrivalPrice)}
              slippageLabel="IS (bps)"
              slippageBps={summary.IS_bps}
              missing={noBloomberg}
            />
            <BenchmarkRow
              benchmarkLabel="Market VWAP (BBG)"
              benchmarkValue={fmtPrice(summary.marketVwap)}
              slippageLabel="VWAP Slippage (bps)"
              slippageBps={vwapSlippage}
              missing={summary.marketVwap === null}
            />
            <BenchmarkRow
              benchmarkLabel="Market TWAP (BBG)"
              benchmarkValue={fmtPrice(summary.marketTwap)}
              slippageLabel="TWAP Slippage (bps)"
              slippageBps={twapSlippage}
              missing={summary.marketTwap === null}
            />
          </div>
        </div>

      </div>
    </div>
  );
}

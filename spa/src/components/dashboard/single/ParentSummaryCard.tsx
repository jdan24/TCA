/**
 * ParentSummaryCard — top-of-dashboard summary for Single Order TCA (Mode 2).
 *
 * Shows aggregate metrics for the entire parent order:
 *   Symbol · Side · Total Qty · Fill VWAP · Arrival Price · IS
 *   Duration · 1σ Vol · Participation Rate
 */

import type { ParentOrderSummary } from "@/types";
import { fmtBps, fmtTtf } from "@/components/dashboard/dashboardUtils";

interface ParentSummaryCardProps {
  summary: ParentOrderSummary;
}

export function ParentSummaryCard({ summary }: ParentSummaryCardProps) {
  const isGood = summary.IS_bps !== null && summary.IS_bps <= 0;
  const isBad = summary.IS_bps !== null && summary.IS_bps > 0;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      {/* Title row */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-lg font-bold text-gray-900 dark:text-white font-mono">
          {summary.symbol}
        </span>
        <span
          className={`px-2 py-0.5 rounded text-xs font-bold tracking-wide ${
            summary.side === "BUY"
              ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
              : "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400"
          }`}
        >
          {summary.side}
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          Parent Order Summary
        </span>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <Stat label="Total Qty" value={summary.totalQty.toLocaleString()} />
        <Stat
          label="Fill VWAP"
          value={summary.fillVwap.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 6,
          })}
        />
        <Stat
          label="Arrival Price"
          value={
            summary.arrivalPrice !== null
              ? summary.arrivalPrice.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 6,
                })
              : "N/A"
          }
        />
        <Stat
          label="IS (bps)"
          value={fmtBps(summary.IS_bps)}
          {...(isGood
            ? { valueClass: "text-green-600 dark:text-green-400" }
            : isBad
              ? { valueClass: "text-red-500" }
              : {})}
        />
        <Stat
          label="Duration"
          value={fmtTtf(summary.duration_ms)}
        />
        <Stat
          label="1σ Vol (bps)"
          value={fmtBps(summary.vol_during_order_bps)}
        />
        <Stat
          label="1σ Vol (price)"
          value={
            summary.vol_during_order_price !== null
              ? summary.vol_during_order_price.toFixed(4)
              : "N/A"
          }
        />
        <Stat
          label="Participation Rate"
          value={
            summary.participationRate !== null
              ? `${(summary.participationRate * 100).toFixed(1)}%`
              : "N/A"
          }
        />
        <Stat
          label="Order Start"
          value={
            summary.orderTime.toLocaleDateString() +
            " " +
            summary.orderTime.toLocaleTimeString()
          }
        />
        <Stat
          label="Last Fill"
          value={
            summary.lastFillTime.toLocaleDateString() +
            " " +
            summary.lastFillTime.toLocaleTimeString()
          }
        />
      </div>
    </div>
  );
}

interface StatProps {
  label: string;
  value: string;
  valueClass?: string;
}

function Stat({ label, value, valueClass }: StatProps) {
  return (
    <div>
      <p className="text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-0.5">
        {label}
      </p>
      <p className={`text-sm font-semibold tabular-nums ${valueClass ?? "text-gray-900 dark:text-white"}`}>
        {value}
      </p>
    </div>
  );
}

/**
 * KPI summary tiles row.
 *
 * Shows five portfolio-level metrics:
 *   Avg IS (bps) · Avg VWAP Dev · Avg TWAS · Avg Time-to-Fill · Avg Market Impact
 *
 * Metrics that require Bloomberg enrichment display "N/A" when unavailable.
 * Color coding: favorable values (negative IS/VWAP) → green; adverse → red.
 */

import type { TCAResult } from "@/types";
import { fmtBps, fmtTtf, safeAvg } from "./dashboardUtils";

interface SummaryCardsProps {
  results: TCAResult[];
}

// ── KPI card ──────────────────────────────────────────────────────────────────

type Sentiment = "good" | "bad" | "neutral";

interface KpiCardProps {
  label: string;
  value: string;
  sub: string;
  sentiment?: Sentiment;
}

function KpiCard({ label, value, sub, sentiment = "neutral" }: KpiCardProps) {
  const valueClass =
    sentiment === "good"
      ? "text-green-600 dark:text-green-400"
      : sentiment === "bad"
        ? "text-red-500"
        : "text-gray-900 dark:text-white";

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col gap-1">
      <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
        {label}
      </p>
      <p className={`text-2xl font-semibold tabular-nums ${valueClass}`}>{value}</p>
      <p className="text-xs text-gray-400 dark:text-gray-600">{sub}</p>
    </div>
  );
}

function bpsSentiment(v: number | null): Sentiment {
  if (v === null) return "neutral";
  return v <= 0 ? "good" : "bad";
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SummaryCards({ results }: SummaryCardsProps) {
  const n = results.length;

  const isVals = results.map((r) => r.IS_bps);
  const avgIS = safeAvg(isVals);
  const isCount = isVals.filter((v) => v !== null).length;

  const vwapVals = results.map((r) => r.VWAP_dev_bps);
  const avgVwap = safeAvg(vwapVals);
  const vwapCount = vwapVals.filter((v) => v !== null).length;

  const twasVals = results.map((r) => r.TWAS_bps);
  const avgTwas = safeAvg(twasVals);
  const twasCount = twasVals.filter((v) => v !== null).length;

  const avgTtf = safeAvg(results.map((r) => r.timeToFill_ms));

  const miVals = results.map((r) => r.MI_bps);
  const avgMI = safeAvg(miVals);
  const miCount = miVals.filter((v) => v !== null).length;

  const volVals = results.map((r) => r.vol_during_order_bps);
  const avgVol = safeAvg(volVals);
  const volCount = volVals.filter((v) => v !== null).length;

  function subOf(count: number) {
    return count === n ? `${n} trade${n !== 1 ? "s" : ""}` : `${count} of ${n} trades`;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
      <KpiCard
        label="Avg IS"
        value={fmtBps(avgIS)}
        sub={subOf(isCount)}
        sentiment={bpsSentiment(avgIS)}
      />
      <KpiCard
        label="Avg VWAP Dev"
        value={fmtBps(avgVwap)}
        sub={subOf(vwapCount)}
        sentiment={bpsSentiment(avgVwap)}
      />
      <KpiCard
        label="Avg TWAS"
        value={fmtBps(avgTwas)}
        sub={subOf(twasCount)}
        sentiment="neutral"
      />
      <KpiCard
        label="Avg Time-to-Fill"
        value={avgTtf !== null ? fmtTtf(Math.round(avgTtf)) : "N/A"}
        sub={`${n} trade${n !== 1 ? "s" : ""}`}
        sentiment="neutral"
      />
      <KpiCard
        label="Avg Mkt Impact"
        value={fmtBps(avgMI)}
        sub={subOf(miCount)}
        sentiment={avgMI !== null && avgMI > 0 ? "bad" : "neutral"}
      />
      <KpiCard
        label="Avg Vol (1σ)"
        value={fmtBps(avgVol)}
        sub={volCount > 0 ? subOf(volCount) : "requires Bloomberg"}
        sentiment="neutral"
      />
    </div>
  );
}

/**
 * KPI summary tiles row.
 *
 * Shows portfolio-level metrics:
 *   Avg IS (bps) · Avg VWAP Dev · Avg TWAS · Total Cost ($) ·
 *   Avg Time-to-Fill · # Orders · Total Contracts
 *
 * Metrics that require Bloomberg enrichment display "N/A" when unavailable.
 * Color coding: favorable values (negative IS/VWAP) → green; adverse → red.
 *
 * Total Cost is benchmark-aware: each order contributes its cash slippage
 * against the benchmark its algo maps to, so a mixed report of VWAP, TWAP and
 * arrival-price algos sums each order against the thing it was actually
 * trying to beat. See the Algo Benchmarks table in Settings.
 */

import type { TCAResult, TradeRecord } from "@/types";
import { resolveBenchmark } from "@/hooks/useAlgoMap";
import { fmtBps, fmtTtf, fmtUsd, safeAvg } from "./dashboardUtils";

interface SummaryCardsProps {
  results: TCAResult[];
  trades: TradeRecord[];
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

export function SummaryCards({ results, trades }: SummaryCardsProps) {
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

  // ── Total cost, each order against its own algo's benchmark ───────────────
  const totalCost = (() => {
    const resultById = new Map(results.map((r) => [r.orderId, r]));
    const currencies = new Set<string>();
    let sum = 0;
    let priced = 0;

    for (const trade of trades) {
      const r = resultById.get(trade.orderId);
      if (!r) continue;
      const benchmark = resolveBenchmark(trade.algo);
      const usd =
        benchmark === "vwap" ? r.VWAP_dev_usd :
        benchmark === "twap" ? r.TWAP_dev_usd :
        r.IS_usd;
      if (usd === null) continue;
      sum += usd;
      priced += 1;
      currencies.add(trade.currency);
    }

    if (priced === 0) {
      return { value: null, sub: "needs point value", currency: "USD" };
    }
    // No FX conversion anywhere in the app, so a total across currencies would
    // be meaningless. Report the gap instead of a wrong number.
    if (currencies.size > 1) {
      return { value: null, sub: "mixed currencies", currency: "USD" };
    }
    return {
      value: sum,
      sub: subOf(priced),
      currency: [...currencies][0] ?? "USD",
    };
  })();

  const uniqueOrderCount = new Set(results.map((r) => r.orderId)).size;

  const totalQty = trades.reduce((s, t) => s + t.orderQty, 0);

  function subOf(count: number) {
    return count === n ? `${n} trade${n !== 1 ? "s" : ""}` : `${count} of ${n} trades`;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-7 gap-3">
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
        label="Total Cost"
        value={fmtUsd(totalCost.value, totalCost.currency)}
        sub={totalCost.sub}
        sentiment={totalCost.value === null ? "neutral" : totalCost.value <= 0 ? "good" : "bad"}
      />
      <KpiCard
        label="Avg Time-to-Fill"
        value={avgTtf !== null ? fmtTtf(Math.round(avgTtf)) : "N/A"}
        sub={`${n} trade${n !== 1 ? "s" : ""}`}
        sentiment="neutral"
      />
      <KpiCard
        label="# Orders"
        value={uniqueOrderCount.toLocaleString()}
        sub={`unique order${uniqueOrderCount !== 1 ? "s" : ""}`}
        sentiment="neutral"
      />
      <KpiCard
        label="Total Contracts"
        value={totalQty.toLocaleString()}
        sub={`${n} trade${n !== 1 ? "s" : ""}`}
        sentiment="neutral"
      />
    </div>
  );
}

/**
 * CumulativeVWAP — running VWAP and running avg fill price vs arrival price.
 *
 * X-axis: fill time (UTC)
 * Blue solid:   running market VWAP (if Bloomberg enriched, else hidden)
 * Green solid:  running avg fill price of the order (cumulative qty-weighted)
 * Purple dashed: individual fill prices
 * Gray dashed:  arrival price reference line
 *
 * Click a legend item to mute/unmute that series.
 */

import { useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TradeRecord } from "@/types";
import { ChartCard, EmptyState } from "@/components/dashboard/dashboardUtils";

interface CumulativeVWAPProps {
  trades: TradeRecord[];
  arrivalPrice: number | null;
  /** Per-fill running market VWAP from order start to each fill. null/empty = not yet enriched. */
  runningMarketVwap: Array<{ t: number; vwap: number }> | null;
}

interface DataPoint {
  t: number;
  timeLabel: string;
  runningFillAvg: number;          // cumulative qty-weighted avg fill price
  fillPrice: number;               // this fill's individual price
  marketVwapLine?: number;         // Bloomberg market VWAP (flat reference, optional)
  cumQty: number;
}

function fmtUtc(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

function buildData(
  trades: TradeRecord[],
  vwapByTime: Map<number, number>,
): DataPoint[] {
  if (trades.length === 0) return [];

  const sorted = [...trades].sort(
    (a, b) => a.lastFillTime.getTime() - b.lastFillTime.getTime()
  );

  let cumNotional = 0;
  let cumQty = 0;

  return sorted.map((t) => {
    cumNotional += t.avgFillPrice * t.orderQty;
    cumQty += t.orderQty;
    const runningFillAvg = cumQty > 0 ? cumNotional / cumQty : t.avgFillPrice;
    const tMs = t.lastFillTime.getTime();
    const marketVwapAtFill = vwapByTime.get(tMs);
    return {
      t: tMs,
      timeLabel: fmtUtc(tMs),
      runningFillAvg,
      fillPrice: t.avgFillPrice,
      cumQty,
      ...(marketVwapAtFill !== undefined ? { marketVwapLine: marketVwapAtFill } : {}),
    };
  });
}

const SERIES: Record<string, { label: string; color: string; dash?: string }> = {
  runningFillAvg: { label: "Running Avg Fill",  color: "#10b981" },
  marketVwapLine: { label: "Market VWAP (BBG)", color: "#3b82f6", dash: "6 3" },
  fillPrice:      { label: "Fill Price",         color: "#8b5cf6", dash: "4 2" },
};

export function CumulativeVWAP({ trades, arrivalPrice, runningMarketVwap }: CumulativeVWAPProps) {
  const vwapByTime = new Map((runningMarketVwap ?? []).map((p) => [p.t, p.vwap]));
  const data = buildData(trades, vwapByTime);
  const hasMarketVwap = (runningMarketVwap?.length ?? 0) > 0;
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  if (data.length === 0) {
    return (
      <ChartCard id="so-chart-vwap" title="Cumulative Fill VWAP" subtitle="Running avg fill price vs arrival">
        <EmptyState message="No fill data" />
      </ChartCard>
    );
  }

  const allPrices = data.flatMap((d) => [d.runningFillAvg, d.fillPrice]);
  if (arrivalPrice !== null) allPrices.push(arrivalPrice);
  if (runningMarketVwap) runningMarketVwap.forEach((p) => allPrices.push(p.vwap));
  const pMin = Math.min(...allPrices);
  const pMax = Math.max(...allPrices);
  const pad = (pMax - pMin) * 0.08 || pMin * 0.001;

  function toggleSeries(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  return (
    <ChartCard
      title="Cumulative Fill VWAP"
      subtitle="Running avg fill · market VWAP · fill prices — click legend to mute"
    >
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
          <XAxis
            dataKey="timeLabel"
            tick={{ fontSize: 9, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[pMin - pad, pMax + pad]}
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => v.toFixed(2)}
          />
          <Tooltip
            content={({ payload, label }) => {
              const d = payload?.[0]?.payload as DataPoint | undefined;
              if (!d) return null;
              return (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 shadow-lg text-xs">
                  <p className="text-gray-500 dark:text-gray-400 mb-1 font-mono">{label}</p>
                  {!hidden.has("runningFillAvg") && (
                    <p className="text-emerald-600 dark:text-emerald-400">
                      Avg Fill: <span className="font-semibold tabular-nums">{d.runningFillAvg.toFixed(4)}</span>
                    </p>
                  )}
                  {!hidden.has("marketVwapLine") && d.marketVwapLine !== undefined && (
                    <p className="text-blue-600 dark:text-blue-400">
                      Mkt VWAP: <span className="font-semibold tabular-nums">{d.marketVwapLine.toFixed(4)}</span>
                    </p>
                  )}
                  {!hidden.has("fillPrice") && (
                    <p className="text-violet-600 dark:text-violet-400">
                      Fill: <span className="font-semibold tabular-nums">{d.fillPrice.toFixed(4)}</span>
                    </p>
                  )}
                  <p className="text-gray-400 dark:text-gray-500 mt-0.5">
                    Cum Qty: <span className="tabular-nums">{d.cumQty.toLocaleString()}</span>
                  </p>
                </div>
              );
            }}
          />

          {/* Clickable legend */}
          <Legend
            onClick={(e) => {
              if (e?.dataKey && typeof e.dataKey === "string") toggleSeries(e.dataKey);
            }}
            formatter={(value: string) => {
              const s = SERIES[value];
              const label = s?.label ?? value;
              const muted = hidden.has(value);
              return (
                <span
                  style={{
                    color: muted ? "#94a3b8" : (s?.color ?? "#94a3b8"),
                    cursor: "pointer",
                    textDecoration: muted ? "line-through" : "none",
                    fontSize: 11,
                  }}
                >
                  {label}
                </span>
              );
            }}
            wrapperStyle={{ cursor: "pointer" }}
          />

          {arrivalPrice !== null && (
            <ReferenceLine
              y={arrivalPrice}
              stroke="#94a3b8"
              strokeDasharray="6 3"
              label={{ value: "Arrival", position: "right", fontSize: 9, fill: "#94a3b8" }}
            />
          )}

          <Line
            type="monotone"
            dataKey="runningFillAvg"
            stroke="#10b981"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            hide={hidden.has("runningFillAvg")}
          />
          {/* Running market VWAP — only rendered when Bloomberg enrichment is available */}
          {hasMarketVwap && (
            <Line
              type="monotone"
              dataKey="marketVwapLine"
              stroke="#3b82f6"
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              activeDot={{ r: 4 }}
              hide={hidden.has("marketVwapLine")}
            />
          )}
          <Line
            type="monotone"
            dataKey="fillPrice"
            stroke="#8b5cf6"
            strokeWidth={1}
            strokeDasharray="4 2"
            dot={{ r: 3, fill: "#8b5cf6" }}
            activeDot={{ r: 5 }}
            hide={hidden.has("fillPrice")}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

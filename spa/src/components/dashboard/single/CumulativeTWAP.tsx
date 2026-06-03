/**
 * CumulativeTWAP — running TWAP and running avg fill price vs arrival price.
 *
 * X-axis: fill time (UTC)
 * Amber dashed:  running market TWAP from Bloomberg trade ticks (if enriched, else hidden)
 * Green solid:   running avg fill price of the order (cumulative qty-weighted)
 * Purple dashed: individual fill prices
 * Gray dashed:   arrival price reference line
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

interface CumulativeTWAPProps {
  trades: TradeRecord[];
  arrivalPrice: number | null;
  /** Per-fill running market TWAP from order start to each fill. null/empty = not yet enriched. */
  runningMarketTwap: Array<{ t: number; twap: number }> | null;
  /** Explicit order window — drives x-axis domain so the chart shifts when times are overridden. */
  orderTime?: Date | null;
  lastFillTime?: Date | null;
}

interface DataPoint {
  t: number;
  timeLabel: string;
  runningFillAvg: number;      // cumulative qty-weighted avg fill price
  fillPrice: number;           // this fill's individual price
  marketTwapLine?: number;     // Bloomberg running market TWAP (optional)
  cumQty: number;
}

function fmtUtc(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

function buildData(
  trades: TradeRecord[],
  twapByTime: Map<number, number>,
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
    const marketTwapAtFill = twapByTime.get(tMs);
    return {
      t: tMs,
      timeLabel: fmtUtc(tMs),
      runningFillAvg,
      fillPrice: t.avgFillPrice,
      cumQty,
      ...(marketTwapAtFill !== undefined ? { marketTwapLine: marketTwapAtFill } : {}),
    };
  });
}

const SERIES: Record<string, { label: string; color: string; dash?: string }> = {
  runningFillAvg: { label: "Running Avg Fill",  color: "#10b981" },
  marketTwapLine: { label: "Market TWAP (BBG)", color: "#f59e0b", dash: "6 3" },
  fillPrice:      { label: "Fill Price",         color: "#8b5cf6", dash: "4 2" },
};

export function CumulativeTWAP({ trades, arrivalPrice, runningMarketTwap, orderTime, lastFillTime }: CumulativeTWAPProps) {
  const twapByTime = new Map((runningMarketTwap ?? []).map((p) => [p.t, p.twap]));
  const data = buildData(trades, twapByTime);
  const hasMarketTwap = (runningMarketTwap?.length ?? 0) > 0;
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  if (data.length === 0) {
    return (
      <ChartCard id="so-chart-twap" title="Cumulative Fill TWAP" subtitle="Running avg fill price vs arrival">
        <EmptyState message="No fill data" />
      </ChartCard>
    );
  }

  const allPrices = data.flatMap((d) => [d.runningFillAvg, d.fillPrice]);
  if (arrivalPrice !== null) allPrices.push(arrivalPrice);
  if (runningMarketTwap) runningMarketTwap.forEach((p) => allPrices.push(p.twap));
  const pMin = Math.min(...allPrices);
  const pMax = Math.max(...allPrices);
  const pad = (pMax - pMin) * 0.08 || pMin * 0.001;

  // X-axis domain: anchor to the order window when provided, but always include all fills
  const fillTimes = data.map((d) => d.t);
  const allTimes = [...fillTimes];
  if (orderTime) allTimes.push(orderTime.getTime());
  if (lastFillTime) allTimes.push(lastFillTime.getTime());
  const tMin = Math.min(...allTimes);
  const tMax = Math.max(...allTimes);
  const tPad = (tMax - tMin) * 0.04 || 30_000;
  const xDomain: [number, number] = [tMin - tPad, tMax + tPad];

  function toggleSeries(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  return (
    <ChartCard
      title="Cumulative Fill TWAP"
      subtitle="Running avg fill · market TWAP · fill prices — click legend to mute"
    >
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
          <XAxis
            dataKey="t"
            type="number"
            domain={xDomain}
            tickCount={5}
            minTickGap={60}
            tickFormatter={fmtUtc}
            tick={{ fontSize: 9, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={[pMin - pad, pMax + pad]}
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => v.toFixed(2)}
          />
          <Tooltip
            content={({ payload }) => {
              const d = payload?.[0]?.payload as DataPoint | undefined;
              if (!d) return null;
              return (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 shadow-lg text-xs">
                  <p className="text-gray-500 dark:text-gray-400 mb-1 font-mono">{d.timeLabel}</p>
                  {!hidden.has("runningFillAvg") && (
                    <p className="text-emerald-600 dark:text-emerald-400">
                      Avg Fill: <span className="font-semibold tabular-nums">{d.runningFillAvg.toFixed(4)}</span>
                    </p>
                  )}
                  {!hidden.has("marketTwapLine") && d.marketTwapLine !== undefined && (
                    <p className="text-amber-600 dark:text-amber-400">
                      Mkt TWAP: <span className="font-semibold tabular-nums">{d.marketTwapLine.toFixed(4)}</span>
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
          {/* Running market TWAP — only rendered when Bloomberg enrichment is available */}
          {hasMarketTwap && (
            <Line
              type="monotone"
              dataKey="marketTwapLine"
              stroke="#f59e0b"
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              activeDot={{ r: 4 }}
              hide={hidden.has("marketTwapLine")}
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

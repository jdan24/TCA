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
  /** Full-window market VWAP (orderTime → lastFillTime). Used as the trailing anchor value. */
  marketVwap?: number | null;
  /** Explicit order window — drives x-axis domain so the chart shifts when times are overridden. */
  orderTime?: Date | null;
  lastFillTime?: Date | null;
  /** When provided, price axis labels and tooltip values use this formatter (e.g. Treasury 32nds). */
  priceFormatter?: (v: number) => string;
  /** When provided, generates Y-axis ticks snapped to the contract's price grid (no duplicate labels). */
  yTicksForRange?: (pMin: number, pMax: number) => number[];
}

interface DataPoint {
  t: number;
  timeLabel: string;
  /** null on the orderTime anchor point (before any fill) — creates a line break for fill series */
  runningFillAvg: number | null;
  fillPrice: number | null;
  marketVwapLine?: number;
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
  /** Anchor at orderTime — extends the market line back to order start. */
  orderAnchor?: { t: number; value: number } | null,
  /** Anchor at Order End Time — extends the market line forward past the last fill. */
  endAnchor?: { t: number; value: number } | null,
): DataPoint[] {
  if (trades.length === 0) return [];

  const sorted = [...trades].sort(
    (a, b) => a.lastFillTime.getTime() - b.lastFillTime.getTime()
  );

  let cumNotional = 0;
  let cumQty = 0;

  const fillPoints: DataPoint[] = sorted.map((t) => {
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

  // Prepend a start anchor at orderTime so the market VWAP line starts there.
  // runningFillAvg / fillPrice are null → Recharts creates a line break for fill series
  // so those lines still start from the first actual fill.
  if (orderAnchor && (fillPoints.length === 0 || orderAnchor.t < fillPoints[0]!.t)) {
    fillPoints.unshift({
      t: orderAnchor.t,
      timeLabel: fmtUtc(orderAnchor.t),
      runningFillAvg: null,
      fillPrice: null,
      cumQty: 0,
      marketVwapLine: orderAnchor.value,
    });
  }

  // Append a trailing anchor at Order End Time if it extends past the last fill.
  // This extends the market VWAP line forward to show what the market did after execution.
  const lastPt = fillPoints[fillPoints.length - 1];
  if (endAnchor && lastPt && endAnchor.t > lastPt.t) {
    fillPoints.push({
      t: endAnchor.t,
      timeLabel: fmtUtc(endAnchor.t),
      runningFillAvg: null,
      fillPrice: null,
      cumQty: lastPt.cumQty,
      marketVwapLine: endAnchor.value,
    });
  }

  return fillPoints;
}

const SERIES: Record<string, { label: string; color: string; dash?: string }> = {
  runningFillAvg: { label: "Running Avg Fill",  color: "#10b981" },
  marketVwapLine: { label: "Market VWAP (BBG)", color: "#3b82f6", dash: "6 3" },
  fillPrice:      { label: "Fill Price",         color: "#8b5cf6", dash: "4 2" },
};

export function CumulativeVWAP({ trades, arrivalPrice, runningMarketVwap, marketVwap, orderTime, lastFillTime, priceFormatter, yTicksForRange }: CumulativeVWAPProps) {
  const fmtPrice = priceFormatter ?? ((v: number) => v.toFixed(4));
  const vwapByTime = new Map((runningMarketVwap ?? []).map((p) => [p.t, p.vwap]));
  const hasMarketVwap = (runningMarketVwap?.length ?? 0) > 0;
  // Anchor at orderTime using arrival price so the market line starts there, not at the first fill.
  const orderAnchor = (hasMarketVwap && orderTime && arrivalPrice !== null)
    ? { t: orderTime.getTime(), value: arrivalPrice }
    : null;
  // Trailing anchor at Order End Time: extends the market line past the last fill dot.
  const endAnchor = (hasMarketVwap && lastFillTime && (marketVwap ?? null) !== null)
    ? { t: lastFillTime.getTime(), value: marketVwap! }
    : null;
  const data = buildData(trades, vwapByTime, orderAnchor, endAnchor);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  if (data.length === 0) {
    return (
      <ChartCard id="so-chart-vwap" title="Cumulative Fill VWAP" subtitle="Running avg fill price vs arrival">
        <EmptyState message="No fill data" />
      </ChartCard>
    );
  }

  const allPrices: number[] = data.flatMap((d) =>
    [d.runningFillAvg, d.fillPrice].filter((v): v is number => v !== null),
  );
  if (arrivalPrice !== null) allPrices.push(arrivalPrice);
  if (runningMarketVwap) runningMarketVwap.forEach((p) => allPrices.push(p.vwap));
  const pMin = Math.min(...allPrices);
  const pMax = Math.max(...allPrices);

  const snappedTicks = yTicksForRange ? yTicksForRange(pMin, pMax) : undefined;
  const yAxisDomain: [number, number] = (() => {
    if (snappedTicks && snappedTicks.length >= 1) {
      const first = snappedTicks[0]!;
      const last  = snappedTicks[snappedTicks.length - 1]!;
      const step  = snappedTicks.length >= 2 ? snappedTicks[1]! - snappedTicks[0]! : first * 0.001;
      return [first - step * 0.4, last + step * 0.4];
    }
    const pad = (pMax - pMin) * 0.08 || pMin * 0.001;
    return [pMin - pad, pMax + pad];
  })();

  // X-axis domain: anchor to the order window when provided, but always include all fills.
  // When orderTime is explicit use it as the hard left boundary (no padding) so the chart
  // starts exactly at the edited order start time.
  const fillTimes = data.map((d) => d.t);
  const allTimes = [...fillTimes];
  if (orderTime) allTimes.push(orderTime.getTime());
  if (lastFillTime) allTimes.push(lastFillTime.getTime());
  const tMin = Math.min(...allTimes);
  const tMax = Math.max(...allTimes);
  const tSpan = tMax - tMin;
  const leftPad  = orderTime   ? 0 : (tSpan * 0.04 || 30_000);
  const rightPad = tSpan * 0.02 || 30_000;
  const xDomain: [number, number] = [tMin - leftPad, tMax + rightPad];

  function toggleSeries(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  return (
    <ChartCard
      id="so-chart-vwap"
      title="Cumulative Fill VWAP"
      subtitle="Running avg fill · market VWAP · fill prices — click legend to mute"
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
            domain={yAxisDomain}
            {...(snappedTicks && { ticks: snappedTicks })}
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={fmtPrice}
            {...(priceFormatter && { width: 72 })}
          />
          <Tooltip
            content={({ payload }) => {
              const d = payload?.[0]?.payload as DataPoint | undefined;
              if (!d) return null;
              return (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 shadow-lg text-xs">
                  <p className="text-gray-500 dark:text-gray-400 mb-1 font-mono">{d.timeLabel}</p>
                  {!hidden.has("runningFillAvg") && d.runningFillAvg !== null && (
                    <p className="text-emerald-600 dark:text-emerald-400">
                      Avg Fill: <span className="font-semibold tabular-nums">{fmtPrice(d.runningFillAvg)}</span>
                    </p>
                  )}
                  {!hidden.has("marketVwapLine") && d.marketVwapLine !== undefined && (
                    <p className="text-blue-600 dark:text-blue-400">
                      Mkt VWAP: <span className="font-semibold tabular-nums">{fmtPrice(d.marketVwapLine)}</span>
                    </p>
                  )}
                  {!hidden.has("fillPrice") && d.fillPrice !== null && (
                    <p className="text-violet-600 dark:text-violet-400">
                      Fill: <span className="font-semibold tabular-nums">{fmtPrice(d.fillPrice)}</span>
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

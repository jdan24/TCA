/**
 * ExecutionTimeline — fill prices overlaid on the continuous market last price.
 *
 * Gray line:   Bloomberg last-traded price tick stream over [orderTime, lastFillTime]
 *              (only rendered when Bloomberg enrichment is available)
 * Colored dots: individual fill prices (blue=BUY, red=SELL), size ∝ qty
 * Gray dashed:  arrival price reference line
 *
 * Uses ComposedChart so the Line (market ticks) and Scatter (fills) share the
 * same X/Y axes.
 */

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { TradeRecord } from "@/types";
import { ChartCard, EmptyState } from "@/components/dashboard/dashboardUtils";

interface ExecutionTimelineProps {
  trades: TradeRecord[];
  arrivalPrice: number | null;
  /** Bloomberg last-traded price ticks over [orderTime, lastFillTime].
   *  null = Bloomberg not yet enriched → no market price line shown. */
  marketTicks: Array<{ t: number; price: number }> | null;
}

interface FillPoint {
  t: number;
  price: number;
  qty: number;
  label: string;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

export function ExecutionTimeline({ trades, arrivalPrice, marketTicks }: ExecutionTimelineProps) {
  if (trades.length === 0) {
    return (
      <ChartCard title="Execution Timeline" subtitle="Fill price vs time">
        <EmptyState message="No fill data" />
      </ChartCard>
    );
  }

  const fillPoints: FillPoint[] = trades.map((t) => ({
    t: t.lastFillTime.getTime(),
    price: t.avgFillPrice,
    qty: t.orderQty,
    label: t.orderId,
  }));

  const side = trades[0]?.side ?? "BUY";
  const fillColor = side === "SELL" ? "#ef4444" : "#3b82f6";
  const maxQty = Math.max(...fillPoints.map((p) => p.qty));

  // ── Axis domains spanning both fill points and market ticks ──────────────
  const allPrices: number[] = [
    ...fillPoints.map((p) => p.price),
    ...(marketTicks ?? []).map((t) => t.price),
  ];
  if (arrivalPrice !== null) allPrices.push(arrivalPrice);
  const pMin = Math.min(...allPrices);
  const pMax = Math.max(...allPrices);
  const pPad = (pMax - pMin) * 0.08 || pMin * 0.001;
  const yDomain: [number, number] = [pMin - pPad, pMax + pPad];

  const allTimes = [
    ...fillPoints.map((p) => p.t),
    ...(marketTicks ?? []).map((t) => t.t),
  ];
  const tMin = Math.min(...allTimes);
  const tMax = Math.max(...allTimes);
  const tPad = (tMax - tMin) * 0.04 || 30_000;
  const xDomain: [number, number] = [tMin - tPad, tMax + tPad];

  const hasMarket = (marketTicks?.length ?? 0) > 0;

  const subtitle = hasMarket
    ? `Fill price vs market last (BBG) — ${side} · dot size ∝ qty`
    : `Fill price vs time — ${side} · dot size ∝ qty · fetch Bloomberg to see market line`;

  return (
    <ChartCard title="Execution Timeline" subtitle={subtitle}>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart
          data={marketTicks ?? []}
          margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={xDomain}
            tickFormatter={fmtTime}
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={false}
            name="Time"
          />
          <YAxis
            type="number"
            domain={yDomain}
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => v.toFixed(2)}
            name="Price"
          />
          {/* ZAxis controls scatter dot size; applies to the Scatter series */}
          <ZAxis dataKey="qty" range={[40, Math.max(200, maxQty * 2)]} name="Qty" />

          {arrivalPrice !== null && (
            <ReferenceLine
              y={arrivalPrice}
              stroke="#94a3b8"
              strokeDasharray="4 4"
              label={{ value: "Arrival", position: "right", fontSize: 9, fill: "#94a3b8" }}
            />
          )}

          {/* Market last-traded price line — only when Bloomberg data is available */}
          {hasMarket && (
            <Line
              dataKey="price"
              stroke="#94a3b8"
              strokeWidth={1.5}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
              name="Mkt Last"
              legendType="none"
            />
          )}

          {/* Fill price dots — size encodes qty via ZAxis */}
          <Scatter
            data={fillPoints}
            fill={fillColor}
            fillOpacity={0.8}
            name="Fills"
          />

          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ payload }) => {
              if (!payload || payload.length === 0) return null;

              // Prefer scatter (fill) payload over line (tick) payload
              const fillEntry = payload.find(
                (p) => p.name === "Fills" && p.payload?.label !== undefined,
              );
              if (fillEntry) {
                const d = fillEntry.payload as FillPoint;
                return (
                  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 shadow-lg text-xs">
                    <p className="font-mono text-gray-500 dark:text-gray-400 mb-1">{d.label}</p>
                    <p className="text-gray-800 dark:text-gray-200">
                      Fill: <span className="font-semibold tabular-nums">{d.price.toFixed(4)}</span>
                    </p>
                    <p className="text-gray-800 dark:text-gray-200">
                      Qty: <span className="font-semibold tabular-nums">{d.qty.toLocaleString()}</span>
                    </p>
                    <p className="text-gray-500 dark:text-gray-400 font-mono">{fmtTime(d.t)}</p>
                  </div>
                );
              }

              // Fallback: market price line hover
              const mktEntry = payload.find((p) => p.name === "Mkt Last");
              if (mktEntry) {
                const d = mktEntry.payload as { t: number; price: number };
                return (
                  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 shadow-lg text-xs">
                    <p className="text-gray-400 dark:text-gray-500 mb-0.5">Market Last</p>
                    <p className="text-gray-800 dark:text-gray-200">
                      <span className="font-semibold tabular-nums">{(d.price as number).toFixed(4)}</span>
                    </p>
                    <p className="text-gray-500 dark:text-gray-400 font-mono">{fmtTime(d.t as number)}</p>
                  </div>
                );
              }

              return null;
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

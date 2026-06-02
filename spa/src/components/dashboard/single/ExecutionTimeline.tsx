/**
 * ExecutionTimeline — fill prices overlaid on the continuous market last price.
 *
 * Gray line:   Bloomberg last-traded price tick stream over [orderTime, lastFillTime]
 *              (only rendered when Bloomberg enrichment is available)
 * Colored dots: individual fill prices (blue=BUY, red=SELL), size ∝ qty
 * Gray dashed:  arrival price reference line
 *
 * Uses ComposedChart with two Lines so both series share the same axes reliably.
 * The fill-dot "line" has strokeWidth=0 and a custom dot renderer sized by qty.
 */

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TradeRecord } from "@/types";
import { ChartCard, EmptyState } from "@/components/dashboard/dashboardUtils";

interface ExecutionTimelineProps {
  trades: TradeRecord[];
  arrivalPrice: number | null;
  /** Bloomberg last-traded price ticks over [orderTime, lastFillTime].
   *  null = Bloomberg not yet enriched → only fill dots are shown. */
  marketTicks: Array<{ t: number; price: number }> | null;
}

interface FillPoint {
  t: number;
  fillPrice: number;
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

  const side     = trades[0]?.side ?? "BUY";
  const fillColor = side === "SELL" ? "#ef4444" : "#3b82f6";

  const fillPoints: FillPoint[] = trades.map((t) => ({
    t:         t.lastFillTime.getTime(),
    fillPrice: t.avgFillPrice,
    qty:       t.orderQty,
    label:     t.orderId,
  }));

  const maxQty    = Math.max(...fillPoints.map((p) => p.qty));
  const hasMarket = (marketTicks?.length ?? 0) > 0;

  // ── Axis domains spanning both series ─────────────────────────────────────
  const allPrices: number[] = [
    ...fillPoints.map((p) => p.fillPrice),
    ...(marketTicks ?? []).map((t) => t.price),
  ];
  if (arrivalPrice !== null) allPrices.push(arrivalPrice);
  const pMin  = Math.min(...allPrices);
  const pMax  = Math.max(...allPrices);
  const pPad  = (pMax - pMin) * 0.1 || pMin * 0.001;
  const yDomain: [number, number] = [pMin - pPad, pMax + pPad];

  const allTimes = [
    ...fillPoints.map((p) => p.t),
    ...(marketTicks ?? []).map((t) => t.t),
  ];
  const tMin  = Math.min(...allTimes);
  const tMax  = Math.max(...allTimes);
  const tPad  = (tMax - tMin) * 0.05 || 30_000;
  const xDomain: [number, number] = [tMin - tPad, tMax + tPad];

  const subtitle = hasMarket
    ? `Fill prices vs market last (BBG) — ${side} · dot size ∝ qty`
    : `Fill price vs time — ${side} · dot size ∝ qty · fetch Bloomberg to add market line`;

  // Custom dot renderer for the fill-price Line — sizes each dot by qty
  const renderFillDot = (dotProps: unknown) => {
    const { cx, cy, payload } = dotProps as {
      cx?: number;
      cy?: number;
      payload?: FillPoint;
    };
    if (cx === undefined || cy === undefined || !payload?.fillPrice) return <g />;
    const r = 5 + (payload.qty / maxQty) * 7; // 5–12 px
    return (
      <circle
        key={`fill-${payload.t}`}
        cx={cx}
        cy={cy}
        r={r}
        fill={fillColor}
        fillOpacity={0.85}
        stroke="white"
        strokeWidth={1.5}
      />
    );
  };

  return (
    <ChartCard title="Execution Timeline" subtitle={subtitle}>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart
          data={marketTicks ?? []}
          margin={{ top: 8, right: 20, bottom: 8, left: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />

          <XAxis
            dataKey="t"
            type="number"
            domain={xDomain}
            tickCount={5}
            minTickGap={60}
            tickFormatter={fmtTime}
            tick={{ fontSize: 9, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="number"
            domain={yDomain}
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => v.toFixed(2)}
          />

          {arrivalPrice !== null && (
            <ReferenceLine
              y={arrivalPrice}
              stroke="#94a3b8"
              strokeDasharray="4 4"
              label={{ value: "Arrival", position: "right", fontSize: 9, fill: "#94a3b8" }}
            />
          )}

          {/* Market last-traded price — uses chart-level data ({t, price}) */}
          {hasMarket && (
            <Line
              dataKey="price"
              stroke="#cbd5e1"
              strokeWidth={1.5}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
              legendType="none"
            />
          )}

          {/* Fill dots — own data prop, invisible connecting line, custom sized dots */}
          <Line
            data={fillPoints}
            dataKey="fillPrice"
            stroke="transparent"
            strokeWidth={0}
            dot={renderFillDot}
            activeDot={{ r: 9, fill: fillColor, stroke: "white", strokeWidth: 2 }}
            isAnimationActive={false}
            legendType="none"
          />

          <Tooltip
            cursor={{ strokeDasharray: "3 3", stroke: "#94a3b8" }}
            content={({ payload }) => {
              if (!payload || payload.length === 0) return null;

              // Prefer fill-dot entry (has fillPrice + label)
              const fillEntry = payload.find(
                (p) => (p.payload as Record<string, unknown>)?.label !== undefined,
              );
              if (fillEntry) {
                const d = fillEntry.payload as FillPoint;
                return (
                  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 shadow-lg text-xs">
                    <p className="font-mono text-gray-400 dark:text-gray-500 mb-1">{d.label}</p>
                    <p className="text-gray-800 dark:text-gray-200">
                      Fill:{" "}
                      <span className="font-semibold tabular-nums">{d.fillPrice.toFixed(4)}</span>
                    </p>
                    <p className="text-gray-800 dark:text-gray-200">
                      Qty:{" "}
                      <span className="font-semibold tabular-nums">{d.qty.toLocaleString()}</span>
                    </p>
                    <p className="text-gray-500 dark:text-gray-400 font-mono mt-0.5">
                      {fmtTime(d.t)}
                    </p>
                  </div>
                );
              }

              // Fallback: market price tick hover
              const mkt = payload[0]?.payload as { t: number; price: number } | undefined;
              if (!mkt?.price) return null;
              return (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 shadow-lg text-xs">
                  <p className="text-gray-400 dark:text-gray-500 mb-0.5">Market Last</p>
                  <p className="text-gray-800 dark:text-gray-200 font-semibold tabular-nums">
                    {mkt.price.toFixed(4)}
                  </p>
                  <p className="text-gray-500 dark:text-gray-400 font-mono">{fmtTime(mkt.t)}</p>
                </div>
              );
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

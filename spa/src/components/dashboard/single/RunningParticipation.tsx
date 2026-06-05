/**
 * RunningParticipation — running % participation rate with market last price overlay.
 *
 * Left Y-axis (orange):  participation(t) = Σ(our qty to t) / Σ(mkt tick sizes to t) × 100
 * Right Y-axis (gray):   Bloomberg last-traded price (same tick stream as ExecutionTimeline)
 * Clickable legend to mute/unmute each series.
 */

import { useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TradeRecord } from "@/types";
import { ChartCard, EmptyState } from "@/components/dashboard/dashboardUtils";

interface RunningParticipationProps {
  trades: TradeRecord[];
  marketVolTicks: Array<{ t: number; size: number }> | null;
  marketTicks:    Array<{ t: number; price: number }> | null;
  orderTime?: Date | null;
  lastFillTime?: Date | null;
}

interface PartPoint {
  t: number;
  pct: number;
  cumOurQty: number;
  cumMktVol: number;
}

/**
 * Unified chart row shared by both series so the tooltip's active payload tracks
 * the mouse. Participation rows also carry the market `price` at their time, so
 * hovering the participation line shows participation + market last + time
 * together. Market-tick rows carry only `price`.
 */
interface ChartRow {
  t: number;
  price?: number;
  pct?: number;
  cumOurQty?: number;
  cumMktVol?: number;
}

/** Last market price at or before time `t` (step/last semantics). */
function priceAtTime(sortedTicks: Array<{ t: number; price: number }>, t: number): number | undefined {
  if (sortedTicks.length === 0) return undefined;
  let lo = 0, hi = sortedTicks.length - 1;
  let ans: number | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedTicks[mid]!.t <= t) { ans = sortedTicks[mid]!.price; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans ?? sortedTicks[0]!.price;
}

const SERIES: Record<string, { label: string; color: string }> = {
  pct:   { label: "Participation %",    color: "#f97316" },
  price: { label: "Market Last (BBG)",  color: "#94a3b8" },
};

function fmtUtc(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

function buildPartData(
  trades: TradeRecord[],
  marketVolTicks: Array<{ t: number; size: number }>,
): PartPoint[] {
  const sorted = [...trades].sort((a, b) => a.lastFillTime.getTime() - b.lastFillTime.getTime());
  const ticks  = [...marketVolTicks].sort((a, b) => a.t - b.t);

  let cumOurQty = 0, cumMktVol = 0, tickIdx = 0;
  const points: PartPoint[] = [];

  for (const fill of sorted) {
    cumOurQty += fill.orderQty;
    const fillMs = fill.lastFillTime.getTime();
    while (tickIdx < ticks.length && ticks[tickIdx]!.t <= fillMs) {
      cumMktVol += ticks[tickIdx]!.size;
      tickIdx++;
    }
    if (cumMktVol > 0) {
      points.push({ t: fillMs, pct: (cumOurQty / cumMktVol) * 100, cumOurQty, cumMktVol });
    }
  }
  return points;
}

export function RunningParticipation({ trades, marketVolTicks, marketTicks, orderTime, lastFillTime }: RunningParticipationProps) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  if (!marketVolTicks || marketVolTicks.length === 0) {
    return (
      <ChartCard id="so-chart-participation" title="Running Participation Rate" subtitle="% of market volume — fetch Bloomberg to enable">
        <EmptyState message="Bloomberg trade tick data required" />
      </ChartCard>
    );
  }

  const partData   = buildPartData(trades, marketVolTicks);
  const hasPrice   = (marketTicks?.length ?? 0) > 0;

  if (partData.length === 0) {
    return (
      <ChartCard id="so-chart-participation" title="Running Participation Rate" subtitle="% of market volume">
        <EmptyState message="No fill data" />
      </ChartCard>
    );
  }

  function toggle(key: string) {
    setHidden((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  const finalPct = partData[partData.length - 1]?.pct ?? null;
  const maxPct   = Math.max(...partData.map((d) => d.pct));
  const yPctMax  = Math.max(maxPct * 1.15, 1);

  // Price axis domain
  const priceValues = (marketTicks ?? []).map((t) => t.price);
  const pMin = priceValues.length > 0 ? Math.min(...priceValues) : 0;
  const pMax = priceValues.length > 0 ? Math.max(...priceValues) : 1;
  const pPad = (pMax - pMin) * 0.1 || pMin * 0.001;
  const yPriceDomain: [number, number] = [pMin - pPad, pMax + pPad];

  // X domain spans both series plus the explicit order window when provided.
  // No left padding when orderTime is explicit — start exactly at the order start.
  const allTimes = [
    ...partData.map((d) => d.t),
    ...(marketTicks ?? []).map((t) => t.t),
  ];
  if (orderTime) allTimes.push(orderTime.getTime());
  if (lastFillTime) allTimes.push(lastFillTime.getTime());
  const tMin = Math.min(...allTimes);
  const tMax = Math.max(...allTimes);
  const tSpan = tMax - tMin;
  const leftPad  = orderTime   ? 0 : (tSpan * 0.04 || 30_000);
  const rightPad = tSpan * 0.02 || 30_000;
  const xDomain: [number, number] = [tMin - leftPad, tMax + rightPad];

  // Single, time-sorted data array shared by both series. Participation rows
  // carry the interpolated market last so the tooltip can show price + time too.
  const sortedTicks = [...(marketTicks ?? [])].sort((a, b) => a.t - b.t);
  const chartRows: ChartRow[] = [
    ...sortedTicks.map((mt): ChartRow => ({ t: mt.t, price: mt.price })),
    ...partData.map((d): ChartRow => {
      const price = priceAtTime(sortedTicks, d.t);
      return price !== undefined
        ? { t: d.t, pct: d.pct, cumOurQty: d.cumOurQty, cumMktVol: d.cumMktVol, price }
        : { t: d.t, pct: d.pct, cumOurQty: d.cumOurQty, cumMktVol: d.cumMktVol };
    }),
  ].sort((a, b) => a.t - b.t);

  return (
    <ChartCard
      id="so-chart-participation"
      title="Running Participation Rate"
      subtitle={
        finalPct !== null
          ? `Final: ${finalPct.toFixed(2)}%`
          : "our cumulative qty / Σ market prints"
      }
    >
      <ResponsiveContainer width="100%" height={260}>
        {/* Both series read from one unified, time-sorted array (chartRows). */}
        <ComposedChart data={chartRows} margin={{ top: 8, right: 56, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />

          <XAxis
            dataKey="t" type="number" domain={xDomain}
            tickCount={5} minTickGap={60} tickFormatter={fmtUtc}
            tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false}
          />

          {/* Left axis — participation % */}
          <YAxis
            yAxisId="pct" orientation="left"
            domain={[0, yPctMax]}
            tick={{ fontSize: 10, fill: "#f97316" }}
            tickLine={false} axisLine={false}
            tickFormatter={(v: number) => `${v.toFixed(1)}%`}
            width={42}
          />

          {/* Right axis — market last price */}
          {hasPrice && (
            <YAxis
              yAxisId="price" orientation="right"
              domain={yPriceDomain}
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              tickLine={false} axisLine={false}
              tickFormatter={(v: number) => v.toFixed(2)}
              width={54}
            />
          )}

          {/* Final participation reference line */}
          {finalPct !== null && !hidden.has("pct") && (
            <ReferenceLine
              yAxisId="pct" y={finalPct}
              stroke="#f97316" strokeDasharray="4 2" strokeOpacity={0.5}
              label={{ value: `${finalPct.toFixed(2)}%`, position: "insideTopLeft", fontSize: 9, fill: "#f97316" }}
            />
          )}

          {/* Market last price line */}
          {hasPrice && (
            <Line
              yAxisId="price"
              dataKey="price"
              stroke="#cbd5e1" strokeWidth={1.5}
              dot={false} activeDot={false}
              isAnimationActive={false}
              connectNulls
              hide={hidden.has("price")}
              name="price"
            />
          )}

          {/* Participation % line — step-after */}
          <Line
            yAxisId="pct"
            dataKey="pct"
            stroke="#f97316" strokeWidth={2}
            type="stepAfter"
            dot={{ r: 3.5, fill: "#f97316", stroke: "white", strokeWidth: 1.5 }}
            activeDot={{ r: 6, fill: "#f97316", stroke: "white", strokeWidth: 2 }}
            isAnimationActive={false}
            connectNulls
            hide={hidden.has("pct")}
            name="pct"
          />

          <Legend
            onClick={(e) => { if (e?.dataKey && typeof e.dataKey === "string") toggle(e.dataKey); }}
            formatter={(value: string) => {
              const s = SERIES[value];
              const label = s?.label ?? value;
              const muted = hidden.has(value);
              return (
                <span style={{
                  color: muted ? "#94a3b8" : (s?.color ?? "#94a3b8"),
                  cursor: "pointer",
                  textDecoration: muted ? "line-through" : "none",
                  fontSize: 11,
                }}>
                  {label}
                </span>
              );
            }}
            wrapperStyle={{ cursor: "pointer" }}
          />

          <Tooltip
            cursor={{ strokeDasharray: "3 3", stroke: "#94a3b8" }}
            content={({ payload }) => {
              // Both series share one data array — read the single active row.
              const d = payload?.[0]?.payload as ChartRow | undefined;
              if (!d) return null;

              const showPct = d.pct !== undefined && !hidden.has("pct");
              const showPx  = d.price !== undefined && !hidden.has("price");
              if (!showPct && !showPx) return null;

              return (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 shadow-lg text-xs space-y-0.5">
                  <p className="text-gray-500 dark:text-gray-400 font-mono mb-1">{fmtUtc(d.t)}</p>
                  {showPct && (
                    <>
                      <p className="text-orange-600 dark:text-orange-400">
                        Part: <span className="font-semibold tabular-nums">{d.pct!.toFixed(3)}%</span>
                      </p>
                      <p className="text-gray-600 dark:text-gray-300">
                        Our qty: <span className="tabular-nums">{(d.cumOurQty ?? 0).toLocaleString()}</span>
                      </p>
                      <p className="text-gray-600 dark:text-gray-300">
                        Mkt vol: <span className="tabular-nums">{(d.cumMktVol ?? 0).toLocaleString()}</span>
                      </p>
                    </>
                  )}
                  {showPx && (
                    <p className="text-gray-500 dark:text-gray-400">
                      Market Last:{" "}
                      <span className="font-semibold tabular-nums">{d.price!.toFixed(4)}</span>
                    </p>
                  )}
                </div>
              );
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

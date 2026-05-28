/**
 * CumulativeVWAP — line chart showing running VWAP vs arrival price
 * across fills over the order's execution.
 *
 * X-axis: fill time
 * Y-axis: price
 * Blue line: running VWAP (updates with each fill)
 * Dashed gray line: arrival price (constant reference)
 */

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
}

interface DataPoint {
  t: number; // epoch ms
  timeLabel: string;
  runningVwap: number;
  fillPrice: number;
  cumQty: number;
}

function buildData(trades: TradeRecord[]): DataPoint[] {
  if (trades.length === 0) return [];

  // Sort by fill time
  const sorted = [...trades].sort(
    (a, b) => a.firstFillTime.getTime() - b.firstFillTime.getTime()
  );

  let cumNotional = 0;
  let cumQty = 0;

  return sorted.map((t) => {
    cumNotional += t.avgFillPrice * t.orderQty;
    cumQty += t.orderQty;
    const runningVwap = cumQty > 0 ? cumNotional / cumQty : t.avgFillPrice;
    const tMs = t.firstFillTime.getTime();
    return {
      t: tMs,
      timeLabel: new Date(tMs).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      runningVwap,
      fillPrice: t.avgFillPrice,
      cumQty,
    };
  });
}

export function CumulativeVWAP({ trades, arrivalPrice }: CumulativeVWAPProps) {
  const data = buildData(trades);

  if (data.length === 0) {
    return (
      <ChartCard title="Cumulative VWAP" subtitle="Running VWAP vs arrival price">
        <EmptyState message="No fill data" />
      </ChartCard>
    );
  }

  const allPrices = data.flatMap((d) => [d.runningVwap, d.fillPrice]);
  if (arrivalPrice !== null) allPrices.push(arrivalPrice);
  const pMin = Math.min(...allPrices);
  const pMax = Math.max(...allPrices);
  const pad = (pMax - pMin) * 0.05 || pMin * 0.001;

  return (
    <ChartCard title="Cumulative VWAP" subtitle="Running VWAP (blue) vs arrival price (dashed)">
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
          <XAxis
            dataKey="timeLabel"
            tick={{ fontSize: 10, fill: "#94a3b8" }}
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
                  <p className="text-gray-500 dark:text-gray-400 mb-1">{label}</p>
                  <p className="text-blue-600 dark:text-blue-400">
                    VWAP: <span className="font-semibold tabular-nums">{d.runningVwap.toFixed(4)}</span>
                  </p>
                  <p className="text-gray-700 dark:text-gray-300">
                    Fill: <span className="font-semibold tabular-nums">{d.fillPrice.toFixed(4)}</span>
                  </p>
                  <p className="text-gray-400 dark:text-gray-500">
                    Cum Qty: <span className="tabular-nums">{d.cumQty.toLocaleString()}</span>
                  </p>
                </div>
              );
            }}
          />
          <Legend
            formatter={(value) =>
              value === "runningVwap" ? "Running VWAP" : "Fill Price"
            }
            wrapperStyle={{ fontSize: 11 }}
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
            dataKey="runningVwap"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="fillPrice"
            stroke="#10b981"
            strokeWidth={1}
            strokeDasharray="4 2"
            dot={{ r: 3, fill: "#10b981" }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

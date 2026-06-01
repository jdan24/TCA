/**
 * ExecutionTimeline — scatter chart of fill price vs fill time.
 *
 * Each point = one child slice.
 * A horizontal dashed reference line marks the arrival price.
 * Point radius is proportional to qty (encoded via ZAxis).
 */

import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
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
}

interface Point {
  t: number; // epoch ms
  price: number;
  qty: number;
  label: string;
}

export function ExecutionTimeline({ trades, arrivalPrice }: ExecutionTimelineProps) {
  if (trades.length === 0) {
    return (
      <ChartCard title="Execution Timeline" subtitle="Fill price vs time">
        <EmptyState message="No fill data" />
      </ChartCard>
    );
  }

  // Use lastFillTime — the time when the slice completed execution.
  // firstFillTime falls back to orderTime when only one time column is
  // mapped, causing every point to cluster at the parent-order creation
  // time.  lastFillTime is the most reliable per-fill timestamp.
  const points: Point[] = trades.map((t) => ({
    t: t.lastFillTime.getTime(),
    price: t.avgFillPrice,
    qty: t.orderQty,
    label: t.orderId,
  }));

  // Format epoch ms as HH:MM:SS UTC so it matches the timestamps shown
  // elsewhere in the tool and is unambiguous for FIX data (which is UTC).
  function fmtTime(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
  }

  const maxQty = Math.max(...points.map((p) => p.qty));

  return (
    <ChartCard title="Execution Timeline" subtitle="Fill price vs time — point size ∝ qty">
      <ResponsiveContainer width="100%" height={260}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
          <XAxis
            dataKey="t"
            type="number"
            domain={["auto", "auto"]}
            tickFormatter={fmtTime}
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={false}
            name="Time"
          />
          <YAxis
            dataKey="price"
            type="number"
            domain={["auto", "auto"]}
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => v.toFixed(2)}
            name="Price"
          />
          <ZAxis dataKey="qty" range={[40, Math.max(200, maxQty * 2)]} name="Qty" />

          {arrivalPrice !== null && (
            <ReferenceLine
              y={arrivalPrice}
              stroke="#94a3b8"
              strokeDasharray="4 4"
              label={{ value: "Arrival", position: "right", fontSize: 9, fill: "#94a3b8" }}
            />
          )}

          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ payload }) => {
              const d = payload?.[0]?.payload as Point | undefined;
              if (!d) return null;
              return (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 shadow-lg text-xs">
                  <p className="font-mono text-gray-500 dark:text-gray-400 mb-1">{d.label}</p>
                  <p className="text-gray-800 dark:text-gray-200">
                    Price: <span className="font-semibold tabular-nums">{d.price.toFixed(4)}</span>
                  </p>
                  <p className="text-gray-800 dark:text-gray-200">
                    Qty: <span className="font-semibold tabular-nums">{d.qty.toLocaleString()}</span>
                  </p>
                  <p className="text-gray-500 dark:text-gray-400 font-mono">{fmtTime(d.t)}</p>
                </div>
              );
            }}
          />

          <Scatter
            data={points}
            fill="#3b82f6"
            fillOpacity={0.75}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

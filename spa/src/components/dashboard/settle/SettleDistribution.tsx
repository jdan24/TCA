/**
 * SettleDistribution — slippage vs settle for every benchmarked order.
 *
 * Plotted against the order's last fill time within its window, so a bias to one
 * side of the settle shows as a cluster above or below the zero line, and a
 * single outlier separates from a systematic drift. One series per window, since
 * the two benchmarks are different things and averaging them would hide which
 * one is driving the result.
 */

import { useMemo } from "react";
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SettleResult, TradeRecord } from "@/types";
import { settleWindowLabel } from "@/tca/settle";
import { ChartCard, EmptyState, fmtBps } from "@/components/dashboard/dashboardUtils";

interface Point {
  /** Minutes from the settle instant; negative means before it. */
  offsetMin: number;
  slip: number;
  symbol: string;
}

const SERIES: Array<{ window: "3pm" | "4pm"; color: string }> = [
  { window: "3pm", color: "#3b82f6" },
  { window: "4pm", color: "#f59e0b" },
];

export function SettleDistribution({
  trades,
  results,
}: {
  trades: TradeRecord[];
  results: SettleResult[];
}) {
  const series = useMemo(() => {
    const tradeById = new Map(trades.map((t) => [t.orderId, t]));
    return SERIES.map(({ window, color }) => {
      const pts: Point[] = [];
      for (const r of results) {
        if (r.window !== window || r.slip_bps === null) continue;
        const trade = tradeById.get(r.orderId);
        if (!trade) continue;
        // The settle instant is the window's hour on the order's NY date; the
        // offset is derived from it so both windows share one x-axis.
        const settleHour = window === "3pm" ? 15 : 16;
        const nyMinutes = minutesIntoNyDay(trade.lastFillTime);
        pts.push({
          offsetMin: nyMinutes - settleHour * 60,
          slip: r.slip_bps,
          symbol: trade.symbol,
        });
      }
      return { window, color, pts };
    }).filter((s) => s.pts.length > 0);
  }, [trades, results]);

  if (series.length === 0) {
    return (
      <ChartCard title="Slippage Distribution" subtitle="Slippage vs settle, by order">
        <EmptyState message="No benchmarked orders to plot" />
      </ChartCard>
    );
  }

  const total = series.reduce((n, s) => n + s.pts.length, 0);

  return (
    <ChartCard
      title="Slippage Distribution"
      subtitle={`${total} benchmarked order${total !== 1 ? "s" : ""} — minutes from the settle vs slippage (bps)`}
    >
      <ResponsiveContainer width="100%" height={260}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 28, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="offsetMin"
            type="number"
            name="Minutes from settle"
            tick={{ fontSize: 11 }}
            tickFormatter={(v: unknown) =>
              typeof v === "number" ? (v > 0 ? `+${v}` : String(v)) : ""
            }
            label={{ value: "minutes from settle", position: "insideBottom", offset: -14, fontSize: 10 }}
          />
          <YAxis
            dataKey="slip"
            type="number"
            name="Slippage"
            tick={{ fontSize: 11 }}
            width={44}
          />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            formatter={(v: unknown, name: unknown) =>
              name === "Slippage" && typeof v === "number"
                ? [fmtBps(v), "Slippage vs settle"]
                : [String(v), String(name)]
            }
          />
          {/* Zero slippage: filled exactly at the settle. */}
          <ReferenceLine y={0} stroke="#94a3b8" />
          {/* The settle instant itself. */}
          <ReferenceLine x={0} stroke="#cbd5e1" strokeDasharray="4 4" />
          {series.map((s) => (
            <Scatter
              key={s.window}
              name={settleWindowLabel(s.window)}
              data={s.pts}
              fill={s.color}
              opacity={0.75}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {series.map((s) => (
          <span key={s.window} className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            {settleWindowLabel(s.window)} ({s.pts.length})
          </span>
        ))}
        <span className="text-[10px] text-gray-400 dark:text-gray-600">
          Above the line is a cost; the dashed vertical is the settle itself.
        </span>
      </div>
    </ChartCard>
  );
}

/** Minutes since NY midnight for an instant, DST-correct via Intl. */
function minutesIntoNyDay(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return (get("hour") % 24) * 60 + get("minute");
}

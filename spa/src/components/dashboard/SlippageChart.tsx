/**
 * Slippage scatter — IS (bps) vs order size (contracts), one series per symbol.
 *
 * Reads: IS_bps (available without Bloomberg if arrivalPrice is in the upload).
 * Empty state shown when no trades have a non-null IS_bps.
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
import type { TCAResult, TradeRecord } from "@/types";
import { ChartCard, EmptyState, paletteColor } from "./dashboardUtils";

interface SlippageChartProps {
  trades: TradeRecord[];
  results: TCAResult[];
}

interface Point {
  qty: number;
  is: number;
}

export function SlippageChart({ trades, results }: SlippageChartProps) {
  const tradeMap = useMemo(() => {
    const m = new Map<string, TradeRecord>();
    for (const t of trades) m.set(t.orderId, t);
    return m;
  }, [trades]);

  // series: stable array of {sym, points} — avoids Map.get() returning undefined in JSX
  const series = useMemo(() => {
    const g = new Map<string, Point[]>();
    for (const r of results) {
      if (r.IS_bps === null) continue;
      const trade = tradeMap.get(r.orderId);
      if (!trade) continue;
      const sym = trade.symbol;
      const point: Point = { qty: trade.orderQty, is: r.IS_bps };
      const bucket = g.get(sym);
      if (bucket) {
        bucket.push(point);
      } else {
        g.set(sym, [point]);
      }
    }
    return [...g.entries()].map(([sym, pts], i) => ({
      sym,
      pts,
      color: paletteColor(i),
    }));
  }, [results, tradeMap]);

  if (series.length === 0) {
    return (
      <ChartCard
        title="IS vs Order Size"
        subtitle="Slippage (bps) vs order quantity — colored by symbol"
      >
        <EmptyState message="No IS data — add an arrivalPrice column or fetch Bloomberg data" />
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title="IS vs Order Size"
      subtitle="Slippage (bps) vs order quantity — colored by symbol"
    >
      <ResponsiveContainer width="100%" height={240}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="qty"
            type="number"
            name="Contracts"
            tick={{ fontSize: 11 }}
            label={{
              value: "Order size (contracts)",
              position: "insideBottom",
              offset: -12,
              fontSize: 11,
              fill: "#6b7280",
            }}
          />
          <YAxis
            dataKey="is"
            type="number"
            name="IS"
            tickFormatter={(v: unknown) =>
              typeof v === "number" ? String(Math.round(v)) : ""
            }
            tick={{ fontSize: 11 }}
            width={38}
          />
          <Tooltip
            formatter={(v: unknown) =>
              typeof v === "number" ? `${v.toFixed(2)} bps` : String(v)
            }
            cursor={{ strokeDasharray: "3 3" }}
          />
          <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
          {series.map(({ sym, pts, color }) => (
            <Scatter key={sym} name={sym} data={pts} fill={color} opacity={0.8} />
          ))}
        </ScatterChart>
      </ResponsiveContainer>

      {/* Symbol legend */}
      <div className="flex flex-wrap gap-3 mt-2 justify-center">
        {series.map(({ sym, color }) => (
          <span
            key={sym}
            className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400"
          >
            <span
              className="inline-block h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: color }}
            />
            {sym}
          </span>
        ))}
      </div>
    </ChartCard>
  );
}

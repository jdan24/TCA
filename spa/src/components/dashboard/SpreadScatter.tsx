/**
 * Spread vs slippage scatter — TWAS (bps) on X, IS (bps) on Y.
 *
 * Reveals the relationship between the liquidity environment (spread width)
 * and execution quality (slippage):
 *   • Points in upper-right: wide spread AND high slippage → poor conditions AND poor execution
 *   • Points in lower-left: tight spread AND low slippage → good conditions AND good execution
 *   • Points in upper-left: tight spread BUT high slippage → poor execution in good conditions
 *
 * Requires both Bloomberg TWAS data and arrival price (IS).
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
import type { TCAResult } from "@/types";
import { ChartCard, EmptyState } from "./dashboardUtils";

interface SpreadScatterProps {
  results: TCAResult[];
}

interface Point {
  twas: number;
  is: number;
}

export function SpreadScatter({ results }: SpreadScatterProps) {
  const points = useMemo<Point[]>(() => {
    const pts: Point[] = [];
    for (const r of results) {
      if (r.TWAS_bps !== null && r.IS_bps !== null) {
        pts.push({ twas: r.TWAS_bps, is: r.IS_bps });
      }
    }
    return pts;
  }, [results]);

  if (points.length === 0) {
    return (
      <ChartCard
        title="Spread vs Slippage"
        subtitle="TWAS (bps) vs IS (bps) — liquidity vs execution cost"
      >
        <EmptyState message="Bloomberg bid/ask tick data required for TWAS" />
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title="Spread vs Slippage"
      subtitle="TWAS (bps) vs IS (bps) — upper-left = poor execution vs liquidity"
    >
      <ResponsiveContainer width="100%" height={240}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="twas"
            type="number"
            name="TWAS"
            tick={{ fontSize: 11 }}
            label={{
              value: "TWAS (bps)",
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
            label={{
              value: "IS (bps)",
              angle: -90,
              position: "insideLeft",
              offset: 12,
              fontSize: 11,
              fill: "#6b7280",
            }}
          />
          <Tooltip
            formatter={(v: unknown) =>
              typeof v === "number" ? `${v.toFixed(2)} bps` : String(v)
            }
            cursor={{ strokeDasharray: "3 3" }}
          />
          <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
          <Scatter data={points} fill="#8b5cf6" opacity={0.75} />
        </ScatterChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

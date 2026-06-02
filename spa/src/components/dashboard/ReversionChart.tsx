/**
 * Post-trade reversion line chart.
 *
 * Shows avg reversion (bps) at +30s and +1m, split by BUY vs SELL.
 *
 * Interpretation:
 *   Positive → price reverted toward arrival after the fill (temporary impact, good)
 *   Negative → price continued away from the fill (permanent impact / info leakage)
 *
 * Requires Bloomberg enrichment; shows empty state otherwise.
 */

import { useMemo } from "react";
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
import type { TCAResult, TradeRecord } from "@/types";
import { ChartCard, EmptyState, safeAvg } from "./dashboardUtils";

interface ReversionChartProps {
  trades: TradeRecord[];
  results: TCAResult[];
}

interface RowDatum {
  label: string;
  buy: number | null;
  sell: number | null;
}

export function ReversionChart({ trades, results }: ReversionChartProps) {
  const { chartData, hasData } = useMemo<{
    chartData: RowDatum[];
    hasData: boolean;
  }>(() => {
    // Build orderId → side lookup
    const sideMap = new Map<string, "BUY" | "SELL">();
    for (const t of trades) sideMap.set(t.orderId, t.side);

    const buyR = results.filter((r) => sideMap.get(r.orderId) === "BUY");
    const sellR = results.filter((r) => sideMap.get(r.orderId) === "SELL");

    const rows: RowDatum[] = [
      {
        label: "+30s",
        buy: safeAvg(buyR.map((r) => r.reversion_30s_bps)),
        sell: safeAvg(sellR.map((r) => r.reversion_30s_bps)),
      },
      {
        label: "+1m",
        buy: safeAvg(buyR.map((r) => r.reversion_1m_bps)),
        sell: safeAvg(sellR.map((r) => r.reversion_1m_bps)),
      },
    ];

    const anyData = rows.some((r) => r.buy !== null || r.sell !== null);
    return { chartData: rows, hasData: anyData };
  }, [trades, results]);

  if (!hasData) {
    return (
      <ChartCard
        title="Post-Trade Reversion"
        subtitle="Avg reversion (bps) at +30s / +1m — by side"
      >
        <EmptyState message="Bloomberg data required for reversion analysis" />
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title="Post-Trade Reversion"
      subtitle="Avg reversion (bps) at +30s / +1m — positive = favorable"
    >
      <ResponsiveContainer width="100%" height={240}>
        <LineChart
          data={chartData}
          margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis
            tickFormatter={(v: unknown) =>
              typeof v === "number" ? `${v.toFixed(0)}` : ""
            }
            tick={{ fontSize: 11 }}
            width={38}
          />
          <Tooltip
            formatter={(v: unknown) =>
              typeof v === "number" ? `${v.toFixed(2)} bps` : String(v)
            }
          />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11 }}
          />
          <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
          <Line
            type="monotone"
            dataKey="buy"
            name="Buy"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ r: 4 }}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="sell"
            name="Sell"
            stroke="#ef4444"
            strokeWidth={2}
            dot={{ r: 4 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

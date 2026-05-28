/**
 * VWAP Deviation bar chart — avg deviation (bps) grouped by symbol + side.
 *
 * Bars are colored green (favorable, negative) or red (adverse, positive).
 * Requires Bloomberg enrichment; shows empty state otherwise.
 */

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TCAResult, TradeRecord } from "@/types";
import { ChartCard, EmptyState, fmtBps, safeAvg } from "./dashboardUtils";

interface VWAPDeviationProps {
  trades: TradeRecord[];
  results: TCAResult[];
}

interface BarDatum {
  name: string;
  avg: number;
  count: number;
}

export function VWAPDeviation({ trades, results }: VWAPDeviationProps) {
  const tradeMap = useMemo(() => {
    const m = new Map<string, TradeRecord>();
    for (const t of trades) m.set(t.orderId, t);
    return m;
  }, [trades]);

  const chartData = useMemo<BarDatum[]>(() => {
    const groups = new Map<string, number[]>();
    for (const r of results) {
      if (r.VWAP_dev_bps === null) continue;
      const trade = tradeMap.get(r.orderId);
      if (!trade) continue;
      const key = `${trade.symbol} ${trade.side}`;
      const bucket = groups.get(key);
      if (bucket) {
        bucket.push(r.VWAP_dev_bps);
      } else {
        groups.set(key, [r.VWAP_dev_bps]);
      }
    }
    return [...groups.entries()]
      .map(([name, vals]) => ({
        name,
        avg: safeAvg(vals) ?? 0,
        count: vals.length,
      }))
      .sort((a, b) => a.avg - b.avg); // worst on right
  }, [results, tradeMap]);

  if (chartData.length === 0) {
    return (
      <ChartCard
        title="VWAP Deviation"
        subtitle="Avg deviation (bps) by symbol and side"
      >
        <EmptyState message="Bloomberg data required for VWAP deviation" />
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title="VWAP Deviation"
      subtitle="Avg deviation (bps) by symbol and side — negative is favorable"
    >
      <ResponsiveContainer width="100%" height={240}>
        <BarChart
          data={chartData}
          margin={{ top: 8, right: 16, bottom: 44, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10 }}
            angle={-35}
            textAnchor="end"
            interval={0}
            height={64}
          />
          <YAxis
            tickFormatter={(v: unknown) =>
              typeof v === "number" ? String(Math.round(v)) : ""
            }
            tick={{ fontSize: 11 }}
            width={38}
          />
          <Tooltip
            formatter={(v: unknown) =>
              typeof v === "number"
                ? [fmtBps(v), "Avg VWAP Dev"]
                : [String(v), "Avg VWAP Dev"]
            }
          />
          <ReferenceLine y={0} stroke="#94a3b8" />
          <Bar dataKey="avg" radius={[3, 3, 0, 0]}>
            {chartData.map((entry) => (
              <Cell
                key={entry.name}
                fill={entry.avg <= 0 ? "#10b981" : "#ef4444"}
                opacity={0.85}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

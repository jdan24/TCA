/**
 * DeviationChart — average benchmark deviation (bps) grouped by symbol + side.
 *
 * Rendered twice on the multi-order dashboard, once against market VWAP and once
 * against market TWAP. The two plots are identical apart from which metric they
 * read, so they share one component rather than a near-copy each.
 *
 * Bars are coloured green (favourable, negative) or red (adverse, positive).
 * Requires Bloomberg enrichment; shows an empty state otherwise.
 *
 * Each instance carries its own algo filter, narrowing within whatever the
 * dashboard-level FilterBar has already left.
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
import { useChartAlgoFilter } from "@/hooks/useChartAlgoFilter";
import { AlgoFilterMenu } from "./AlgoFilterMenu";
import { ChartCard, EmptyState, fmtBps, safeAvg } from "./dashboardUtils";

interface DeviationChartProps {
  trades: TradeRecord[];
  results: TCAResult[];
  /** Stable key for this chart's stored algo selection. */
  chartId: string;
  title: string;
  /** Short name used in the tooltip and the empty state, e.g. "VWAP". */
  benchmark: string;
  /** Which metric to plot. */
  valueOf: (r: TCAResult) => number | null;
}

interface BarDatum {
  name: string;
  avg: number;
  count: number;
}

export function DeviationChart({
  trades,
  results,
  chartId,
  title,
  benchmark,
  valueOf,
}: DeviationChartProps) {
  const algoFilter = useChartAlgoFilter(chartId, trades);

  const tradeMap = useMemo(() => {
    const m = new Map<string, TradeRecord>();
    for (const t of trades) m.set(t.orderId, t);
    return m;
  }, [trades]);

  const chartData = useMemo<BarDatum[]>(() => {
    const groups = new Map<string, number[]>();
    for (const r of results) {
      const v = valueOf(r);
      if (v === null) continue;
      const trade = tradeMap.get(r.orderId);
      if (!trade) continue;
      if (!algoFilter.includes(trade)) continue;
      const key = `${trade.symbol} ${trade.side}`;
      const bucket = groups.get(key);
      if (bucket) {
        bucket.push(v);
      } else {
        groups.set(key, [v]);
      }
    }
    return [...groups.entries()]
      .map(([name, vals]) => ({
        name,
        avg: safeAvg(vals) ?? 0,
        count: vals.length,
      }))
      .sort((a, b) => a.avg - b.avg); // worst on right
  }, [results, tradeMap, valueOf, algoFilter]);

  const actions = <AlgoFilterMenu filter={algoFilter} />;

  if (chartData.length === 0) {
    return (
      <ChartCard
        title={title}
        subtitle={`Avg deviation (bps) by symbol and side`}
        actions={actions}
      >
        <EmptyState
          message={
            algoFilter.isNarrowed
              ? "No orders match the selected algos"
              : `Bloomberg data required for ${benchmark} deviation`
          }
        />
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title={title}
      subtitle="Avg deviation (bps) by symbol and side — negative is favorable"
      actions={actions}
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
                ? [fmtBps(v), `Avg ${benchmark} Dev`]
                : [String(v), `Avg ${benchmark} Dev`]
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

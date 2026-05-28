/**
 * Timing heatmap — 30-min intraday buckets × day-of-week.
 *
 * Each cell shows avg IS (bps) for trades whose orderTime falls in that slot.
 *   Green  → favorable (negative slippage)
 *   Red    → adverse (positive slippage)
 *   Gray   → no trades in that cell
 *
 * Implemented as a CSS grid (no Recharts) for dense layout control.
 * All 48 × 30-min slots are shown (00:00–23:30); bucket labels every 2 hours.
 * Weekdays Mon–Fri are shown; weekend rows are omitted when empty.
 */

import { useMemo } from "react";
import type { TCAResult, TradeRecord } from "@/types";
import { buildHeatmapData, bucketLabel } from "@/tca/timing";
import { ChartCard, EmptyState, bpsToHsl, fmtBps } from "./dashboardUtils";

interface TimingHeatmapProps {
  trades: TradeRecord[];
  results: TCAResult[];
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
const ALL_BUCKETS = Array.from({ length: 48 }, (_, i) => i);

export function TimingHeatmap({ trades, results }: TimingHeatmapProps) {
  const { cells, absMax, hasTrades } = useMemo(() => {
    const slippages = results.map((r) => r.IS_bps);
    const cellMap = buildHeatmapData(trades, slippages);

    const allBps = [...cellMap.values()]
      .map((c) => c.avgSlippage_bps)
      .filter((v): v is number => v !== null);

    const max = allBps.length > 0 ? Math.max(...allBps.map(Math.abs)) : 1;
    return { cells: cellMap, absMax: max, hasTrades: allBps.length > 0 };
  }, [trades, results]);

  if (!hasTrades) {
    return (
      <ChartCard
        title="Timing Heatmap"
        subtitle="Avg IS (bps) by time-of-day and day-of-week"
      >
        <EmptyState message="No IS data available — add an arrivalPrice column or fetch Bloomberg data" />
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title="Timing Heatmap"
      subtitle="Avg IS (bps) by 30-min bucket and day — green = favorable, red = adverse"
    >
      <div className="overflow-x-auto">
        <div style={{ minWidth: 560 }}>
          {/* Time-of-day axis labels */}
          <div className="flex mb-1">
            <div className="w-9 shrink-0" />
            {ALL_BUCKETS.map((b) => (
              <div
                key={b}
                className="flex-1 text-[9px] text-center text-gray-400 dark:text-gray-600"
              >
                {b % 4 === 0 ? bucketLabel(b) : ""}
              </div>
            ))}
          </div>

          {/* Day rows */}
          {WEEKDAYS.map((day) => (
            <div key={day} className="flex items-center mb-px">
              <div className="w-9 shrink-0 text-[10px] text-gray-500 dark:text-gray-400 text-right pr-1.5 font-medium">
                {day}
              </div>
              {ALL_BUCKETS.map((b) => {
                const key = `${day}-${b}`;
                const cell = cells.get(key);
                const color = bpsToHsl(cell?.avgSlippage_bps ?? null, absMax);
                const tip = cell
                  ? `${day} ${bucketLabel(b)}: ${cell.count} trade${cell.count !== 1 ? "s" : ""}, avg IS ${fmtBps(cell.avgSlippage_bps)}`
                  : `${day} ${bucketLabel(b)}: no trades`;
                return (
                  <div
                    key={b}
                    title={tip}
                    className="flex-1 h-5 mx-px rounded-[2px] cursor-default"
                    style={{ backgroundColor: color }}
                  />
                );
              })}
            </div>
          ))}

          {/* Color legend */}
          <div className="flex items-center justify-end gap-2 mt-3 text-[10px] text-gray-400 dark:text-gray-600">
            <span>Favorable</span>
            {[-1, -0.5, 0, 0.5, 1].map((t) => (
              <div
                key={t}
                className="h-3 w-6 rounded-sm"
                style={{ backgroundColor: bpsToHsl(t * absMax, absMax) }}
              />
            ))}
            <span>Adverse</span>
          </div>
        </div>
      </div>
    </ChartCard>
  );
}

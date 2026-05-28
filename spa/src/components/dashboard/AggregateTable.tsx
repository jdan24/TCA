/**
 * AggregateTable — one reusable stats table rendered for each grouping
 * (By Symbol, By Algo, By Symbol+Algo, By Symbol+Side).
 *
 * Clicking a row filters the TradeTable to matching orders.
 * Clicking the same row again deselects it (toggle).
 */

import type { AggregateRow } from "@/types";
import { ChartCard } from "./dashboardUtils";
import { fmtBps, fmtTtf } from "./dashboardUtils";

interface AggregateTableProps {
  title: string;
  rows: AggregateRow[];
  /** groupKey of the currently selected row, or null */
  activeKey: string | null;
  onRowClick: (row: AggregateRow) => void;
}

export function AggregateTable({
  title,
  rows,
  activeKey,
  onRowClick,
}: AggregateTableProps) {
  if (rows.length === 0) {
    return (
      <ChartCard title={title}>
        <p className="py-8 text-center text-xs text-gray-400 dark:text-gray-600 italic">
          No data
        </p>
      </ChartCard>
    );
  }

  return (
    <ChartCard title={title} subtitle="Click a row to filter the trade detail table">
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-xs min-w-[640px]">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800">
              {[
                "Group", "Orders", "Total Qty",
                "Avg IS", "Avg VWAP Dev", "Avg MI", "Avg TWAS",
                "Avg TTF", "Win %", "Best IS", "Worst IS",
              ].map((h) => (
                <th
                  key={h}
                  className="pb-2 pr-3 text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isActive = activeKey === row.groupKey;
              return (
                <tr
                  key={row.groupKey}
                  onClick={() => onRowClick(row)}
                  className={[
                    "cursor-pointer transition-colors border-b border-gray-50 dark:border-gray-800/50",
                    isActive
                      ? "bg-blue-50 dark:bg-blue-900/20 border-l-2 border-l-blue-500"
                      : "hover:bg-gray-50 dark:hover:bg-gray-800/40",
                  ].join(" ")}
                >
                  {/* Group */}
                  <td className="py-2 pr-3 font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap">
                    {row.groupKey}
                  </td>
                  {/* Orders */}
                  <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-gray-400">
                    {row.count}
                  </td>
                  {/* Total Qty */}
                  <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-gray-400">
                    {row.totalQty.toLocaleString()}
                  </td>
                  {/* Avg IS */}
                  <td className="py-2 pr-3">
                    <BpsCell value={row.avgIS_bps} />
                  </td>
                  {/* Avg VWAP Dev */}
                  <td className="py-2 pr-3">
                    <BpsCell value={row.avgVWAP_dev_bps} />
                  </td>
                  {/* Avg MI */}
                  <td className="py-2 pr-3">
                    <BpsCell value={row.avgMI_bps} />
                  </td>
                  {/* Avg TWAS */}
                  <td className="py-2 pr-3">
                    <BpsCell value={row.avgTWAS_bps} neutral />
                  </td>
                  {/* Avg TTF */}
                  <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    {fmtTtf(Math.round(row.avgTTF_ms))}
                  </td>
                  {/* Win % */}
                  <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-gray-400">
                    {row.winRate !== null ? `${Math.round(row.winRate * 100)}%` : "N/A"}
                  </td>
                  {/* Best IS */}
                  <td className="py-2 pr-3">
                    {row.bestIS_bps !== null ? (
                      <span className="text-green-600 dark:text-green-400 tabular-nums font-medium">
                        {fmtBps(row.bestIS_bps)}
                      </span>
                    ) : (
                      <span className="text-gray-300 dark:text-gray-600 select-none">N/A</span>
                    )}
                  </td>
                  {/* Worst IS */}
                  <td className="py-2">
                    {row.worstIS_bps !== null ? (
                      <span className="text-red-500 dark:text-red-400 tabular-nums font-medium">
                        {fmtBps(row.worstIS_bps)}
                      </span>
                    ) : (
                      <span className="text-gray-300 dark:text-gray-600 select-none">N/A</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}

// ── BpsCell (local, same logic as TradeTable but without neutral option confusion) ──

function BpsCell({ value, neutral = false }: { value: number | null; neutral?: boolean }) {
  if (value === null) {
    return <span className="text-gray-300 dark:text-gray-600 select-none">N/A</span>;
  }
  let cls: string;
  if (neutral) {
    cls = "text-gray-600 dark:text-gray-400";
  } else {
    cls = value <= 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400";
  }
  const sign = value > 0 ? "+" : "";
  return (
    <span className={`tabular-nums font-medium ${cls}`}>
      {sign}{value.toFixed(1)}
    </span>
  );
}

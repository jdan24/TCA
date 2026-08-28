/**
 * SettleBySymbol — slippage vs settle per instrument, within each window.
 *
 * Separates a contract that is persistently poor into a settle from one that had
 * a single bad day. Rows are ordered by window then by order count, and the
 * window is repeated on each row so the table stays readable when scrolled.
 */

import type { SettleGroupRow } from "@/tca/settleAggregate";
import { settleWindowLabel } from "@/tca/settle";
import { ChartCard, EmptyState, fmtBps, fmtUsd } from "@/components/dashboard/dashboardUtils";

const HEADERS = [
  "Window",
  "Instrument",
  "Orders",
  "Total Qty",
  "Avg Slip vs Settle",
  "Total Slip",
] as const;

export function SettleBySymbol({
  rows,
  actions,
}: {
  rows: SettleGroupRow[];
  actions?: React.ReactNode;
}) {
  if (rows.length === 0) {
    return (
      <ChartCard title="By Instrument" {...(actions !== undefined ? { actions } : {})}>
        <EmptyState message="No orders to group" />
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title="By Instrument"
      subtitle="Slippage vs settle per contract, split by window"
      {...(actions !== undefined ? { actions } : {})}
    >
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-xs min-w-[600px]">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800">
              {HEADERS.map((h) => (
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
            {rows.map((row) => (
              <tr
                key={`${row.window}|${row.key}`}
                className="border-b border-gray-50 dark:border-gray-800/50"
              >
                <td className="py-2 pr-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {settleWindowLabel(row.window)}
                </td>
                <td className="py-2 pr-3 font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap">
                  {row.key}
                  {row.flagged > 0 && (
                    <span
                      className="ml-1.5 text-amber-600 dark:text-amber-400"
                      title="This contract does not settle at 15:00 ET — the benchmark is its own official settle"
                    >
                      &#9888;
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-gray-400">
                  {row.count}
                </td>
                <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-gray-400">
                  {row.totalQty.toLocaleString()}
                </td>
                <td className="py-2 pr-3">
                  {row.avgSlip_bps === null ? (
                    <NaCell />
                  ) : (
                    <span
                      className={`tabular-nums font-medium ${
                        row.avgSlip_bps <= 0
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-500 dark:text-red-400"
                      }`}
                    >
                      {fmtBps(row.avgSlip_bps)}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  {row.totalSlip_usd === null ? (
                    <NaCell />
                  ) : (
                    <span
                      className={`tabular-nums font-medium whitespace-nowrap ${
                        row.totalSlip_usd <= 0
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-500 dark:text-red-400"
                      }`}
                    >
                      {fmtUsd(row.totalSlip_usd, row.currency ?? "USD")}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}

function NaCell() {
  return <span className="text-gray-300 dark:text-gray-600 select-none">N/A</span>;
}

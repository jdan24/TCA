/**
 * SettleWindowSummary — how execution went into each settlement print.
 *
 * Always shows all three rows including Unassigned, so an order that fell
 * outside both windows is visible and countable rather than quietly absent from
 * the report it was loaded into.
 *
 * SettleWindowAlgoSummary renders the same table split by algo within each
 * window, so the algos can be compared print by print. Both share one set of
 * cells so the two tables cannot drift apart in formatting.
 */

import type { SettleGroupRow } from "@/tca/settleAggregate";
import { settleWindowLabel } from "@/tca/settle";
import {
  ChartCard,
  EmptyState,
  fmtBps,
  fmtUsd,
  FxNote,
  slipToneClass,
} from "@/components/dashboard/dashboardUtils";
import { useCashDisplay } from "@/hooks/useCashDisplay";

const HEADERS = [
  "Window",
  "Algo",
  "Orders",
  "Total Qty",
  "Avg Slip vs Settle",
  "Total Slip",
  "Benchmarked",
] as const;

export function SettleWindowSummary({ rows }: { rows: SettleGroupRow[] }) {
  const cash = useCashDisplay();
  return (
    <ChartCard
      title="By Settle Window"
      subtitle="Execution measured against the print each order was working into"
    >
      <WindowTable rows={rows} showAlgo={false} />

      <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-gray-800 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-gray-400 dark:text-gray-500">
        <span>
          <span className="font-semibold text-gray-500 dark:text-gray-400">3PM Settle</span>{" "}
          official settle for the order&rsquo;s date
        </span>
        <span>
          <span className="font-semibold text-gray-500 dark:text-gray-400">4PM Close</span>{" "}
          last print before 16:00:00 NY
        </span>
        <span>
          <span className="font-semibold text-gray-500 dark:text-gray-400">Unassigned</span>{" "}
          finished outside both windows
        </span>
        <span>Positive slippage is a cost.</span>
      </div>
      <FxNote text={cash.disclosureFor(rows.map((r) => r.currency ?? "USD"))} />
    </ChartCard>
  );
}

export function SettleWindowAlgoSummary({ rows }: { rows: SettleGroupRow[] }) {
  const cash = useCashDisplay();
  return (
    <ChartCard
      title="By Settle Window & Algo"
      subtitle="Which algo did better into each print"
    >
      {rows.length === 0 ? (
        <EmptyState message="No orders landed in a settle window" />
      ) : (
        <>
          <WindowTable rows={rows} showAlgo />
          <FxNote text={cash.disclosureFor(rows.map((r) => r.currency ?? "USD"))} />
        </>
      )}
    </ChartCard>
  );
}

function WindowTable({ rows, showAlgo }: { rows: SettleGroupRow[]; showAlgo: boolean }) {
  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full text-xs min-w-[560px]">
        <thead>
          <tr className="border-b border-gray-100 dark:border-gray-800">
            {HEADERS.filter((h) => showAlgo || h !== "Algo").map((h) => (
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
            const unassigned = row.window === "unassigned";
            return (
              <tr
                key={`${row.key}|${row.algo ?? ""}`}
                className="border-b border-gray-50 dark:border-gray-800/50"
              >
                <td className="py-2 pr-3 font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap">
                  {settleWindowLabel(row.window)}
                  {row.flagged > 0 && (
                    <span
                      className="ml-1.5 text-[10px] text-amber-600 dark:text-amber-400"
                      title={`${row.flagged} order${row.flagged !== 1 ? "s" : ""} on a contract that does not settle at 15:00 ET — the benchmark is that contract's own settle`}
                    >
                      &#9888; {row.flagged}
                    </span>
                  )}
                </td>
                {showAlgo && (
                  <td className="py-2 pr-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                    {row.algo ?? "—"}
                  </td>
                )}
                <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-gray-400">
                  {row.count}
                </td>
                <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-gray-400">
                  {row.totalQty.toLocaleString()}
                </td>
                <td className="py-2 pr-3">
                  {unassigned || row.avgSlip_bps === null ? (
                    <NaCell />
                  ) : (
                    <span className={`tabular-nums font-medium ${slipToneClass(row.avgSlip_bps)}`}>
                      {fmtBps(row.avgSlip_bps)}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  {row.totalSlip_usd === null ? (
                    <NaCell />
                  ) : (
                    <span
                      className={`tabular-nums font-medium whitespace-nowrap ${slipToneClass(row.totalSlip_usd)}`}
                    >
                      {fmtUsd(row.totalSlip_usd, row.currency ?? "USD")}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-gray-400">
                  {unassigned ? (
                    <span className="text-gray-400 dark:text-gray-600 italic">
                      no benchmark
                    </span>
                  ) : (
                    <>
                      {row.withBenchmark} of {row.count}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NaCell() {
  return <span className="text-gray-300 dark:text-gray-600 select-none">N/A</span>;
}

/**
 * SpreadSavingsTable — how much of the quoted spread each instrument's
 * executions actually kept.
 *
 * Slippage in bps is hard to judge on its own: 2 bps of cost is excellent in a
 * 6 bps market and poor in a 1 bps one. This table divides one by the other, so
 * every instrument is scored against the liquidity it was actually trading in.
 *
 * Grouped by generic ticker — FVU6 and FVZ6 are the same instrument for this
 * purpose, and a multi-month report would otherwise split them into rows too
 * thin to mean anything.
 *
 * See buildSpreadSavings() in tca/aggregate.ts for the arithmetic.
 */

import type { SpreadSavingsRow } from "@/types";
import { ChartCard } from "./dashboardUtils";

interface SpreadSavingsTableProps {
  rows: SpreadSavingsRow[];
}

const HEADERS = [
  "Generic Ticker",
  "Orders",
  "Total Qty",
  "Avg Spread Cost",
  "Wtd Avg IS",
  "Spread Savings",
] as const;

export function SpreadSavingsTable({ rows }: SpreadSavingsTableProps) {
  if (rows.length === 0) {
    return (
      <ChartCard title="Spread Savings by Instrument">
        <p className="py-8 text-center text-xs text-gray-400 dark:text-gray-600 italic">
          No data
        </p>
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title="Spread Savings by Instrument"
      subtitle="Execution quality measured against the spread that was quoted at the time"
    >
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-xs min-w-[560px]">
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
                key={row.groupKey}
                className="border-b border-gray-50 dark:border-gray-800/50"
              >
                <td className="py-2 pr-3 font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap">
                  {row.groupKey}
                </td>
                <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-gray-400">
                  {row.count}
                </td>
                <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-gray-400">
                  {row.totalQty.toLocaleString()}
                </td>
                {/* Spread width is an environment reading, not a good/bad score */}
                <td className="py-2 pr-3">
                  <BpsCell value={row.avgSpread_bps} neutral />
                </td>
                <td className="py-2 pr-3">
                  <BpsCell value={row.wAvgIS_bps} />
                </td>
                <td className="py-2 pr-3">
                  <SavingsCell value={row.savingsPct} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Legend />
    </ChartCard>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────

function Legend() {
  const items: Array<{ mark: string; text: string }> = [
    { mark: "100%",     text: "filled at or better than the near touch" },
    { mark: "50%",      text: "filled at mid" },
    { mark: "0%",       text: "paid the full spread" },
    { mark: "below 0%", text: "worse than crossing the spread" },
  ];
  return (
    <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-gray-800 flex flex-wrap gap-x-4 gap-y-1">
      {items.map(({ mark, text }) => (
        <span key={mark} className="text-[10px] text-gray-400 dark:text-gray-500">
          <span className="font-semibold text-gray-500 dark:text-gray-400 tabular-nums">
            {mark}
          </span>{" "}
          {text}
        </span>
      ))}
    </div>
  );
}

// ── Cells ─────────────────────────────────────────────────────────────────────

/** Same conventions as the BpsCell in AggregateTable: negative is favourable. */
function BpsCell({ value, neutral = false }: { value: number | null; neutral?: boolean }) {
  if (value === null) {
    return <span className="text-gray-300 dark:text-gray-600 select-none">N/A</span>;
  }
  const cls = neutral
    ? "text-gray-600 dark:text-gray-400"
    : value <= 0
      ? "text-green-600 dark:text-green-400"
      : "text-red-500 dark:text-red-400";
  const sign = value > 0 ? "+" : "";
  return (
    <span className={`tabular-nums font-medium ${cls}`}>
      {sign}{value.toFixed(1)}
    </span>
  );
}

/**
 * Savings runs the opposite way to the bps columns — more is better — so the
 * colours are keyed to the legend's landmarks rather than to the sign:
 * at-or-better than mid is green, paying more than the full spread is red.
 */
function SavingsCell({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-gray-300 dark:text-gray-600 select-none">N/A</span>;
  }
  const cls =
    value >= 0.5
      ? "text-green-600 dark:text-green-400"
      : value < 0
        ? "text-red-500 dark:text-red-400"
        : "text-amber-600 dark:text-amber-400";
  return (
    <span className={`tabular-nums font-semibold ${cls}`}>
      {(value * 100).toFixed(1)}%
    </span>
  );
}

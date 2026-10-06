/**
 * AzOpenSummary — the cash-open report's summary tables.
 *
 *   By Benchmark  — every order, one row per benchmark.
 *   By Instrument — one row per contract (or generic), every benchmark across.
 *
 * bps are quantity-weighted; cash figures are group totals in whichever
 * currency the report is being read in.
 */

import type { ReactNode } from "react";
import type { OpenGroupRow } from "@/tca/azOpenAggregate";
import { OPEN_BENCHMARKS } from "@/tca/azOpen";
import {
  ChartCard,
  EmptyState,
  fmtBps,
  fmtUsd,
  FxNote,
  slipToneClass,
} from "@/components/dashboard/dashboardUtils";
import { useCashDisplay } from "@/hooks/useCashDisplay";

const TH =
  "pb-2 pr-3 text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide whitespace-nowrap";

function NaCell() {
  return <span className="text-gray-300 dark:text-gray-600 select-none">N/A</span>;
}

function BpsCell({ v }: { v: number | null }) {
  if (v === null) return <NaCell />;
  return <span className={`tabular-nums font-medium ${slipToneClass(v)}`}>{fmtBps(v)}</span>;
}

function UsdCell({ v, currency }: { v: number | null; currency: string | null }) {
  if (v === null) return <NaCell />;
  return (
    <span className={`tabular-nums font-medium whitespace-nowrap ${slipToneClass(v)}`}>
      {fmtUsd(v, currency ?? "USD")}
    </span>
  );
}

export function AzOpenBenchmarkSummary({ overall }: { overall: OpenGroupRow }) {
  const cash = useCashDisplay();
  return (
    <ChartCard
      title="By Benchmark"
      subtitle={`${overall.count.toLocaleString()} order${overall.count !== 1 ? "s" : ""} · ${overall.totalQty.toLocaleString()} lots · quantity-weighted bps, total cash`}
    >
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-xs min-w-[480px]">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800">
              <th className={TH}>Benchmark</th>
              <th className={TH}>Wtd Avg Slip</th>
              <th className={TH}>Total Slip</th>
              <th className={TH}>Benchmarked</th>
            </tr>
          </thead>
          <tbody>
            {OPEN_BENCHMARKS.map((b) => {
              const s = overall.bench[b.id];
              return (
                <tr key={b.id} className="border-b border-gray-50 dark:border-gray-800/50">
                  <td
                    className="py-2 pr-3 font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap cursor-help"
                    title={b.title}
                  >
                    {b.label}
                  </td>
                  <td className="py-2 pr-3"><BpsCell v={s.wAvg_bps} /></td>
                  <td className="py-2 pr-3"><UsdCell v={s.total_usd} currency={overall.currency} /></td>
                  <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-gray-400">
                    {s.withBenchmark} of {overall.count}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Legend />
      <FxNote text={cash.disclosureFor([overall.currency ?? "USD"])} />
    </ChartCard>
  );
}

export function AzOpenBySymbol({
  rows,
  actions,
}: {
  rows: OpenGroupRow[];
  actions?: ReactNode;
}) {
  const cash = useCashDisplay();
  if (rows.length === 0) {
    return (
      <ChartCard title="By Instrument" actions={actions}>
        <EmptyState message="No orders to show" />
      </ChartCard>
    );
  }
  return (
    <ChartCard
      title="By Instrument"
      subtitle="Quantity-weighted slippage (bps) and total cash slippage against each benchmark"
      actions={actions}
    >
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-xs min-w-[880px]">
          <thead>
            <tr>
              <th className={TH} colSpan={3} />
              {OPEN_BENCHMARKS.map((b) => (
                <th
                  key={b.id}
                  colSpan={2}
                  title={b.title}
                  className={`${TH} text-center border-l border-gray-100 dark:border-gray-800 pl-3 cursor-help`}
                >
                  {b.label}
                </th>
              ))}
            </tr>
            <tr className="border-b border-gray-100 dark:border-gray-800">
              <th className={TH}>Instrument</th>
              <th className={TH}>Orders</th>
              <th className={TH}>Qty</th>
              {OPEN_BENCHMARKS.map((b) => (
                <SubHeads key={b.id} />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-gray-50 dark:border-gray-800/50">
                <td className="py-2 pr-3 font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                  {row.key}
                </td>
                <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-gray-400">{row.count}</td>
                <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-gray-400">
                  {row.totalQty.toLocaleString()}
                </td>
                {OPEN_BENCHMARKS.map((b) => (
                  <BenchPair key={b.id} row={row} id={b.id} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Legend />
      <FxNote text={cash.disclosureFor(rows.map((r) => r.currency ?? "USD"))} />
    </ChartCard>
  );
}

function SubHeads() {
  return (
    <>
      <th className={`${TH} border-l border-gray-100 dark:border-gray-800 pl-3`}>bps</th>
      <th className={TH}>$</th>
    </>
  );
}

function BenchPair({ row, id }: { row: OpenGroupRow; id: (typeof OPEN_BENCHMARKS)[number]["id"] }) {
  const s = row.bench[id];
  return (
    <>
      <td className="py-2 pr-3 pl-3 border-l border-gray-50 dark:border-gray-800/50">
        <BpsCell v={s.wAvg_bps} />
      </td>
      <td className="py-2 pr-3"><UsdCell v={s.total_usd} currency={row.currency} /></td>
    </>
  );
}

function Legend() {
  return (
    <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-gray-800 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-gray-400 dark:text-gray-500">
      <span>VWAP / TWAP over 09:30:00–09:31:00 NY trade prints</span>
      <span>09:30 quote: first at or after 09:30:00</span>
      <span>Arrival quote: in force at order creation</span>
      <span>Far touch: ask for buys, bid for sells</span>
      <span>Positive slippage is a cost.</span>
    </div>
  );
}

/**
 * AzOpenSummary — the cash-open report's summary tables, one of each per order
 * class: market orders against the mids, TWAP/VWAP orders against the VWAPs.
 *
 *   By Benchmark  — every order of the class, one row per benchmark.
 *   By Instrument — one row per contract (or generic), the class's benchmarks across.
 *
 * bps are quantity-weighted; cash figures are group totals in whichever
 * currency the report is being read in.
 */

import type { ReactNode } from "react";
import type { OpenBenchmarkId, OpenOrderClass } from "@/types";
import type { OpenGroupRow } from "@/tca/azOpenAggregate";
import { benchmarksFor, OPEN_ORDER_CLASS_LABEL } from "@/tca/azOpen";
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

export function AzOpenBenchmarkSummary({
  cls,
  overall,
}: {
  cls: OpenOrderClass;
  overall: OpenGroupRow;
}) {
  const cash = useCashDisplay();
  const title = `By Benchmark — ${OPEN_ORDER_CLASS_LABEL[cls]}`;
  if (overall.count === 0) {
    return (
      <ChartCard title={title}>
        <EmptyState message={`No ${OPEN_ORDER_CLASS_LABEL[cls].toLowerCase()}`} />
      </ChartCard>
    );
  }
  return (
    <ChartCard
      title={title}
      subtitle={`${overall.count.toLocaleString()} order${overall.count !== 1 ? "s" : ""} · ${overall.totalQty.toLocaleString()} lots · quantity-weighted bps, total cash`}
    >
      <div className="overflow-x-auto -mx-4 px-4 print:overflow-visible">
        <table className="w-full text-xs min-w-[480px] print:min-w-0">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800">
              <th className={TH}>Benchmark</th>
              <th className={TH} title="Each order weighted by its quantity">Wtd Avg Slip</th>
              <th className={TH} title="Every order counted once, whatever its size">Avg Slip</th>
              <th className={TH}>Total Slip</th>
              <th className={TH}>Benchmarked</th>
            </tr>
          </thead>
          <tbody>
            {benchmarksFor(cls).map((b) => {
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
                  <td className="py-2 pr-3"><BpsCell v={s.avg_bps} /></td>
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
      <Legend cls={cls} />
      <FxNote text={cash.disclosureFor([overall.currency ?? "USD"])} />
    </ChartCard>
  );
}

export function AzOpenBySymbol({
  cls,
  rows,
  actions,
}: {
  cls: OpenOrderClass;
  rows: OpenGroupRow[];
  actions?: ReactNode;
}) {
  const cash = useCashDisplay();
  const title = `By Instrument — ${OPEN_ORDER_CLASS_LABEL[cls]}`;
  const benches = benchmarksFor(cls);
  if (rows.length === 0) {
    return (
      <ChartCard title={title} actions={actions}>
        <EmptyState message={`No ${OPEN_ORDER_CLASS_LABEL[cls].toLowerCase()}`} />
      </ChartCard>
    );
  }
  return (
    <ChartCard
      title={title}
      subtitle="Quantity-weighted and simple average slippage (bps), and total cash slippage, against each benchmark"
      actions={actions}
    >
      <div className="overflow-x-auto -mx-4 px-4 print:overflow-visible">
        <table className="w-full text-xs min-w-[680px] print:min-w-0">
          <thead>
            <tr>
              <th className={TH} colSpan={3} />
              {benches.map((b) => (
                <th
                  key={b.id}
                  colSpan={3}
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
              {benches.map((b) => (
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
                {benches.map((b) => (
                  <BenchPair key={b.id} row={row} id={b.id} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Legend cls={cls} />
      <FxNote text={cash.disclosureFor(rows.map((r) => r.currency ?? "USD"))} />
    </ChartCard>
  );
}

/**
 * Plain-language explanation of slippage and its colours, for readers new to
 * TCA. Sits between the summary tables and the order detail, on screen and in
 * print.
 */
export function AzOpenSlippageNote() {
  return (
    <ChartCard title="What Is Slippage?">
      <div className="space-y-2 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
        <p>
          Slippage is how far each order&rsquo;s average fill price landed from a reference
          price (the benchmark), in basis points (1 bp = 0.01%) and in dollars. It measures
          what the execution cost, or saved, versus that benchmark.
        </p>
        <ul className="space-y-1">
          <li className="flex items-start gap-2">
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-red-500" aria-hidden />
            <span>
              <span className="font-semibold text-red-500 dark:text-red-400">Red (positive)</span>{" "}
              &mdash; a cost: bought above, or sold below, the benchmark.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-green-600" aria-hidden />
            <span>
              <span className="font-semibold text-green-600 dark:text-green-400">
                Green (zero or negative)
              </span>{" "}
              &mdash; no cost or a saving: bought at or below, or sold at or above, the
              benchmark.
            </span>
          </li>
        </ul>
        <p>
          <span className="font-semibold text-gray-800 dark:text-gray-200">Wtd Avg Slip</span>{" "}
          weights each order by its size;{" "}
          <span className="font-semibold text-gray-800 dark:text-gray-200">Avg Slip</span>{" "}
          counts every order equally.
        </p>
      </div>
    </ChartCard>
  );
}

function SubHeads() {
  return (
    <>
      <th
        className={`${TH} border-l border-gray-100 dark:border-gray-800 pl-3`}
        title="Each order weighted by its quantity"
      >
        Wtd bps
      </th>
      <th className={TH} title="Every order counted once, whatever its size">Avg bps</th>
      <th className={TH}>$</th>
    </>
  );
}

function BenchPair({ row, id }: { row: OpenGroupRow; id: OpenBenchmarkId }) {
  const s = row.bench[id];
  return (
    <>
      <td className="py-2 pr-3 pl-3 border-l border-gray-50 dark:border-gray-800/50">
        <BpsCell v={s.wAvg_bps} />
      </td>
      <td className="py-2 pr-3"><BpsCell v={s.avg_bps} /></td>
      <td className="py-2 pr-3"><UsdCell v={s.total_usd} currency={row.currency} /></td>
    </>
  );
}

function Legend({ cls }: { cls: OpenOrderClass }) {
  return (
    <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-gray-800 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-gray-400 dark:text-gray-500">
      {cls === "market" ? (
        <>
          <span>09:30 mid: first quote at or after 09:30:00 NY</span>
          <span>Arrival mid: quote in force at order creation</span>
        </>
      ) : (
        <span>VWAP over trade prints from 09:30:00 NY for 2 and 4 minutes</span>
      )}
      <span>Positive slippage is a cost.</span>
    </div>
  );
}

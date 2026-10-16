/**
 * AzOpenSummary — the cash-open report's summary tables.
 *
 *   By Benchmark  — per order class: one row per benchmark of that class.
 *   By Instrument — per order class: one row per contract (or generic).
 *   By Month      — one row per month, all four benchmarks across, each scored
 *                   on the orders of the class it belongs to.
 *   Top/Bottom 5  — per order class: the best and worst orders by cash
 *                   slippage against the class's primary benchmark.
 *
 * bps are quantity-weighted; cash figures and Amount (notional) are group
 * totals in whichever currency the report is being read in.
 */

import type { ReactNode } from "react";
import type { OpenBenchmarkId, OpenOrderClass } from "@/types";
import type { OpenGroupRow } from "@/tca/azOpenAggregate";
import {
  benchmarksFor,
  monthLabel,
  OPEN_BENCHMARKS,
  OPEN_ORDER_CLASS_LABEL,
  PRIMARY_BENCHMARK,
} from "@/tca/azOpen";
import {
  ChartCard,
  EmptyState,
  fmtBps,
  fmtUsd,
  FxNote,
  slipToneClass,
} from "@/components/dashboard/dashboardUtils";
import { useCashDisplay } from "@/hooks/useCashDisplay";
import { AZ_OPEN_COLUMNS, renderOpenCell, type OpenColumnId, type OpenTableRow } from "./AzOpenOrderTable";

const TH =
  "pb-2 pr-3 text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide whitespace-nowrap";
const TD_MUTED = "py-2 pr-3 tabular-nums text-gray-600 dark:text-gray-400 whitespace-nowrap";

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

/** A group's total notional — a size, so no gain/loss colouring. */
function AmountCell({ row }: { row: OpenGroupRow }) {
  if (row.totalNotional === null) return <NaCell />;
  return (
    <span className="tabular-nums text-gray-700 dark:text-gray-300 whitespace-nowrap">
      {fmtUsd(row.totalNotional, row.currency ?? "USD")}
    </span>
  );
}

function emptyMessage(cls: OpenOrderClass) {
  return `No ${OPEN_ORDER_CLASS_LABEL[cls].toLowerCase()}`;
}

// ── By Benchmark ──────────────────────────────────────────────────────────────

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
        <EmptyState message={emptyMessage(cls)} />
      </ChartCard>
    );
  }
  return (
    <ChartCard title={title} subtitle="Quantity-weighted slippage (bps) and total cash slippage">
      <div className="overflow-x-auto -mx-4 px-4 print:overflow-visible">
        <table className="w-full text-xs min-w-[640px] print:min-w-0">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800">
              <th className={TH}>Benchmark</th>
              <th className={TH}>Orders</th>
              <th className={TH}>Quantity</th>
              <th className={TH} title="Notional traded: quantity × price × contract point value">
                Amount
              </th>
              <th className={TH} title="Each order weighted by its quantity">Avg Slip (bps)</th>
              <th className={TH} title="Total cash slippage across the orders">Slip ($)</th>
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
                  <td className={TD_MUTED}>{overall.count.toLocaleString()}</td>
                  <td className={TD_MUTED}>{overall.totalQty.toLocaleString()}</td>
                  <td className="py-2 pr-3"><AmountCell row={overall} /></td>
                  <td className="py-2 pr-3"><BpsCell v={s.wAvg_bps} /></td>
                  <td className="py-2 pr-3"><UsdCell v={s.total_usd} currency={overall.currency} /></td>
                  <td className={TD_MUTED}>
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

// ── By Instrument ─────────────────────────────────────────────────────────────

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
        <EmptyState message={emptyMessage(cls)} />
      </ChartCard>
    );
  }
  return (
    <ChartCard
      title={title}
      subtitle="Quantity-weighted slippage (bps) and total cash slippage against each benchmark"
      actions={actions}
    >
      <div className="overflow-x-auto -mx-4 px-4 print:overflow-visible">
        <table className="w-full text-xs min-w-[680px] print:min-w-0">
          <thead>
            <tr>
              <th className={TH} colSpan={4} />
              {benches.map((b) => (
                <BenchGroupHead key={b.id} id={b.id} />
              ))}
            </tr>
            <tr className="border-b border-gray-100 dark:border-gray-800">
              <th className={TH}>Instrument</th>
              <th className={TH}>Orders</th>
              <th className={TH}>Quantity</th>
              <th className={TH}>Amount</th>
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
                <td className={TD_MUTED}>{row.count.toLocaleString()}</td>
                <td className={TD_MUTED}>{row.totalQty.toLocaleString()}</td>
                <td className="py-2 pr-3"><AmountCell row={row} /></td>
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

// ── By Month ──────────────────────────────────────────────────────────────────

/**
 * One row per month with all four benchmarks across. The widest table in the
 * report (16 columns), so its cells are a size smaller on paper.
 */
export function AzOpenByMonth({ rows }: { rows: OpenGroupRow[] }) {
  const cash = useCashDisplay();
  if (rows.length === 0) {
    return (
      <ChartCard title="By Month">
        <EmptyState message="No orders to show" />
      </ChartCard>
    );
  }
  return (
    <ChartCard
      title="By Month"
      subtitle="Mid benchmarks scored on market orders, VWAP benchmarks on TWAP/VWAP orders; orders, quantity and amount cover every order in the month"
    >
      <div className="overflow-x-auto -mx-4 px-4 print:overflow-visible">
        <table className="w-full text-xs print:text-[10px] min-w-[960px] print:min-w-0">
          <thead>
            <tr>
              <th className={TH} colSpan={4} />
              {OPEN_BENCHMARKS.map((b) => (
                <BenchGroupHead key={b.id} id={b.id} tagged />
              ))}
            </tr>
            <tr className="border-b border-gray-100 dark:border-gray-800">
              <th className={TH}>Month</th>
              <th className={TH}>Orders</th>
              <th className={TH}>Quantity</th>
              <th className={TH}>Amount</th>
              {OPEN_BENCHMARKS.map((b) => (
                <SubHeads key={b.id} />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-gray-50 dark:border-gray-800/50">
                <td className="py-2 pr-3 font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                  {monthLabel(row.key)}
                </td>
                <td className={TD_MUTED}>{row.count.toLocaleString()}</td>
                <td className={TD_MUTED}>{row.totalQty.toLocaleString()}</td>
                <td className="py-2 pr-3"><AmountCell row={row} /></td>
                {OPEN_BENCHMARKS.map((b) => (
                  <BenchPair key={b.id} row={row} id={b.id} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-gray-800 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-gray-400 dark:text-gray-500">
        <span>Mid columns: market orders only</span>
        <span>VWAP columns: TWAP/VWAP orders only</span>
        <span>Positive slippage is a cost.</span>
      </div>
      <FxNote text={cash.disclosureFor(rows.map((r) => r.currency ?? "USD"))} />
    </ChartCard>
  );
}

// ── Top/Bottom 5 ──────────────────────────────────────────────────────────────

const TOP_BOTTOM_COLUMN_IDS: OpenColumnId[] = ["nyDate", "algo", "side", "orderQty", "amount"];

/**
 * The best and worst orders of one class by cash slippage against its primary
 * benchmark. Cells render through the Order Detail renderer, so an order reads
 * the same here as in the full list.
 */
export function AzOpenTopBottom({
  cls,
  best,
  worst,
}: {
  cls: OpenOrderClass;
  best: OpenTableRow[];
  worst: OpenTableRow[];
}) {
  const title = `Top / Bottom 5 — ${OPEN_ORDER_CLASS_LABEL[cls]}`;
  const primary = OPEN_BENCHMARKS.find((b) => b.id === PRIMARY_BENCHMARK[cls])!;
  if (best.length === 0) {
    return (
      <ChartCard title={title}>
        <EmptyState message={`No ${OPEN_ORDER_CLASS_LABEL[cls].toLowerCase()} with ${primary.label} slippage`} />
      </ChartCard>
    );
  }
  const cols = [
    ...TOP_BOTTOM_COLUMN_IDS.map((id) => AZ_OPEN_COLUMNS.find((c) => c.id === id)!),
    ...benchmarksFor(cls).flatMap((b) =>
      AZ_OPEN_COLUMNS.filter((c) => c.bench?.id === b.id && c.bench.unit !== "px"),
    ),
  ];
  const primaryUsd = `${primary.id}_usd`;

  const table = (label: string, rows: OpenTableRow[]) => (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <table className="w-full text-xs print:text-[10px]">
        <thead>
          <tr className="border-b border-gray-100 dark:border-gray-800">
            <th className={TH}>Symbol</th>
            {cols.map((c) => (
              <th key={c.id} className={TH}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.orderId} className="border-b border-gray-50 dark:border-gray-800/50">
              <td className="py-1.5 pr-3 font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                {row.bbgSymbol}
              </td>
              {cols.map((c) => (
                <td
                  key={c.id}
                  className={`py-1.5 pr-3 whitespace-nowrap ${c.id === primaryUsd ? "[&_span]:font-bold" : ""}`}
                >
                  {renderOpenCell(row, c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <ChartCard
      title={title}
      subtitle={`Ranked by cash slippage vs ${primary.label} — best is the largest saving`}
    >
      <div className="overflow-x-auto -mx-4 px-4 print:overflow-visible space-y-4">
        {table(`Best ${best.length}`, best)}
        {worst.length > 0 && table(`Worst ${worst.length}`, worst)}
      </div>
    </ChartCard>
  );
}

// ── Slippage note ─────────────────────────────────────────────────────────────

/**
 * Plain-language explanation of slippage and its colours, for readers new to
 * TCA. Sits between the summary tables and the order lists, on screen and in
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
          <span className="font-semibold text-gray-800 dark:text-gray-200">Amount</span> is the
          notional traded (quantity &times; price &times; contract point value), to show how
          large the slippage is relative to the size traded. bps figures weight each order by
          its quantity.
        </p>
      </div>
    </ChartCard>
  );
}

// ── Shared pieces ─────────────────────────────────────────────────────────────

/** A benchmark's two-column group header; `tagged` adds the class it scores. */
function BenchGroupHead({ id, tagged = false }: { id: OpenBenchmarkId; tagged?: boolean }) {
  const b = OPEN_BENCHMARKS.find((x) => x.id === id)!;
  return (
    <th
      colSpan={2}
      title={b.title}
      className={`${TH} text-center border-l border-gray-100 dark:border-gray-800 pl-3 cursor-help`}
    >
      {b.label}
      {tagged && (
        <span className="ml-1 font-normal normal-case tracking-normal text-gray-400 dark:text-gray-500">
          ({b.group === "market" ? "market" : "TWAP/VWAP"})
        </span>
      )}
    </th>
  );
}

function SubHeads() {
  return (
    <>
      <th
        className={`${TH} border-l border-gray-100 dark:border-gray-800 pl-3`}
        title="Quantity-weighted average slippage"
      >
        bps
      </th>
      <th className={TH} title="Total cash slippage">$</th>
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

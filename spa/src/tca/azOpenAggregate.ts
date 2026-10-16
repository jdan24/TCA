/**
 * Aggregations for the cash-open report: one overall row and one per instrument,
 * each built for one order class (market or TWAP/VWAP). Every benchmark is
 * summarised; the tables read only the ones that class is judged on.
 *
 * bps figures are quantity-weighted — Σ(bps × qty) / Σqty over the orders that
 * have the benchmark — so a large order counts for what it cost. Notional
 * ("Amount") is totalled the same way as cash slippage, so the two read
 * together: so much slipped on so much traded. Cash figures
 * are group totals, and a group whose currencies cannot be totalled reports no
 * total rather than summing across FX, as everywhere else in the app.
 */

import type { OpenBenchmarkId, OpenOrderClass, OpenResult, TradeRecord } from "@/types";
import { NATIVE_TOTALLER, type CashTotaller } from "./fx";
import { OPEN_BENCHMARKS, PRIMARY_BENCHMARK } from "./azOpen";

export interface OpenBenchSummary {
  /** Quantity-weighted mean slippage, in bps. */
  wAvg_bps: number | null;
  /** Group total cash slippage. null when the group's currencies cannot total. */
  total_usd: number | null;
  /** How many orders in the group have this benchmark. */
  withBenchmark: number;
}

export interface OpenGroupRow {
  key: string;
  count: number;
  totalQty: number;
  /** Total notional traded, in the display currency; null when it cannot total. */
  totalNotional: number | null;
  currency: string | null;
  bench: Record<OpenBenchmarkId, OpenBenchSummary>;
}

/**
 * Σ of a per-order cash figure in the display currency. null when the group's
 * currencies cannot total, or when no order has the figure. A member that will
 * not convert voids the total rather than being quietly left out of it.
 */
function totalCash(
  rows: Array<{ result: OpenResult }>,
  pick: (r: OpenResult) => number | null,
  canTotal: boolean,
  cash: CashTotaller,
): number | null {
  if (!canTotal) return null;
  let sum = 0;
  let seen = 0;
  for (const { result } of rows) {
    const v = pick(result);
    if (v === null || !isFinite(v)) continue;
    const converted = cash.toDisplay(v, result.currency);
    if (converted === null) return null;
    sum += converted;
    seen += 1;
  }
  return seen > 0 ? sum : null;
}

function summarise(
  key: string,
  rows: Array<{ result: OpenResult; qty: number }>,
  cash: CashTotaller,
): OpenGroupRow {
  const currencyList = [...new Set(rows.map((r) => r.result.currency))];
  const currency = cash.totalCurrency(currencyList);
  const canTotal = cash.canTotal(currencyList);

  const bench = {} as Record<OpenBenchmarkId, OpenBenchSummary>;
  for (const { id } of OPEN_BENCHMARKS) {
    let wSum = 0;
    let qSum = 0;
    let withBenchmark = 0;
    for (const { result, qty } of rows) {
      const s = result.bench[id];
      if (s.price !== null) withBenchmark += 1;
      if (s.bps === null || !isFinite(s.bps) || qty <= 0) continue;
      wSum += s.bps * qty;
      qSum += qty;
    }

    bench[id] = {
      wAvg_bps: qSum > 0 ? wSum / qSum : null,
      total_usd: totalCash(rows, (r) => r.bench[id].usd, canTotal, cash),
      withBenchmark,
    };
  }

  return {
    key,
    count: rows.length,
    totalQty: rows.reduce((s, r) => s + r.qty, 0),
    totalNotional: totalCash(rows, (r) => r.notional, canTotal, cash),
    currency,
    bench,
  };
}

/** One row across every order of one class. */
export function buildOpenOverall(
  trades: TradeRecord[],
  results: OpenResult[],
  cls: OpenOrderClass,
  cash: CashTotaller = NATIVE_TOTALLER,
): OpenGroupRow {
  const qtyById = new Map(trades.map((t) => [t.orderId, t.orderQty]));
  return summarise(
    "All orders",
    results
      .filter((r) => r.orderClass === cls)
      .map((r) => ({ result: r, qty: qtyById.get(r.orderId) ?? 0 })),
    cash,
  );
}

/** One row per instrument within one class, the contracts that carry it first. */
export function buildOpenBySymbol(
  trades: TradeRecord[],
  results: OpenResult[],
  cls: OpenOrderClass,
  symbolKeyFor: (ric: string) => string,
  cash: CashTotaller = NATIVE_TOTALLER,
): OpenGroupRow[] {
  const tradeById = new Map(trades.map((t) => [t.orderId, t]));
  const groups = new Map<string, Array<{ result: OpenResult; qty: number }>>();
  for (const r of results) {
    if (r.orderClass !== cls) continue;
    const trade = tradeById.get(r.orderId);
    if (!trade) continue;
    const label = symbolKeyFor(trade.symbol);
    let g = groups.get(label);
    if (!g) {
      g = [];
      groups.set(label, g);
    }
    g.push({ result: r, qty: trade.orderQty });
  }
  return [...groups.entries()]
    .map(([label, rows]) => summarise(label, rows, cash))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/**
 * One row per month, oldest first. Orders, quantity and notional cover every
 * order in the month; each benchmark is summarised over the month's orders of
 * the class it scores, so the mid columns are market orders and the VWAP
 * columns TWAP/VWAP orders.
 */
export function buildOpenByMonth(
  trades: TradeRecord[],
  results: OpenResult[],
  cash: CashTotaller = NATIVE_TOTALLER,
): OpenGroupRow[] {
  const qtyById = new Map(trades.map((t) => [t.orderId, t.orderQty]));
  const byMonth = new Map<string, Array<{ result: OpenResult; qty: number }>>();
  for (const r of results) {
    let g = byMonth.get(r.month);
    if (!g) {
      g = [];
      byMonth.set(r.month, g);
    }
    g.push({ result: r, qty: qtyById.get(r.orderId) ?? 0 });
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, rows]) => {
      const all = summarise(month, rows, cash);
      const market = summarise(month, rows.filter((x) => x.result.orderClass === "market"), cash);
      const algo = summarise(month, rows.filter((x) => x.result.orderClass === "algo"), cash);
      const bench = {} as Record<OpenBenchmarkId, OpenBenchSummary>;
      for (const b of OPEN_BENCHMARKS) {
        bench[b.id] = (b.group === "market" ? market : algo).bench[b.id];
      }
      return { ...all, bench };
    });
}

/**
 * The n best and n worst orders of one class by cash slippage against the
 * class's primary benchmark (best = most negative, i.e. the biggest saving).
 * Orders without that figure are left out. With fewer than 2n orders the worst
 * list only draws from orders not already in the best, so none appears twice.
 */
export function buildTopBottom<T extends { result: OpenResult }>(
  rows: T[],
  cls: OpenOrderClass,
  cash: CashTotaller = NATIVE_TOTALLER,
  n = 5,
): { best: T[]; worst: T[] } {
  const id = PRIMARY_BENCHMARK[cls];
  // Ranked in the display currency, so orders in different currencies compare
  // like for like; an order that will not convert cannot be ranked.
  const ranked = rows
    .filter((r) => r.result.orderClass === cls)
    .map((r) => {
      const v = r.result.bench[id].usd;
      return { r, v: v === null || !isFinite(v) ? null : cash.toDisplay(v, r.result.currency) };
    })
    .filter((x): x is { r: T; v: number } => x.v !== null)
    .sort((a, b) => a.v - b.v)
    .map((x) => x.r);
  const best = ranked.slice(0, n);
  const worst = ranked.slice(Math.max(best.length, ranked.length - n)).reverse();
  return { best, worst };
}

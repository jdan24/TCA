/**
 * Aggregations for the cash-open report: one overall row and one per instrument.
 *
 * bps figures are quantity-weighted — Σ(bps × qty) / Σqty over the orders that
 * have the benchmark — so a large order counts for what it cost. Cash figures
 * are group totals, and a group whose currencies cannot be totalled reports no
 * total rather than summing across FX, as everywhere else in the app.
 */

import type { OpenBenchmarkId, OpenResult, TradeRecord } from "@/types";
import { NATIVE_TOTALLER, type CashTotaller } from "./fx";
import { OPEN_BENCHMARKS } from "./azOpen";

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
  currency: string | null;
  bench: Record<OpenBenchmarkId, OpenBenchSummary>;
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

    // Whether a group totals at all is the totaller's call. A member that will
    // not convert voids the total rather than being quietly left out of it.
    let total_usd: number | null = null;
    if (canTotal) {
      let sum = 0;
      let seen = 0;
      for (const { result } of rows) {
        const v = result.bench[id].usd;
        if (v === null || !isFinite(v)) continue;
        const converted = cash.toDisplay(v, result.currency);
        if (converted === null) { seen = 0; break; }
        sum += converted;
        seen += 1;
      }
      total_usd = seen > 0 ? sum : null;
    }

    bench[id] = {
      wAvg_bps: qSum > 0 ? wSum / qSum : null,
      total_usd,
      withBenchmark,
    };
  }

  return {
    key,
    count: rows.length,
    totalQty: rows.reduce((s, r) => s + r.qty, 0),
    currency,
    bench,
  };
}

/** One row across every order in the report. */
export function buildOpenOverall(
  trades: TradeRecord[],
  results: OpenResult[],
  cash: CashTotaller = NATIVE_TOTALLER,
): OpenGroupRow {
  const qtyById = new Map(trades.map((t) => [t.orderId, t.orderQty]));
  return summarise(
    "All orders",
    results.map((r) => ({ result: r, qty: qtyById.get(r.orderId) ?? 0 })),
    cash,
  );
}

/** One row per instrument, the contracts that carry the report first. */
export function buildOpenBySymbol(
  trades: TradeRecord[],
  results: OpenResult[],
  symbolKeyFor: (ric: string) => string,
  cash: CashTotaller = NATIVE_TOTALLER,
): OpenGroupRow[] {
  const tradeById = new Map(trades.map((t) => [t.orderId, t]));
  const groups = new Map<string, Array<{ result: OpenResult; qty: number }>>();
  for (const r of results) {
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

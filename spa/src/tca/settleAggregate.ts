/**
 * Aggregations for the target-settle report.
 *
 * Two groupings: by settle window, and by instrument within a window. Both
 * follow the conventions the rest of the app already uses — bps figures are
 * simple means, cash figures are group totals, and a group spanning more than
 * one currency reports no total rather than summing across FX.
 */

import type { SettleResult, SettleWindow, TradeRecord } from "@/types";
import { safeAvg } from "@/components/dashboard/dashboardUtils";

export interface SettleGroupRow {
  /** Window id for the summary table; generic ticker for the per-symbol one. */
  key: string;
  window: SettleWindow;
  count: number;
  totalQty: number;
  /** Simple mean of per-order slippage vs settle, in bps. */
  avgSlip_bps: number | null;
  /** Group total cash slippage. null when the group mixes currencies. */
  totalSlip_usd: number | null;
  currency: string | null;
  /** How many orders in the group actually got a benchmark. */
  withBenchmark: number;
  /** How many carry the settle-time mismatch flag. */
  flagged: number;
}

const WINDOW_ORDER: SettleWindow[] = ["3pm", "4pm", "unassigned"];

/** Shared reducer for both groupings. */
function summarise(
  key: string,
  window: SettleWindow,
  rows: Array<{ result: SettleResult; qty: number }>,
): SettleGroupRow {
  const results = rows.map((r) => r.result);

  const currencies = new Set(results.map((r) => r.currency));
  const currency = currencies.size === 1 ? [...currencies][0] ?? null : null;

  // Cash only totals within one currency — there is no FX conversion anywhere
  // in this app, so a mixed group reports null instead of a wrong number.
  let totalSlip_usd: number | null = null;
  if (currency !== null) {
    let sum = 0;
    let seen = 0;
    for (const r of results) {
      if (r.slip_usd === null || !isFinite(r.slip_usd)) continue;
      sum += r.slip_usd;
      seen += 1;
    }
    totalSlip_usd = seen > 0 ? sum : null;
  }

  return {
    key,
    window,
    count: rows.length,
    totalQty: rows.reduce((s, r) => s + r.qty, 0),
    avgSlip_bps: safeAvg(results.map((r) => r.slip_bps)),
    totalSlip_usd,
    currency,
    withBenchmark: results.filter((r) => r.benchmark !== null).length,
    flagged: results.filter((r) => r.settleTimeMismatch).length,
  };
}

/**
 * One row per settle window, always in 3PM / 4PM / Unassigned order and always
 * all three — a window with no orders still shows as empty rather than vanishing,
 * so "nothing landed in the 3PM bucket" is legible as a finding.
 */
export function buildSettleWindowSummary(
  trades: TradeRecord[],
  results: SettleResult[],
): SettleGroupRow[] {
  const qtyById = new Map(trades.map((t) => [t.orderId, t.orderQty]));
  const groups = new Map<SettleWindow, Array<{ result: SettleResult; qty: number }>>();
  for (const w of WINDOW_ORDER) groups.set(w, []);

  for (const r of results) {
    groups.get(r.window)?.push({ result: r, qty: qtyById.get(r.orderId) ?? 0 });
  }

  return WINDOW_ORDER.map((w) => summarise(w, w, groups.get(w) ?? []));
}

/**
 * One row per (window, instrument), so a contract that is persistently poor into
 * a settle separates from one that had a single bad day.
 */
export function buildSettleBySymbol(
  trades: TradeRecord[],
  results: SettleResult[],
  symbolKeyFor: (ric: string) => string,
): SettleGroupRow[] {
  const tradeById = new Map(trades.map((t) => [t.orderId, t]));
  const groups = new Map<string, { window: SettleWindow; label: string; rows: Array<{ result: SettleResult; qty: number }> }>();

  for (const r of results) {
    const trade = tradeById.get(r.orderId);
    if (!trade) continue;
    const label = symbolKeyFor(trade.symbol);
    const key = `${r.window}|${label}`;
    let g = groups.get(key);
    if (!g) {
      g = { window: r.window, label, rows: [] };
      groups.set(key, g);
    }
    g.rows.push({ result: r, qty: trade.orderQty });
  }

  return [...groups.values()]
    .map((g) => summarise(g.label, g.window, g.rows))
    .sort((a, b) => {
      const wa = WINDOW_ORDER.indexOf(a.window);
      const wb = WINDOW_ORDER.indexOf(b.window);
      if (wa !== wb) return wa - wb;
      return b.count - a.count;
    });
}

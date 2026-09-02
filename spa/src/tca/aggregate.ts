/**
 * Multi-order aggregation — group trades + results by various dimensions
 * and compute summary statistics for each group.
 *
 * Two public entry points:
 *
 *   buildAggregations()      the groupings that span every benchmark — by algo,
 *                            symbol+algo, symbol+side, symbol+algo+side.
 *   buildSymbolAggregation() one By Symbol table, for one benchmark.
 *
 * The split exists because an order is only comparable with the benchmark its
 * algo was working to: averaging a TWAP order's arrival slippage next to a
 * POV order's says nothing about either. The caller partitions its orders by
 * benchmark and calls buildSymbolAggregation() once per bucket, so each table
 * scores its win rate, best and worst against the right series.
 *
 * Each row includes orderIds for TradeTable pre-filtering.
 */

import { NATIVE_TOTALLER, type CashTotaller } from "./fx";
import type {
  AggregateRow,
  BenchmarkKind,
  CrossBenchmarkAggregations,
  SpreadSavingsRow,
  TCAResult,
  TradeRecord,
} from "@/types";
import { safeAvg } from "@/components/dashboard/dashboardUtils";

// ── Internal group accumulator ────────────────────────────────────────────────

interface GroupAcc {
  trades: TradeRecord[];
  results: TCAResult[];
}

/**
 * The slippage series a benchmark is scored on.
 *
 * Positive is a cost in every one of them (see tca/slippage.ts), so win rate,
 * best and worst read the same way whichever benchmark is in play.
 */
export function slippageFor(r: TCAResult, benchmark: BenchmarkKind): number | null {
  return benchmark === "vwap" ? r.VWAP_dev_bps
       : benchmark === "twap" ? r.TWAP_dev_bps
       : r.IS_bps;
}

// ── Generic groupBy helper ────────────────────────────────────────────────────

function groupBy(
  trades: TradeRecord[],
  results: TCAResult[],
  keyFn: (t: TradeRecord) => string,
  cash: CashTotaller = NATIVE_TOTALLER,
  /** Which slippage series feeds win rate, best and worst. */
  benchmark: BenchmarkKind = "arrival",
): AggregateRow[] {
  const resultMap = new Map<string, TCAResult>();
  for (const r of results) resultMap.set(r.orderId, r);

  const groups = new Map<string, GroupAcc>();

  for (const t of trades) {
    const key = keyFn(t);
    let acc = groups.get(key);
    if (!acc) {
      acc = { trades: [], results: [] };
      groups.set(key, acc);
    }
    acc.trades.push(t);
    const r = resultMap.get(t.orderId);
    if (r) acc.results.push(r);
  }

  const rows: AggregateRow[] = [];

  for (const [groupKey, { trades: gTrades, results: gResults }] of groups.entries()) {
    const count = gTrades.length;
    const totalQty = gTrades.reduce((s, t) => s + t.orderQty, 0);

    const avgIS_bps = safeAvg(gResults.map((r) => r.IS_bps));
    const avgVWAP_dev_bps = safeAvg(gResults.map((r) => r.VWAP_dev_bps));
    const avgTWAP_dev_bps = safeAvg(gResults.map((r) => r.TWAP_dev_bps));

    // Cash figures are group totals rather than averages: they are additive, and
    // the total cost of trading a symbol is what gets acted on.
    //
    // Whether a group can be totalled at all is the totaller's call. In native
    // mode that means one currency, as it always did — summing across currencies
    // without converting is meaningless. In USD mode every member is converted
    // first, so a group spanning Bund and Treasury futures gains a real total.
    // A group with one unconvertible member still reports none, rather than a
    // sum that quietly omits it.
    const currencyList = [...new Set(gResults.map((r) => r.currency))];
    const currency = cash.totalCurrency(currencyList);
    const canSum = cash.canTotal(currencyList);
    const sumUsd = (pick: (r: TCAResult) => number | null): number | null => {
      if (!canSum) return null;
      let sum = 0;
      let seen = 0;
      for (const r of gResults) {
        const v = pick(r);
        if (v === null || !isFinite(v)) continue;
        const converted = cash.toDisplay(v, r.currency);
        if (converted === null) return null;
        sum += converted;
        seen += 1;
      }
      return seen > 0 ? sum : null;
    };
    const totalVWAP_dev_usd = sumUsd((r) => r.VWAP_dev_usd);
    const totalTWAP_dev_usd = sumUsd((r) => r.TWAP_dev_usd);
    const avgMI_bps = safeAvg(gResults.map((r) => r.MI_bps));
    const avgTWAS_bps = safeAvg(gResults.map((r) => r.TWAS_bps));
    const avgTTF_ms = safeAvg(gResults.map((r) => r.timeToFill_ms)) ?? 0;

    // Win rate, best and worst all score against the table's own benchmark, so a
    // "vs TWAP" table never reports a win that was only a win against arrival.
    // Orders with no figure for that benchmark are excluded rather than counted
    // as losses.
    const slipVals = gResults
      .map((r) => slippageFor(r, benchmark))
      .filter((v): v is number => v !== null);
    const winRate =
      slipVals.length > 0 ? slipVals.filter((v) => v <= 0).length / slipVals.length : null;
    const bestIS_bps = slipVals.length > 0 ? Math.min(...slipVals) : null;
    const worstIS_bps = slipVals.length > 0 ? Math.max(...slipVals) : null;

    rows.push({
      groupKey,
      count,
      totalQty,
      avgIS_bps,
      avgVWAP_dev_bps,
      avgTWAP_dev_bps,
      totalVWAP_dev_usd,
      totalTWAP_dev_usd,
      currency,
      avgMI_bps,
      avgTWAS_bps,
      avgTTF_ms,
      winRate,
      bestIS_bps,
      worstIS_bps,
      orderIds: gTrades.map((t) => t.orderId),
    });
  }

  // Default sort: count descending
  return rows.sort((a, b) => b.count - a.count);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * One By Symbol table, over orders already narrowed to a single benchmark.
 *
 * The caller does the partitioning because it also applies the table's own algo
 * filter — passing the benchmark in here would leave this function unable to
 * tell "no VWAP orders" from "every VWAP algo unticked".
 */
export function buildSymbolAggregation(
  trades: TradeRecord[],
  results: TCAResult[],
  benchmark: BenchmarkKind,
  groupSymbol: (ric: string) => string = (s) => s,
  cash: CashTotaller = NATIVE_TOTALLER,
): AggregateRow[] {
  return groupBy(trades, results, (t) => groupSymbol(t.symbol), cash, benchmark);
}

export function buildAggregations(
  trades: TradeRecord[],
  results: TCAResult[],
  /**
   * Maps a trade's symbol to the label it groups under. Pass
   * toGenericTicker∘resolve to collapse expiries onto the instrument
   * ("FVU6"/"FVZ6" → "FV Comdty"); the identity default keeps per-contract rows.
   * byAlgo is unaffected either way — it never keys on the symbol.
   */
  groupSymbol: (ric: string) => string = (s) => s,
  /**
   * How cash totals are formed. Omitted, groups total only within one currency —
   * the behaviour from before FX existed. The dashboard passes useCashDisplay,
   * so USD mode converts each member before adding and cross-currency groups
   * gain a real total.
   */
  cash: CashTotaller = NATIVE_TOTALLER,
): CrossBenchmarkAggregations {
  return {
    byAlgo: groupBy(trades, results, (t) => t.algo ?? "(no algo)", cash),
    bySymbolAlgo: groupBy(
      trades,
      results,
      (t) => `${groupSymbol(t.symbol)} / ${t.algo ?? "(no algo)"}`,
      cash,
    ),
    bySymbolSide: groupBy(trades, results, (t) => `${groupSymbol(t.symbol)} ${t.side}`, cash),
    bySymbolAlgoSide: groupBy(
      trades,
      results,
      (t) => `${groupSymbol(t.symbol)} / ${t.algo ?? "(no algo)"} ${t.side}`,
      cash,
    ),
  };
}

// ── Spread savings ────────────────────────────────────────────────────────────

/**
 * Below this an average spread is treated as unusable: dividing by it turns
 * rounding noise into a savings figure that swings by orders of magnitude.
 * Same reasoning as MIN_ABS_MID in tca/spread.ts.
 */
const MIN_SPREAD_BPS = 1e-6;

/** Median of a list of numbers; even counts average the two middle values. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const lo = sorted[mid - 1];
  const hi = sorted[mid];
  return lo !== undefined && hi !== undefined ? (lo + hi) / 2 : null;
}

/**
 * Per-instrument view of how much of the quoted spread the execution kept,
 * alongside the market conditions that produced it.
 *
 * Always grouped by generic ticker — collapsing expiries is the whole point of
 * the table, so it does not follow the dashboard's group-by toggle.
 *
 * On the volatility columns
 * ─────────────────────────
 * Savings divides by the spread, so on a one-tick market the denominator is
 * tiny and the figure reports drift rather than spread capture: ES is ~0.42 bps
 * wide while a 5-minute window carries ~11 bps of movement, which turns an
 * ordinary +3 bps of drift into −664%. Those rows are not wrong, they are
 * outside the metric's domain — so the volatility the orders traded through is
 * reported beside the score rather than the score being suppressed.
 *
 * Every figure is null rather than 0 when its inputs are missing, so a group
 * with no Bloomberg quotes reads as "no data" instead of "paid nothing".
 *
 * On the benchmark
 * ────────────────
 * The savings formula keeps its shape whichever benchmark is passed — only the
 * slippage term changes, from arrival to deviation vs market VWAP or TWAP. That
 * keeps the scale comparable across the three tables (1.0 = near touch, 0.5 =
 * mid, 0.0 = paid the spread). Worth knowing when reading the VWAP and TWAP
 * tables: half the quoted spread is the natural yardstick for an order crossing
 * a spread at arrival, and a looser one for an order following a schedule, so
 * their figures are best read against each other rather than against arrival's.
 */
export function buildSpreadSavings(
  trades: TradeRecord[],
  results: TCAResult[],
  genericFor: (ric: string) => string,
  /** Which slippage series is scored against the spread. */
  benchmark: BenchmarkKind = "arrival",
): SpreadSavingsRow[] {
  const resultMap = new Map<string, TCAResult>();
  for (const r of results) resultMap.set(r.orderId, r);

  const groups = new Map<string, GroupAcc>();
  for (const t of trades) {
    const key = genericFor(t.symbol);
    let acc = groups.get(key);
    if (!acc) {
      acc = { trades: [], results: [] };
      groups.set(key, acc);
    }
    acc.trades.push(t);
    const r = resultMap.get(t.orderId);
    if (r) acc.results.push(r);
  }

  const rows: SpreadSavingsRow[] = [];

  for (const [groupKey, { trades: gTrades, results: gResults }] of groups.entries()) {
    const avgSpread_bps = safeAvg(gResults.map((r) => r.TWAS_bps));

    // Quantity-weighted slippage vs the benchmark: a 200-lot should move this
    // figure 200× more than a 1-lot. Orders with no figure for this benchmark
    // are excluded from both sums, not counted as zero.
    let isWeightedSum = 0;
    let isWeight = 0;
    // Savings is computed per order and then quantity-weighted, rather than as a
    // ratio of the group's aggregates. Each order is scored against the spread
    // *it* actually faced, and the resulting mean is comparable with a median.
    let savWeightedSum = 0;
    let savWeight = 0;
    const isValues: number[] = [];
    // Quantity-weighted, matching wAvgIS_bps rather than the simple mean the
    // AggregateTables use — this table weights its slippage figures by size.
    const volValues: number[] = [];
    const volRates: number[] = [];

    for (const t of gTrades) {
      const r = resultMap.get(t.orderId);
      if (!r) continue;
      const qty = t.orderQty > 0 ? t.orderQty : 0;
      const slip = slippageFor(r, benchmark);
      const is = slip !== null && isFinite(slip) ? slip : null;
      const spread = r.TWAS_bps !== null && isFinite(r.TWAS_bps) ? r.TWAS_bps : null;

      if (is !== null) {
        isValues.push(is);
        if (qty > 0) {
          isWeightedSum += is * qty;
          isWeight += qty;
        }
      }

      // A near-zero spread makes the per-order ratio explode, so that order is
      // dropped instead of being allowed to poison the group's mean.
      if (is !== null && spread !== null && Math.abs(spread) >= MIN_SPREAD_BPS && qty > 0) {
        savWeightedSum += ((spread / 2 - is) / spread) * qty;
        savWeight += qty;
      }

      // Volatility is a reading of the environment, so each order's window counts
      // once — no quantity weighting, matching how avgSpread_bps is built.
      const vol = r.vol_during_order_bps;
      if (vol !== null && isFinite(vol)) {
        volValues.push(vol);
        // σ grows with √duration, so dividing by √minutes turns a total into a
        // rate that is comparable between a 30-second and a two-hour order.
        const minutes = r.timeToFill_ms / 60_000;
        if (minutes > 0) volRates.push(vol / Math.sqrt(minutes));
      }
    }

    rows.push({
      groupKey,
      count: gTrades.length,
      totalQty: gTrades.reduce((s, t) => s + t.orderQty, 0),
      avgSpread_bps,
      wAvgIS_bps: isWeight > 0 ? isWeightedSum / isWeight : null,
      medianIS_bps: median(isValues),
      avgVol_bps: safeAvg(volValues),
      avgVolRate_bps: safeAvg(volRates),
      savingsPct: savWeight > 0 ? savWeightedSum / savWeight : null,
    });
  }

  // Most-traded first, matching the aggregation tables' default sort.
  return rows.sort((a, b) => b.count - a.count);
}

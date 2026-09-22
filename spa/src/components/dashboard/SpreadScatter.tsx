/**
 * Cost vs Crossing the Spread — what the algos saved against simply paying up.
 *
 * Built for an audience that trades with market orders. The question it answers
 * is "what would this have cost me if I'd just hit the bid / lifted the offer?",
 * so the y axis is not slippage but the saving against that alternative:
 *
 *   savings_bps = TWAS_bps − 2 × IS_bps    (positive = cheaper than crossing)
 *
 * On the doubling
 * ───────────────
 * The quoted spread is a TWO-way quantity — ask minus bid — while IS is ONE-way,
 * measured from the arrival mid. Comparing them directly flattered every order by
 * half a spread: a real FVZ6 market order that crossed a one-tick market for
 * exactly half the width scored +0.37 bps and plotted as a win over market
 * orders, which is the thing this chart exists to measure against.
 *
 * So both sides are put on a round trip. Crossing twice costs the full quoted
 * spread; executing twice at this order's own slippage costs 2 × IS. That order
 * now scores 0.00, and the full width stays the headline comparator.
 *
 * Equivalently this is 2 × TWAS × savingsPct, so the chart and the Spread
 * Savings table (buildSpreadSavings() in tca/aggregate.ts) share a zero point.
 *
 * The baseline is therefore a single flat line at y = 0 for the whole chart,
 * with a neutral band either side — see NEUTRAL_BAND_FRACTION for why an order
 * that merely matched the crossing cost must not be coloured on its sign.
 *
 * X keeps TWAS, so the reading holds across tight and wide markets. Because y is
 * derived from x, the points form a wedge bounded above by y = x — reached when
 * IS is zero — and savings are naturally larger where spreads are wider.
 *
 * Requires both Bloomberg TWAS data and arrival price (IS).
 */

import { useMemo } from "react";
import {
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TCAResult, TradeRecord } from "@/types";
import { useChartAlgoFilter } from "@/hooks/useChartAlgoFilter";
import { AlgoFilterMenu } from "./AlgoFilterMenu";
import { ChartCard, EmptyState, fmtBps, slipToneClass } from "./dashboardUtils";

/**
 * The card's title, exported so the print layout captions the image identically
 * rather than re-typing it — the two had already drifted apart once.
 */
export const SPREAD_SCATTER_TITLE = "Cost vs Crossing the Spread";

const BEAT_COLOR = "#10b981"; // emerald — cost less than crossing
const EVEN_COLOR = "#94a3b8"; // slate   — matched the cost of crossing
const MISS_COLOR = "#ef4444"; // red     — cost more than crossing
const BASELINE_COLOR = "#64748b";

/**
 * Half-width of the neutral band, as a fraction of the quoted spread.
 *
 * Without it the colour of an order that merely crossed is decided by rounding
 * rather than execution: on a one-tick FV market a 1% change in the spread
 * flips it between green and red. Orders this close to the baseline matched it,
 * and say so, rather than being scattered into wins and losses at random.
 */
const NEUTRAL_BAND_FRACTION = 0.1;

type Verdict = "beat" | "matched" | "miss";

const VERDICT_COLOR: Record<Verdict, string> = {
  beat: BEAT_COLOR,
  matched: EVEN_COLOR,
  miss: MISS_COLOR,
};

interface SpreadScatterProps {
  /** Needed for the algo filter and the tooltip — algo, symbol, side and qty
   *  live on the trade, not the result. */
  trades: TradeRecord[];
  results: TCAResult[];
}

/**
 * Gridline spacing for a y range, in whole bps.
 *
 * Every candidate is an integer, so a tick can never land on a fraction and the
 * axis cannot print the same rounded label twice — the failure the single-order
 * charts already guard against with their own snapped-tick helper.
 */
function wholeBpsStep(range: number): number {
  const target = range / 6; // aim for roughly six gridlines
  const steps = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];
  return steps.find((s) => s >= target) ?? steps[steps.length - 1]!;
}

/**
 * Y domain and ticks: whole bps only, always bracketing zero.
 *
 * The range is padded to at least ±1 bps so a tight-spread instrument — ES is
 * ~0.42 bps wide, and every saving on it is sub-1-bps — still draws a whole-bps
 * line either side of the baseline instead of leaving the baseline alone.
 */
function wholeBpsAxis(values: number[]): { domain: [number, number]; ticks: number[] } {
  const min = Math.min(-1, ...values);
  const max = Math.max(1, ...values);
  const step = wholeBpsStep(max - min);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  return { domain: [lo, hi], ticks };
}

interface Point {
  twas: number;
  /** TWAS − 2·IS: bps saved against crossing, round trip against round trip. */
  savings: number;
  /** Kept for the tooltip, which shows the underlying slippage too. */
  is: number;
  /** Where the order landed relative to the baseline and its neutral band. */
  verdict: Verdict;
  /** Identity, so a visible outlier is an order you can go and look at. */
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
}

export function SpreadScatter({ trades, results }: SpreadScatterProps) {
  const algoFilter = useChartAlgoFilter("spread", trades);

  const tradeMap = useMemo(() => {
    const m = new Map<string, TradeRecord>();
    for (const t of trades) m.set(t.orderId, t);
    return m;
  }, [trades]);

  const points = useMemo<Point[]>(() => {
    const pts: Point[] = [];
    for (const r of results) {
      if (
        r.TWAS_bps !== null && isFinite(r.TWAS_bps) &&
        r.IS_bps !== null && isFinite(r.IS_bps)
      ) {
        const trade = tradeMap.get(r.orderId);
        if (!trade || !algoFilter.includes(trade)) continue;
        // Round trip against round trip: crossing twice costs the full quoted
        // spread, executing twice at this order's own slippage costs 2 × IS.
        // Comparing a one-way slippage with a two-way spread was what let a
        // plain market order read as a win over market orders.
        const savings = r.TWAS_bps - 2 * r.IS_bps;
        const band = Math.abs(r.TWAS_bps) * NEUTRAL_BAND_FRACTION;
        pts.push({
          twas: r.TWAS_bps,
          savings,
          is: r.IS_bps,
          verdict: savings > band ? "beat" : savings < -band ? "miss" : "matched",
          orderId: r.orderId,
          symbol: trade.symbol,
          side: trade.side,
          qty: trade.orderQty,
        });
      }
    }
    return pts;
  }, [results, tradeMap, algoFilter]);

  // The headline counts the neutral band as a pass: an order that matched the
  // cost of crossing did not lose to it, and the claim being made is "at or
  // better", not "strictly better".
  const atOrBetterCount = points.filter((p) => p.verdict !== "miss").length;

  const yAxis = useMemo(
    () => wholeBpsAxis(points.map((p) => p.savings)),
    [points],
  );

  const actions = <AlgoFilterMenu filter={algoFilter} />;

  if (points.length === 0) {
    return (
      <ChartCard
        title={SPREAD_SCATTER_TITLE}
        subtitle="What the algos saved against simply crossing and paying"
        actions={actions}
      >
        <EmptyState
          message={
            algoFilter.isNarrowed
              ? "No orders match the selected algos"
              : "Bloomberg bid/ask tick data required for TWAS"
          }
        />
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title={SPREAD_SCATTER_TITLE}
      subtitle={`${atOrBetterCount} of ${points.length} orders at or better than crossing the full spread`}
      actions={actions}
    >
      <ResponsiveContainer width="100%" height={240}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 0 }}>
          {/* Two grids rather than one: the horizontals are dotted and land only
              on whole bps (they follow the Y axis ticks below), while the
              verticals keep the dash they have always had. A single
              CartesianGrid cannot style the two axes differently. */}
          <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#e5e7eb" />
          <CartesianGrid vertical={false} strokeDasharray="1 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="twas"
            type="number"
            name="Quoted spread"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11 }}
            label={{
              value: "Quoted spread — TWAS (bps)",
              position: "insideBottom",
              offset: -12,
              fontSize: 11,
              fill: "#6b7280",
            }}
          />
          <YAxis
            dataKey="savings"
            type="number"
            name="Saved vs crossing"
            domain={yAxis.domain}
            ticks={yAxis.ticks}
            tickFormatter={(v: unknown) =>
              typeof v === "number" ? String(Math.round(v)) : ""
            }
            tick={{ fontSize: 11 }}
            width={38}
            label={{
              value: "Saved vs crossing (bps)",
              angle: -90,
              position: "insideLeft",
              offset: 12,
              fontSize: 11,
              fill: "#6b7280",
            }}
          />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ payload }) => {
              // Guard on the dot series' own field so the tooltip cannot fire on
              // empty chart area or on a future reference series.
              const entries = (payload ?? []) as unknown as ReadonlyArray<{ payload?: unknown }>;
              const d = entries
                .map((e) => e.payload as Point | undefined)
                .find((p): p is Point => p !== undefined && typeof p.orderId === "string");
              if (!d) return null;

              const savedTone =
                d.verdict === "beat"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : d.verdict === "miss"
                    ? "text-red-500 dark:text-red-400"
                    : "text-gray-500 dark:text-gray-400";

              return (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 shadow-lg text-xs">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="font-semibold text-gray-900 dark:text-white">
                      {d.symbol}
                    </span>
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide ${
                        d.side === "BUY"
                          ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                          : "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400"
                      }`}
                    >
                      {d.side}
                    </span>
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 tabular-nums">
                      {d.qty.toLocaleString()}
                    </span>
                  </div>
                  <p className="text-gray-600 dark:text-gray-300">
                    Quoted spread:{" "}
                    <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                      {d.twas.toFixed(2)} bps
                    </span>
                  </p>
                  <p className="text-gray-600 dark:text-gray-300">
                    Your slippage:{" "}
                    <span className={`font-semibold tabular-nums ${slipToneClass(d.is)}`}>
                      {fmtBps(d.is, 2)}
                    </span>
                  </p>
                  {/* The doubled figure is shown rather than left implied: it is
                      the step a sceptical reader will want to check, and this
                      chart's whole job is to be checked. */}
                  <p className="text-gray-600 dark:text-gray-300">
                    Round trip (2&times;):{" "}
                    <span className={`font-semibold tabular-nums ${slipToneClass(d.is)}`}>
                      {fmtBps(d.is * 2, 2)}
                    </span>
                  </p>
                  <p
                    className={`mt-1.5 pt-1.5 border-t border-gray-100 dark:border-gray-700 font-medium ${savedTone}`}
                  >
                    {d.verdict === "matched" ? (
                      "Matched the cost of crossing"
                    ) : (
                      <>
                        {d.verdict === "beat" ? "Saved" : "Cost"}{" "}
                        <span className="tabular-nums">
                          {Math.abs(d.savings).toFixed(2)} bps
                        </span>{" "}
                        {d.verdict === "beat" ? "vs crossing" : "more than crossing"}
                      </>
                    )}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-gray-400 dark:text-gray-500 truncate max-w-[15rem]">
                    {d.orderId}
                  </p>
                </div>
              );
            }}
          />

          {/* The baseline. This single line replaces the per-order spread marks:
              at y = 0 the order cost exactly the full quoted width. */}
          <ReferenceLine
            y={0}
            stroke={BASELINE_COLOR}
            strokeWidth={1.5}
            label={{
              value: "cost of crossing the spread",
              position: "insideTopRight",
              fontSize: 10,
              fill: BASELINE_COLOR,
            }}
          />

          <Scatter data={points} isAnimationActive={false}>
            {points.map((p, i) => (
              <Cell key={i} fill={VERDICT_COLOR[p.verdict]} fillOpacity={0.8} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: BEAT_COLOR }} />
          cost less than crossing
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: EVEN_COLOR }} />
          matched crossing (within 10%)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: MISS_COLOR }} />
          cost more than crossing
        </span>
      </div>

      {/* Methodology. Inside the card so it is captured into the exported PNG —
          the baseline is an assumption and should travel with the picture. */}
      <p className="mt-1.5 text-[10px] text-gray-400 dark:text-gray-500">
        Baseline: the full quoted spread (TWAS), against twice the order&rsquo;s slippage
        &mdash; a round trip each side. Slippage is measured against the arrival mid.
      </p>
    </ChartCard>
  );
}

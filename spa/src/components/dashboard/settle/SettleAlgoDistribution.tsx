/**
 * SettleAlgoDistribution — slippage vs the settle benchmark, by algo.
 *
 * One chart per settle window, because the two benchmarks are different things:
 * 3PM is the contract's own official settle, 4PM the last print before the
 * equity close. Averaging an algo across both would hide which print it is
 * actually good into.
 *
 * Within a chart the algos are columns. Every order in an algo is a dot at its
 * own slippage, and a wide bar marks the algo's mean — so a policy that is
 * consistently a touch expensive separates from one that averages well because
 * two large misses cancelled. The dots are jittered horizontally within their
 * column so that orders landing on the same slippage stay countable rather than
 * stacking into a single mark.
 *
 * Sign convention is the report's: positive is a cost.
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
import type { SettleResult, SettleWindow, TradeRecord } from "@/types";
import { settleWindowLabel } from "@/tca/settle";
import { NO_ALGO_LABEL } from "@/tca/settleAggregate";
import {
  ChartCard,
  EmptyState,
  fmtBps,
  paletteColor,
  safeAvg,
} from "@/components/dashboard/dashboardUtils";

type SettledWindow = Exclude<SettleWindow, "unassigned">;

/** Half-width of an algo's mean bar, in pixels. */
const MEAN_HALF_WIDTH = 22;
const MEAN_COLOR = "#475569";

/**
 * How far a dot may be nudged sideways from its column centre, as a fraction of
 * the one-unit spacing between columns. Wide enough to separate a dozen orders,
 * narrow enough that no dot can be mistaken for its neighbour's column.
 */
const JITTER_SPREAD = 0.28;

interface Point {
  /** Column index, plus the dot's own jitter. */
  x: number;
  slip: number;
  algo: string;
  symbol: string;
  colorIndex: number;
}

interface AlgoColumn {
  algo: string;
  index: number;
  mean: number | null;
  count: number;
}

/** Tooltip for one order: what it was, not where the jitter put it. */
function PointTooltip(props: unknown) {
  const { active, payload } = props as {
    active?: boolean;
    payload?: Array<{ payload?: Point }>;
  };
  const point = payload?.[0]?.payload;
  if (active !== true || point === undefined || point.symbol === undefined) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] shadow-lg dark:border-gray-700 dark:bg-gray-900">
      <p className="font-semibold text-gray-900 dark:text-white">{point.symbol}</p>
      <p className="text-gray-500 dark:text-gray-400">{point.algo}</p>
      <p className="tabular-nums text-gray-700 dark:text-gray-300">
        {fmtBps(point.slip)} vs settle
      </p>
    </div>
  );
}

/** A wide flat bar at an algo's mean slippage. */
function MeanBar(props: unknown) {
  const { cx, cy } = props as { cx?: number; cy?: number };
  if (typeof cx !== "number" || typeof cy !== "number") return null;
  return (
    <line
      x1={cx - MEAN_HALF_WIDTH}
      x2={cx + MEAN_HALF_WIDTH}
      y1={cy}
      y2={cy}
      stroke={MEAN_COLOR}
      strokeWidth={2.5}
      strokeLinecap="round"
    />
  );
}

/**
 * Deterministic jitter in [-1, 1) from the order id.
 *
 * Deterministic on purpose: a random offset would make every dot hop on each
 * re-render, which reads as the data changing when only React did.
 */
function jitterOf(orderId: string): number {
  let h = 2166136261;
  for (let i = 0; i < orderId.length; i++) {
    h ^= orderId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

export function SettleAlgoDistribution({
  window,
  trades,
  results,
}: {
  window: SettledWindow;
  trades: TradeRecord[];
  results: SettleResult[];
}) {
  const { points, columns } = useMemo(() => {
    const tradeById = new Map(trades.map((t) => [t.orderId, t]));

    // Group this window's benchmarked orders by algo, in first-seen order of the
    // sorted algo names so the two charts put the same algo in the same column.
    const byAlgo = new Map<string, Array<{ slip: number; orderId: string; symbol: string }>>();
    for (const r of results) {
      if (r.window !== window || r.slip_bps === null) continue;
      const trade = tradeById.get(r.orderId);
      if (!trade) continue;
      const algo = trade.algo?.trim() || NO_ALGO_LABEL;
      const list = byAlgo.get(algo);
      const entry = { slip: r.slip_bps, orderId: trade.orderId, symbol: trade.symbol };
      if (list) list.push(entry);
      else byAlgo.set(algo, [entry]);
    }

    // Named algos alphabetically, the blank sentinel always last — matching how
    // the algo filters elsewhere order their options.
    const names = [...byAlgo.keys()].sort((a, b) => {
      if (a === NO_ALGO_LABEL) return 1;
      if (b === NO_ALGO_LABEL) return -1;
      return a.localeCompare(b);
    });

    const cols: AlgoColumn[] = [];
    const pts: Point[] = [];
    names.forEach((algo, index) => {
      const orders = byAlgo.get(algo) ?? [];
      cols.push({
        algo,
        index,
        mean: safeAvg(orders.map((o) => o.slip)),
        count: orders.length,
      });
      for (const o of orders) {
        pts.push({
          x: index + jitterOf(o.orderId) * JITTER_SPREAD,
          slip: o.slip,
          algo,
          symbol: o.symbol,
          colorIndex: index,
        });
      }
    });

    return { points: pts, columns: cols };
  }, [window, trades, results]);

  const title = `${settleWindowLabel(window)} — Slippage by Algo`;

  if (points.length === 0) {
    return (
      <ChartCard title={title} subtitle="Slippage vs the settle benchmark, per order">
        <EmptyState message={`No benchmarked orders in the ${settleWindowLabel(window)} window`} />
      </ChartCard>
    );
  }

  const meanPoints = columns
    .filter((c): c is AlgoColumn & { mean: number } => c.mean !== null)
    .map((c) => ({ x: c.index, slip: c.mean }));

  return (
    <ChartCard
      title={title}
      subtitle={`${points.length} order${points.length !== 1 ? "s" : ""} across ${columns.length} algo${columns.length !== 1 ? "s" : ""} — positive is a cost`}
    >
      <ResponsiveContainer width="100%" height={260}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 28, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis
            dataKey="x"
            type="number"
            name="Algo"
            // The domain is padded half a column each side so the outermost
            // columns' jitter and mean bars are not clipped by the axis.
            domain={[-0.5, columns.length - 0.5]}
            ticks={columns.map((c) => c.index)}
            tick={{ fontSize: 11 }}
            tickFormatter={(v: unknown) =>
              typeof v === "number" ? columns[Math.round(v)]?.algo ?? "" : ""
            }
            interval={0}
          />
          <YAxis
            dataKey="slip"
            type="number"
            name="Slippage"
            tick={{ fontSize: 11 }}
            width={44}
            label={{
              value: "slip vs settle (bps)",
              angle: -90,
              position: "insideLeft",
              offset: 14,
              fontSize: 10,
              fill: "#6b7280",
            }}
          />
          {/* Custom content: the x value is a jittered column index, so the
              default tooltip would report a number that means nothing. */}
          <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<PointTooltip />} />
          {/* Zero slippage: filled exactly at the settle. */}
          <ReferenceLine y={0} stroke="#94a3b8" />

          <Scatter data={points} isAnimationActive={false}>
            {points.map((p, i) => (
              <Cell key={i} fill={paletteColor(p.colorIndex)} fillOpacity={0.8} />
            ))}
          </Scatter>

          {/* Mean bars last, so they read on top of a dense column. */}
          <Scatter
            data={meanPoints}
            shape={<MeanBar />}
            isAnimationActive={false}
            legendType="none"
          />
        </ScatterChart>
      </ResponsiveContainer>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {columns.map((c) => (
          <span
            key={c.algo}
            className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400"
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: paletteColor(c.index) }}
            />
            {c.algo} ({c.count}) {fmtBps(c.mean)} avg
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-[10px] text-gray-400 dark:text-gray-600">
          <svg width="18" height="6" aria-hidden>
            <line x1="0" y1="3" x2="18" y2="3" stroke={MEAN_COLOR} strokeWidth="2.5" />
          </svg>
          algo mean
        </span>
      </div>
    </ChartCard>
  );
}

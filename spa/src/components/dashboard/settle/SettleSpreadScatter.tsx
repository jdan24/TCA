/**
 * SettleSpreadScatter — slippage vs settle against the cost of just crossing.
 *
 * The question this answers for the client: the order slipped X bps against the
 * settle, but what would it have cost simply to lift the offer and be done,
 * without working the order at all? On a liquid future the book is one tick wide
 * nearly all the time, so one tick is the stand-in for the full spread.
 *
 *   X — that product's 1-tick spread cost, in bps of its settle benchmark.
 *   Y — the order's slippage vs that settle benchmark.
 *
 * Each order carries a short dashed gray marker at its own spread cost, exactly
 * as the multi-order Spread vs Slippage chart does. A dot sitting under its
 * marker beat the full cost of the spread; the dots are coloured to say the same
 * thing, so the reading survives turning the markers off on a crowded plot.
 *
 * One chart per settle window, matching the algo charts above it.
 *
 * Note the marker is the FULL tick. An order that simply crossed once would land
 * around it; one that worked the print well should sit comfortably below.
 */

import { useMemo, useState } from "react";
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
import { tickSpreadBps } from "@/tca/tickSize";
import { NO_ALGO_LABEL } from "@/tca/settleAggregate";
import { useChartAlgoFilter } from "@/hooks/useChartAlgoFilter";
import { AlgoFilterMenu } from "@/components/dashboard/AlgoFilterMenu";
import { ChartCard, EmptyState, fmtBps } from "@/components/dashboard/dashboardUtils";

type SettledWindow = Exclude<SettleWindow, "unassigned">;

const BEAT_COLOR = "#10b981"; // emerald — slippage under the full spread cost
const MISS_COLOR = "#ef4444"; // red     — paid more than a full tick
const MARKER_COLOR = "#94a3b8";

/** Half-width of a spread marker, in pixels. Matches the multi-order chart. */
const MARKER_HALF_WIDTH = 9;

interface Point {
  /** One-tick spread cost, bps of the benchmark. */
  spread: number;
  /** Slippage vs the settle benchmark, bps. */
  slip: number;
  /** Slippage came in under the full cost of the spread. */
  beat: boolean;
  symbol: string;
  algo: string;
}

/**
 * A short dashed horizontal tick, drawn at the point's own spread cost.
 * Recharts hands the shape the resolved pixel centre of its datum.
 */
function SpreadMarker(props: unknown) {
  const { cx, cy } = props as { cx?: number; cy?: number };
  if (typeof cx !== "number" || typeof cy !== "number") return null;
  return (
    <line
      x1={cx - MARKER_HALF_WIDTH}
      x2={cx + MARKER_HALF_WIDTH}
      y1={cy}
      y2={cy}
      stroke={MARKER_COLOR}
      strokeWidth={1.5}
      strokeDasharray="3 2"
    />
  );
}

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
      <p className="tabular-nums text-gray-500 dark:text-gray-400">
        {fmtBps(point.spread)} full spread
      </p>
    </div>
  );
}

interface SettleSpreadScatterProps {
  window: SettledWindow;
  trades: TradeRecord[];
  results: SettleResult[];
  /** Decimal tick size for a Bloomberg symbol; null when unknown. */
  tickSizeFor: (bbgSymbol: string) => number | null;
  resolveSymbol: (ric: string) => string;
}

export function SettleSpreadScatter({
  window,
  trades,
  results,
  tickSizeFor,
  resolveSymbol,
}: SettleSpreadScatterProps) {
  const [showMarkers, setShowMarkers] = useState(true);
  // Each window's chart keeps its own algo selection — the two prints are read
  // separately, so narrowing one should not silently narrow the other.
  const algoFilter = useChartAlgoFilter(`settle-spread-${window}`, trades);

  const points = useMemo<Point[]>(() => {
    const tradeById = new Map(trades.map((t) => [t.orderId, t]));
    const pts: Point[] = [];
    for (const r of results) {
      if (r.window !== window || r.slip_bps === null) continue;
      const trade = tradeById.get(r.orderId);
      if (!trade || !algoFilter.includes(trade)) continue;

      const bbgSymbol = resolveSymbol(trade.symbol);
      const spread = tickSpreadBps(tickSizeFor(bbgSymbol), r.benchmark);
      // No tick size means no honest x-coordinate: drop the order rather than
      // plot it against a guessed spread.
      if (spread === null) continue;

      pts.push({
        spread,
        slip: r.slip_bps,
        beat: r.slip_bps < spread,
        symbol: bbgSymbol,
        algo: trade.algo?.trim() || NO_ALGO_LABEL,
      });
    }
    return pts;
  }, [window, trades, results, tickSizeFor, resolveSymbol, algoFilter]);

  // Marker series: same x as each order, plotted at its own spread level.
  const markers = useMemo(
    () => points.map((p) => ({ spread: p.spread, slip: p.spread })),
    [points],
  );

  const title = `${settleWindowLabel(window)} — Spread Cost vs Slippage`;

  const actions = (
    <div className="flex items-center gap-2">
      <AlgoFilterMenu filter={algoFilter} />
      <button
        type="button"
        onClick={() => setShowMarkers((v) => !v)}
        title="Show or hide the dashed 1-tick spread-cost marker for each order"
        className="px-2 py-1 text-[11px] rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors whitespace-nowrap"
      >
        {showMarkers ? "Hide" : "Show"} spread marks
      </button>
    </div>
  );

  if (points.length === 0) {
    return (
      <ChartCard
        title={title}
        subtitle="1-tick spread cost (bps) vs slippage vs settle (bps)"
        actions={actions}
      >
        <EmptyState
          message={
            algoFilter.isNarrowed
              ? "No orders match the selected algos"
              : `No benchmarked orders with a known tick size in the ${settleWindowLabel(window)} window`
          }
        />
      </ChartCard>
    );
  }

  const beatCount = points.filter((p) => p.beat).length;

  return (
    <ChartCard
      title={title}
      subtitle={`${beatCount} of ${points.length} beat the full cost of a 1-tick spread`}
      actions={actions}
    >
      <ResponsiveContainer width="100%" height={260}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 28, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="spread"
            type="number"
            name="Spread cost"
            tick={{ fontSize: 11 }}
            label={{
              value: "1-tick spread cost (bps)",
              position: "insideBottom",
              offset: -14,
              fontSize: 10,
              fill: "#6b7280",
            }}
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
          <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<PointTooltip />} />
          {/* Zero slippage: filled exactly at the settle. */}
          <ReferenceLine y={0} stroke="#94a3b8" />

          {/* Spread-cost marker per order, drawn behind the dots */}
          {showMarkers && (
            <Scatter
              data={markers}
              shape={<SpreadMarker />}
              isAnimationActive={false}
              legendType="none"
            />
          )}

          <Scatter data={points} isAnimationActive={false}>
            {points.map((p, i) => (
              <Cell key={i} fill={p.beat ? BEAT_COLOR : MISS_COLOR} fillOpacity={0.8} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: BEAT_COLOR }} />
          beat the spread
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: MISS_COLOR }} />
          paid more than the spread
        </span>
        {showMarkers && (
          <span className="flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden>
              <line
                x1="0"
                y1="3"
                x2="18"
                y2="3"
                stroke={MARKER_COLOR}
                strokeWidth="1.5"
                strokeDasharray="3 2"
              />
            </svg>
            that product&rsquo;s full 1-tick spread cost
          </span>
        )}
      </div>
    </ChartCard>
  );
}

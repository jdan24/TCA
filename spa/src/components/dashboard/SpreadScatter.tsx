/**
 * Spread vs slippage scatter — TWAS (bps) on X, IS (bps) on Y.
 *
 * Reveals the relationship between the liquidity environment (spread width)
 * and execution quality (slippage):
 *   • Points in upper-right: wide spread AND high slippage → poor conditions AND poor execution
 *   • Points in lower-left: tight spread AND low slippage → good conditions AND good execution
 *   • Points in upper-left: tight spread BUT high slippage → poor execution in good conditions
 *
 * Each order carries two short dashed marks at its own x, above or below its dot:
 *
 *   • the CROSSING mark at TWAS / 2 — the bar that matters. IS is measured
 *     against the arrival mid, so lifting the far touch costs half the quoted
 *     width. A dot under this mark did better than simply crossing.
 *   • the FULL mark at TWAS — the outer bound, drawn lighter. A dot above it
 *     paid more than the entire quoted width.
 *
 * Dots are coloured on those same two thresholds — green below the crossing
 * mark, amber between the two, red above the full width — so the reading
 * survives turning the marks off on a crowded plot.
 *
 * The crossing mark is deliberately the same yardstick the Spread Savings table
 * uses: its 0% sits at exactly IS = TWAS / 2 (see buildSpreadSavings() in
 * tca/aggregate.ts). A green dot here and a positive savings figure there mean
 * the same thing, which they did not when this chart scored against the full
 * width — an order that merely crossed the spread read as a comfortable beat.
 *
 * Requires both Bloomberg TWAS data and arrival price (IS).
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
import type { TCAResult, TradeRecord } from "@/types";
import { useChartAlgoFilter } from "@/hooks/useChartAlgoFilter";
import { AlgoFilterMenu } from "./AlgoFilterMenu";
import { ChartCard, EmptyState, fmtBps, slipToneClass } from "./dashboardUtils";

const BEAT_COLOR = "#10b981"; // emerald — cost less than crossing the spread
const PART_COLOR = "#f59e0b"; // amber   — over the crossing cost, under the full width
const MISS_COLOR = "#ef4444"; // red     — paid more than the full quoted width

const CROSS_MARKER_COLOR = "#64748b"; // the bar: half the quoted spread
const FULL_MARKER_COLOR = "#cbd5e1";  // lighter outer bound: the full width

/** Half-width of a spread marker, in pixels. */
const MARKER_HALF_WIDTH = 9;

interface SpreadScatterProps {
  /** Needed for the algo filter and the tooltip — algo, symbol, side and qty
   *  live on the trade, not the result. */
  trades: TradeRecord[];
  results: TCAResult[];
}

/**
 * Where an order landed against the two marks.
 *   beat    — under TWAS / 2: better than crossing at arrival
 *   crossed — between TWAS / 2 and TWAS: worse than crossing, inside the width
 *   missed  — at or above TWAS: paid more than the entire quoted spread
 */
type Verdict = "beat" | "crossed" | "missed";

const VERDICT_COLOR: Record<Verdict, string> = {
  beat: BEAT_COLOR,
  crossed: PART_COLOR,
  missed: MISS_COLOR,
};

interface Point {
  twas: number;
  is: number;
  /** Half the quoted spread — the cost of simply crossing at arrival. */
  half: number;
  verdict: Verdict;
  /** Identity, so a visible outlier is an order you can go and look at. */
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
}

function verdictFor(is: number, twas: number): Verdict {
  if (is < twas / 2) return "beat";
  if (is < twas) return "crossed";
  return "missed";
}

/**
 * A short dashed horizontal tick, drawn at one of the point's spread levels.
 * Recharts hands the shape the resolved pixel centre of its datum.
 *
 * The stroke props are named `marker*` rather than `stroke`/`strokeDasharray`
 * so that Recharts cloning the element over its own props cannot blank them.
 */
interface SpreadMarkerProps {
  /** Resolved pixel centre, supplied by Recharts — absent until the datum lays out. */
  cx?: number;
  cy?: number;
  markerStroke?: string;
  markerDash?: string;
}

function SpreadMarker({ cx, cy, markerStroke, markerDash }: SpreadMarkerProps) {
  if (typeof cx !== "number" || typeof cy !== "number") return null;
  return (
    <line
      x1={cx - MARKER_HALF_WIDTH}
      x2={cx + MARKER_HALF_WIDTH}
      y1={cy}
      y2={cy}
      stroke={markerStroke ?? CROSS_MARKER_COLOR}
      strokeWidth={1.5}
      strokeDasharray={markerDash ?? "3 2"}
    />
  );
}

export function SpreadScatter({ trades, results }: SpreadScatterProps) {
  const [showMarkers, setShowMarkers] = useState(true);
  const algoFilter = useChartAlgoFilter("spread", trades);

  const tradeMap = useMemo(() => {
    const m = new Map<string, TradeRecord>();
    for (const t of trades) m.set(t.orderId, t);
    return m;
  }, [trades]);

  const points = useMemo<Point[]>(() => {
    const pts: Point[] = [];
    for (const r of results) {
      if (r.TWAS_bps !== null && r.IS_bps !== null) {
        const trade = tradeMap.get(r.orderId);
        if (!trade || !algoFilter.includes(trade)) continue;
        pts.push({
          twas: r.TWAS_bps,
          is: r.IS_bps,
          half: r.TWAS_bps / 2,
          verdict: verdictFor(r.IS_bps, r.TWAS_bps),
          orderId: r.orderId,
          symbol: trade.symbol,
          side: trade.side,
          qty: trade.orderQty,
        });
      }
    }
    return pts;
  }, [results, tradeMap, algoFilter]);

  // Marker series: same x as each order, plotted at its two spread levels.
  const crossMarkers = useMemo(
    () => points.map((p) => ({ twas: p.twas, is: p.half })),
    [points],
  );
  const fullMarkers = useMemo(
    () => points.map((p) => ({ twas: p.twas, is: p.twas })),
    [points],
  );

  const beatCount = points.filter((p) => p.verdict === "beat").length;

  // The spread-marks toggle and the algo filter share the actions slot.
  const actions = (
    <div className="flex items-center gap-2">
      <AlgoFilterMenu filter={algoFilter} />
      <button
        type="button"
        onClick={() => setShowMarkers((v) => !v)}
        title="Show or hide the dashed spread marks above each order"
        className="px-2 py-1 text-[11px] rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors whitespace-nowrap"
      >
        {showMarkers ? "Hide" : "Show"} spread marks
      </button>
    </div>
  );

  if (points.length === 0) {
    return (
      <ChartCard
        title="Spread vs Slippage"
        subtitle="TWAS (bps) vs IS (bps) — liquidity vs execution cost"
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
      title="Spread vs Slippage"
      subtitle={`${beatCount} of ${points.length} beat the cost of crossing the spread`}
      actions={actions}
    >
      <ResponsiveContainer width="100%" height={240}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="twas"
            type="number"
            name="TWAS"
            tick={{ fontSize: 11 }}
            label={{
              value: "TWAS (bps)",
              position: "insideBottom",
              offset: -12,
              fontSize: 11,
              fill: "#6b7280",
            }}
          />
          <YAxis
            dataKey="is"
            type="number"
            name="IS"
            tickFormatter={(v: unknown) =>
              typeof v === "number" ? String(Math.round(v)) : ""
            }
            tick={{ fontSize: 11 }}
            width={38}
            label={{
              value: "IS (bps)",
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
              // Three series share this chart; only the dot series carries an
              // orderId, so the marks never raise a tooltip of their own.
              const entries = (payload ?? []) as unknown as ReadonlyArray<{ payload?: unknown }>;
              const d = entries
                .map((e) => e.payload as Point | undefined)
                .find((p): p is Point => p !== undefined && typeof p.orderId === "string");
              if (!d) return null;

              const verdict =
                d.verdict === "beat"
                  ? {
                      text: `Beat the crossing cost by ${(d.half - d.is).toFixed(2)} bps`,
                      tone: "text-emerald-600 dark:text-emerald-400",
                    }
                  : d.verdict === "crossed"
                    ? {
                        text: `${(d.is - d.half).toFixed(2)} bps worse than crossing`,
                        tone: "text-amber-600 dark:text-amber-400",
                      }
                    : {
                        text: `${(d.is - d.twas).toFixed(2)} bps worse than the full spread`,
                        tone: "text-red-500 dark:text-red-400",
                      };

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
                    Spread (TWAS):{" "}
                    <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                      {d.twas.toFixed(2)} bps
                    </span>
                  </p>
                  <p className="text-gray-600 dark:text-gray-300">
                    Cost to cross:{" "}
                    <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                      {d.half.toFixed(2)} bps
                    </span>
                  </p>
                  <p className="text-gray-600 dark:text-gray-300">
                    Slippage (IS):{" "}
                    <span className={`font-semibold tabular-nums ${slipToneClass(d.is)}`}>
                      {fmtBps(d.is, 2)}
                    </span>
                  </p>
                  <p
                    className={`mt-1.5 pt-1.5 border-t border-gray-100 dark:border-gray-700 font-medium ${verdict.tone}`}
                  >
                    {verdict.text}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-gray-400 dark:text-gray-500 truncate max-w-[15rem]">
                    {d.orderId}
                  </p>
                </div>
              );
            }}
          />
          <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />

          {/* Spread marks per order, drawn behind the dots. The full width goes
              down first so the crossing mark — the one being scored against —
              sits on top where they are close enough to overlap. */}
          {showMarkers && (
            <Scatter
              data={fullMarkers}
              shape={<SpreadMarker markerStroke={FULL_MARKER_COLOR} markerDash="2 3" />}
              isAnimationActive={false}
              legendType="none"
            />
          )}
          {showMarkers && (
            <Scatter
              data={crossMarkers}
              shape={<SpreadMarker markerStroke={CROSS_MARKER_COLOR} markerDash="3 2" />}
              isAnimationActive={false}
              legendType="none"
            />
          )}

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
          beat the cost of crossing
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: PART_COLOR }} />
          crossed, but inside the full spread
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: MISS_COLOR }} />
          paid more than the full spread
        </span>
        {showMarkers && (
          <>
            <span className="flex items-center gap-1.5">
              <svg width="18" height="6" aria-hidden>
                <line x1="0" y1="3" x2="18" y2="3" stroke={CROSS_MARKER_COLOR} strokeWidth="1.5" strokeDasharray="3 2" />
              </svg>
              cost of crossing (&frac12; spread)
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="18" height="6" aria-hidden>
                <line x1="0" y1="3" x2="18" y2="3" stroke={FULL_MARKER_COLOR} strokeWidth="1.5" strokeDasharray="2 3" />
              </svg>
              full spread
            </span>
          </>
        )}
      </div>
    </ChartCard>
  );
}

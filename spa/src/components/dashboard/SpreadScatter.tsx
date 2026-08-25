/**
 * Spread vs slippage scatter — TWAS (bps) on X, IS (bps) on Y.
 *
 * Reveals the relationship between the liquidity environment (spread width)
 * and execution quality (slippage):
 *   • Points in upper-right: wide spread AND high slippage → poor conditions AND poor execution
 *   • Points in lower-left: tight spread AND low slippage → good conditions AND good execution
 *   • Points in upper-left: tight spread BUT high slippage → poor execution in good conditions
 *
 * Each order also gets a short dashed marker at its own TWAS level, directly
 * above or below its dot: the full cost of the spread it traded through. A dot
 * sitting under its marker beat that cost. Dots are coloured to say the same
 * thing at a glance — green beat the spread, red did not — so the reading
 * survives turning the markers off on a crowded plot.
 *
 * Note the marker is the FULL quoted spread. IS is measured against the arrival
 * mid, so simply crossing to the far touch costs half the spread and lands
 * around half the marker height — comfortably "beating" it.
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
import type { TCAResult } from "@/types";
import { ChartCard, EmptyState } from "./dashboardUtils";

const BEAT_COLOR = "#10b981"; // emerald — slippage under the spread it crossed
const MISS_COLOR = "#ef4444"; // red     — paid more than the full quoted width
const MARKER_COLOR = "#94a3b8";

/** Half-width of a spread marker, in pixels. */
const MARKER_HALF_WIDTH = 9;

interface SpreadScatterProps {
  results: TCAResult[];
}

interface Point {
  twas: number;
  is: number;
  /** Slippage came in under the full cost of the spread. */
  beat: boolean;
}

/**
 * A short dashed horizontal tick, drawn at the point's own TWAS level.
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

export function SpreadScatter({ results }: SpreadScatterProps) {
  const [showMarkers, setShowMarkers] = useState(true);

  const points = useMemo<Point[]>(() => {
    const pts: Point[] = [];
    for (const r of results) {
      if (r.TWAS_bps !== null && r.IS_bps !== null) {
        pts.push({ twas: r.TWAS_bps, is: r.IS_bps, beat: r.IS_bps < r.TWAS_bps });
      }
    }
    return pts;
  }, [results]);

  // Marker series: same x as each order, plotted at its own TWAS level.
  const markers = useMemo(
    () => points.map((p) => ({ twas: p.twas, is: p.twas })),
    [points],
  );

  const beatCount = points.filter((p) => p.beat).length;

  if (points.length === 0) {
    return (
      <ChartCard
        title="Spread vs Slippage"
        subtitle="TWAS (bps) vs IS (bps) — liquidity vs execution cost"
      >
        <EmptyState message="Bloomberg bid/ask tick data required for TWAS" />
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title="Spread vs Slippage"
      subtitle={`${beatCount} of ${points.length} beat the full cost of their spread`}
      actions={
        <button
          type="button"
          onClick={() => setShowMarkers((v) => !v)}
          title="Show or hide the dashed spread-cost marker above each order"
          className="px-2 py-1 text-[11px] rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors whitespace-nowrap"
        >
          {showMarkers ? "Hide" : "Show"} spread marks
        </button>
      }
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
            formatter={(v: unknown) =>
              typeof v === "number" ? `${v.toFixed(2)} bps` : String(v)
            }
            cursor={{ strokeDasharray: "3 3" }}
          />
          <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />

          {/* Spread-cost marker per order, drawn behind the dots */}
          {showMarkers && (
            <Scatter data={markers} shape={<SpreadMarker />} isAnimationActive={false} legendType="none" />
          )}

          <Scatter data={points} isAnimationActive={false}>
            {points.map((p, i) => (
              <Cell key={i} fill={p.beat ? BEAT_COLOR : MISS_COLOR} fillOpacity={0.8} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>

      {/* Legend */}
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
              <line x1="0" y1="3" x2="18" y2="3" stroke={MARKER_COLOR} strokeWidth="1.5" strokeDasharray="3 2" />
            </svg>
            that order&rsquo;s spread cost
          </span>
        )}
      </div>
    </ChartCard>
  );
}

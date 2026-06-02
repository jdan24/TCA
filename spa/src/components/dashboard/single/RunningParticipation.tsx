/**
 * RunningParticipation — running % participation rate vs market volume.
 *
 * At each fill timestamp:
 *   participation(t) = Σ(our qty filled up to t) / Σ(market trade tick sizes up to t) × 100
 *
 * X-axis: fill time (UTC)
 * Orange line with dots at each fill
 * Requires Bloomberg trade tick data; shows empty state otherwise.
 */

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TradeRecord } from "@/types";
import { ChartCard, EmptyState } from "@/components/dashboard/dashboardUtils";

interface RunningParticipationProps {
  trades: TradeRecord[];
  /** Bloomberg trade tick sizes over [orderTime, lastFillTime]. null = not enriched. */
  marketVolTicks: Array<{ t: number; size: number }> | null;
}

interface DataPoint {
  t: number;
  timeLabel: string;
  pct: number;
  cumOurQty: number;
  cumMktVol: number;
}

function fmtUtc(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

function buildData(
  trades: TradeRecord[],
  marketVolTicks: Array<{ t: number; size: number }>,
): DataPoint[] {
  if (trades.length === 0) return [];

  const sorted = [...trades].sort(
    (a, b) => a.lastFillTime.getTime() - b.lastFillTime.getTime(),
  );

  // Ensure ticks are sorted ascending (Bloomberg returns them in order, but be safe)
  const ticks = [...marketVolTicks].sort((a, b) => a.t - b.t);

  let cumOurQty = 0;
  let cumMktVol = 0;
  let tickIdx   = 0;

  const points: DataPoint[] = [];

  for (const fill of sorted) {
    cumOurQty += fill.orderQty;
    const fillMs = fill.lastFillTime.getTime();

    // Advance running market volume cursor to include all ticks up to this fill
    while (tickIdx < ticks.length && ticks[tickIdx]!.t <= fillMs) {
      cumMktVol += ticks[tickIdx]!.size;
      tickIdx++;
    }

    if (cumMktVol > 0) {
      points.push({
        t:          fillMs,
        timeLabel:  fmtUtc(fillMs),
        pct:        (cumOurQty / cumMktVol) * 100,
        cumOurQty,
        cumMktVol,
      });
    }
  }

  return points;
}

export function RunningParticipation({ trades, marketVolTicks }: RunningParticipationProps) {
  if (!marketVolTicks || marketVolTicks.length === 0) {
    return (
      <ChartCard
        title="Running Participation Rate"
        subtitle="% of market volume — fetch Bloomberg to enable"
      >
        <EmptyState message="Bloomberg trade tick data required" />
      </ChartCard>
    );
  }

  const data = buildData(trades, marketVolTicks);

  if (data.length === 0) {
    return (
      <ChartCard
        title="Running Participation Rate"
        subtitle="% of market volume"
      >
        <EmptyState message="No fill data" />
      </ChartCard>
    );
  }

  const finalPct = data[data.length - 1]?.pct ?? null;
  const maxPct   = Math.max(...data.map((d) => d.pct));
  const yMax     = Math.max(maxPct * 1.15, 1);

  return (
    <ChartCard
      title="Running Participation Rate"
      subtitle={
        finalPct !== null
          ? `Final: ${finalPct.toFixed(2)}% of market volume · our qty / Σ market prints`
          : "our cumulative qty / Σ market trade tick volume"
      }
    >
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 20, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
          <XAxis
            dataKey="timeLabel"
            tick={{ fontSize: 9, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[0, yMax]}
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v.toFixed(1)}%`}
            width={42}
          />

          {/* Final participation rate reference line */}
          {finalPct !== null && (
            <ReferenceLine
              y={finalPct}
              stroke="#f97316"
              strokeDasharray="4 2"
              strokeOpacity={0.5}
              label={{
                value: `${finalPct.toFixed(2)}%`,
                position: "right",
                fontSize: 9,
                fill: "#f97316",
              }}
            />
          )}

          <Line
            type="stepAfter"
            dataKey="pct"
            stroke="#f97316"
            strokeWidth={2}
            dot={{ r: 3.5, fill: "#f97316", stroke: "white", strokeWidth: 1.5 }}
            activeDot={{ r: 6, fill: "#f97316", stroke: "white", strokeWidth: 2 }}
            isAnimationActive={false}
          />

          <Tooltip
            content={({ payload, label }) => {
              const d = payload?.[0]?.payload as DataPoint | undefined;
              if (!d) return null;
              return (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 shadow-lg text-xs">
                  <p className="text-gray-500 dark:text-gray-400 mb-1 font-mono">{label}</p>
                  <p className="text-orange-600 dark:text-orange-400">
                    Participation:{" "}
                    <span className="font-semibold tabular-nums">{d.pct.toFixed(3)}%</span>
                  </p>
                  <p className="text-gray-600 dark:text-gray-300 mt-0.5">
                    Our qty:{" "}
                    <span className="tabular-nums">{d.cumOurQty.toLocaleString()}</span>
                  </p>
                  <p className="text-gray-600 dark:text-gray-300">
                    Mkt vol:{" "}
                    <span className="tabular-nums">{d.cumMktVol.toLocaleString()}</span>
                  </p>
                </div>
              );
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

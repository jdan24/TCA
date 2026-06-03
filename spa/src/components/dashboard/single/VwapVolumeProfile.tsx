/**
 * VwapVolumeProfile — per-minute volume distribution comparison for VWAP orders.
 *
 * Three series over the order execution window:
 *   Orange bars  : Our Order %   — % of our total filled qty in each minute bucket
 *   Blue line    : Market %      — % of market volume (Bloomberg trade ticks) per minute
 *   Gray dashed  : Historical %  — % from uploaded historical volume curve file (Smoothed col)
 *
 * All series are normalised to % of the order-window total so they overlay directly.
 * A perfect VWAP execution would show all three coinciding.
 */

import { useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Papa from "papaparse";
import type { TradeRecord } from "@/types";
import { ChartCard, EmptyState } from "@/components/dashboard/dashboardUtils";

// ── CSV parsing ───────────────────────────────────────────────────────────────

/**
 * Parse a historical volume curve CSV.
 * Expects columns: Time_UTC (HH:MM or date+time), Smoothed (% of daily volume).
 * Returns a Map from "HH:MM" (UTC, zero-padded) → Smoothed %.
 */
export function parseVolumeCurveCsv(file: File): Promise<Map<string, number>> {
  return new Promise((resolve) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: ({ data }) => {
        const curve = new Map<string, number>();
        for (const row of data) {
          // Locate Time_UTC and Smoothed columns (case-insensitive, trim spaces)
          const timeRaw  = colVal(row, ["Time_UTC", "TimeUTC", "time_utc", "TIME_UTC"]);
          const smthRaw  = colVal(row, ["Smoothed", "smoothed", "SMOOTHED"]);
          if (!timeRaw || !smthRaw) continue;
          const smoothed = parseFloat(smthRaw);
          if (isNaN(smoothed)) continue;
          // Extract the time portion: "1/13/2026 14:30" → "14:30", or just "14:30"
          const parts   = timeRaw.trim().split(/\s+/);
          const timePart = parts[parts.length - 1] ?? ""; // last token is the time
          const colonIdx = timePart.indexOf(":");
          if (colonIdx < 0) continue;
          const h = timePart.slice(0, colonIdx).padStart(2, "0");
          const m = timePart.slice(colonIdx + 1, colonIdx + 3).padStart(2, "0");
          curve.set(`${h}:${m}`, smoothed);
        }
        resolve(curve);
      },
      error: () => resolve(new Map()),
    });
  });
}

/** Case-insensitive, trimmed column lookup. */
function colVal(row: Record<string, string>, names: string[]): string | undefined {
  for (const key of Object.keys(row)) {
    const k = key.trim().toLowerCase();
    if (names.some((n) => n.toLowerCase() === k)) {
      const v = row[key]?.trim();
      return v || undefined;
    }
  }
  return undefined;
}

// ── Data building ─────────────────────────────────────────────────────────────

interface VolumePoint {
  t: number;
  timeLabel: string;
  /** Predicted schedule: whole contracts (largest-remainder method). Left axis. */
  historical: number | null;
  /** Actual market volume from Bloomberg ticks. Right axis. */
  market: number | null;
  /** Our actual fills (null when 0 so no dot is rendered). Left axis. */
  ourOrder: number | null;
}

/**
 * Distribute `total` whole-number units across `weights` (null = excluded)
 * using the Largest Remainder Method so the result sums to exactly `total`.
 */
function largestRemainder(total: number, weights: (number | null)[]): (number | null)[] {
  const totalWeight = weights.reduce<number>((s, w) => s + (w ?? 0), 0);
  if (totalWeight === 0 || total === 0) return weights.map(() => null);

  // Raw (fractional) allocation
  const raw = weights.map((w) => (w !== null ? (total * w) / totalWeight : null));
  // Floor each
  const floored = raw.map((v) => (v !== null ? Math.floor(v) : null));
  const currentSum = floored.reduce<number>((s, v) => s + (v ?? 0), 0);
  let remainder = total - currentSum;

  // Sort eligible indices by fractional part descending, add 1 each
  const fracs = raw
    .map((v, i) => ({ i, frac: v !== null ? v - Math.floor(v) : -1 }))
    .filter((x) => x.frac >= 0)
    .sort((a, b) => b.frac - a.frac);

  const result = [...floored];
  for (let j = 0; j < remainder && j < fracs.length; j++) {
    const idx = fracs[j]!.i;
    if (result[idx] !== null) result[idx] = result[idx]! + 1;
  }
  return result;
}

function buildVolumeData(
  trades: TradeRecord[],
  orderTime: Date,
  lastFillTime: Date,
  marketVolTicks: Array<{ t: number; size: number }> | null,
  histCurve: Map<string, number> | null,
): VolumePoint[] {
  const ONE_MIN = 60_000;
  const startMs = Math.floor(orderTime.getTime()   / ONE_MIN) * ONE_MIN;
  const endMs   = Math.floor(lastFillTime.getTime() / ONE_MIN) * ONE_MIN;
  if (startMs > endMs) return [];

  // ── Enumerate per-minute slots ────────────────────────────────────────────
  const minutes: number[] = [];
  for (let t = startMs; t <= endMs; t += ONE_MIN) minutes.push(t);

  // ── Bucket our fills by minute (absolute qty) ─────────────────────────────
  const ourByMin = new Map<number, number>();
  for (const t of trades) {
    const min = Math.floor(t.lastFillTime.getTime() / ONE_MIN) * ONE_MIN;
    ourByMin.set(min, (ourByMin.get(min) ?? 0) + t.orderQty);
  }
  const totalOur = [...ourByMin.values()].reduce((a, b) => a + b, 0);

  // ── Bucket market volume by minute (absolute contracts) ───────────────────
  const mktByMin = new Map<number, number>();
  if (marketVolTicks) {
    for (const tk of marketVolTicks) {
      const min = Math.floor(tk.t / ONE_MIN) * ONE_MIN;
      mktByMin.set(min, (mktByMin.get(min) ?? 0) + tk.size);
    }
  }

  // ── Historical predicted schedule (whole contracts, largest remainder) ────
  // Use the Smoothed % values for each minute in the window, then allocate
  // totalOur contracts proportionally so the schedule sums to exactly totalOur.
  // Minutes not in the CSV are treated as 0 volume (not excluded), so the line
  // stays continuous at y=0 for those points per the user's preference.
  const rawHistWeights = minutes.map((t) => {
    if (!histCurve) return null;
    const d  = new Date(t);
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    // 0 for minutes absent from the CSV → zero scheduled, no break in line
    return histCurve.get(`${hh}:${mm}`) ?? 0;
  });
  const scheduledQty = largestRemainder(totalOur, rawHistWeights);

  return minutes.map((t, i) => {
    const d  = new Date(t);
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");

    const historical = scheduledQty[i] ?? null;

    const mktVol = mktByMin.get(t);
    const market = mktVol !== undefined && mktVol > 0 ? mktVol : null;

    const ourVol  = ourByMin.get(t) ?? 0;
    // Null for empty minutes so no dot is drawn
    const ourOrder = ourVol > 0 ? ourVol : null;

    return {
      t,
      timeLabel: `${hh}:${mm} UTC`,
      historical,
      market,
      ourOrder,
    };
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

interface VwapVolumeProfileProps {
  trades: TradeRecord[];
  orderTime: Date;
  lastFillTime: Date;
  marketVolTicks: Array<{ t: number; size: number }> | null;
  histVolCurve: Map<string, number> | null;
}

const SERIES = {
  ourOrder:   { label: "Our Execution (contracts)", color: "#f97316" },
  market:     { label: "Market Volume (BBG)",        color: "#3b82f6" },
  historical: { label: "Scheduled (historical)",     color: "#94a3b8" },
};

export function VwapVolumeProfile({
  trades,
  orderTime,
  lastFillTime,
  marketVolTicks,
  histVolCurve,
}: VwapVolumeProfileProps) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const data      = buildVolumeData(trades, orderTime, lastFillTime, marketVolTicks, histVolCurve);
  const hasMarket = (marketVolTicks?.length ?? 0) > 0;
  const hasHist   = histVolCurve !== null && histVolCurve.size > 0;
  // True only when the CSV covers at least one minute in the order window.
  // If the CSV is loaded but all minutes return null (e.g. time-range mismatch)
  // we show a warning rather than a blank line.
  const hasHistMatch = hasHist && data.some((d) => d.historical !== null);

  function toggle(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  if (data.length === 0) {
    return (
      <ChartCard
        id="so-chart-vwap-profile"
        title="VWAP Volume Profile"
        subtitle="Contracts per minute — order execution window"
      >
        <EmptyState message="No fill data in range" />
      </ChartCard>
    );
  }

  // ── Axis domains ─────────────────────────────────────────────────────────
  // Left axis: our order + historical schedule (both in contracts, same scale)
  const orderVals = data.flatMap((d) =>
    [d.ourOrder, d.historical].filter((v): v is number => v !== null),
  );
  const yOrderMax = Math.max(...orderVals, 1);
  const yOrderDomain: [number, number] = [0, Math.ceil(yOrderMax * 1.25)];

  // Right axis: market volume (usually much larger)
  const mktVals = data.flatMap((d) => (d.market !== null ? [d.market] : []));
  const yMktMax = Math.max(...mktVals, 1);
  const yMktDomain: [number, number] = [0, Math.ceil(yMktMax * 1.25)];

  // X-axis label thinning (~6 ticks)
  const interval = Math.max(1, Math.ceil(data.length / 6)) - 1;

  const subtitle = [
    "Contracts per minute — order window · click legend to mute",
    !hasMarket    && "fetch Bloomberg for market volume",
    !hasHist      && "upload historical curve for schedule",
    (hasHist && !hasHistMatch) && "⚠ historical curve time range doesn't match order window",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ChartCard
      id="so-chart-vwap-profile"
      title="VWAP Volume Profile"
      subtitle={subtitle}
    >
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 8, right: 56, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
          <XAxis
            dataKey="timeLabel"
            tick={{ fontSize: 9, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={false}
            interval={interval}
          />

          {/* Left axis — our order + historical (contracts) */}
          <YAxis
            yAxisId="order"
            orientation="left"
            domain={yOrderDomain}
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => v.toLocaleString()}
            width={42}
          />

          {/* Right axis — market volume (contracts) */}
          {hasMarket && (
            <YAxis
              yAxisId="market"
              orientation="right"
              domain={yMktDomain}
              tick={{ fontSize: 10, fill: "#3b82f6" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) =>
                v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)
              }
              width={46}
            />
          )}

          <Tooltip
            cursor={{ fill: "rgba(148,163,184,0.08)" }}
            content={({ payload, label }) => {
              if (!payload || payload.length === 0) return null;
              return (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 shadow-lg text-xs space-y-0.5">
                  <p className="text-gray-500 dark:text-gray-400 font-mono mb-1">{label}</p>
                  {payload.map((p, idx) => {
                    const key = typeof p.dataKey === "string" ? p.dataKey : "";
                    const s = SERIES[key as keyof typeof SERIES];
                    if (!s || p.value == null) return null;
                    const v = p.value as number;
                    return (
                      <p key={idx} style={{ color: s.color }}>
                        {s.label}:{" "}
                        <span className="font-semibold tabular-nums">
                          {v.toLocaleString()}
                        </span>
                      </p>
                    );
                  })}
                </div>
              );
            }}
          />

          <Legend
            onClick={(e) => {
              if (e?.dataKey && typeof e.dataKey === "string") toggle(e.dataKey);
            }}
            formatter={(value: string) => {
              const s = SERIES[value as keyof typeof SERIES];
              const label = s?.label ?? value;
              const muted = hidden.has(value);
              return (
                <span
                  style={{
                    color: muted ? "#94a3b8" : (s?.color ?? "#94a3b8"),
                    cursor: "pointer",
                    textDecoration: muted ? "line-through" : "none",
                    fontSize: 11,
                  }}
                >
                  {label}
                </span>
              );
            }}
            wrapperStyle={{ cursor: "pointer" }}
          />

          {/* Market volume — bars on right axis */}
          {hasMarket && (
            <Bar
              yAxisId="market"
              dataKey="market"
              fill="#3b82f6"
              fillOpacity={0.35}
              radius={[1, 1, 0, 0]}
              isAnimationActive={false}
              hide={hidden.has("market")}
            />
          )}

          {/* Historical predicted schedule — dashed line on left axis */}
          {hasHistMatch && (
            <Line
              yAxisId="order"
              type="monotone"
              dataKey="historical"
              stroke="#94a3b8"
              strokeWidth={1.5}
              strokeDasharray="6 3"
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
              hide={hidden.has("historical")}
              connectNulls={false}
            />
          )}

          {/* Our actual execution — dots only (no connecting line), left axis */}
          <Line
            yAxisId="order"
            dataKey="ourOrder"
            stroke="transparent"
            strokeWidth={0}
            dot={{ r: 5, fill: "#f97316", stroke: "white", strokeWidth: 1.5 }}
            activeDot={{ r: 7, fill: "#f97316", stroke: "white", strokeWidth: 2 }}
            isAnimationActive={false}
            hide={hidden.has("ourOrder")}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

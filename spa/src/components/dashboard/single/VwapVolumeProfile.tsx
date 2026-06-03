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
  historical: number | null;  // % of window (normalised from Smoothed)
  market: number | null;      // % of market volume in window
  ourOrder: number | null;    // % of our total order qty
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

  // ── Bucket our fills by minute ────────────────────────────────────────────
  const ourByMin = new Map<number, number>();
  for (const t of trades) {
    const min = Math.floor(t.lastFillTime.getTime() / ONE_MIN) * ONE_MIN;
    ourByMin.set(min, (ourByMin.get(min) ?? 0) + t.orderQty);
  }
  const totalOur = [...ourByMin.values()].reduce((a, b) => a + b, 0);

  // ── Bucket market volume by minute ────────────────────────────────────────
  const mktByMin = new Map<number, number>();
  if (marketVolTicks) {
    for (const tk of marketVolTicks) {
      const min = Math.floor(tk.t / ONE_MIN) * ONE_MIN;
      mktByMin.set(min, (mktByMin.get(min) ?? 0) + tk.size);
    }
  }
  const totalMkt = [...mktByMin.values()].reduce((a, b) => a + b, 0);

  // ── Collect per-minute slots ──────────────────────────────────────────────
  const minutes: number[] = [];
  for (let t = startMs; t <= endMs; t += ONE_MIN) minutes.push(t);

  // Raw historical values for the window; normalise over window sum so the
  // scale matches the other two series (both sum to 100 % over the window).
  const rawHist = minutes.map((t) => {
    if (!histCurve) return null;
    const d  = new Date(t);
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    return histCurve.get(`${hh}:${mm}`) ?? null;
  });
  const histWindowSum = rawHist.reduce<number>((s, v) => s + (v ?? 0), 0);

  return minutes.map((t, i) => {
    const d  = new Date(t);
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");

    const rh = rawHist[i] ?? null;
    const historical =
      rh !== null && histWindowSum > 0 ? (rh / histWindowSum) * 100 : null;

    const mktVol = mktByMin.get(t) ?? 0;
    const market = totalMkt > 0 ? (mktVol / totalMkt) * 100 : null;

    const ourVol  = ourByMin.get(t) ?? 0;
    const ourOrder = totalOur > 0 ? (ourVol / totalOur) * 100 : null;

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
  ourOrder:   { label: "Our Order %",    color: "#f97316" },
  market:     { label: "Market % (BBG)", color: "#3b82f6" },
  historical: { label: "Historical %",   color: "#94a3b8" },
};

export function VwapVolumeProfile({
  trades,
  orderTime,
  lastFillTime,
  marketVolTicks,
  histVolCurve,
}: VwapVolumeProfileProps) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  // Build chart data whenever inputs change
  const data = buildVolumeData(trades, orderTime, lastFillTime, marketVolTicks, histVolCurve);

  const hasMarket = (marketVolTicks?.length ?? 0) > 0;
  const hasHist   = histVolCurve !== null && histVolCurve.size > 0;

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
        subtitle="% of volume per minute — order execution window"
      >
        <EmptyState message="No fill data in range" />
      </ChartCard>
    );
  }

  // Determine how many x-axis ticks to show (aim for ~6 labels)
  const nPoints  = data.length;
  const interval = Math.max(1, Math.ceil(nPoints / 6)) - 1;

  const yMax = Math.max(
    ...data.flatMap((d) =>
      [d.ourOrder, d.market, d.historical].filter((v): v is number => v !== null),
    ),
    0,
  );
  const yDomain: [number, number] = [0, Math.ceil(yMax * 1.2) || 10];

  const subtitle = [
    "% of volume per minute — order window",
    !hasMarket && "fetch Bloomberg for market series",
    !hasHist   && "upload historical curve to add reference",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ChartCard
      id="so-chart-vwap-profile"
      title="VWAP Volume Profile"
      subtitle={subtitle}
    >
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
          <XAxis
            dataKey="timeLabel"
            tick={{ fontSize: 9, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={false}
            interval={interval}
          />
          <YAxis
            domain={yDomain}
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v.toFixed(1)}%`}
            width={42}
          />
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
                    return (
                      <p key={idx} style={{ color: s.color }}>
                        {s.label}:{" "}
                        <span className="font-semibold tabular-nums">
                          {(p.value as number).toFixed(2)}%
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

          {/* Our Order — bars */}
          <Bar
            dataKey="ourOrder"
            fill="#f97316"
            fillOpacity={0.8}
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
            hide={hidden.has("ourOrder")}
          />

          {/* Market volume — line */}
          {hasMarket && (
            <Line
              type="monotone"
              dataKey="market"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
              hide={hidden.has("market")}
            />
          )}

          {/* Historical curve — dashed line */}
          {hasHist && (
            <Line
              type="monotone"
              dataKey="historical"
              stroke="#94a3b8"
              strokeWidth={1.5}
              strokeDasharray="6 3"
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
              hide={hidden.has("historical")}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

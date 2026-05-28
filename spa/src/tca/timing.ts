/**
 * Execution timing analysis utilities.
 *
 * Provides:
 *   - computeTimeToFill   — lastFillTime − orderTime in milliseconds
 *   - intradayBucket      — 30-minute bucket index (0–47) for heatmap
 *   - bucketLabel         — human-readable bucket start time, e.g. "09:30"
 *   - dayOfWeekLabel      — "Mon" … "Fri" for the heatmap Y-axis
 *
 * All functions are pure and have no external dependencies.
 */
import type { TradeRecord } from "@/types";

// ── Time-to-fill ──────────────────────────────────────────────────────────────

/** Wall-clock duration of the full order: lastFillTime − orderTime (ms). */
export function computeTimeToFill(trade: TradeRecord): number {
  return Math.max(0, trade.lastFillTime.getTime() - trade.orderTime.getTime());
}

// ── Intraday bucket ───────────────────────────────────────────────────────────

/**
 * Map a timestamp to a 30-minute intraday bucket (0–47, local time).
 *
 *   0 → 00:00–00:30
 *   1 → 00:30–01:00
 *  38 → 09:30–10:00   ← NYSE open
 *  47 → 23:30–00:00
 */
export function intradayBucket(time: Date): number {
  return time.getHours() * 2 + (time.getMinutes() >= 30 ? 1 : 0);
}

/**
 * Human-readable bucket start label for a given bucket index.
 * e.g. intradayBucket(new Date('...09:45')) → 19, bucketLabel(19) → "09:30"
 */
export function bucketLabel(bucket: number): string {
  const h = Math.floor(bucket / 2);
  const m = bucket % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
}

// ── Day-of-week ───────────────────────────────────────────────────────────────

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
type DayLabel = (typeof DAY_LABELS)[number];

/** Short day name for the heatmap Y-axis (local time). */
export function dayOfWeekLabel(time: Date): DayLabel {
  return DAY_LABELS[time.getDay()] ?? "Sun";
}

// ── Heatmap cell key ──────────────────────────────────────────────────────────

/**
 * A stable string key combining day-of-week and 30-min bucket.
 * Used as the record key for aggregating heatmap cells.
 * e.g. "Mon-38"
 */
export function heatmapKey(time: Date): string {
  return `${dayOfWeekLabel(time)}-${intradayBucket(time)}`;
}

// ── Aggregate heatmap data ────────────────────────────────────────────────────

export interface HeatmapCell {
  day: DayLabel;
  bucket: number;
  bucketLabel: string;
  count: number;
  avgSlippage_bps: number | null;
}

/**
 * Build a map of heatmap cells from trades and their IS values.
 * IS values are passed in as a parallel array (null = no arrival price).
 */
export function buildHeatmapData(
  trades: TradeRecord[],
  slippages: (number | null)[]
): Map<string, HeatmapCell> {
  const cells = new Map<string, HeatmapCell>();

  for (let i = 0; i < trades.length; i++) {
    const trade = trades[i];
    // noUncheckedIndexedAccess: array reads return T | undefined
    const slip: number | null = slippages[i] ?? null;
    if (!trade) continue;

    const key = heatmapKey(trade.orderTime);
    const existing = cells.get(key);

    if (!existing) {
      cells.set(key, {
        day: dayOfWeekLabel(trade.orderTime),
        bucket: intradayBucket(trade.orderTime),
        bucketLabel: bucketLabel(intradayBucket(trade.orderTime)),
        count: 1,
        avgSlippage_bps: slip,
      });
    } else {
      existing.count += 1;
      // Running average of slippage (only where IS is available)
      if (slip !== null) {
        if (existing.avgSlippage_bps === null) {
          existing.avgSlippage_bps = slip;
        } else {
          existing.avgSlippage_bps =
            (existing.avgSlippage_bps * (existing.count - 1) + slip) / existing.count;
        }
      }
    }
  }

  return cells;
}

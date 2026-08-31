/**
 * Time-binning for fills on the single-order charts.
 *
 * A parent order worked over five hours can arrive as several hundred child
 * fills. Drawn one dot each they overlap into a solid band: you can see that
 * trading happened, but not where the weight was or what it paid. Binning the
 * order window into a fixed number of slices and drawing one marker per slice —
 * at the slice's quantity-weighted average price, sized by the quantity filled —
 * keeps both readings and costs only the individual fill as an addressable
 * point, which the fill-detail table below the charts already provides.
 *
 * Small orders are left alone. Under BIN_THRESHOLD fills the dots do not
 * overlap, and binning would only take away detail while changing nothing about
 * legibility.
 *
 * The marker is placed at a real fill time rather than the slice's midpoint: the
 * fill nearest the slice's quantity-weighted centre. Two reasons. It puts the
 * marker where trading actually happened, so a slice whose fills all landed in
 * its first minute does not draw a marker a minute and a half later. And it
 * means every bin coincides with a row the cumulative charts already have,
 * which is what lets those charts bin their fill markers without disturbing the
 * running-average and benchmark lines they draw at full resolution.
 */

import type { TradeRecord } from "@/types";

/** Above this many fills, charts switch from one dot per fill to bins. */
export const BIN_THRESHOLD = 100;

/** How many slices the order window is cut into once binning applies. */
export const MAX_BINS = 80;

export interface FillBin {
  /**
   * Where the marker is drawn — the time of the fill in this bin nearest its
   * quantity-weighted centre, so the marker sits on a real event.
   */
  t: number;
  /** Slice bounds, for the tooltip's time range. */
  tStart: number;
  tEnd: number;
  /** Quantity-weighted average fill price across the bin. */
  price: number;
  /** Total quantity filled in the bin — drives marker size. */
  qty: number;
  /** How many fills fell in the bin. */
  count: number;
}

/** Whether a chart with this many fills should bin them. */
export function shouldBinFills(fillCount: number): boolean {
  return fillCount > BIN_THRESHOLD;
}

/**
 * Cut the order window into equal time slices and summarise the fills in each.
 *
 * Empty slices are dropped rather than emitted as gaps: a marker per traded
 * slice is the point, and a run of nothing is already visible as a gap on the
 * time axis.
 *
 * Returns an empty array for an empty input, and a single bin when every fill
 * shares one timestamp — a zero-width window cannot be sliced.
 */
export function binFills(trades: TradeRecord[], maxBins: number = MAX_BINS): FillBin[] {
  if (trades.length === 0) return [];

  const sorted = [...trades].sort(
    (a, b) => a.lastFillTime.getTime() - b.lastFillTime.getTime(),
  );
  const tMin = sorted[0]!.lastFillTime.getTime();
  const tMax = sorted[sorted.length - 1]!.lastFillTime.getTime();
  const span = tMax - tMin;

  const bins = Math.max(1, Math.min(maxBins, sorted.length));
  // A zero-width window (every fill on one timestamp) collapses to one bin
  // rather than dividing by zero.
  const width = span > 0 ? span / bins : 0;

  interface Acc {
    notional: number;
    qty: number;
    count: number;
    /** Σ(t × qty), for the quantity-weighted centre. */
    tWeighted: number;
    times: number[];
    tStart: number;
    tEnd: number;
  }
  const acc = new Map<number, Acc>();

  for (const trade of sorted) {
    const t = trade.lastFillTime.getTime();
    // The last fill would land in bin `bins` on its own; clamp so it joins the
    // final slice rather than opening an off-the-end one.
    const idx = width > 0 ? Math.min(bins - 1, Math.floor((t - tMin) / width)) : 0;
    const qty = trade.orderQty;

    let a = acc.get(idx);
    if (a === undefined) {
      a = {
        notional: 0,
        qty: 0,
        count: 0,
        tWeighted: 0,
        times: [],
        tStart: tMin + idx * width,
        tEnd: tMin + (idx + 1) * width,
      };
      acc.set(idx, a);
    }
    a.notional += trade.avgFillPrice * qty;
    a.qty += qty;
    a.count += 1;
    a.tWeighted += t * qty;
    a.times.push(t);
  }

  return [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, a]) => {
      // Quantity-weighted where quantity exists; a bin of zero-quantity fills
      // still deserves a marker, so fall back to the plain mean time.
      const centre =
        a.qty > 0
          ? a.tWeighted / a.qty
          : a.times.reduce((s, t) => s + t, 0) / a.times.length;

      let repT = a.times[0]!;
      let best = Math.abs(repT - centre);
      for (const t of a.times) {
        const d = Math.abs(t - centre);
        if (d < best) {
          best = d;
          repT = t;
        }
      }

      return {
        t: repT,
        tStart: a.tStart,
        tEnd: a.tEnd,
        // An all-zero-quantity bin has no weighted price; the simple mean is the
        // only honest answer and keeps the marker on the chart.
        price:
          a.qty > 0
            ? a.notional / a.qty
            : a.notional / Math.max(1, a.count),
        qty: a.qty,
        count: a.count,
      };
    });
}

/** "725 fills in 80 time bins" — the subtitle note every binned chart carries. */
export function binSubtitleNote(fillCount: number, binCount: number): string {
  return `${fillCount.toLocaleString()} fills in ${binCount} time bin${binCount !== 1 ? "s" : ""}`;
}

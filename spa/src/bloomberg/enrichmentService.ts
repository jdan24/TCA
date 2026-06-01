/**
 * Bloomberg enrichment orchestrator.
 *
 * enrichAllTrades() is the single entry point called from App.tsx when the user
 * clicks "Fetch Bloomberg Data".
 *
 * Strategy per trade
 * ──────────────────
 *   1. Reference data (batched by symbol, one call per unique symbol):
 *        HIST_VOL_30D  → dailyVol = (annualized% / 100) / √252
 *        VOLUME_AVG_30D → adv
 *
 *   2. Intraday bars (1-min, from orderTime−5 min to end-of-day):
 *        • VWAP over the execution window [orderTime, lastFillTime]
 *        • Reversion prices at lastFillTime + 1 m / 5 m / 30 m, and EOD close
 *
 *   3. Arrival price via /snapshot (tick mid then bar-open fallback is handled
 *      by the bridge; we pass orderTime as the target datetime).
 *
 *   4. Bid/ask ticks ([orderTime − 2 min, lastFillTime + 30 s]) for TWAS.
 *
 * Trades that cannot produce an arrival price are skipped (no enrichment key
 * inserted) so the dashboard shows N/A rather than fabricated numbers.
 *
 * Reversion fallback
 * ──────────────────
 * If no bar is available at a reversion offset (e.g. market closed by then),
 * we fall back to avgFillPrice.  This yields 0 bps of measured reversion,
 * which is the conservative "no data" signal rather than a misleading number.
 */

import type { BidAskTick, BloombergEnrichment, IntradayBar, TradeRecord } from "@/types";
import {
  fetchArrivalPrice,
  fetchBidAskTicks,
  fetchIntradayBars,
  fetchReference,
} from "./bloombergClient";

// ── Time constants ────────────────────────────────────────────────────────────

const ONE_MIN_MS = 60_000;
const FIVE_MIN_MS = 5 * ONE_MIN_MS;
const THIRTY_MIN_MS = 30 * ONE_MIN_MS;

// ── Timezone normalisation ────────────────────────────────────────────────────

/**
 * Bloomberg returns bar and tick timestamps in the exchange's local timezone
 * as naive ISO strings (no 'Z', no offset).  The browser interprets them as
 * the *user's* local timezone, introducing an offset that breaks any filter
 * comparing bar times to UTC-based Date objects (order time, last fill time).
 *
 * This function detects the mismatch by comparing the first item's timestamp
 * (mis-parsed as browser-local) to the known UTC request start.  If they
 * differ by a whole number of hours (a valid timezone offset), it shifts all
 * timestamps by that amount and appends 'Z' so subsequent `new Date()` calls
 * correctly produce UTC-epoch values.
 *
 * Example: CME futures (CDT = UTC−5), browser in EDT (UTC−4).
 *   Bridge sends: requestStart = "2026-05-28T19:40:00Z" (UTC)
 *   Bloomberg returns first bar: "2026-05-28T14:40:00" (14:40 CDT)
 *   Browser reads as: 14:40 EDT = 18:40 UTC  →  1 h behind actual UTC
 *   Correction: +1 h  →  "2026-05-28T19:40:00.000Z"  ✓
 */
function shiftToUtc<T extends { time: string }>(
  items: T[],
  requestedStartUtcMs: number,
): T[] {
  if (items.length === 0) return items;
  const first = items[0];
  if (!first) return items;

  // Parse first item's naive time string using browser's local interpretation
  const firstAsLocalMs = new Date(first.time).getTime();

  // Round requested start to the nearest minute (Bloomberg aligns bars to minutes)
  const startRoundedMs = Math.floor(requestedStartUtcMs / 60_000) * 60_000;

  const diffMs = firstAsLocalMs - startRoundedMs;
  const diffHours = Math.round(diffMs / 3_600_000);

  // No correction needed, or the offset is implausibly large
  if (diffHours === 0 || Math.abs(diffHours) > 14) return items;

  const correctionMs = -diffHours * 3_600_000;

  return items.map((item) => ({
    ...item,
    // Shift and append 'Z' so new Date() treats the result as UTC
    time: new Date(new Date(item.time).getTime() + correctionMs).toISOString(),
  }));
}

// ── Vol from bars fallback ────────────────────────────────────────────────────

/**
 * Estimate annualised daily volatility from 1-min bar close-to-close returns.
 * Used when Bloomberg reference fields (HIST_VOL_30D, VOLATILITY_30D) are not
 * available for a security type (e.g. many fixed-income futures).
 *
 * Returns 0 when there are fewer than 10 bars (insufficient sample).
 */
function computeDailyVolFromBars(bars: IntradayBar[]): number {
  if (bars.length < 10) return 0;

  const returns: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1];
    const curr = bars[i];
    if (prev && curr && prev.close > 0 && curr.close > 0) {
      returns.push((curr.close - prev.close) / prev.close);
    }
  }
  if (returns.length < 10) return 0;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const sigmaPerBar = Math.sqrt(variance);

  // Annualise: 1-min bars, ~1440 trading min/day for near-24h futures, 252 days/year
  return sigmaPerBar * Math.sqrt(1_440 * 252);
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function toIso(d: Date): string {
  return d.toISOString();
}

/** 23:59:59.000 UTC on the same calendar day as d. */
function endOfDayUtc(d: Date): Date {
  const eod = new Date(d);
  eod.setUTCHours(23, 59, 59, 0);
  return eod;
}

// ── Short-order threshold ─────────────────────────────────────────────────────

/** Orders ≤ this duration use bid/ask tick midpoints for VWAP instead of bars. */
const SHORT_ORDER_THRESHOLD_MS = 5 * 60_000; // 5 minutes

// ── Bar analysis helpers ──────────────────────────────────────────────────────

/**
 * Market VWAP (volume-weighted close price) over 1-min bars covering
 * the window [from, to].
 *
 * Boundary alignment: bar timestamps represent the bar's OPEN time, so
 * a bar at T covers [T, T+60s).  We round both boundaries DOWN to the
 * nearest minute so we include:
 *   – the bar that was open when the order was submitted (even if the
 *     order started 31 seconds into that bar)
 *   – the bar that was open at the last fill
 *
 * Price formula: close × volume.  The close is the last actual trade
 * price in the bar — a better proxy for true VWAP than the typical
 * price (H+L+C)/3, which can be skewed by brief spike highs/lows.
 *
 * Returns null when no bars fall in the window or total volume is 0.
 */
function computeVwap(
  bars: IntradayBar[],
  from: Date,
  to: Date,
): number | null {
  const ONE_MIN_MS = 60_000;
  // Align to bar minute boundaries so partial start/end bars are included
  const fromBarMs = Math.floor(from.getTime() / ONE_MIN_MS) * ONE_MIN_MS;
  const toBarMs   = Math.floor(to.getTime()   / ONE_MIN_MS) * ONE_MIN_MS;

  let sumPV = 0;
  let sumV  = 0;
  for (const bar of bars) {
    const barMs = new Date(bar.time).getTime();
    if (barMs >= fromBarMs && barMs <= toBarMs) {
      sumPV += bar.close * bar.volume;
      sumV  += bar.volume;
    }
  }
  return sumV > 0 ? sumPV / sumV : null;
}

/**
 * Close of the last bar whose open time is ≤ targetTime.
 * Assumes bars are sorted ascending by time.
 * Returns null if no bar precedes the target.
 */
function getPriceAtOrBefore(bars: IntradayBar[], targetTime: Date): number | null {
  const targetMs = targetTime.getTime();
  let best: IntradayBar | null = null;
  for (const bar of bars) {
    if (new Date(bar.time).getTime() <= targetMs) {
      best = bar;
    } else {
      break; // ascending order → no more candidates
    }
  }
  return best?.close ?? null;
}

/**
 * Close of the last bar for the calendar day of `day` (UTC date portion).
 * Returns null when no bars fall on that day.
 */
function getEodClose(bars: IntradayBar[], day: Date): number | null {
  const prefix = day.toISOString().slice(0, 10); // "YYYY-MM-DD"
  let last: IntradayBar | null = null;
  for (const bar of bars) {
    if (bar.time.startsWith(prefix)) {
      last = bar;
    }
  }
  return last?.close ?? null;
}

// ── Reference data helpers ────────────────────────────────────────────────────

/**
 * Convert Bloomberg HIST_VOL_30D (annualized percent, e.g. 18.5)
 * to a daily volatility fraction suitable for the square-root MI model.
 *   dailyVol = (pct / 100) / √252
 */
function annualizedPctToDaily(raw: unknown): number {
  if (typeof raw !== "number" || raw <= 0) return 0;
  return (raw / 100) / Math.sqrt(252);
}

// ── Per-trade enrichment ──────────────────────────────────────────────────────

async function enrichOneTrade(
  trade: TradeRecord,
  refData: Record<string, unknown>,
  bbgSymbol: string,
): Promise<BloombergEnrichment | null> {
  const { orderTime, lastFillTime, avgFillPrice } = trade;
  const symbol = bbgSymbol; // may be mapped RIC → Bloomberg ticker+yellowKey

  // ── Parallel data fetch ──────────────────────────────────────────────────
  const barStart = new Date(orderTime.getTime() - FIVE_MIN_MS);
  const barEnd = endOfDayUtc(lastFillTime);

  const tickStart = new Date(orderTime.getTime() - 2 * ONE_MIN_MS);
  const tickEnd = new Date(lastFillTime.getTime() + 30_000);

  const [rawBars, rawTickData, bridgeArrival] = await Promise.all([
    fetchIntradayBars(symbol, toIso(barStart), toIso(barEnd), 1),
    fetchBidAskTicks(symbol, toIso(tickStart), toIso(tickEnd)),
    fetchArrivalPrice(symbol, toIso(orderTime)),
  ]);

  // Normalise bar and tick timestamps from exchange-local to UTC.
  // Bloomberg returns naive ISO timestamps in the exchange's local timezone;
  // without correction the time-window filters in TWAP/vol/TWAS are wrong.
  const bars = shiftToUtc(rawBars, barStart.getTime());
  const rawTicks = shiftToUtc(rawTickData, tickStart.getTime());

  // ── Arrival price ────────────────────────────────────────────────────────
  // Bridge handles tick-mid vs bar-open fallback internally.
  // If bridge also returns nothing, try our own bar lookup.
  const arrivalPrice = bridgeArrival ?? getPriceAtOrBefore(bars, orderTime);
  if (arrivalPrice === null) return null; // can't enrich without arrival price

  // ── VWAP (execution window) ──────────────────────────────────────────────
  // For short orders (≤ 5 min) use tick midpoints: 1-min bars are too coarse
  // (only 0–5 bars) and minute-boundary rounding introduces excessive noise.
  const isShortOrder =
    lastFillTime.getTime() - orderTime.getTime() <= SHORT_ORDER_THRESHOLD_MS;

  const vwap = isShortOrder
    ? (() => {
        // rawTicks is already available; bidAskTicks is declared further below
        const fromMs = orderTime.getTime();
        const toMs   = lastFillTime.getTime();
        const mids   = rawTicks
          .filter((tk) => {
            const ms = new Date(tk.time).getTime();
            return ms >= fromMs && ms <= toMs;
          })
          .map((tk) => (tk.bid + tk.ask) / 2);
        return mids.length > 0
          ? mids.reduce((a, b) => a + b, 0) / mids.length
          : null;
      })() ?? arrivalPrice
    : computeVwap(bars, orderTime, lastFillTime) ?? arrivalPrice;

  // ── Reference fields ─────────────────────────────────────────────────────
  // Vol fallback chain — try each Bloomberg field in order; if none returns a
  // value, derive daily vol from the intraday bars (close-to-close returns,
  // annualised).  This ensures MI_bps is never N/A due to missing ref data.
  const dailyVol =
    annualizedPctToDaily(
      refData["HIST_VOL_30D"] ??
      refData["VOLATILITY_30D"] ??
      refData["RETURN_VOL_30D_MID"] ??
      refData["CLOSE_TO_CLOSE_HIST_VOL_30D"],
    ) || computeDailyVolFromBars(bars);
  // Prefer 30-day ADV; fall back to 20-day when 30-day is unavailable.
  const adv =
    typeof refData["VOLUME_AVG_30D"] === "number"
      ? (refData["VOLUME_AVG_30D"] as number)
      : typeof refData["VOLUME_AVG_20D"] === "number"
        ? (refData["VOLUME_AVG_20D"] as number)
        : 0;

  // ── Reversion mark prices ────────────────────────────────────────────────
  const rev1mPrice = getPriceAtOrBefore(
    bars,
    new Date(lastFillTime.getTime() + ONE_MIN_MS),
  );
  const rev5mPrice = getPriceAtOrBefore(
    bars,
    new Date(lastFillTime.getTime() + FIVE_MIN_MS),
  );
  const rev30mPrice = getPriceAtOrBefore(
    bars,
    new Date(lastFillTime.getTime() + THIRTY_MIN_MS),
  );
  const eodPrice = getEodClose(bars, lastFillTime);

  // ── Bid/ask ticks (Date-typed for computeTWAS) ────────────────────────────
  const bidAskTicks: BidAskTick[] = rawTicks.map((t) => ({
    time: new Date(t.time),
    bid: t.bid,
    ask: t.ask,
  }));

  return {
    arrivalPrice,
    vwap,
    adv,
    dailyVol,
    // Fall back to avgFillPrice → 0 bps reversion (conservative "no data")
    reversion1m: rev1mPrice ?? avgFillPrice,
    reversion5m: rev5mPrice ?? avgFillPrice,
    reversion30m: rev30mPrice ?? avgFillPrice,
    reversionEOD: eodPrice ?? avgFillPrice,
    bidAskTicks,
    barsSnapshot: bars,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface EnrichProgress {
  done: number;
  total: number;
}

/**
 * Enrich all trades with Bloomberg data.
 *
 * Progress callback fires after each trade completes so callers can render a
 * progress bar.  Trades that fail enrichment (no arrival price, network error)
 * are silently omitted from the result map — the dashboard renders those as N/A.
 *
 * @param trades      Normalised trade records from the parser.
 * @param onProgress  Optional callback: called with {done, total} each step.
 * @returns           Partial enrichment map keyed by orderId.
 */
export async function enrichAllTrades(
  trades: TradeRecord[],
  onProgress?: (progress: EnrichProgress) => void,
  resolveSymbol: (ric: string) => string = (s) => s,
): Promise<Record<string, BloombergEnrichment>> {
  const result: Record<string, BloombergEnrichment> = {};
  const total = trades.length;
  if (total === 0) return result;

  // ── Step 1: batch reference data (one call per unique mapped symbol) ───────
  const uniqueSymbols = [...new Set(trades.map((t) => resolveSymbol(t.symbol)))];
  const refMap: Record<string, Record<string, unknown>> = {};

  await Promise.all(
    uniqueSymbols.map(async (sym) => {
      // Request both the primary field and its fallback in one call.
      // VOLATILITY_30D is tried when HIST_VOL_30D is not valid for the
      // security type (common for fixed-income and some commodity futures).
      // VOLUME_AVG_20D backs up VOLUME_AVG_30D for instruments with shorter
      // available history.
      // Vol fields in priority order — different security types expose different
      // fields.  Equity-style: HIST_VOL_30D.  Futures/fixed-income: one of the
      // RETURN_VOL or CLOSE_TO_CLOSE variants tends to work.  If none returns a
      // value, dailyVol is computed from intraday bars as a final fallback.
      refMap[sym] = await fetchReference(sym, [
        "HIST_VOL_30D",           // equities, some equity-index futures
        "VOLATILITY_30D",         // Bloomberg-computed 30-day realized vol
        "RETURN_VOL_30D_MID",     // 30-day price-return vol — works broadly for futures
        "CLOSE_TO_CLOSE_HIST_VOL_30D", // close-to-close 30D, common for rates/FI futures
        "VOLUME_AVG_30D",
        "VOLUME_AVG_20D",
      ]);
    }),
  );

  // ── Step 2: enrich each trade sequentially (preserves progress accuracy) ──
  for (let i = 0; i < total; i++) {
    const trade = trades[i];
    if (!trade) {
      onProgress?.({ done: i + 1, total });
      continue;
    }

    const bbgSymbol = resolveSymbol(trade.symbol);
    const ref = refMap[bbgSymbol] ?? {};

    try {
      const enriched = await enrichOneTrade(trade, ref, bbgSymbol);
      if (enriched !== null) {
        result[trade.orderId] = enriched;
      }
    } catch {
      // Network errors or unexpected blpapi responses — skip this trade
    }

    onProgress?.({ done: i + 1, total });
  }

  return result;
}

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

import type { BidAskTick, BloombergEnrichment, TradeRecord } from "@/types";
import {
  fetchArrivalPrice,
  fetchBidAskTicks,
  fetchIntradayBars,
  fetchReference,
  type IntradayBar,
} from "./bloombergClient";

// ── Time constants ────────────────────────────────────────────────────────────

const ONE_MIN_MS = 60_000;
const FIVE_MIN_MS = 5 * ONE_MIN_MS;
const THIRTY_MIN_MS = 30 * ONE_MIN_MS;

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

// ── Bar analysis helpers ──────────────────────────────────────────────────────

/**
 * VWAP (typical-price weighted) over 1-min bars in [from, to).
 * Returns null when there are no bars or zero total volume.
 */
function computeVwap(
  bars: IntradayBar[],
  from: Date,
  to: Date,
): number | null {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  let sumPV = 0;
  let sumV = 0;
  for (const bar of bars) {
    const barMs = new Date(bar.time).getTime();
    if (barMs >= fromMs && barMs < toMs) {
      const typical = (bar.high + bar.low + bar.close) / 3;
      sumPV += typical * bar.volume;
      sumV += bar.volume;
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
): Promise<BloombergEnrichment | null> {
  const { symbol, orderTime, lastFillTime, avgFillPrice } = trade;

  // ── Parallel data fetch ──────────────────────────────────────────────────
  const barStart = new Date(orderTime.getTime() - FIVE_MIN_MS);
  const barEnd = endOfDayUtc(lastFillTime);

  const tickStart = new Date(orderTime.getTime() - 2 * ONE_MIN_MS);
  const tickEnd = new Date(lastFillTime.getTime() + 30_000);

  const [bars, rawTicks, bridgeArrival] = await Promise.all([
    fetchIntradayBars(symbol, toIso(barStart), toIso(barEnd), 1),
    fetchBidAskTicks(symbol, toIso(tickStart), toIso(tickEnd)),
    fetchArrivalPrice(symbol, toIso(orderTime)),
  ]);

  // ── Arrival price ────────────────────────────────────────────────────────
  // Bridge handles tick-mid vs bar-open fallback internally.
  // If bridge also returns nothing, try our own bar lookup.
  const arrivalPrice = bridgeArrival ?? getPriceAtOrBefore(bars, orderTime);
  if (arrivalPrice === null) return null; // can't enrich without arrival price

  // ── VWAP (execution window) ──────────────────────────────────────────────
  const vwap = computeVwap(bars, orderTime, lastFillTime) ?? arrivalPrice;

  // ── Reference fields ─────────────────────────────────────────────────────
  const dailyVol = annualizedPctToDaily(refData["HIST_VOL_30D"]);
  const adv =
    typeof refData["VOLUME_AVG_30D"] === "number"
      ? (refData["VOLUME_AVG_30D"] as number)
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
): Promise<Record<string, BloombergEnrichment>> {
  const result: Record<string, BloombergEnrichment> = {};
  const total = trades.length;
  if (total === 0) return result;

  // ── Step 1: batch reference data (one call per unique symbol) ─────────────
  const uniqueSymbols = [...new Set(trades.map((t) => t.symbol))];
  const refMap: Record<string, Record<string, unknown>> = {};

  await Promise.all(
    uniqueSymbols.map(async (sym) => {
      refMap[sym] = await fetchReference(sym, ["HIST_VOL_30D", "VOLUME_AVG_30D"]);
    }),
  );

  // ── Step 2: enrich each trade sequentially (preserves progress accuracy) ──
  for (let i = 0; i < total; i++) {
    const trade = trades[i];
    if (!trade) {
      onProgress?.({ done: i + 1, total });
      continue;
    }

    const ref = refMap[trade.symbol] ?? {};

    try {
      const enriched = await enrichOneTrade(trade, ref);
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

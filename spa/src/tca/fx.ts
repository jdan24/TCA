/**
 * FX conversion for the cash figures.
 *
 * Every cash number in this app is produced in the contract's own currency: a
 * EUR-denominated future yields a EUR result, because the point value behind it
 * is denominated in EUR. That is correct but not always useful — a book spanning
 * Bund, Gilt and Treasury futures has three currencies and therefore no total,
 * and "which instrument cost us the most" cannot be answered at all.
 *
 * So there are two display modes, chosen globally:
 *
 *   native — each figure in its own currency, and a group spanning more than one
 *            reports no total. This is what the app did before FX existed, and
 *            it remains the mode that invents nothing.
 *   usd    — every figure converted, and cross-currency groups gain real totals.
 *
 * Rates are USD per one major unit of the currency (EUR 1.0842, JPY 0.00676), so
 * conversion is always a multiplication and the direction cannot be got wrong by
 * reading the code. USD itself is always exactly 1 and never needs fetching.
 *
 * A currency with no rate is not converted and not silently dropped: the figure
 * stays native and is marked, so a mixed report is visibly mixed rather than
 * quietly wrong. Totals over any unconvertible member are suppressed the same
 * way native mode suppresses mixed ones.
 *
 * Minor units never reach here. Bloomberg's "USd"/"GBp" forms are normalised to
 * their major code by toMajorCurrency in dollars.ts, and the point value is
 * divided by 100 at the same time, so a cash figure is always in major units by
 * the time it is converted.
 */

/** How the app is currently displaying cash. */
export type DisplayCurrency = "usd" | "native";

/** Where a rate came from. An override always beats a fetched rate. */
export type FxRateSource = "override" | "bloomberg";

export interface FxRate {
  /** Major ISO code of the *from* currency, e.g. "EUR". */
  ccy: string;
  /** USD per one major unit of `ccy`. */
  rate: number;
  source: FxRateSource;
  /** When Bloomberg's rate was pulled. null for a manual override. */
  asOf: Date | null;
}

/** Rates keyed by major ISO code. */
export type FxRateMap = Record<string, FxRate>;

export const USD = "USD";

/**
 * Bloomberg security for a currency's USD rate.
 *
 * The XXXUSD direction is used for every currency, including those the market
 * quotes the other way round (USDJPY). Bloomberg carries both tickers and
 * returns the inverse for the reversed one, so asking consistently for XXXUSD
 * means the answer is always USD per unit and no branch has to know which
 * currencies are conventionally quoted backwards.
 */
export function fxSecurityFor(ccy: string): string {
  return `${ccy.trim().toUpperCase()}USD Curncy`;
}

/**
 * A rate is only usable if it is finite and positive. A zero or negative rate
 * would silently zero out or flip the sign of every figure it touched.
 */
export function isUsableRate(rate: unknown): rate is number {
  return typeof rate === "number" && isFinite(rate) && rate > 0;
}

/**
 * The rate to use for a currency, override first.
 *
 * USD resolves to 1 without consulting anything, so a USD-only report needs no
 * Bloomberg call and cannot be blocked by a missing one.
 */
export function resolveRate(ccy: string | null, rates: FxRateMap): FxRate | null {
  if (ccy === null) return null;
  const code = ccy.trim().toUpperCase();
  if (code === "") return null;
  if (code === USD) return { ccy: USD, rate: 1, source: "override", asOf: null };
  return rates[code] ?? null;
}

/** The outcome of asking for a figure in the display currency. */
export interface ConvertedCash {
  value: number;
  /** Currency the value is actually in — USD when converted, else the native one. */
  currency: string;
  /**
   * True when the figure is still in its native currency despite USD mode being
   * on, because no rate was available. Callers mark these.
   */
  unconverted: boolean;
}

/**
 * Present one cash figure in the requested display currency.
 *
 * In native mode this is a pass-through: no rate is consulted, so a missing rate
 * cannot affect a report nobody asked to convert.
 */
export function convertCash(
  value: number,
  nativeCcy: string,
  display: DisplayCurrency,
  rates: FxRateMap,
): ConvertedCash {
  const code = nativeCcy.trim().toUpperCase() || USD;
  if (display === "native") {
    return { value, currency: code, unconverted: false };
  }
  const rate = resolveRate(code, rates);
  if (rate === null || !isUsableRate(rate.rate)) {
    return { value, currency: code, unconverted: true };
  }
  return { value: value * rate.rate, currency: USD, unconverted: false };
}

/**
 * Whether every one of these currencies can be shown in the display currency.
 *
 * This is the test a group total has to pass. In native mode it means "all one
 * currency", exactly as before FX existed; in USD mode it means "every currency
 * has a rate" — a group carrying one unconvertible member reports no total
 * rather than a sum that quietly omits it.
 */
export function canTotal(
  currencies: readonly string[],
  display: DisplayCurrency,
  rates: FxRateMap,
): boolean {
  const codes = [...new Set(currencies.map((c) => c.trim().toUpperCase()))].filter(
    (c) => c !== "",
  );
  if (codes.length === 0) return false;
  if (display === "native") return codes.length === 1;
  return codes.every((c) => {
    const r = resolveRate(c, rates);
    return r !== null && isUsableRate(r.rate);
  });
}

/**
 * Currency a group's total is reported in: USD when converting, otherwise the
 * single native currency the group shares. null when it cannot be totalled.
 */
export function totalCurrency(
  currencies: readonly string[],
  display: DisplayCurrency,
  rates: FxRateMap,
): string | null {
  if (!canTotal(currencies, display, rates)) return null;
  if (display === "usd") return USD;
  return currencies[0]?.trim().toUpperCase() ?? null;
}

/** The currencies a set of figures needs rates for — USD excluded, it is free. */
export function currenciesNeedingRates(currencies: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const c of currencies) {
    const code = c.trim().toUpperCase();
    if (code !== "" && code !== USD) out.add(code);
  }
  return [...out].sort();
}

/**
 * "EURUSD 1.0842, GBPUSD 1.2610 (Bloomberg PX_LAST, 2026-09-01 14:32 UTC)"
 *
 * The line printed under every table that shows converted figures, so a figure
 * cannot be read — or screenshotted — without the rate that produced it.
 * Overrides are named as such: a reader who cannot reproduce the number from
 * Bloomberg should be able to see why.
 */
export function fxDisclosure(rates: FxRate[]): string {
  if (rates.length === 0) return "";
  const parts = rates
    .slice()
    .sort((a, b) => a.ccy.localeCompare(b.ccy))
    .map((r) => `${r.ccy}USD ${formatRate(r.rate)}${r.source === "override" ? " (override)" : ""}`);

  // Timestamp the oldest fetched rate: it bounds how stale the set is. Overrides
  // carry no time, and a set that is entirely overrides has nothing to stamp.
  const stamped = rates
    .filter((r) => r.source === "bloomberg" && r.asOf !== null)
    .map((r) => r.asOf!.getTime());
  const asOf =
    stamped.length > 0 ? ` — Bloomberg PX_LAST, ${fmtUtcMinute(new Date(Math.min(...stamped)))}` : "";

  return `Converted at ${parts.join(", ")}${asOf}`;
}

/** Rates span orders of magnitude (JPY 0.0068, EUR 1.08) — show enough of each. */
export function formatRate(rate: number): string {
  if (!isFinite(rate)) return "N/A";
  if (rate >= 100) return rate.toFixed(2);
  if (rate >= 1) return rate.toFixed(4);
  if (rate >= 0.01) return rate.toFixed(5);
  return rate.toPrecision(4);
}

function fmtUtcMinute(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
  );
}

/**
 * The slice of useCashDisplay that pure aggregation code needs.
 *
 * Declared here so tca/aggregate.ts and tca/settleAggregate.ts can total in the
 * display currency without importing a React hook or knowing where the rates
 * came from. Callers pass the hook's return value straight in; omitting it keeps
 * the pre-FX behaviour, which is what the pure unit paths want.
 */
export interface CashTotaller {
  canTotal(currencies: readonly string[]): boolean;
  totalCurrency(currencies: readonly string[]): string | null;
  /** null when the figure cannot be expressed in the display currency. */
  toDisplay(value: number, nativeCcy: string): number | null;
}

/**
 * Totaller used when none is supplied: native semantics, no rates.
 *
 * Keeps every aggregation's default identical to what it did before FX existed —
 * one currency totals, more than one does not.
 */
export const NATIVE_TOTALLER: CashTotaller = {
  canTotal: (currencies) => canTotal(currencies, "native", {}),
  totalCurrency: (currencies) => totalCurrency(currencies, "native", {}),
  toDisplay: (value) => value,
};

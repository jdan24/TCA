/**
 * FX rate enrichment.
 *
 * One PX_LAST per currency, fetched on demand. The report converts at a single
 * current rate rather than at each order's own date: it is the rate the desk
 * would use to talk about the book today, and it means a report has one number
 * to disclose rather than one per date. The timestamp is recorded with it so a
 * saved PDF says exactly what it was converted at and when.
 *
 * USD is never fetched — it is 1 by definition, so a USD-only report makes no
 * calls at all and cannot be blocked by an offline bridge.
 */

import { fetchReference } from "./bloombergClient";
import { asBloombergNumber } from "@/tca/tcaUtils";
import {
  currenciesNeedingRates,
  fxSecurityFor,
  isUsableRate,
  type FxRate,
  type FxRateMap,
} from "@/tca/fx";

/**
 * How many rate lookups may be in flight at once.
 *
 * The same reasoning as the settle fetch: the browser caps HTTP/1.1 at six
 * connections per host and the fetch timeout starts at call time, so an
 * unbounded burst ages in a queue until it aborts. A report rarely spans more
 * than a handful of currencies, but the pacing costs nothing when it does not.
 */
const MAX_IN_FLIGHT = 4;

export interface FxProgress {
  done: number;
  total: number;
}

/**
 * Fetch a USD rate for every currency given, minus USD itself.
 *
 * A currency whose rate does not come back is simply absent from the result —
 * callers show those figures natively and mark them, rather than converting at
 * a guessed rate.
 */
export async function fetchFxRates(
  currencies: Iterable<string>,
  onProgress?: (p: FxProgress) => void,
): Promise<FxRateMap> {
  const needed = currenciesNeedingRates(currencies);
  const rates: FxRateMap = {};

  if (needed.length === 0) {
    onProgress?.({ done: 0, total: 0 });
    return rates;
  }

  let done = 0;
  onProgress?.({ done: 0, total: needed.length });

  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      const ccy = needed[i];
      if (i >= needed.length || ccy === undefined) return;

      const ref = await fetchReference(fxSecurityFor(ccy), ["PX_LAST"]);
      const rate = asBloombergNumber(ref["PX_LAST"]);
      if (isUsableRate(rate)) {
        rates[ccy] = { ccy, rate, source: "bloomberg", asOf: new Date() };
      }

      done += 1;
      onProgress?.({ done, total: needed.length });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(MAX_IN_FLIGHT, needed.length) }, () => worker()),
  );

  return rates;
}

/**
 * Merge manual overrides over fetched rates.
 *
 * An override wins outright and is labelled as such — a reader who cannot
 * reproduce a converted figure from Bloomberg should be able to see why from
 * the disclosure line alone. An override for a currency Bloomberg never
 * answered for still applies: typing a rate is exactly what that case is for.
 */
export function applyFxOverrides(
  fetched: FxRateMap,
  overrides: Record<string, number>,
): FxRateMap {
  const merged: FxRateMap = { ...fetched };
  for (const [rawCcy, rate] of Object.entries(overrides)) {
    const ccy = rawCcy.trim().toUpperCase();
    if (ccy === "" || !isUsableRate(rate)) continue;
    merged[ccy] = { ccy, rate, source: "override", asOf: null };
  }
  return merged;
}

/** Rates for exactly the currencies in use, for the disclosure line. */
export function ratesInUse(currencies: Iterable<string>, rates: FxRateMap): FxRate[] {
  const out: FxRate[] = [];
  for (const ccy of currenciesNeedingRates(currencies)) {
    const r = rates[ccy];
    if (r !== undefined) out.push(r);
  }
  return out;
}

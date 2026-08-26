/**
 * Resolving a contract's cash point value.
 *
 * Two sources, in priority order:
 *   1. A manual per-symbol override in the symbol-mapping table.
 *   2. Bloomberg's FUT_CONT_SIZE, converted in the enrichment service
 *      (see pointValueFromContractSize in tca/dollars.ts).
 *
 * Returns null when neither is available, so every downstream cash figure
 * shows N/A rather than a number built on a guessed multiplier.
 *
 * Also home to buildPriceScaleResolver — the other per-symbol setting the
 * mapping table carries, resolved the same way.
 */
import type { BloombergEnrichment, SymbolMapping, TradeRecord } from "@/types";

export function buildPointValueResolver(
  mappings: SymbolMapping[],
  trades: TradeRecord[],
  enrichment: Record<string, BloombergEnrichment>,
): (ric: string) => number | null {
  // Manual overrides, keyed by RIC exactly as the mapping table stores them.
  const overrides = new Map<string, number>();
  for (const m of mappings) {
    if (typeof m.pointValue === "number" && isFinite(m.pointValue) && m.pointValue > 0) {
      overrides.set(m.ric, m.pointValue);
    }
  }

  // Bloomberg-derived values. Enrichment is keyed by orderId, so walk the
  // trades to get back to a RIC; every order on one symbol shares a value.
  const fromBloomberg = new Map<string, number>();
  for (const trade of trades) {
    if (fromBloomberg.has(trade.symbol)) continue;
    const pv = enrichment[trade.orderId]?.pointValue;
    if (typeof pv === "number" && isFinite(pv) && pv > 0) {
      fromBloomberg.set(trade.symbol, pv);
    }
  }

  return (ric: string) => overrides.get(ric) ?? fromBloomberg.get(ric) ?? null;
}

/**
 * Multiplier applied to file-sourced prices before they are compared with
 * Bloomberg prices — 0.01 when the file quotes 100× Bloomberg, 100 for the
 * reverse. Returns 1 (a no-op) when the symbol has no mapping or the stored
 * value is unusable.
 *
 * The multiplier is resolved on every render rather than baked into the trade
 * records at import time, so editing it in the Symbols table re-prices the
 * loaded report immediately and never needs another Bloomberg fetch.
 */
export function buildPriceScaleResolver(
  mappings: SymbolMapping[],
): (ric: string) => number {
  const scales = new Map<string, number>();
  for (const m of mappings) {
    if (typeof m.priceMultiplier === "number" && isFinite(m.priceMultiplier) && m.priceMultiplier > 0) {
      scales.set(m.ric, m.priceMultiplier);
    }
  }
  return (ric: string) => scales.get(ric) ?? 1;
}

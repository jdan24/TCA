// TODO Phase 3
// MI ≈ σ × sideSign × √(Q / ADV)
// σ = realized daily vol, ADV = avg daily volume — both from Bloomberg
import type { BloombergEnrichment, TradeRecord } from "@/types";

export function computeMarketImpact(
  _trade: TradeRecord,
  _enrichment: BloombergEnrichment | undefined
): number | null {
  return null;
}

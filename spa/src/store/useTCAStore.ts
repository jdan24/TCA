import { create } from "zustand";
import type { BloombergEnrichment, TCAResult, TCAStore, TradeRecord } from "@/types";

const initialState = {
  rawTrades: [] as TradeRecord[],
  results: [] as TCAResult[],
  enrichment: {} as Record<string, BloombergEnrichment>,
  bloombergConnected: false,
  isProcessing: false,
  parseError: null as string | null,
};

export const useTCAStore = create<TCAStore>((set) => ({
  ...initialState,
  setRawTrades: (trades) => set({ rawTrades: trades }),
  setResults: (results) => set({ results }),
  setEnrichment: (orderId, data) =>
    set((s) => ({ enrichment: { ...s.enrichment, [orderId]: data } })),
  setBloombergConnected: (v) => set({ bloombergConnected: v }),
  setProcessing: (v) => set({ isProcessing: v }),
  setParseError: (msg) => set({ parseError: msg }),
  reset: () => set(initialState),
}));

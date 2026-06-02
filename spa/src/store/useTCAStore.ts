import { create } from "zustand";
import type {
  AggregationFilter,
  BloombergEnrichment,
  TCAMode,
  TCAResult,
  TCAStore,
  TradeRecord,
} from "@/types";

const initialState = {
  mode: "multi" as TCAMode,
  rawTrades: [] as TradeRecord[],
  results: [] as TCAResult[],
  enrichment: {} as Record<string, BloombergEnrichment>,
  bloombergConnected: false,
  isProcessing: false,
  parseError: null as string | null,
  aggregationFilter: null as AggregationFilter | null,
  singleOrderTimeOverride: null as { start: Date; end: Date } | null,
};

export const useTCAStore = create<TCAStore>((set) => ({
  ...initialState,
  setMode: (m) => set({ mode: m }),
  setRawTrades: (trades) => set({ rawTrades: trades }),
  setResults: (results) => set({ results }),
  setEnrichment: (orderId, data) =>
    set((s) => ({ enrichment: { ...s.enrichment, [orderId]: data } })),
  setAllEnrichment: (enrichment) => set({ enrichment }),
  setBloombergConnected: (v) => set({ bloombergConnected: v }),
  setProcessing: (v) => set({ isProcessing: v }),
  setParseError: (msg) => set({ parseError: msg }),
  setAggregationFilter: (f) => set({ aggregationFilter: f }),
  setSingleOrderTimeOverride: (v) => set({ singleOrderTimeOverride: v }),
  reset: () => set(initialState),
}));

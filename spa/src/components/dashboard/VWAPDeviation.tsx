// TODO Phase 5 — bar chart: VWAP deviation (bps) by symbol and side
import type { TCAResult, TradeRecord } from "@/types";

interface VWAPDeviationProps {
  trades: TradeRecord[];
  results: TCAResult[];
}

export function VWAPDeviation(_props: VWAPDeviationProps) {
  return <div className="text-gray-400 text-sm">VWAPDeviation — stub (Phase 5)</div>;
}

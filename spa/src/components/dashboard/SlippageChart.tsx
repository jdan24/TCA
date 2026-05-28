// TODO Phase 5 — scatter: slippage (bps) vs order size (contracts), colored by symbol
import type { TCAResult, TradeRecord } from "@/types";

interface SlippageChartProps {
  trades: TradeRecord[];
  results: TCAResult[];
}

export function SlippageChart(_props: SlippageChartProps) {
  return <div className="text-gray-400 text-sm">SlippageChart — stub (Phase 5)</div>;
}

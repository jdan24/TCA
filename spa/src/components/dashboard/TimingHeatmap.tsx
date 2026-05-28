// TODO Phase 5 — 30-min intraday buckets × day-of-week, colored by avg slippage
import type { TCAResult, TradeRecord } from "@/types";

interface TimingHeatmapProps {
  trades: TradeRecord[];
  results: TCAResult[];
}

export function TimingHeatmap(_props: TimingHeatmapProps) {
  return <div className="text-gray-400 text-sm">TimingHeatmap — stub (Phase 5)</div>;
}

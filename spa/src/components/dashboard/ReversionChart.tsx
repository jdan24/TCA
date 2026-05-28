// TODO Phase 5 — avg price path at +1m/+5m/+30m/EOD, buy vs sell curves
import type { TCAResult } from "@/types";

interface ReversionChartProps {
  results: TCAResult[];
}

export function ReversionChart(_props: ReversionChartProps) {
  return <div className="text-gray-400 text-sm">ReversionChart — stub (Phase 5)</div>;
}

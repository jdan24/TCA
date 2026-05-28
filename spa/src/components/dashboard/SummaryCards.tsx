// TODO Phase 5 — KPI tiles: avg IS, avg VWAP deviation, avg TWAS, avg time-to-fill, total MI cost
import type { TCAResult } from "@/types";

interface SummaryCardsProps {
  results: TCAResult[];
}

export function SummaryCards(_props: SummaryCardsProps) {
  return <div className="text-gray-400 text-sm">SummaryCards — stub (Phase 5)</div>;
}

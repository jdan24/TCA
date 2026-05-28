// TODO Phase 6 — TanStack Table v8 with all metric columns, column visibility, filter/sort
import type { TCAResult, TradeRecord } from "@/types";

interface TradeTableProps {
  trades: TradeRecord[];
  results: TCAResult[];
}

export function TradeTable(_props: TradeTableProps) {
  return <div className="text-gray-400 text-sm">TradeTable — stub (Phase 6)</div>;
}

// TODO Phase 7 — Excel (SheetJS) + PDF (jsPDF + autotable) export buttons
import type { TCAResult, TradeRecord } from "@/types";

interface ExportBarProps {
  trades: TradeRecord[];
  results: TCAResult[];
}

export function ExportBar(_props: ExportBarProps) {
  return <div className="text-gray-400 text-sm">ExportBar — stub (Phase 7)</div>;
}

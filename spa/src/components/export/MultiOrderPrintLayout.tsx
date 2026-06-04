import type { TCAResult, TradeRecord } from "@/types";

interface MultiOrderPrintLayoutProps {
  trades: TradeRecord[];
  results: TCAResult[];
  onBack: () => void;
}

export function MultiOrderPrintLayout({ onBack }: MultiOrderPrintLayoutProps) {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 flex flex-col">
      {/* Toolbar — hidden on Ctrl+P */}
      <div className="print:hidden flex items-center gap-3 px-6 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <span className="text-sm font-semibold text-gray-900 dark:text-white">
          Multi-Order Print Layout
        </span>
      </div>

      {/* Placeholder body */}
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-12 text-center">
        <svg className="h-12 w-12 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
        </svg>
        <p className="text-lg font-semibold text-gray-700 dark:text-gray-300">
          Multi-Order Print Layout
        </p>
        <p className="text-sm text-gray-400 dark:text-gray-500 max-w-sm">
          This layout is under construction. A tailored multi-order print view will be built here.
        </p>
      </div>
    </div>
  );
}

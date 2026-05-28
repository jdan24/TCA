import { Header } from "@/components/layout/Header";
import { FileDropZone } from "@/components/upload/FileDropZone";
import { useTCAStore } from "@/store/useTCAStore";

function App() {
  const rawTrades = useTCAStore((s) => s.rawTrades);
  const setRawTrades = useTCAStore((s) => s.setRawTrades);
  const reset = useTCAStore((s) => s.reset);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <Header />

      <main className="flex-1 flex flex-col items-center justify-center p-8 gap-6">
        {rawTrades.length === 0 ? (
          <>
            <FileDropZone onComplete={setRawTrades} />
            <p className="text-sm text-gray-400 dark:text-gray-600">
              Upload a CSV, XLSX, or FIX execution report to begin analysis
            </p>
          </>
        ) : (
          <TradesLoadedPlaceholder
            count={rawTrades.length}
            onReset={reset}
          />
        )}
      </main>
    </div>
  );
}

// ── Placeholder shown after a successful parse (replaced by Dashboard in Phase 5) ──

interface TradesLoadedProps {
  count: number;
  onReset: () => void;
}

function TradesLoadedPlaceholder({ count, onReset }: TradesLoadedProps) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="flex items-center justify-center h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/30">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-8 w-8 text-green-600 dark:text-green-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <div>
        <p className="text-lg font-semibold text-gray-900 dark:text-white">
          {count.toLocaleString()} trade{count !== 1 ? "s" : ""} loaded
        </p>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Dashboard will appear here in Phase 5
        </p>
      </div>

      <button
        type="button"
        onClick={onReset}
        className="mt-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        ↺ Load a different file
      </button>
    </div>
  );
}

export default App;

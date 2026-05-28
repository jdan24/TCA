import { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { FileDropZone } from "@/components/upload/FileDropZone";
import { enrichAllTrades, type EnrichProgress } from "@/bloomberg/enrichmentService";
import { useTCAStore } from "@/store/useTCAStore";
import { computeAll } from "@/tca/compute";

function App() {
  const rawTrades = useTCAStore((s) => s.rawTrades);
  const enrichment = useTCAStore((s) => s.enrichment);
  const bloombergConnected = useTCAStore((s) => s.bloombergConnected);
  const setRawTrades = useTCAStore((s) => s.setRawTrades);
  const setResults = useTCAStore((s) => s.setResults);
  const setAllEnrichment = useTCAStore((s) => s.setAllEnrichment);
  const reset = useTCAStore((s) => s.reset);

  const [enrichProgress, setEnrichProgress] = useState<EnrichProgress | null>(null);

  // Re-run TCA metrics whenever trades or Bloomberg enrichment changes
  useEffect(() => {
    if (rawTrades.length > 0) {
      setResults(computeAll(rawTrades, enrichment));
    }
  }, [rawTrades, enrichment, setResults]);

  async function handleFetchBloomberg() {
    if (rawTrades.length === 0 || !bloombergConnected || enrichProgress !== null) return;
    setEnrichProgress({ done: 0, total: rawTrades.length });
    const result = await enrichAllTrades(rawTrades, setEnrichProgress);
    setAllEnrichment(result);
    setEnrichProgress(null);
  }

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
            bloombergConnected={bloombergConnected}
            enrichedCount={Object.keys(enrichment).length}
            enrichProgress={enrichProgress}
            onFetchBloomberg={() => { void handleFetchBloomberg(); }}
            onReset={reset}
          />
        )}
      </main>
    </div>
  );
}

// ── Trades-loaded panel (replaced by Dashboard in Phase 5) ────────────────────

interface TradesLoadedProps {
  count: number;
  bloombergConnected: boolean;
  enrichedCount: number;
  enrichProgress: EnrichProgress | null;
  onFetchBloomberg: () => void;
  onReset: () => void;
}

function TradesLoadedPlaceholder({
  count,
  bloombergConnected,
  enrichedCount,
  enrichProgress,
  onFetchBloomberg,
  onReset,
}: TradesLoadedProps) {
  const isFetching = enrichProgress !== null;
  const pct =
    isFetching && enrichProgress.total > 0
      ? Math.round((enrichProgress.done / enrichProgress.total) * 100)
      : 0;

  return (
    <div className="flex flex-col items-center gap-5 text-center max-w-sm w-full">
      {/* Success icon */}
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

      {/* Trade count */}
      <div>
        <p className="text-lg font-semibold text-gray-900 dark:text-white">
          {count.toLocaleString()} trade{count !== 1 ? "s" : ""} loaded
        </p>
        {enrichedCount > 0 && !isFetching && (
          <p className="mt-0.5 text-sm text-blue-600 dark:text-blue-400">
            {enrichedCount} enriched with Bloomberg data
          </p>
        )}
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Dashboard will appear here in Phase 5
        </p>
      </div>

      {/* Bloomberg enrichment section */}
      {isFetching ? (
        <div className="w-full space-y-2">
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>Fetching Bloomberg data…</span>
            <span>
              {enrichProgress.done} / {enrichProgress.total}
            </span>
          </div>
          <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      ) : bloombergConnected ? (
        <button
          type="button"
          onClick={onFetchBloomberg}
          className="w-full px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          {enrichedCount > 0 ? "Re-fetch Bloomberg Data" : "Fetch Bloomberg Data"}
        </button>
      ) : (
        <p className="text-xs text-gray-400 dark:text-gray-600 italic">
          Start the Bloomberg bridge to enable market data enrichment
        </p>
      )}

      {/* Reset */}
      <button
        type="button"
        onClick={onReset}
        className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        ↺ Load a different file
      </button>
    </div>
  );
}

export default App;

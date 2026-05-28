import { lazy, Suspense, useEffect, useState } from "react";
import { enrichAllTrades, type EnrichProgress } from "@/bloomberg/enrichmentService";
import { Header } from "@/components/layout/Header";
import { FileDropZone } from "@/components/upload/FileDropZone";
import { useTCAStore } from "@/store/useTCAStore";
import { computeAll } from "@/tca/compute";

/**
 * Dashboard is lazy-loaded so recharts, @tanstack/react-table, and all chart
 * components are excluded from the initial bundle.  They load as a separate
 * chunk the first time a file is successfully parsed.
 */
const Dashboard = lazy(() =>
  import("@/components/dashboard/Dashboard").then((m) => ({
    default: m.Dashboard,
  }))
);

function App() {
  const rawTrades = useTCAStore((s) => s.rawTrades);
  const results = useTCAStore((s) => s.results);
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

  const enrichedCount = Object.keys(enrichment).length;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <Header />

      {rawTrades.length === 0 ? (
        <main className="flex-1 flex flex-col items-center justify-center p-8 gap-6">
          <FileDropZone onComplete={setRawTrades} />
          <p className="text-sm text-gray-400 dark:text-gray-600">
            Upload a CSV, XLSX, or FIX execution report to begin analysis
          </p>
        </main>
      ) : (
        <Suspense
          fallback={
            <main className="flex-1 flex items-center justify-center gap-3 text-sm text-gray-400 dark:text-gray-600">
              <svg
                className="h-5 w-5 animate-spin text-blue-500"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="3"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Loading dashboard…
            </main>
          }
        >
          <main className="flex-1 overflow-auto">
            <Dashboard
              trades={rawTrades}
              results={results}
              bloombergConnected={bloombergConnected}
              enrichedCount={enrichedCount}
              enrichProgress={enrichProgress}
              onFetchBloomberg={() => {
                void handleFetchBloomberg();
              }}
              onReset={reset}
            />
          </main>
        </Suspense>
      )}
    </div>
  );
}

export default App;

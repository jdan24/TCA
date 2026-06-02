import { useEffect, useState } from "react";
import { enrichAllTrades, enrichSingleOrder, type EnrichProgress } from "@/bloomberg/enrichmentService";
import { Header } from "@/components/layout/Header";
import { FileDropZone } from "@/components/upload/FileDropZone";
import { ModeSelector } from "@/components/upload/ModeSelector";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { SingleOrderDashboard } from "@/components/dashboard/single/SingleOrderDashboard";
import { useSymbolMap } from "@/hooks/useSymbolMap";
import { useTCAStore } from "@/store/useTCAStore";
import { computeAll } from "@/tca/compute";

function App() {
  const mode = useTCAStore((s) => s.mode);
  const rawTrades = useTCAStore((s) => s.rawTrades);
  const results = useTCAStore((s) => s.results);
  const enrichment = useTCAStore((s) => s.enrichment);
  const bloombergConnected = useTCAStore((s) => s.bloombergConnected);
  const setRawTrades = useTCAStore((s) => s.setRawTrades);
  const setResults = useTCAStore((s) => s.setResults);
  const setAllEnrichment = useTCAStore((s) => s.setAllEnrichment);
  const reset = useTCAStore((s) => s.reset);

  const symbolMap = useSymbolMap();
  const singleOrderTimeOverride = useTCAStore((s) => s.singleOrderTimeOverride);
  const [enrichProgress, setEnrichProgress] = useState<EnrichProgress | null>(null);

  // Re-run TCA metrics whenever trades or Bloomberg enrichment changes
  useEffect(() => {
    if (rawTrades.length > 0) {
      setResults(computeAll(rawTrades, enrichment));
    }
  }, [rawTrades, enrichment, setResults]);

  async function handleFetchBloomberg() {
    if (rawTrades.length === 0 || !bloombergConnected || enrichProgress !== null) return;
    setEnrichProgress({ done: 0, total: mode === "single" ? 1 : rawTrades.length });
    // Single Order mode: one set of Bloomberg calls for the full parent window.
    // Multi-order mode: one call per trade (existing behaviour).
    const result = mode === "single"
      ? await enrichSingleOrder(rawTrades, setEnrichProgress, symbolMap.resolve, singleOrderTimeOverride ?? undefined)
      : await enrichAllTrades(rawTrades, setEnrichProgress, symbolMap.resolve);
    setAllEnrichment(result);
    setEnrichProgress(null);
  }

  const enrichedCount = Object.keys(enrichment).length;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <Header />

      {rawTrades.length === 0 ? (
        <main className="flex-1 flex flex-col items-center justify-center p-8 gap-6">
          <ModeSelector />
          <FileDropZone onComplete={setRawTrades} mode={mode} />
          <p className="text-sm text-gray-400 dark:text-gray-600">
            Upload a CSV, XLSX, or FIX execution report to begin analysis
          </p>
        </main>
      ) : mode === "single" ? (
        <main className="flex-1 overflow-auto">
          <SingleOrderDashboard
            trades={rawTrades}
            results={results}
            enrichment={enrichment}
            bloombergConnected={bloombergConnected}
            enrichedCount={enrichedCount}
            enrichProgress={enrichProgress}
            onFetchBloomberg={() => { void handleFetchBloomberg(); }}
            onReset={reset}
          />
        </main>
      ) : (
        <main className="flex-1 overflow-auto">
          <Dashboard
            trades={rawTrades}
            results={results}
            bloombergConnected={bloombergConnected}
            enrichedCount={enrichedCount}
            enrichProgress={enrichProgress}
            onFetchBloomberg={() => { void handleFetchBloomberg(); }}
            onReset={reset}
          />
        </main>
      )}
    </div>
  );
}

export default App;

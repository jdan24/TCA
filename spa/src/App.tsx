import { useEffect, useState } from "react";
import { enrichAllTrades, enrichSingleOrder, type EnrichProgress } from "@/bloomberg/enrichmentService";
import { Header } from "@/components/layout/Header";
import { SymbolRefreshBanner } from "@/components/layout/SymbolRefreshBanner";
import { FileDropZone } from "@/components/upload/FileDropZone";
import { ImportWizardMulti } from "@/components/upload/ImportWizardMulti";
import { ModeSelector } from "@/components/upload/ModeSelector";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { SingleOrderDashboard } from "@/components/dashboard/single/SingleOrderDashboard";
import { useSymbolMap } from "@/hooks/useSymbolMap";
import { useTCAStore } from "@/store/useTCAStore";
import { computeAll } from "@/tca/compute";
import type { TradeRecord } from "@/types";

function App() {
  const mode = useTCAStore((s) => s.mode);
  const rawTrades = useTCAStore((s) => s.rawTrades);
  const results = useTCAStore((s) => s.results);
  const enrichment = useTCAStore((s) => s.enrichment);
  const bloombergConnected = useTCAStore((s) => s.bloombergConnected);
  const setRawTrades = useTCAStore((s) => s.setRawTrades);
  const setResults = useTCAStore((s) => s.setResults);
  const setAllEnrichment        = useTCAStore((s) => s.setAllEnrichment);
  const setSingleOrderFetchWindow = useTCAStore((s) => s.setSingleOrderFetchWindow);
  const symbolMapDirty = useTCAStore((s) => s.symbolMapDirty);
  const setSymbolMapDirty = useTCAStore((s) => s.setSymbolMapDirty);
  const reset = useTCAStore((s) => s.reset);

  const symbolMap = useSymbolMap();
  const singleOrderTimeOverride = useTCAStore((s) => s.singleOrderTimeOverride);
  const singleOrderBbgSymbol    = useTCAStore((s) => s.singleOrderBbgSymbol);
  const [enrichProgress, setEnrichProgress] = useState<EnrichProgress | null>(null);

  // Holds parsed trades awaiting wizard configuration in multi-order mode.
  // null = wizard not shown; non-null = wizard shown with these trades.
  const [wizardTrades, setWizardTrades] = useState<TradeRecord[] | null>(null);

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
    // Single order: if the user typed a Bloomberg symbol override on the page, use it as a
    // constant resolver (ignores the RIC from the file).  Otherwise fall back to the symbol
    // mapping table — same as multi-order mode.
    const soSymbol = singleOrderBbgSymbol?.trim();
    const singleOrderResolver = soSymbol ? () => soSymbol : symbolMap.resolve;

    const result = mode === "single"
      ? await enrichSingleOrder(rawTrades, setEnrichProgress, singleOrderResolver, singleOrderTimeOverride ?? undefined)
      : await enrichAllTrades(rawTrades, setEnrichProgress, symbolMap.resolve);
    setAllEnrichment(result);
    // Record the exact time window used for this fetch so the stale indicator
    // can accurately detect when the override has moved outside the fetched range.
    if (mode === "single") {
      const fetchStart = singleOrderTimeOverride?.start
        ?? new Date(Math.min(...rawTrades.map((t) => t.orderTime.getTime())));
      const fetchEnd   = singleOrderTimeOverride?.end
        ?? new Date(Math.max(...rawTrades.map((t) => t.lastFillTime.getTime())));
      setSingleOrderFetchWindow({ start: fetchStart, end: fetchEnd });
    }
    // Data now reflects the current mappings — clear the refresh prompt.
    setSymbolMapDirty(false);
    setEnrichProgress(null);
  }

  const enrichedCount = Object.keys(enrichment).length;

  /** FileDropZone callback: single-order → straight to store; multi → open wizard. */
  function handleFileComplete(trades: TradeRecord[]) {
    if (mode === "multi") {
      setWizardTrades(trades);
    } else {
      setRawTrades(trades);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <Header />

      {/* ── Refresh prompt after symbol mappings change ───────────────────── */}
      {symbolMapDirty && rawTrades.length > 0 && wizardTrades === null && (
        <SymbolRefreshBanner
          onRefresh={() => { void handleFetchBloomberg(); }}
          onDismiss={() => setSymbolMapDirty(false)}
          disabled={!bloombergConnected || enrichProgress !== null}
          busy={enrichProgress !== null}
          notConnected={!bloombergConnected}
        />
      )}

      {/* ── Import wizard (multi-order mode only) ─────────────────────────── */}
      {wizardTrades !== null ? (
        <main className="flex-1 overflow-auto flex flex-col items-center py-8 px-4">
          <ImportWizardMulti
            trades={wizardTrades}
            onComplete={(transformed) => {
              setWizardTrades(null);
              setRawTrades(transformed);
            }}
            onCancel={() => setWizardTrades(null)}
          />
        </main>
      ) : rawTrades.length === 0 ? (
        <main className="flex-1 flex flex-col items-center justify-center p-8 gap-6">
          <ModeSelector />
          <FileDropZone onComplete={handleFileComplete} mode={mode} />
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

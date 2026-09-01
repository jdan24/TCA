import { useEffect, useMemo, useState } from "react";
import { enrichAllTrades, enrichSingleOrder, type EnrichProgress } from "@/bloomberg/enrichmentService";
import { enrichSettleBenchmarks } from "@/bloomberg/settleService";
import { fetchFxRates } from "@/bloomberg/fxService";
import { toMajorCurrency } from "@/tca/dollars";
import { Header } from "@/components/layout/Header";
import { SymbolRefreshBanner } from "@/components/layout/SymbolRefreshBanner";
import { FileDropZone } from "@/components/upload/FileDropZone";
import { ImportWizardMulti } from "@/components/upload/ImportWizardMulti";
import { ModeSelector } from "@/components/upload/ModeSelector";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { SingleOrderDashboard } from "@/components/dashboard/single/SingleOrderDashboard";
import { SettleDashboard } from "@/components/dashboard/settle/SettleDashboard";
import { useSymbolMap } from "@/hooks/useSymbolMap";
import { CorporateTemplateProvider } from "@/hooks/useCorporateTemplate";
import { useTCAStore } from "@/store/useTCAStore";
import { computeAll } from "@/tca/compute";
import { buildPointValueResolver, buildPriceScaleResolver } from "@/tca/pointValue";
import { parseSymbolMapCsvText } from "@/parsers/symbolMapCsv";
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
  const settleBenchmarks  = useTCAStore((s) => s.settleBenchmarks);
  const setSettleData     = useTCAStore((s) => s.setSettleData);
  const setFxRates        = useTCAStore((s) => s.setFxRates);
  const settleTolerance   = useTCAStore((s) => s.settleTolerance);
  const symbolMapDirty = useTCAStore((s) => s.symbolMapDirty);
  const setSymbolMapDirty = useTCAStore((s) => s.setSymbolMapDirty);
  const reset = useTCAStore((s) => s.reset);

  const symbolMap = useSymbolMap();

  // Fetch the privileged sym_mapping.csv from bridge on startup.
  // Uses "base" strategy so existing user mappings always win on conflict.
  useEffect(() => {
    async function loadBaseSymbolMap() {
      try {
        const res = await fetch("http://localhost:8000/branding/sym-mapping");
        if (!res.ok) return;
        const { csv } = await res.json() as { csv: string };
        const { mappings } = await parseSymbolMapCsvText(csv);
        if (mappings.length > 0) symbolMap.importMappings(mappings, "base");
      } catch {
        // Bridge offline or zip missing sym_mapping.csv — silent no-op
      }
    }
    void loadBaseSymbolMap();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const singleOrderTimeOverride = useTCAStore((s) => s.singleOrderTimeOverride);
  const singleOrderBbgSymbol    = useTCAStore((s) => s.singleOrderBbgSymbol);
  const [enrichProgress, setEnrichProgress] = useState<EnrichProgress | null>(null);

  // Holds parsed trades awaiting wizard configuration in multi-order mode.
  // null = wizard not shown; non-null = wizard shown with these trades.
  const [wizardTrades, setWizardTrades] = useState<TradeRecord[] | null>(null);

  // ── Price multiplier, applied as a derived layer ──────────────────────────
  // The multiplier lives in the symbol map and is applied here rather than
  // baked into the records at import time, so changing it in the Symbols table
  // re-prices the loaded report on the spot — no Bloomberg re-fetch required.
  //
  // Every file-sourced price scales together; Bloomberg's own prices never do.
  // Scaling a fill without its arrival price would manufacture slippage.
  //
  // Single-order mode is excluded: SingleOrderDashboard already applies its own
  // singleOrderPriceScale, and scaling here too would square the multiplier.
  const scaledTrades = useMemo(() => {
    if (mode === "single") return rawTrades;
    const scaleFor = buildPriceScaleResolver(symbolMap.mappings);
    return rawTrades.map((t) => {
      const k = scaleFor(t.symbol);
      if (k === 1) return t;
      return {
        ...t,
        avgFillPrice: t.avgFillPrice * k,
        arrivalPrice: t.arrivalPrice !== null ? t.arrivalPrice * k : null,
        fileVwap:     t.fileVwap     !== null ? t.fileVwap     * k : null,
        fileTwap:     t.fileTwap     !== null ? t.fileTwap     * k : null,
      };
    });
  }, [rawTrades, symbolMap.mappings, mode]);

  // Re-run TCA metrics whenever trades, Bloomberg enrichment, or the symbol
  // mappings change — the mappings carry the manual point-value overrides that
  // the cash slippage figures depend on, and the price multiplier above.
  useEffect(() => {
    if (scaledTrades.length > 0) {
      const pointValueFor = buildPointValueResolver(symbolMap.mappings, scaledTrades, enrichment);
      setResults(computeAll(scaledTrades, enrichment, pointValueFor));
    }
  }, [scaledTrades, enrichment, symbolMap.mappings, setResults]);

  /**
   * Pull a USD rate for every currency the report touches.
   *
   * Run after enrichment rather than alongside it: the contract's currency comes
   * from Bloomberg's CRNCY, so which rates are needed is not known until the
   * reference data is in. The file's own currency column is included as well,
   * since it is what the display falls back to when Bloomberg says nothing.
   *
   * Failures are silent by design — a missing rate shows the figure natively and
   * marked, which is the same outcome as never having fetched.
   */
  async function refreshFxRates(currencies: Iterable<string>) {
    const rates = await fetchFxRates(currencies);
    setFxRates(rates);
  }

  async function handleFetchSettle() {
    if (rawTrades.length === 0 || !bloombergConnected || enrichProgress !== null) return;
    setEnrichProgress({ done: 0, total: 1 });
    const { benchmarks, reference } = await enrichSettleBenchmarks(
      scaledTrades,
      settleTolerance,
      symbolMap.resolve,
      setEnrichProgress,
    );
    setSettleData(benchmarks, reference);
    await refreshFxRates([
      ...Object.values(reference).map((r) => toMajorCurrency(r["CRNCY"]) ?? ""),
      ...scaledTrades.map((t) => t.currency),
    ]);
    setSymbolMapDirty(false);
    setEnrichProgress(null);
  }

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
      // Scaled, not raw: enrichOneTrade falls back to avgFillPrice for the
      // reversion marks, and a fallback in the wrong price scale would show up
      // as reversion that never happened.
      : await enrichAllTrades(scaledTrades, setEnrichProgress, symbolMap.resolve);
    setAllEnrichment(result);
    await refreshFxRates([
      ...Object.values(result).map((e) => e.currency ?? ""),
      ...scaledTrades.map((t) => t.currency),
    ]);
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

  /**
   * FileDropZone callback: single-order goes straight to the store; the two
   * portfolio modes open the import wizard first.
   *
   * Settle mode needs the wizard as much as multi does — resolving RICs to
   * Bloomberg tickers is what makes the settle lookup possible at all.
   */
  function handleFileComplete(trades: TradeRecord[]) {
    if (mode === "multi" || mode === "settle") {
      setWizardTrades(trades);
    } else {
      setRawTrades(trades);
    }
  }

  return (
    <CorporateTemplateProvider>
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <Header />

      {/* ── Refresh prompt after symbol mappings change ───────────────────── */}
      {symbolMapDirty && rawTrades.length > 0 && wizardTrades === null && (
        <SymbolRefreshBanner
          onRefresh={() => {
            void (mode === "settle" ? handleFetchSettle() : handleFetchBloomberg());
          }}
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
      ) : mode === "settle" ? (
        <main className="flex-1 overflow-auto">
          <SettleDashboard
            trades={scaledTrades}
            bloombergConnected={bloombergConnected}
            benchmarkCount={Object.keys(settleBenchmarks).length}
            progress={enrichProgress}
            onFetch={() => { void handleFetchSettle(); }}
            onReset={reset}
          />
        </main>
      ) : mode === "single" ? (
        <main className="flex-1 overflow-auto">
          <SingleOrderDashboard
            trades={rawTrades}
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
            trades={scaledTrades}
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
    </CorporateTemplateProvider>
  );
}

export default App;

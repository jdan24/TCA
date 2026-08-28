/**
 * useChartAlgoFilter — per-chart algo selection for the multi-order charts.
 *
 * The FilterBar's Algo control narrows the whole dashboard; this narrows further
 * within one chart, so you can isolate VWAP orders in the VWAP Deviation plot
 * while leaving the others showing everything. Each chart keeps its own
 * selection, stored under its own key.
 *
 * What is persisted is the set of *excluded* algos, not the selected ones. Algo
 * names come from whatever file is loaded, so a stored "selected" list would
 * silently hide any algo the next file introduces. Recording exclusions means an
 * unfamiliar algo always plots.
 */

import { useCallback, useMemo, useState } from "react";
import type { TradeRecord } from "@/types";

/**
 * Stand-in key for orders whose algo column is blank.
 *
 * The leading U+0001 is written as an escape deliberately: a control character
 * cannot appear in an algo name from a spreadsheet or a FIX message, so this can
 * never collide with a real value the way a plain "(no algo)" could. It is only
 * ever a lookup key -- algoLabel() is what reaches the screen.
 */
export const NO_ALGO = "\u0001no-algo";

/** Label shown for the sentinel. */
export function algoLabel(algo: string): string {
  return algo === NO_ALGO ? "(no algo)" : algo;
}

const KEY_PREFIX = "tca_chart_algos_v1:";

function loadExcluded(chartId: string): string[] {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + chartId);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function saveExcluded(chartId: string, excluded: string[]): void {
  try {
    localStorage.setItem(KEY_PREFIX + chartId, JSON.stringify(excluded));
  } catch {
    // localStorage unavailable (private browsing) — the setting just won't persist
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────
// Exported so the selection logic can be exercised directly rather than only
// through a rendered component.

/** The filter key for a trade: its algo, or the blank sentinel. */
export function algoKeyOf(trade: TradeRecord): string {
  return trade.algo === null || trade.algo === "" ? NO_ALGO : trade.algo;
}

/** Every algo present in the data, sorted, with NO_ALGO last when it applies. */
export function deriveAlgoOptions(trades: TradeRecord[]): string[] {
  const named = new Set<string>();
  let hasBlank = false;
  for (const t of trades) {
    if (t.algo === null || t.algo === "") hasBlank = true;
    else named.add(t.algo);
  }
  const sorted = [...named].sort();
  return hasBlank ? [...sorted, NO_ALGO] : sorted;
}

/**
 * The exclusion list to store after a selection change.
 *
 * Exclusions for algos absent from the current dataset are carried through
 * untouched, so switching files and switching back restores the choice rather
 * than quietly discarding it.
 */
export function nextExcluded(
  options: string[],
  currentExcluded: string[],
  nextSelected: string[],
): string[] {
  const keep = new Set(nextSelected);
  return [
    ...options.filter((o) => !keep.has(o)),
    ...currentExcluded.filter((e) => !options.includes(e)),
  ];
}

export interface ChartAlgoFilter {
  /** Every algo present in the data, sorted, with NO_ALGO last when it applies. */
  options: string[];
  /** The subset currently plotted, in the same order as options. */
  selected: string[];
  setSelected: (next: string[]) => void;
  /** True when this trade's algo is currently plotted. */
  includes: (trade: TradeRecord) => boolean;
  /** False when everything is selected — lets the control show it is inactive. */
  isNarrowed: boolean;
}

export function useChartAlgoFilter(
  chartId: string,
  trades: TradeRecord[],
): ChartAlgoFilter {
  const [excluded, setExcluded] = useState<string[]>(() => loadExcluded(chartId));

  const options = useMemo(() => deriveAlgoOptions(trades), [trades]);

  const excludedSet = useMemo(() => new Set(excluded), [excluded]);
  const selected = useMemo(
    () => options.filter((o) => !excludedSet.has(o)),
    [options, excludedSet],
  );

  const setSelected = useCallback(
    (next: string[]) => {
      const stillExcluded = nextExcluded(options, excluded, next);
      setExcluded(stillExcluded);
      saveExcluded(chartId, stillExcluded);
    },
    [chartId, options, excluded],
  );

  const includes = useCallback(
    (trade: TradeRecord) => !excludedSet.has(algoKeyOf(trade)),
    [excludedSet],
  );

  return {
    options,
    selected,
    setSelected,
    includes,
    isNarrowed: selected.length !== options.length,
  };
}

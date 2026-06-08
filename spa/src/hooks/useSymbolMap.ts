/**
 * useSymbolMap — localStorage-persisted RIC → Bloomberg symbol mapping.
 *
 * Provides CRUD operations and a resolve() helper used by the enrichment
 * service to translate RIC codes to Bloomberg "ticker yellowKey" format
 * before making API calls.
 *
 * The mappings live in a single module-level store shared by every
 * useSymbolMap() caller (via useSyncExternalStore). This matters because the
 * mapping modal and App's Bloomberg fetch are different component instances:
 * with per-instance useState, a change made in the modal was invisible to the
 * fetch, so the API kept resolving the original (unmapped) symbol. The shared
 * store guarantees every consumer — including the resolver used at fetch time —
 * sees the latest mappings.
 *
 * Storage key: "tca_symbol_map_v1"
 * Format:      JSON array of SymbolMapping objects
 */

import { useCallback, useSyncExternalStore } from "react";
import type { SymbolMapping } from "@/types";

const STORAGE_KEY = "tca_symbol_map_v1";

function load(): SymbolMapping[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as SymbolMapping[]) : [];
  } catch {
    return [];
  }
}

// ── Shared module-level store ─────────────────────────────────────────────────

let store: SymbolMapping[] = load();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Write the new mappings to localStorage and notify all subscribers. */
function persist(next: SymbolMapping[]): void {
  store = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage may be full or unavailable (private browsing); ignore
  }
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): SymbolMapping[] {
  return store;
}

// Keep multiple browser tabs/windows in sync.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) {
      store = load();
      emit();
    }
  });
}

export interface UseSymbolMapReturn {
  mappings: SymbolMapping[];
  addMapping: (m: SymbolMapping) => void;
  updateMapping: (ric: string, patch: Partial<SymbolMapping>) => void;
  deleteMapping: (ric: string) => void;
  /**
   * Bulk-import mappings.
   *  - "replace": discard the current table and keep only the imported rows.
   *  - "merge":   keep existing rows; imported rows win on RIC conflicts.
   *  - "base":    like merge but existing user mappings win — incoming only fills gaps.
   * Returns the resulting row count.
   */
  importMappings: (incoming: SymbolMapping[], strategy: "replace" | "merge" | "base") => number;
  /** Translate a RIC to "bbgTicker bbgYellowKey", or return the raw value if unmapped. */
  resolve: (ric: string) => string;
}

export function useSymbolMap(): UseSymbolMapReturn {
  const mappings = useSyncExternalStore(subscribe, getSnapshot);

  // All mutators read from the module-level `store` (always current), so they
  // are stable across renders and never operate on a stale snapshot.
  const addMapping = useCallback((m: SymbolMapping) => {
    persist([...store.filter((x) => x.ric !== m.ric), m]);
  }, []);

  const updateMapping = useCallback((ric: string, patch: Partial<SymbolMapping>) => {
    persist(store.map((m) => (m.ric === ric ? { ...m, ...patch } : m)));
  }, []);

  const deleteMapping = useCallback((ric: string) => {
    persist(store.filter((m) => m.ric !== ric));
  }, []);

  const importMappings = useCallback(
    (incoming: SymbolMapping[], strategy: "replace" | "merge" | "base"): number => {
      // Dedupe the incoming rows by RIC (last occurrence wins).
      const incomingByRic = new Map<string, SymbolMapping>();
      for (const m of incoming) incomingByRic.set(m.ric, m);

      let next: SymbolMapping[];
      if (strategy === "replace") {
        next = [...incomingByRic.values()];
      } else if (strategy === "merge") {
        // Additive: start from existing, then overlay imported rows (incoming wins).
        const merged = new Map<string, SymbolMapping>();
        for (const m of store) merged.set(m.ric, m);
        for (const [ric, m] of incomingByRic) merged.set(ric, m);
        next = [...merged.values()];
      } else {
        // "base": incoming only fills gaps — existing user mappings always win.
        const merged = new Map<string, SymbolMapping>();
        for (const m of store) merged.set(m.ric, m);
        for (const [ric, m] of incomingByRic) {
          if (!merged.has(ric)) merged.set(ric, m);
        }
        next = [...merged.values()];
      }
      persist(next);
      return next.length;
    },
    [],
  );

  // Reads `store` directly so it is always current; `mappings` is in the dep
  // list so memoised consumers re-run when the mappings change.
  const resolve = useCallback(
    (ric: string): string => {
      const m = store.find((x) => x.ric === ric);
      if (!m) return ric;
      const ticker = m.bbgTicker.trim();
      const key = m.bbgYellowKey.trim();
      return ticker && key ? `${ticker} ${key}` : ric;
    },
    [mappings],
  );

  return { mappings, addMapping, updateMapping, deleteMapping, importMappings, resolve };
}

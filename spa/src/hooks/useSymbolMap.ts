/**
 * useSymbolMap — localStorage-persisted RIC → Bloomberg symbol mapping.
 *
 * Provides CRUD operations and a resolve() helper used by the enrichment
 * service to translate RIC codes to Bloomberg "ticker yellowKey" format
 * before making API calls.
 *
 * Storage key: "tca_symbol_map_v1"
 * Format:      JSON array of SymbolMapping objects
 */

import { useState, useCallback } from "react";
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

function save(mappings: SymbolMapping[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mappings));
  } catch {
    // localStorage may be full or unavailable (private browsing); ignore
  }
}

export interface UseSymbolMapReturn {
  mappings: SymbolMapping[];
  addMapping: (m: SymbolMapping) => void;
  updateMapping: (ric: string, patch: Partial<SymbolMapping>) => void;
  deleteMapping: (ric: string) => void;
  /**
   * Bulk-import mappings from a CSV.
   *  - "replace": discard the current table and keep only the imported rows.
   *  - "merge":   keep existing rows; imported rows win on RIC conflicts (additive).
   * Returns the resulting row count.
   */
  importMappings: (incoming: SymbolMapping[], strategy: "replace" | "merge") => number;
  /** Translate a RIC to "bbgTicker bbgYellowKey", or return the raw value if unmapped. */
  resolve: (ric: string) => string;
}

export function useSymbolMap(): UseSymbolMapReturn {
  const [mappings, setMappings] = useState<SymbolMapping[]>(load);

  const persist = useCallback((next: SymbolMapping[]) => {
    save(next);
    setMappings(next);
  }, []);

  const addMapping = useCallback(
    (m: SymbolMapping) => {
      persist([...mappings.filter((x) => x.ric !== m.ric), m]);
    },
    [mappings, persist],
  );

  const updateMapping = useCallback(
    (ric: string, patch: Partial<SymbolMapping>) => {
      persist(mappings.map((m) => (m.ric === ric ? { ...m, ...patch } : m)));
    },
    [mappings, persist],
  );

  const deleteMapping = useCallback(
    (ric: string) => {
      persist(mappings.filter((m) => m.ric !== ric));
    },
    [mappings, persist],
  );

  const importMappings = useCallback(
    (incoming: SymbolMapping[], strategy: "replace" | "merge"): number => {
      // Dedupe the incoming rows by RIC (last occurrence wins).
      const incomingByRic = new Map<string, SymbolMapping>();
      for (const m of incoming) incomingByRic.set(m.ric, m);

      let next: SymbolMapping[];
      if (strategy === "replace") {
        next = [...incomingByRic.values()];
      } else {
        // Additive: start from existing, then overlay imported rows (CSV wins).
        const merged = new Map<string, SymbolMapping>();
        for (const m of mappings) merged.set(m.ric, m);
        for (const [ric, m] of incomingByRic) merged.set(ric, m);
        next = [...merged.values()];
      }
      persist(next);
      return next.length;
    },
    [mappings, persist],
  );

  const resolve = useCallback(
    (ric: string): string => {
      const m = mappings.find((x) => x.ric === ric);
      if (!m) return ric;
      const ticker = m.bbgTicker.trim();
      const key = m.bbgYellowKey.trim();
      return ticker && key ? `${ticker} ${key}` : ric;
    },
    [mappings],
  );

  return { mappings, addMapping, updateMapping, deleteMapping, importMappings, resolve };
}

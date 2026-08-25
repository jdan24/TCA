/**
 * useAlgoMap — localStorage-persisted algo name → benchmark mapping.
 *
 * Multi-order files carry the algo as free text ("VWAP 10%", "Twap-Aggressive"),
 * so there is no reliable way to guess which benchmark an order should be judged
 * against. This table makes it explicit, and drives the Total Cost tile: each
 * order contributes its slippage against the benchmark its algo maps to.
 *
 * Mirrors useSymbolMap's shared module-level store + useSyncExternalStore, for
 * the same reason: the settings modal and the dashboard are different component
 * instances and must see the same data.
 *
 * The table is seeded with the algos the single-order view already offers, so it
 * is correct before anyone opens it. Seeding happens only when storage is empty,
 * so deleting a default row sticks.
 *
 * Storage key: "tca_algo_map_v1"
 */

import { useCallback, useSyncExternalStore } from "react";
import type { AlgoMapping, BenchmarkKind } from "@/types";

const STORAGE_KEY = "tca_algo_map_v1";

/**
 * Algos offered by the single-order picker. TWAP and VWAP have their own market
 * benchmarks; the rest are arrival-price strategies.
 */
export const DEFAULT_ALGO_MAPPINGS: AlgoMapping[] = [
  { algo: "TWAP",    benchmark: "twap" },
  { algo: "VWAP",    benchmark: "vwap" },
  { algo: "POV",     benchmark: "arrival" },
  { algo: "Pegger",  benchmark: "arrival" },
  { algo: "Sniper",  benchmark: "arrival" },
  { algo: "ArtemIS", benchmark: "arrival" },
  { algo: "Apollo",  benchmark: "arrival" },
];

/** Benchmark used for an algo with no entry in the table. */
export const FALLBACK_BENCHMARK: BenchmarkKind = "arrival";

function load(): AlgoMapping[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [...DEFAULT_ALGO_MAPPINGS]; // never seen before — seed
    const parsed = JSON.parse(raw) as unknown;
    // An explicitly emptied table is a valid state, not a reason to re-seed.
    return Array.isArray(parsed) ? (parsed as AlgoMapping[]) : [...DEFAULT_ALGO_MAPPINGS];
  } catch {
    return [...DEFAULT_ALGO_MAPPINGS];
  }
}

// ── Shared module-level store ─────────────────────────────────────────────────

let store: AlgoMapping[] = load();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function persist(next: AlgoMapping[]): void {
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

function getSnapshot(): AlgoMapping[] {
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

/**
 * Which benchmark an algo name maps to. Matching is case-insensitive and
 * whitespace-trimmed but otherwise exact — a name absent from the table (or a
 * blank algo) falls back to arrival, matching how the single-order view has
 * always treated everything that is not TWAP or VWAP.
 *
 * Exported standalone so non-component code can call it; components should use
 * the hook so they re-render when the table changes.
 */
export function resolveBenchmark(algo: string | null | undefined): BenchmarkKind {
  const key = (algo ?? "").trim().toLowerCase();
  if (!key) return FALLBACK_BENCHMARK;
  const hit = store.find((m) => m.algo.trim().toLowerCase() === key);
  return hit ? hit.benchmark : FALLBACK_BENCHMARK;
}

export interface UseAlgoMapReturn {
  mappings: AlgoMapping[];
  addMapping: (m: AlgoMapping) => void;
  updateMapping: (algo: string, patch: Partial<AlgoMapping>) => void;
  deleteMapping: (algo: string) => void;
  resetToDefaults: () => void;
  /** Benchmark for an algo name; re-created when the table changes. */
  resolve: (algo: string | null | undefined) => BenchmarkKind;
}

export function useAlgoMap(): UseAlgoMapReturn {
  const mappings = useSyncExternalStore(subscribe, getSnapshot);

  // Mutators read the module-level `store` so they are stable across renders
  // and never act on a stale snapshot.
  const addMapping = useCallback((m: AlgoMapping) => {
    const key = m.algo.trim().toLowerCase();
    persist([...store.filter((x) => x.algo.trim().toLowerCase() !== key), m]);
  }, []);

  const updateMapping = useCallback((algo: string, patch: Partial<AlgoMapping>) => {
    const key = algo.trim().toLowerCase();
    persist(store.map((m) => (m.algo.trim().toLowerCase() === key ? { ...m, ...patch } : m)));
  }, []);

  const deleteMapping = useCallback((algo: string) => {
    const key = algo.trim().toLowerCase();
    persist(store.filter((m) => m.algo.trim().toLowerCase() !== key));
  }, []);

  const resetToDefaults = useCallback(() => {
    persist([...DEFAULT_ALGO_MAPPINGS]);
  }, []);

  // `mappings` in the dep list so memoised consumers re-run on change.
  const resolve = useCallback(
    (algo: string | null | undefined) => resolveBenchmark(algo),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mappings],
  );

  return { mappings, addMapping, updateMapping, deleteMapping, resetToDefaults, resolve };
}

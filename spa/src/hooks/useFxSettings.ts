/**
 * useFxSettings — the global display currency and the manual FX rate overrides.
 *
 * Both live in one module-level store shared by every caller, for the same
 * reason useSymbolMap does: the toggle lives in the header, the overrides in the
 * Symbols modal, and the figures they govern are rendered by a dozen unrelated
 * components. Per-instance state would let those disagree.
 *
 * Overrides are keyed by major ISO code rather than by contract. A rate belongs
 * to a currency — every EUR product shares one EURUSD — so keying by RIC would
 * allow two rows to disagree about the same rate and leave the report with no
 * single number to disclose.
 *
 * Storage keys: "tca_fx_display_v1", "tca_fx_overrides_v1"
 */

import { useCallback, useSyncExternalStore } from "react";
import type { DisplayCurrency } from "@/tca/fx";

const DISPLAY_KEY = "tca_fx_display_v1";
const OVERRIDES_KEY = "tca_fx_overrides_v1";

interface FxSettings {
  display: DisplayCurrency;
  /** USD per one major unit, keyed by major ISO code. */
  overrides: Record<string, number>;
}

function loadDisplay(): DisplayCurrency {
  try {
    // Native is the default: it is the mode that invents nothing, and it is what
    // the app did before FX existed.
    return localStorage.getItem(DISPLAY_KEY) === "usd" ? "usd" : "native";
  } catch {
    return "native";
  }
}

function loadOverrides(): Record<string, number> {
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && isFinite(v) && v > 0) out[k.toUpperCase()] = v;
    }
    return out;
  } catch {
    return {};
  }
}

// ── Shared module-level store ─────────────────────────────────────────────────

let store: FxSettings = { display: loadDisplay(), overrides: loadOverrides() };
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): FxSettings {
  return store;
}

function persist(next: FxSettings): void {
  store = next;
  try {
    localStorage.setItem(DISPLAY_KEY, next.display);
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(next.overrides));
  } catch {
    // localStorage unavailable (private browsing) — the setting just won't persist
  }
  emit();
}

/** Read the display currency outside React — used by non-component code. */
export function currentDisplayCurrency(): DisplayCurrency {
  return store.display;
}

/** Read the overrides outside React — used when merging a fresh fetch. */
export function currentFxOverrides(): Record<string, number> {
  return store.overrides;
}

export interface UseFxSettingsReturn {
  display: DisplayCurrency;
  setDisplay: (d: DisplayCurrency) => void;
  overrides: Record<string, number>;
  /** Pass null to clear an override and fall back to Bloomberg's rate. */
  setOverride: (ccy: string, rate: number | null) => void;
}

export function useFxSettings(): UseFxSettingsReturn {
  const settings = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setDisplay = useCallback((display: DisplayCurrency) => {
    persist({ ...store, display });
  }, []);

  const setOverride = useCallback((ccy: string, rate: number | null) => {
    const code = ccy.trim().toUpperCase();
    if (code === "") return;
    const overrides = { ...store.overrides };
    // A blank or unusable entry clears rather than storing a rate that would
    // zero out or flip the sign of every figure it touched.
    if (rate === null || !isFinite(rate) || rate <= 0) delete overrides[code];
    else overrides[code] = rate;
    persist({ ...store, overrides });
  }, []);

  return {
    display: settings.display,
    setDisplay,
    overrides: settings.overrides,
    setOverride,
  };
}

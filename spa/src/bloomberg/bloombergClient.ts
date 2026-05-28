// TODO Phase 4 — fetch() calls to the local Bloomberg FastAPI bridge
// Bridge runs at http://localhost:8000 — no proxy needed (same-machine deployment)
// All functions return null/false gracefully when the bridge is unreachable

const BRIDGE_BASE = "http://localhost:8000";

/** Ping /health — returns true if the bridge is up. */
export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BRIDGE_BASE}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** GET /snapshot — arrival prices and reference data for a set of securities. */
export async function fetchSnapshot(
  _securities: string[],
  _fields: string[]
): Promise<Record<string, Record<string, unknown>>> {
  return {};
}

/** GET /intraday-bars — VWAP, reversion marks, vol, ADV. */
export async function fetchIntradayBars(
  _security: string,
  _start: string,
  _end: string,
  _intervalMinutes: number
): Promise<unknown[]> {
  return [];
}

/** GET /reference — contract multiplier, currency, ADV. */
export async function fetchReference(
  _security: string,
  _fields: string[]
): Promise<Record<string, unknown>> {
  return {};
}

/** GET /bid-ask-ticks — timestamped bid/ask pairs for TWAS calculation. */
export async function fetchBidAskTicks(
  _security: string,
  _start: string,
  _end: string
): Promise<Array<{ time: string; bid: number; ask: number }>> {
  return [];
}

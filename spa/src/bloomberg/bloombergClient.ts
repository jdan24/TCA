/**
 * Bloomberg Bridge HTTP client.
 *
 * Thin, typed wrappers around the FastAPI bridge running at localhost:8000.
 * Every function returns a safe empty/null value instead of throwing when the
 * bridge is unreachable — callers treat missing data as N/A in the dashboard.
 *
 * Bridge endpoints:
 *   GET /health            → { status: "ok", blpapi: boolean }
 *   GET /snapshot          → { arrivalPrice: number }
 *   GET /intraday-bars     → IntradayBar[]
 *   GET /reference         → Record<string, unknown>
 *   GET /bid-ask-ticks     → BridgeTick[]
 */

import type { IntradayBar } from "@/types";

const BRIDGE_BASE = "http://localhost:8000";

/** Matches the bridge's _drain timeout (15 s). Add a small buffer. */
const TIMEOUT_MS = 17_000;

// ── Response shapes (mirror the Python bridge) ────────────────────────────────

// IntradayBar is defined in @/types and re-exported here for consumers that
// import it from this module (backwards-compatible).
export type { IntradayBar } from "@/types";

/** A paired bid/ask quote as returned by the bridge. */
export interface BridgeTick {
  /** ISO-8601 string (UTC implied). */
  time: string;
  bid: number;
  ask: number;
}

/** A last-traded price/size tick as returned by the bridge /trade-ticks endpoint. */
export interface BridgeTradeTick {
  /** ISO-8601 string (UTC implied). */
  time: string;
  price: number;
  size: number;
}

// ── Internal fetch helper ─────────────────────────────────────────────────────

async function bridgeGet<T>(
  path: string,
  params: Record<string, string>,
  fallback: T,
  timeoutMs = TIMEOUT_MS,
): Promise<T> {
  try {
    const url = new URL(`${BRIDGE_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Ping /health.
 * Returns true only when the bridge is up AND blpapi is installed.
 */
export async function checkHealth(): Promise<boolean> {
  type HealthResp = { status: string; blpapi: boolean };
  const data = await bridgeGet<HealthResp>(
    "/health",
    {},
    { status: "", blpapi: false },
    2_000, // short timeout for status badge
  );
  return data.status === "ok" && data.blpapi;
}

/**
 * GET /snapshot — arrival price at a specific datetime.
 *
 * The bridge tries tick-level bid/ask mid first, falls back to the 1-minute
 * bar open if ticks are unavailable.
 *
 * @param security  Bare ticker, e.g. "ESH4"
 * @param dt        ISO-8601 UTC string, e.g. "2024-03-15T09:30:00.000Z"
 */
export async function fetchArrivalPrice(
  security: string,
  dt: string,
): Promise<number | null> {
  type Resp = { arrivalPrice: number };
  const data = await bridgeGet<Resp | null>(
    "/snapshot",
    { security, dt },
    null,
  );
  return typeof data?.arrivalPrice === "number" ? data.arrivalPrice : null;
}

/**
 * GET /intraday-bars — OHLCV bars over [start, end].
 *
 * @param security         Bare ticker, e.g. "ESH4"
 * @param start            ISO-8601 UTC string
 * @param end              ISO-8601 UTC string
 * @param intervalMinutes  Bar size in minutes (default 1)
 */
export async function fetchIntradayBars(
  security: string,
  start: string,
  end: string,
  intervalMinutes: number = 1,
): Promise<IntradayBar[]> {
  return bridgeGet<IntradayBar[]>(
    "/intraday-bars",
    {
      security,
      start,
      end,
      interval: String(intervalMinutes),
    },
    [],
  );
}

/**
 * GET /reference — Bloomberg reference fields for a security.
 *
 * @param security  Bare ticker, e.g. "ESH4"
 * @param fields    Bloomberg field names; defaults match bridge default
 */
export async function fetchReference(
  security: string,
  fields: string[] = ["HIST_VOL_30D", "VOLUME_AVG_30D", "FUT_CONT_SIZE", "CRNCY"],
): Promise<Record<string, unknown>> {
  return bridgeGet<Record<string, unknown>>(
    "/reference",
    { security, fields: fields.join(",") },
    {},
  );
}

/**
 * GET /bid-ask-ticks — chronological bid/ask pairs over [start, end].
 *
 * @param security  Bare ticker, e.g. "ESH4"
 * @param start     ISO-8601 UTC string
 * @param end       ISO-8601 UTC string
 */
export async function fetchBidAskTicks(
  security: string,
  start: string,
  end: string,
): Promise<BridgeTick[]> {
  return bridgeGet<BridgeTick[]>(
    "/bid-ask-ticks",
    { security, start, end },
    [],
  );
}

/**
 * GET /trade-ticks — last-traded price and size ticks over [start, end].
 *
 * Used for true VWAP (Σ price×size / Σ size) on short orders (≤ 5 min).
 *
 * @param security  Bare ticker, e.g. "ESH4"
 * @param start     ISO-8601 UTC string
 * @param end       ISO-8601 UTC string
 */
export async function fetchTradeTicks(
  security: string,
  start: string,
  end: string,
): Promise<BridgeTradeTick[]> {
  return bridgeGet<BridgeTradeTick[]>(
    "/trade-ticks",
    { security, start, end },
    [],
  );
}

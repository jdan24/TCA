import { parse as dfnsParse, parseISO, isValid } from "date-fns";
import type { ColumnMapping, RawFileData, TradeRecord } from "@/types";

// ── Timestamp parsing ─────────────────────────────────────────────────────────

const FIX_TS_RE = /^\d{8}-\d{2}:\d{2}:\d{2}/;

/**
 * Parse a timestamp from any of the supported formats:
 *  - JS Date object (pass-through from XLSX cellDates)
 *  - FIX TransactTime: YYYYMMDD-HH:mm:ss[.SSS]
 *  - ISO 8601: 2024-03-15T09:30:00Z / 2024-03-15 09:30:00
 *  - Native Date constructor fallback
 */
export function parseTimestamp(value: unknown): Date {
  if (value instanceof Date) {
    if (isValid(value)) return value;
    throw new Error("Invalid Date object passed to parseTimestamp");
  }

  const s = String(value ?? "").trim();
  if (!s) throw new Error("Empty timestamp value");

  // FIX format: YYYYMMDD-HH:mm:ss[.SSS]
  if (FIX_TS_RE.test(s)) {
    // Ensure milliseconds are present: 20240315-09:30:00 → 20240315-09:30:00.000
    const datePart = s.slice(0, 8); // YYYYMMDD
    const timePart = s.slice(9, 17); // HH:mm:ss
    const msPart = s.length > 17 && s.charAt(17) === "." ? s.slice(17, 21) : ".000";
    const normalized = `${datePart}-${timePart}${msPart}`;
    const d = dfnsParse(normalized, "yyyyMMdd-HH:mm:ss.SSS", new Date());
    if (isValid(d)) return d;
  }

  // ISO 8601 (handles Z, +HH:mm offsets, and space-separated variants)
  const iso = parseISO(s.replace(" ", "T"));
  if (isValid(iso)) return iso;

  // Native constructor fallback (handles many locale-specific formats)
  const native = new Date(s);
  if (isValid(native)) return native;

  throw new Error(`Unrecognized timestamp format: "${s}"`);
}

// ── Side normalization ────────────────────────────────────────────────────────

const BUY_VALUES = new Set(["buy", "b", "1", "long", "purchase", "bid"]);

/**
 * Normalize a side string to the canonical "BUY" | "SELL" union.
 * Throws if the value cannot be recognized.
 */
export function normalizeSide(raw: string): "BUY" | "SELL" {
  const v = raw.trim().toLowerCase();
  if (BUY_VALUES.has(v)) return "BUY";
  if (v === "sell" || v === "s" || v === "2" || v === "short" || v === "offer") return "SELL";
  throw new Error(`Unrecognized side value: "${raw}" — expected Buy/Sell or 1/2`);
}

// ── Row normalization ─────────────────────────────────────────────────────────

/**
 * Apply a ColumnMapping to raw string rows and produce TradeRecord[].
 * Throws on the first row that cannot be fully parsed (includes row index in message).
 */
export function normalizeRows(data: RawFileData, mapping: ColumnMapping): TradeRecord[] {
  const trades: TradeRecord[] = [];

  for (let i = 0; i < data.rows.length; i++) {
    const row = data.rows[i];
    if (!row) continue;

    /** Pull a trimmed string from the mapped column, defaulting to "". */
    const get = (col: string | undefined): string =>
      col ? (row[col] ?? "").toString().trim() : "";

    try {
      const orderId = get(mapping.orderId) || `ROW-${i + 1}`;
      const symbol = get(mapping.symbol);
      const side = normalizeSide(get(mapping.side));
      const orderQty = parseFloat(get(mapping.orderQty));
      const avgFillPrice = parseFloat(get(mapping.avgFillPrice));

      // arrivalPrice is optional; null → Bloomberg will provide it in Phase 4
      const arrivalRaw = get(mapping.arrivalPrice);
      const arrivalPrice = arrivalRaw !== "" ? (parseFloat(arrivalRaw) || null) : null;

      const orderTime = parseTimestamp(row[mapping.orderTime]);
      const firstFillTime = parseTimestamp(row[mapping.firstFillTime]);
      const lastFillTime = parseTimestamp(row[mapping.lastFillTime]);

      const multRaw = get(mapping.contractMultiplier);
      const contractMultiplier = multRaw ? parseFloat(multRaw) || 1 : 1;

      const currRaw = get(mapping.currency);
      const currency = currRaw || "USD";

      const algoRaw = get(mapping.algo);
      const algo = algoRaw !== "" ? algoRaw : null;

      if (!symbol) throw new Error(`Symbol is blank`);
      if (isNaN(orderQty) || orderQty <= 0) throw new Error(`Invalid orderQty: "${get(mapping.orderQty)}"`);
      if (isNaN(avgFillPrice) || avgFillPrice <= 0) {
        throw new Error(`Invalid avgFillPrice: "${get(mapping.avgFillPrice)}"`);
      }

      trades.push({
        orderId,
        symbol,
        side,
        orderQty,
        avgFillPrice,
        arrivalPrice,
        orderTime,
        firstFillTime,
        lastFillTime,
        contractMultiplier,
        currency,
        algo,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Row ${i + 1}: ${msg}`);
    }
  }

  return trades;
}

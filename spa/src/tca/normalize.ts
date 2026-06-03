import { parseISO, isValid } from "date-fns";
import type { ColumnMapping, RawFileData, TradeRecord } from "@/types";

// ── Numeric parsing ───────────────────────────────────────────────────────────
//
// Many OMS exports format large numbers with comma thousands-separators
// (e.g. "1,234" or "5,500.25").  parseFloat() stops at the first comma and
// returns only the leading integer (1 or 5), silently dropping the rest.
// Strip all commas before parsing so "1,234" → 1234 and "5,500.25" → 5500.25.

export function parseNum(s: string): number {
  return parseFloat(s.replace(/,/g, ""));
}

// ── Null-sentinel detection ───────────────────────────────────────────────────
//
// Many data sources export missing values as a bare hyphen "-", double
// hyphen "--", "N/A", "null", "none", etc.  Treat all of these as empty.

const NULL_SENTINELS = new Set([
  "-", "--", "n/a", "na", "null", "none", "#n/a", "#null", "#na",
]);

function isNullSentinel(raw: string): boolean {
  return raw === "" || NULL_SENTINELS.has(raw.toLowerCase());
}

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
  // The FIX protocol specification (tag 60 TransactTime) mandates UTC.
  // We construct an explicit UTC ISO-8601 string so that the Date object
  // carries the correct UTC epoch regardless of the browser's local timezone.
  // (Using dfnsParse without a reference timezone would produce local time,
  //  shifting the order time by the browser's UTC offset — e.g. a 19:40 UTC
  //  FIX time would become 23:40 UTC on an Eastern-time machine.)
  if (FIX_TS_RE.test(s)) {
    const datePart = s.slice(0, 8); // YYYYMMDD
    const timePart = s.slice(9, 17); // HH:mm:ss
    const msPart   = s.length > 17 && s.charAt(17) === "." ? s.slice(17, 21) : ".000";
    // "20260528-19:40:00.000" → "2026-05-28T19:40:00.000Z"
    const utcIso = `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}T${timePart}${msPart}Z`;
    const d = new Date(utcIso);
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

/**
 * Like parseTimestamp but returns null instead of throwing.
 * Treats null-sentinel values ("-", "N/A", etc.) as null without attempting
 * to parse them.
 */
function tryParseTimestamp(value: unknown): Date | null {
  const s = String(value ?? "").trim();
  if (isNullSentinel(s)) return null;
  try {
    return parseTimestamp(value);
  } catch {
    return null;
  }
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

    /**
     * Pull a trimmed string from the mapped column.
     * Null sentinels ("-", "N/A", etc.) are normalised to "".
     */
    const get = (col: string | undefined): string => {
      if (!col) return "";
      const raw = (row[col] ?? "").toString().trim();
      return isNullSentinel(raw) ? "" : raw;
    };

    try {
      const orderId = get(mapping.orderId) || `ROW-${i + 1}`;
      const symbol = get(mapping.symbol);
      const side = normalizeSide(get(mapping.side));
      const orderQty = parseNum(get(mapping.orderQty));
      const avgFillPrice = parseNum(get(mapping.avgFillPrice));

      // arrivalPrice is optional; null → Bloomberg will provide it in Phase 4
      const arrivalRaw = get(mapping.arrivalPrice);
      const arrivalPrice = arrivalRaw !== "" ? (parseNum(arrivalRaw) || null) : null;

      // File-sourced VWAP/TWAP benchmarks (optional — null when column not mapped)
      const fileVwapRaw = get(mapping.fileVwap);
      const fileVwap = fileVwapRaw !== "" ? (parseNum(fileVwapRaw) || null) : null;
      const fileTwapRaw = get(mapping.fileTwap);
      const fileTwap = fileTwapRaw !== "" ? (parseNum(fileTwapRaw) || null) : null;

      // Time fields: try each independently, then cross-fill with whichever
      // values did parse.  Many data sources export missing times as "-".
      const rawOrderTime = tryParseTimestamp(row[mapping.orderTime]);
      const rawFirstFill = tryParseTimestamp(row[mapping.firstFillTime]);
      const rawLastFill  = tryParseTimestamp(row[mapping.lastFillTime]);

      // At least one must be valid to produce a usable record.
      const anyTime = rawOrderTime ?? rawFirstFill ?? rawLastFill;
      if (!anyTime) {
        throw new Error(
          "All time columns (orderTime, firstFillTime, lastFillTime) are empty or unrecognised — " +
          "at least one must contain a valid timestamp",
        );
      }

      // Fill missing fields from the nearest available time.
      const orderTime    = rawOrderTime ?? rawFirstFill ?? rawLastFill ?? anyTime;
      const firstFillTime = rawFirstFill ?? rawOrderTime ?? rawLastFill ?? anyTime;
      const lastFillTime  = rawLastFill  ?? rawFirstFill ?? rawOrderTime ?? anyTime;

      const multRaw = get(mapping.contractMultiplier);
      const contractMultiplier = multRaw ? parseNum(multRaw) || 1 : 1;

      const currRaw = get(mapping.currency);
      const currency = currRaw || "USD";

      const algoRaw = get(mapping.algo);
      const algo = algoRaw !== "" ? algoRaw : null;

      const accountIdRaw = get(mapping.accountId);
      const accountId = accountIdRaw !== "" ? accountIdRaw : null;

      const accountDescRaw = get(mapping.accountDescription);
      const accountDescription = accountDescRaw !== "" ? accountDescRaw : null;

      // Hard-required fields: skip the row rather than aborting the whole import.
      // Rows with a null sentinel ("-", "N/A", etc.) or genuinely blank values
      // in these columns cannot be analysed and are silently dropped.
      if (!symbol) continue;
      if (isNaN(orderQty) || orderQty <= 0) continue;
      if (isNaN(avgFillPrice) || avgFillPrice <= 0) continue;

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
        accountId,
        accountDescription,
        fileVwap,
        fileTwap,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Row ${i + 1}: ${msg}`);
    }
  }

  return trades;
}

import type { TradeRecord } from "@/types";
import { FIX_TAGS } from "@/types";
import { parseTimestamp, normalizeSide } from "@/tca/normalize";

// ── Types ─────────────────────────────────────────────────────────────────────

type FixMsg = Record<string, string>;

interface FillAccumulator {
  clOrdId: string;
  symbol: string;
  side: string;
  orderQty: number;
  /** All fill messages (LastQty > 0) in chronological order */
  fills: Array<{ transactTime: string; lastQty: number; lastPx: number }>;
  /** AvgPx from the message with the highest CumQty seen so far */
  bestAvgPx: number;
  bestCumQty: number;
  /** Earliest TransactTime in the group (used as orderTime) */
  earliestTime: string;
}

// ── Parser ────────────────────────────────────────────────────────────────────

/**
 * Parse one FIX message line.
 *
 * Delimiter auto-detection (per line):
 *   • SOH (ASCII 0x01) — native FIX wire format; takes precedence when present.
 *   • "|" (pipe)       — common logging/export format; used when no SOH found.
 *
 * Returns null if the line is blank or yields no tag=value pairs.
 */
function parseLine(line: string): FixMsg | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // SOH (0x01) is the canonical FIX field separator; pipe is a common text variant.
  const delim = trimmed.includes("\x01") ? "\x01" : "|";

  const msg: FixMsg = {};
  const parts = trimmed.split(delim);
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const tag = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (tag) msg[tag] = value;
  }

  return Object.keys(msg).length > 0 ? msg : null;
}

function tag(msg: FixMsg, t: number): string {
  return msg[String(t)] ?? "";
}

/** Aggregate an array of raw FIX messages into TradeRecord[]. */
function aggregate(messages: FixMsg[]): TradeRecord[] {
  const map = new Map<string, FillAccumulator>();

  for (const msg of messages) {
    // Only process Execution Reports (MsgType = 8)
    if (tag(msg, FIX_TAGS.MsgType) !== "8") continue;

    const clOrdId = tag(msg, FIX_TAGS.ClOrdID);
    if (!clOrdId) continue;

    const transactTime = tag(msg, FIX_TAGS.TransactTime);
    const lastQtyRaw = parseFloat(tag(msg, FIX_TAGS.LastQty) || "0");
    const lastPxRaw = parseFloat(tag(msg, FIX_TAGS.LastPx) || "0");
    const avgPxRaw = parseFloat(tag(msg, FIX_TAGS.AvgPx) || "0");
    const cumQtyRaw = parseFloat(tag(msg, FIX_TAGS.CumQty) || "0");

    const existing = map.get(clOrdId);

    if (!existing) {
      map.set(clOrdId, {
        clOrdId,
        symbol: tag(msg, FIX_TAGS.Symbol),
        side: tag(msg, FIX_TAGS.Side),
        orderQty: parseFloat(tag(msg, FIX_TAGS.OrderQty) || "0"),
        fills:
          lastQtyRaw > 0
            ? [{ transactTime, lastQty: lastQtyRaw, lastPx: lastPxRaw }]
            : [],
        bestAvgPx: cumQtyRaw > 0 ? avgPxRaw : 0,
        bestCumQty: cumQtyRaw,
        earliestTime: transactTime,
      });
    } else {
      // Update symbol/side/orderQty from later messages if earlier one was blank
      if (!existing.symbol) existing.symbol = tag(msg, FIX_TAGS.Symbol);
      if (!existing.side) existing.side = tag(msg, FIX_TAGS.Side);
      if (!existing.orderQty) {
        existing.orderQty = parseFloat(tag(msg, FIX_TAGS.OrderQty) || "0");
      }

      // Track earliest transact time for orderTime
      if (transactTime && transactTime < existing.earliestTime) {
        existing.earliestTime = transactTime;
      }

      // Track the fill with highest CumQty for best AvgPx
      if (cumQtyRaw > existing.bestCumQty) {
        existing.bestAvgPx = avgPxRaw;
        existing.bestCumQty = cumQtyRaw;
      }

      // Append fill if this message represents an actual fill
      if (lastQtyRaw > 0) {
        existing.fills.push({ transactTime, lastQty: lastQtyRaw, lastPx: lastPxRaw });
      }
    }
  }

  const trades: TradeRecord[] = [];

  for (const acc of map.values()) {
    if (!acc.symbol || acc.orderQty <= 0) continue;

    // Sort fills chronologically
    const sortedFills = [...acc.fills].sort((a, b) =>
      a.transactTime.localeCompare(b.transactTime)
    );

    const orderTime = safeParseDate(acc.earliestTime);
    const firstFill = sortedFills[0];
    const lastFill = sortedFills[sortedFills.length - 1];

    const firstFillTime = firstFill
      ? safeParseDate(firstFill.transactTime)
      : orderTime;
    const lastFillTime = lastFill
      ? safeParseDate(lastFill.transactTime)
      : orderTime;

    // Compute avgFillPrice from fills if AvgPx was never set (fallback: VWAP of fills)
    let avgFillPrice = acc.bestAvgPx;
    if (!avgFillPrice && sortedFills.length > 0) {
      const totalQty = sortedFills.reduce((s, f) => s + f.lastQty, 0);
      const totalNotional = sortedFills.reduce((s, f) => s + f.lastQty * f.lastPx, 0);
      avgFillPrice = totalQty > 0 ? totalNotional / totalQty : 0;
    }

    // FIX Side: 1 = Buy, 2 = Sell
    const sideRaw = acc.side === "1" ? "BUY" : acc.side === "2" ? "SELL" : acc.side;

    trades.push({
      orderId: acc.clOrdId,
      symbol: acc.symbol,
      side: normalizeSide(sideRaw),
      orderQty: acc.orderQty,
      avgFillPrice,
      arrivalPrice: null, // sourced from Bloomberg in Phase 4
      orderTime,
      firstFillTime,
      lastFillTime,
      contractMultiplier: 1, // sourced from Bloomberg reference data in Phase 4
      currency: "USD",
      algo: null,              // FIX messages do not carry algo policy info
      accountId: null,         // not present in standard FIX execution reports
      accountDescription: null,
      fileVwap: null,
      fileTwap: null,
    });
  }

  return trades;
}

function safeParseDate(s: string): Date {
  try {
    return parseTimestamp(s);
  } catch {
    return new Date();
  }
}

// ── Per-fill aggregation (Single Order / Mode 2) ─────────────────────────────

/**
 * Emit one TradeRecord per individual fill execution report.
 *
 * Used in Single Order TCA (Mode 2) so each fill becomes a separate data
 * point on the Execution Timeline, plotted at its own TransactTime (tag 60).
 *
 * Each TradeRecord:
 *   orderId        = ExecID (tag 17) when present, else ClOrdID + "_" + index
 *   orderTime      = fill's TransactTime (tag 60)
 *   firstFillTime  = same
 *   lastFillTime   = same
 *   avgFillPrice   = fill's LastPx (tag 31) — THIS fill's price, not cumulative AvgPx
 *   orderQty       = fill's LastQty (tag 32) — quantity filled in THIS execution
 */
function aggregatePerFill(messages: FixMsg[]): TradeRecord[] {
  const trades: TradeRecord[] = [];
  let fillIndex = 0;

  for (const msg of messages) {
    if (tag(msg, FIX_TAGS.MsgType) !== "8") continue;

    const lastQty = parseFloat(tag(msg, FIX_TAGS.LastQty) || "0");
    const lastPx  = parseFloat(tag(msg, FIX_TAGS.LastPx)  || "0");

    // Only process messages that represent an actual fill
    if (lastQty <= 0 || lastPx <= 0) continue;

    const clOrdId      = tag(msg, FIX_TAGS.ClOrdID);
    const execId       = tag(msg, FIX_TAGS.ExecID);
    const transactTime = tag(msg, FIX_TAGS.TransactTime);
    const symbol       = tag(msg, FIX_TAGS.Symbol);
    const sideRaw      = tag(msg, FIX_TAGS.Side);

    if (!symbol || !transactTime) continue;

    const fillTime = safeParseDate(transactTime);
    const orderId  = execId || (clOrdId ? `${clOrdId}_${fillIndex}` : `fill_${fillIndex}`);
    const sideStr  = sideRaw === "1" ? "BUY" : sideRaw === "2" ? "SELL" : sideRaw;

    try {
      trades.push({
        orderId,
        symbol,
        side: normalizeSide(sideStr),
        orderQty: lastQty,
        avgFillPrice: lastPx,
        arrivalPrice: null,
        orderTime:     fillTime,
        firstFillTime: fillTime,
        lastFillTime:  fillTime,
        contractMultiplier: 1,
        currency: "USD",
        algo: null,
        accountId: null,
        accountDescription: null,
        fileVwap: null,
        fileTwap: null,
      });
    } catch {
      // Skip fills with unrecognised side or other parse issues
    }

    fillIndex++;
  }

  return trades;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Read a pipe-delimited FIX execution report file and return TradeRecord[].
 * Filters for MsgType=8 only; aggregates multiple fills per ClOrdID.
 */
export function parseFixFile(file: File): Promise<TradeRecord[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const text = e.target?.result;
        if (typeof text !== "string") {
          reject(new Error("Failed to read FIX file as text"));
          return;
        }

        const lines = text.split(/\r?\n/);
        const messages: FixMsg[] = [];

        for (const line of lines) {
          const msg = parseLine(line);
          if (msg) messages.push(msg);
        }

        if (messages.length === 0) {
          reject(new Error("No valid FIX messages found in file"));
          return;
        }

        // Filter out individual legs of multi-leg orders.
        // Rule: keep a message if tag 442 (MultiLegReportingType) is absent OR equals "3"
        //   442 absent → plain single-leg fill → keep
        //   442 = "3"  → spread-level fill → keep
        //   442 = "1" or "2" → individual leg fill → drop
        // If NO message in the file has tag 442, nothing is filtered (backward-compatible).
        const mlrtKey = String(FIX_TAGS.MultiLegReportingType); // "442"
        const filteredMessages = messages.filter(
          (m) => !m[mlrtKey] || m[mlrtKey] === "3",
        );

        const trades = aggregate(filteredMessages);

        if (trades.length === 0) {
          reject(
            new Error(
              "No Execution Reports (MsgType=8) found. " +
                "Ensure the file contains FIX tag 35=8 messages."
            )
          );
          return;
        }

        resolve(trades);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };

    reader.onerror = () => reject(new Error("FileReader error while reading FIX file"));
    reader.readAsText(file);
  });
}

/**
 * Single Order variant — one TradeRecord per individual fill execution.
 * Each record is timestamped with tag 60 TransactTime of that specific fill.
 * Used in Mode 2 (Single Order TCA) so the Execution Timeline can plot
 * every fill as a separate point at its actual execution time.
 */
export function parseFixFileSingleOrder(file: File): Promise<TradeRecord[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const text = e.target?.result;
        if (typeof text !== "string") {
          reject(new Error("Failed to read FIX file as text"));
          return;
        }

        const lines = text.split(/\r?\n/);
        const messages: FixMsg[] = [];

        for (const line of lines) {
          const msg = parseLine(line);
          if (msg) messages.push(msg);
        }

        if (messages.length === 0) {
          reject(new Error("No valid FIX messages found in file"));
          return;
        }

        // Same multi-leg filter as parseFixFile: drop individual legs (442=1/2), keep spreads (442=3).
        const mlrtKey = String(FIX_TAGS.MultiLegReportingType);
        const filteredMessages = messages.filter(
          (m) => !m[mlrtKey] || m[mlrtKey] === "3",
        );

        const trades = aggregatePerFill(filteredMessages);

        if (trades.length === 0) {
          reject(
            new Error(
              "No fill executions (MsgType=8 with LastQty > 0) found. " +
                "Ensure the file contains FIX execution reports with tag 32 (LastQty)."
            )
          );
          return;
        }

        resolve(trades);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };

    reader.onerror = () => reject(new Error("FileReader error while reading FIX file"));
    reader.readAsText(file);
  });
}

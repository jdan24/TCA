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
 * Parse one line of pipe-delimited FIX (field separator = "|").
 * Returns null if the line is blank or malformed.
 */
function parseLine(line: string): FixMsg | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const msg: FixMsg = {};
  const parts = trimmed.split("|");
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

        const trades = aggregate(messages);

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

import type { TradeRecord } from "@/types";
import { FIX_TAGS } from "@/types";
import { parseTimestamp, normalizeSide } from "@/tca/normalize";

// ── Types ─────────────────────────────────────────────────────────────────────

type FixMsg = Record<string, string>;

interface FillAccumulator {
  clOrdId: string;
  /** FIX tag 37 OrderID — broker/exchange identifier; first non-empty value wins. */
  brokerOrderId: string;
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
        brokerOrderId: tag(msg, FIX_TAGS.OrderID),
        symbol: tag(msg, FIX_TAGS.SecurityID) || tag(msg, FIX_TAGS.Symbol),
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
      // Update symbol/side/orderQty/brokerOrderId from later messages if earlier one was blank
      if (!existing.brokerOrderId) existing.brokerOrderId = tag(msg, FIX_TAGS.OrderID);
      if (!existing.symbol) existing.symbol = tag(msg, FIX_TAGS.SecurityID) || tag(msg, FIX_TAGS.Symbol);
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

      // Append fill if this message represents an actual fill.
      // Priority 1: explicit LastQty/LastPx.
      // Priority 2: ExecType indicates a fill + delta CumQty (covers formats
      //             that only report cumulative totals without LastQty/LastPx).
      const execType = tag(msg, FIX_TAGS.ExecType);
      const isFillExecType = ["1", "2", "F", "H", "3"].includes(execType)
        || (execType === "" && cumQtyRaw > 0);
      if (lastQtyRaw > 0) {
        existing.fills.push({ transactTime, lastQty: lastQtyRaw, lastPx: lastPxRaw });
      } else if (isFillExecType && cumQtyRaw > existing.bestCumQty && avgPxRaw > 0) {
        // Delta fill from cumulative report
        const deltaCumQty = cumQtyRaw - existing.bestCumQty;
        const prevNotional = existing.bestAvgPx * existing.bestCumQty;
        const impliedPx    = deltaCumQty > 0
          ? (avgPxRaw * cumQtyRaw - prevNotional) / deltaCumQty
          : avgPxRaw;
        if (deltaCumQty > 0 && impliedPx > 0) {
          existing.fills.push({ transactTime, lastQty: deltaCumQty, lastPx: impliedPx });
        }
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
      brokerOrderId: acc.brokerOrderId || null,
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
 *   orderQty       = fill's LastQty (tag 32) when available; delta CumQty otherwise
 *
 * Fill detection strategy (two passes in priority order):
 *   1. LastQty (32) + LastPx (31) > 0 — standard per-fill notification.
 *   2. Delta CumQty (14) + implied price from AvgPx (6) — covers FIX 4.4+
 *      ExecType="F" (Trade) messages and "done for day" summaries that only
 *      report cumulative totals without LastQty/LastPx.
 */
function aggregatePerFill(messages: FixMsg[]): TradeRecord[] {
  const trades: TradeRecord[] = [];
  let fillIndex = 0;

  // Track cumulative state per ClOrdID for the delta-fill fallback.
  // Key = ClOrdID; Value = { cumQty seen so far, avgPx at that point }
  const prevCumState = new Map<string, { cumQty: number; avgPx: number }>();

  for (const msg of messages) {
    if (tag(msg, FIX_TAGS.MsgType) !== "8") continue;

    const clOrdId      = tag(msg, FIX_TAGS.ClOrdID);
    const execId       = tag(msg, FIX_TAGS.ExecID);
    const transactTime = tag(msg, FIX_TAGS.TransactTime);
    const symbol       = tag(msg, FIX_TAGS.SecurityID) || tag(msg, FIX_TAGS.Symbol);
    const sideRaw      = tag(msg, FIX_TAGS.Side);
    const execType     = tag(msg, FIX_TAGS.ExecType); // tag 150

    if (!symbol || !transactTime) continue;

    const lastQty = parseFloat(tag(msg, FIX_TAGS.LastQty) || "0");
    const lastPx  = parseFloat(tag(msg, FIX_TAGS.LastPx)  || "0");
    const cumQty  = parseFloat(tag(msg, FIX_TAGS.CumQty)  || "0");
    const avgPx   = parseFloat(tag(msg, FIX_TAGS.AvgPx)   || "0");

    let fillQty = 0;
    let fillPx  = 0;

    // ── Priority 1: explicit LastQty / LastPx ─────────────────────────────
    if (lastQty > 0 && lastPx > 0) {
      fillQty = lastQty;
      fillPx  = lastPx;
    } else {
      // ── Priority 2: ExecType indicates a fill + delta CumQty ─────────────
      // FIX 4.2: ExecType "1" = Partial Fill, "2" = Fill
      // FIX 4.4+: ExecType "F" = Trade (replaces "2"), "H" = Trade Correct
      // Some systems also send ExecType "3" (Done for Day) with no LastQty.
      const isFillExecType = ["1", "2", "F", "H", "3"].includes(execType)
        || (execType === "" && cumQty > 0); // no ExecType tag at all → use CumQty
      if (isFillExecType && cumQty > 0 && avgPx > 0) {
        const prev      = clOrdId ? prevCumState.get(clOrdId) : undefined;
        const prevCum   = prev?.cumQty ?? 0;
        const prevAvgPx = prev?.avgPx  ?? 0;
        const delta     = cumQty - prevCum;
        if (delta > 0) {
          fillQty = delta;
          // Derive implied last-fill price from the weighted-average delta:
          //   fillPx = (avgPx × cumQty − prevAvgPx × prevCum) / delta
          fillPx = prevCum > 0
            ? (avgPx * cumQty - prevAvgPx * prevCum) / delta
            : avgPx; // first fill → avgPx equals the only fill price
        }
      }
    }

    // Update cumulative tracking for future delta calculations
    if (clOrdId && cumQty > 0 && avgPx > 0) {
      prevCumState.set(clOrdId, { cumQty, avgPx });
    }

    if (fillQty <= 0 || fillPx <= 0) continue;

    const fillTime = safeParseDate(transactTime);
    const orderId  = execId || (clOrdId ? `${clOrdId}_${fillIndex}` : `fill_${fillIndex}`);
    const sideStr  = sideRaw === "1" ? "BUY" : sideRaw === "2" ? "SELL" : sideRaw;

    try {
      trades.push({
        orderId,
        brokerOrderId: tag(msg, FIX_TAGS.OrderID) || null,
        symbol,
        side: normalizeSide(sideStr),
        orderQty: fillQty,
        avgFillPrice: fillPx,
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

        // Smart multi-leg filter (tag 442 — MultiLegReportingType):
        //
        //   442 absent → plain single-leg fill                  → always keep
        //   442 = "3"  → spread-level fill                      → always keep
        //   442 = "1" or "2" → individual leg of a spread order → conditional
        //
        // The filter is only applied when the file actually contains spread-level
        // fills (442=3).  If no 442=3 messages exist the file contains single-leg
        // orders whose fills are tagged 442=1 (e.g. Allianz.txt, abenmFS.txt) and
        // we must keep them all.  When 442=3 messages ARE present (e.g. LCC.txt)
        // the file is a spread order and we keep only the spread-level fills to
        // avoid triple-counting the same notional via leg reports (442=1/2).
        const mlrtKey = String(FIX_TAGS.MultiLegReportingType); // "442"
        const hasSpreadLevel = messages.some((m) => m[mlrtKey] === "3");
        const filteredMessages = hasSpreadLevel
          ? messages.filter((m) => !m[mlrtKey] || m[mlrtKey] === "3")
          : messages;

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

        // Smart multi-leg filter — same logic as the multi-order parser:
        //
        //   • File has 442=3 messages  → spread order → keep only 442=3 (spread-
        //     level fills) and discard 442=1/2 (individual leg fills) to avoid
        //     double/triple-counting.  LCC.txt is an example: each fill generates
        //     one 442=3 spread-level report and two 442=1/2 leg-level reports.
        //
        //   • File has NO 442=3 messages → single-leg order where fills are tagged
        //     442=1 (e.g. Allianz.txt, abenmFS.txt) or have no 442 tag at all →
        //     keep everything.
        const mlrtKey = String(FIX_TAGS.MultiLegReportingType); // "442"
        const hasSpreadLevel = messages.some((m) => m[mlrtKey] === "3");
        const filteredMessages = hasSpreadLevel
          ? messages.filter((m) => !m[mlrtKey] || m[mlrtKey] === "3")
          : messages;

        const trades = aggregatePerFill(filteredMessages);

        if (trades.length === 0) {
          reject(
            new Error(
              "No fill executions found. " +
                "The parser looks for MsgType=8 messages with either tag 32 (LastQty) > 0 " +
                "or tag 150 (ExecType) indicating a fill (1/2/F) with tag 14 (CumQty) > 0. " +
                "Check that the file contains FIX execution reports."
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

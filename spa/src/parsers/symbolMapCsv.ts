/**
 * symbolMapCsv — parse a CSV of RIC → Bloomberg symbol mappings for bulk import.
 *
 * Accepts the same columns the mapping table uses. Headers are matched loosely
 * (case-insensitive, ignoring spaces / punctuation), so both the internal field
 * names and the human-readable table labels work:
 *
 *   ric            | Symbol | RIC
 *   bbgTicker      | "Bloomberg Ticker"
 *   bbgYellowKey   | "Yellow Key"
 *   priceMultiplier| "Price Multiplier"
 *
 * Rows missing a RIC or Bloomberg ticker are skipped. An unknown / blank yellow
 * key falls back to "Index". priceMultiplier is only kept when it is a valid
 * number > 0 and ≠ 1 (matching the table's own normalisation).
 */

import Papa from "papaparse";
import type { SymbolMapping } from "@/types";

const YELLOW_KEYS = ["Index", "Comdty", "Equity", "Curncy", "Corp", "Govt", "Mtge", "Muni"];

/** Normalise a header / key for loose matching: lowercase, alphanumerics only. */
function canon(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const RIC_KEYS = new Set(["ric", "symbol", "ricsymbol", "ric/symbol"].map(canon));
const TICKER_KEYS = new Set(["bbgticker", "bloombergticker", "ticker"].map(canon));
const YELLOWKEY_KEYS = new Set(["bbgyellowkey", "yellowkey"].map(canon));
const MULT_KEYS = new Set(["pricemultiplier", "multiplier"].map(canon));

/** Pull the first value from a row whose canonicalised header is in `keys`. */
function pick(row: Record<string, string>, keys: Set<string>): string | undefined {
  for (const [k, v] of Object.entries(row)) {
    if (keys.has(canon(k))) return v;
  }
  return undefined;
}

function normalizeYellowKey(raw: string | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "Index";
  const match = YELLOW_KEYS.find((k) => k.toLowerCase() === v.toLowerCase());
  return match ?? "Index";
}

export interface SymbolMapCsvResult {
  mappings: SymbolMapping[];
  /** Number of data rows that were skipped because they lacked a RIC or ticker. */
  skipped: number;
}

export function parseSymbolMapCsv(file: File): Promise<SymbolMapCsvResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete(results) {
        if (results.errors.length > 0 && results.data.length === 0) {
          reject(new Error(results.errors[0]?.message ?? "CSV parse error"));
          return;
        }

        const mappings: SymbolMapping[] = [];
        let skipped = 0;

        for (const row of results.data) {
          const ric = (pick(row, RIC_KEYS) ?? "").trim();
          const ticker = (pick(row, TICKER_KEYS) ?? "").trim();
          if (!ric || !ticker) {
            skipped++;
            continue;
          }
          const bbgYellowKey = normalizeYellowKey(pick(row, YELLOWKEY_KEYS));
          const multRaw = (pick(row, MULT_KEYS) ?? "").trim();
          const mult = parseFloat(multRaw);
          const keepMult = multRaw !== "" && !isNaN(mult) && mult > 0 && mult !== 1;

          mappings.push(
            keepMult
              ? { ric, bbgTicker: ticker, bbgYellowKey, priceMultiplier: mult }
              : { ric, bbgTicker: ticker, bbgYellowKey },
          );
        }

        if (mappings.length === 0) {
          reject(
            new Error(
              "No valid mappings found. Expected columns: Symbol, Bloomberg Ticker, Yellow Key, Price Multiplier.",
            ),
          );
          return;
        }

        resolve({ mappings, skipped });
      },
      error(err: Error) {
        reject(err);
      },
    });
  });
}

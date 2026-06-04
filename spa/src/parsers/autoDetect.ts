import type { ColumnMapping, OptionalField, RequiredField } from "@/types";

// ── Alias table ───────────────────────────────────────────────────────────────
// Each entry lists normalized forms (lowercase, stripped of non-alphanumeric) of
// known column names found in real broker / OMS exports.
const FIELD_ALIASES: Record<RequiredField | OptionalField, string[]> = {
  orderId: [
    "orderid", "order_id", "clordid", "cl_ord_id", "clientorderid",
    "client_order_id", "tradeid", "trade_id", "id",
  ],
  symbol: [
    "symbol", "sym", "instrument", "ticker", "contract", "security",
    "sec", "underlying",
  ],
  side: [
    "side", "direction", "buysell", "buy_sell", "action",
    "transactiontype", "transaction_type", "tradetype", "trade_type",
  ],
  orderQty: [
    "orderqty", "order_qty", "qty", "quantity", "orderquantity",
    "order_quantity", "size", "shares", "contracts", "ordershares",
    "fillqty", "fill_qty",
  ],
  avgFillPrice: [
    "avgfillprice", "avg_fill_price", "avgpx", "avg_px", "fillprice",
    "fill_price", "execprice", "exec_price", "executedprice",
    "executed_price", "averageprice", "average_price", "avgexecprice",
    "avg_exec_price", "price",
  ],
  orderTime: [
    "ordertime", "order_time", "ordertimestamp", "order_timestamp",
    "entrytime", "entry_time", "submittime", "submit_time", "createtime",
    "create_time", "orderdatetime", "order_date_time", "submittedtime",
    "submitted_time",
  ],
  firstFillTime: [
    "firstfilltime", "first_fill_time", "firstfill", "first_fill",
    "firstexectime", "first_exec_time", "firstfilltimestamp",
    "first_fill_timestamp", "firsttradetime", "first_trade_time",
  ],
  lastFillTime: [
    "lastfilltime", "last_fill_time", "lastfill", "last_fill",
    "lastexectime", "last_exec_time", "exectime", "exec_time",
    "filltime", "fill_time", "executedtime", "executed_time",
    "completedtime", "completed_time", "transacttime",
  ],
  arrivalPrice: [
    "arrivalprice", "arrival_price", "arrivalpx", "arrival_px",
    "refprice", "ref_price", "benchmarkprice", "benchmark_price",
    "pretradeprice", "pretrade_price", "pre_trade_price", "openingprice",
    "opening_price",
  ],
  contractMultiplier: [
    "contractmultiplier", "contract_multiplier", "multiplier",
    "mult", "contractsize", "contract_size", "pointvalue",
  ],
  currency: [
    "currency", "ccy", "curr", "tradecurrency", "trade_currency",
    "settlecurrency", "settle_currency",
  ],
  algo: [
    "algopolicy", "algo_policy", "algo", "algorithm", "strategy",
    "strategyname", "strategy_name", "algoname", "algo_name",
    "executionalgo", "execution_algo", "algocode", "algo_code",
    "algostrategypolicy",
  ],
  accountId: [
    "accountid", "account_id", "account", "acctid", "acct_id", "acct",
    "portfolioid", "portfolio_id", "portid", "port_id",
  ],
  accountDescription: [
    "accountdescription", "account_description", "accountdesc", "account_desc",
    "accountname", "account_name", "clientname", "client_name", "client",
    "portfolioname", "portfolio_name", "portfoliodesc",
  ],
  fileVwap: [
    "vwap", "filevwap", "file_vwap", "sourcevwap", "source_vwap",
    "benchmarkvwap", "benchmark_vwap", "marketvwap", "market_vwap",
    "mkvwap", "mkt_vwap", "referencevwap", "reference_vwap",
  ],
  fileTwap: [
    "twap", "filetwap", "file_twap", "sourcetwap", "source_twap",
    "benchmarktwap", "benchmark_twap", "markettwap", "market_twap",
    "mktwap", "mkt_twap", "referencetwap", "reference_twap",
  ],
  brokerOrderId: [
    "brokerorderid", "broker_order_id", "parentorderid", "parent_order_id",
    "exchangeorderid", "exchange_order_id", "orderid37", "tag37",
    "brokerid", "broker_id", "fixorderid", "fix_order_id",
  ],
};

// Strip everything except a-z and 0-9 for comparison
function normalize(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface DetectionResult {
  /** Best-guess column name for each field (empty string = no match found) */
  mapping: Partial<ColumnMapping>;
  /** Fields where exactly one alias matched — safe to skip asking the user */
  confident: Set<RequiredField | OptionalField>;
}

/**
 * Attempt to map the file's headers to TCA fields using normalized alias matching.
 * Returns a partial mapping and the set of confidently-matched fields.
 */
export function autoDetectMapping(headers: string[]): DetectionResult {
  const normalizedHeaders = headers.map(normalize);
  const mapping: Partial<ColumnMapping> = {};
  const confident = new Set<RequiredField | OptionalField>();

  const fields = Object.keys(FIELD_ALIASES) as Array<RequiredField | OptionalField>;

  for (const field of fields) {
    const aliases = FIELD_ALIASES[field];
    const matches: string[] = [];

    for (const alias of aliases) {
      const idx = normalizedHeaders.indexOf(alias);
      if (idx !== -1) {
        const original = headers[idx];
        if (original !== undefined) matches.push(original);
      }
    }

    if (matches.length === 1) {
      // Exactly one match → confident
      (mapping as Record<string, string>)[field] = matches[0] ?? "";
      confident.add(field);
    } else if (matches.length > 1) {
      // Multiple aliases matched → take first but flag as not confident
      (mapping as Record<string, string>)[field] = matches[0] ?? "";
    }
    // No match → field stays absent in mapping
  }

  return { mapping, confident };
}

/** The set of required fields that must be mapped before parsing can proceed */
export const REQUIRED_FIELDS: RequiredField[] = [
  "orderId",
  "symbol",
  "side",
  "orderQty",
  "avgFillPrice",
  "orderTime",
  "firstFillTime",
  "lastFillTime",
];

export const OPTIONAL_FIELDS: OptionalField[] = [
  "arrivalPrice",
  "contractMultiplier",
  "currency",
  "algo",
  "accountId",
  "accountDescription",
  "fileVwap",
  "fileTwap",
  "brokerOrderId",
];

/** Human-readable labels and descriptions for the ColumnMapper UI */
export const FIELD_META: Record<
  RequiredField | OptionalField,
  { label: string; description: string }
> = {
  orderId: { label: "Order ID", description: "Unique identifier for each order" },
  symbol: { label: "Symbol", description: "Futures contract ticker (e.g. ESH4, NQZ4)" },
  side: { label: "Side", description: "Buy or Sell — any common variant recognized" },
  orderQty: { label: "Order Quantity", description: "Total contracts ordered" },
  avgFillPrice: { label: "Avg Fill Price", description: "Volume-weighted average execution price" },
  orderTime: { label: "Order Time", description: "Timestamp when the order was submitted" },
  firstFillTime: { label: "First Fill Time", description: "Timestamp of the first partial fill" },
  lastFillTime: { label: "Last Fill Time", description: "Timestamp of the final fill" },
  arrivalPrice: {
    label: "Arrival Price",
    description: "Price at order entry — leave unmapped to fetch from Bloomberg",
  },
  contractMultiplier: {
    label: "Contract Multiplier",
    description: "Point value per contract (default: 1 if not in file)",
  },
  currency: {
    label: "Currency",
    description: "Settlement currency (default: USD if not in file)",
  },
  algo: {
    label: "Algo / Strategy",
    description: "Algo Policy or execution strategy name (e.g. VWAP, TWAP, POV)",
  },
  accountId: {
    label: "Account ID",
    description: "Portfolio or account identifier (used for filter bar)",
  },
  accountDescription: {
    label: "Client / Account Name",
    description: "Account description or client name (used for filter bar)",
  },
  fileVwap: {
    label: "Source VWAP",
    description: "Market VWAP from your file — used for VWAP deviation when Bloomberg is offline",
  },
  fileTwap: {
    label: "Source TWAP",
    description: "Market TWAP from your file — used for TWAP deviation when Bloomberg is offline",
  },
  brokerOrderId: {
    label: "Broker / Exchange Order ID",
    description: "FIX tag 37 OrderID — broker or exchange order identifier (optional)",
  },
};

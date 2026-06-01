// ── Intraday bar (also re-exported from bloombergClient) ─────────────────────
export interface IntradayBar {
  /** ISO-8601 string: bar open time (UTC implied). */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  numEvents: number;
}

// ── Analysis mode ─────────────────────────────────────────────────────────────
export type TCAMode = "multi" | "single";

// ── Raw normalized trade record ──────────────────────────────────────────────
export interface TradeRecord {
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  orderQty: number;
  avgFillPrice: number;
  arrivalPrice: number | null; // null when Bloomberg bridge is not connected
  orderTime: Date;
  firstFillTime: Date;
  lastFillTime: Date;
  contractMultiplier: number;
  currency: string;
  algo: string | null;              // "Algo Policy" column; null when absent
  accountId: string | null;         // Portfolio / account identifier; null when absent
  accountDescription: string | null; // Client / account name; null when absent
}

// ── Computed TCA metrics per trade ───────────────────────────────────────────
export interface TCAResult {
  orderId: string;
  IS_bps: number | null;
  VWAP_dev_bps: number | null;
  MI_bps: number | null;
  timeToFill_ms: number;
  reversion_1m_bps: number | null;
  reversion_5m_bps: number | null;
  reversion_30m_bps: number | null;
  reversion_EOD_bps: number | null;
  TWAS_bps: number | null;
  vol_during_order_price: number | null; // 1σ price std-dev during order window
  vol_during_order_bps: number | null;   // same expressed in bps
  TWAP_dev_bps: number | null;           // slippage vs market TWAP during [orderTime, lastFillTime]
  marketVWAP_price: number | null;       // raw market VWAP price during [orderTime, lastFillTime]
}

// ── Bloomberg enrichment payload (one per orderId) ───────────────────────────
export interface BidAskTick {
  time: Date;
  bid: number;
  ask: number;
}

export interface BloombergEnrichment {
  arrivalPrice: number;
  vwap: number;
  adv: number;
  dailyVol: number;
  reversion1m: number;
  reversion5m: number;
  reversion30m: number;
  reversionEOD: number;
  bidAskTicks: BidAskTick[];
  barsSnapshot: IntradayBar[]; // 1-min bars for the order window (used by volatility)
}

// ── Single-order parent aggregate (Mode 2 only) ───────────────────────────────
export interface ParentOrderSummary {
  symbol: string;
  side: "BUY" | "SELL";
  totalQty: number;
  fillVwap: number; // qty-weighted avg fill price across all slices
  arrivalPrice: number | null;
  IS_bps: number | null;
  orderTime: Date; // earliest orderTime across all slices
  lastFillTime: Date; // latest lastFillTime across all slices
  duration_ms: number;
  vol_during_order_price: number | null;
  vol_during_order_bps: number | null;
  participationRate: number | null; // totalQty / exchange volume during [orderTime, lastFillTime]
}

// ── Multi-order aggregation types ─────────────────────────────────────────────
export type AggGroupType = "symbol" | "algo" | "symbol+algo" | "symbol+side";

export interface AggregateRow {
  groupKey: string; // display label, e.g. "ESH5" or "ESH5 / VWAP"
  count: number;
  totalQty: number;
  avgIS_bps: number | null;
  avgVWAP_dev_bps: number | null;
  avgMI_bps: number | null;
  avgTWAS_bps: number | null;
  avgTTF_ms: number;
  winRate: number | null; // fraction [0,1] of orders where IS_bps <= 0
  bestIS_bps: number | null; // most favourable (min) IS in group
  worstIS_bps: number | null; // most adverse (max) IS in group
  orderIds: string[]; // pre-computed for TradeTable pre-filter
}

export interface AggregationFilter {
  type: AggGroupType;
  key: string; // groupKey value that was clicked
  orderIds: string[];
}

export interface AggregationSet {
  bySymbol: AggregateRow[];
  byAlgo: AggregateRow[];
  bySymbolAlgo: AggregateRow[];
  bySymbolSide: AggregateRow[];
}

// ── Multi-order dashboard filter ─────────────────────────────────────────────
export interface DataFilter {
  symbol: string | null;
  accountId: string | null;
  accountDescription: string | null;
  algo: string | null;
  dateFrom: string | null; // "YYYY-MM-DD" inclusive lower bound on orderTime
  dateTo: string | null;   // "YYYY-MM-DD" inclusive upper bound on orderTime
}

export const EMPTY_FILTER: DataFilter = {
  symbol: null,
  accountId: null,
  accountDescription: null,
  algo: null,
  dateFrom: null,
  dateTo: null,
};

// ── RIC → Bloomberg symbol mapping ────────────────────────────────────────────
export interface SymbolMapping {
  ric: string; // e.g. "ESc1", "ES=F"
  bbgTicker: string; // e.g. "ES1", "CL1"
  bbgYellowKey: string; // "Index" | "Comdty" | "Equity" | "Curncy" | etc.
}

// ── Column-mapping types ──────────────────────────────────────────────────────
// arrivalPrice is optional — Bloomberg fills it when the bridge is connected
export type RequiredField =
  | "orderId"
  | "symbol"
  | "side"
  | "orderQty"
  | "avgFillPrice"
  | "orderTime"
  | "firstFillTime"
  | "lastFillTime";

export type OptionalField =
  | "arrivalPrice"
  | "contractMultiplier"
  | "currency"
  | "algo"
  | "accountId"
  | "accountDescription";

export type ColumnMapping = Record<RequiredField, string> &
  Partial<Record<OptionalField, string>>;

// ── Raw data returned by CSV/XLSX parsers before column-mapping ───────────────
export interface RawFileData {
  headers: string[];
  rows: Record<string, string>[];
  fileType: "csv" | "xlsx";
}

// ── Zustand store shape ───────────────────────────────────────────────────────
export interface TCAStore {
  mode: TCAMode;
  rawTrades: TradeRecord[];
  results: TCAResult[];
  enrichment: Record<string, BloombergEnrichment>; // keyed by orderId
  bloombergConnected: boolean;
  isProcessing: boolean;
  parseError: string | null;
  aggregationFilter: AggregationFilter | null;
  setMode: (m: TCAMode) => void;
  setRawTrades: (trades: TradeRecord[]) => void;
  setResults: (results: TCAResult[]) => void;
  setEnrichment: (orderId: string, data: BloombergEnrichment) => void;
  /** Replace the entire enrichment map at once (used after a full enrichment run). */
  setAllEnrichment: (enrichment: Record<string, BloombergEnrichment>) => void;
  setBloombergConnected: (v: boolean) => void;
  setProcessing: (v: boolean) => void;
  setParseError: (msg: string | null) => void;
  setAggregationFilter: (f: AggregationFilter | null) => void;
  reset: () => void;
}

// ── FIX 4.x / 5.0 tag constants ──────────────────────────────────────────────
export const FIX_TAGS = {
  ClOrdID: 11,
  Symbol: 55,
  Side: 54,
  OrderQty: 38,
  LastQty: 32,
  LastPx: 31,
  Price: 44,
  AvgPx: 6,
  CumQty: 14,
  TransactTime: 60,
  ExecType: 150,
  MsgType: 35,
} as const;

export type FixTagKey = keyof typeof FIX_TAGS;

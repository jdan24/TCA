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

export type OptionalField = "arrivalPrice" | "contractMultiplier" | "currency";

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
  rawTrades: TradeRecord[];
  results: TCAResult[];
  enrichment: Record<string, BloombergEnrichment>; // keyed by orderId
  bloombergConnected: boolean;
  isProcessing: boolean;
  parseError: string | null;
  setRawTrades: (trades: TradeRecord[]) => void;
  setResults: (results: TCAResult[]) => void;
  setEnrichment: (orderId: string, data: BloombergEnrichment) => void;
  /** Replace the entire enrichment map at once (used after a full enrichment run). */
  setAllEnrichment: (enrichment: Record<string, BloombergEnrichment>) => void;
  setBloombergConnected: (v: boolean) => void;
  setProcessing: (v: boolean) => void;
  setParseError: (msg: string | null) => void;
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

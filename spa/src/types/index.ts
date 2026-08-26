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
  /** FIX tag 37 OrderID — broker/exchange order identifier; null when absent. */
  brokerOrderId: string | null;
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
  /** VWAP benchmark imported from source file; null when column not mapped. */
  fileVwap: number | null;
  /** TWAP benchmark imported from source file; null when column not mapped. */
  fileTwap: number | null;
}

// ── Computed TCA metrics per trade ───────────────────────────────────────────
export interface TCAResult {
  orderId: string;
  IS_bps: number | null;
  VWAP_dev_bps: number | null;
  MI_bps: number | null;
  /** Currency the cash figures below are denominated in. Bloomberg's quote
   *  currency when known (normalised to its major unit), else the file's. */
  currency: string;
  /** Slippage in cash terms. null when no point value is known for the symbol. */
  IS_usd: number | null;
  VWAP_dev_usd: number | null;
  TWAP_dev_usd: number | null;
  timeToFill_ms: number;
  reversion_30s_bps: number | null;
  reversion_1m_bps: number | null;
  TWAS_bps: number | null;
  /** Same time-weighted average spread expressed as a raw price width (ask − bid). */
  TWAS_price: number | null;
  vol_during_order_price: number | null; // 1σ price std-dev during order window
  vol_during_order_bps: number | null;   // same expressed in bps
  TWAP_dev_bps: number | null;           // slippage vs market TWAP during [orderTime, lastFillTime]
  marketVWAP_price: number | null;       // raw market VWAP price during [orderTime, lastFillTime]
  marketTWAP_price: number | null;       // raw market TWAP price during [orderTime, lastFillTime]
}

// ── Bloomberg enrichment payload (one per orderId) ───────────────────────────
/** Provenance of a bid/ask stream — see the bridge's /bid-ask-ticks endpoint. */
export type BidAskSource = "ticks" | "bars" | null;

export interface BidAskTick {
  time: Date;
  bid: number;
  ask: number;
}

export interface TradeTick {
  time: Date;
  price: number;
  size: number;
}

export interface BloombergEnrichment {
  arrivalPrice: number;
  vwap: number;
  adv: number;
  dailyVol: number;
  reversion30s: number; // last-traded price at lastFillTime + 30 s (from trade ticks)
  reversion1m: number;  // bar close at lastFillTime + 1 min
  /** Cash value of a 1.00 price move for one contract, from FUT_CONT_SIZE.
   *  null when Bloomberg does not supply it for this security. */
  pointValue: number | null;
  /** Major-unit currency of the cash figures, from CRNCY — "USd" is reported
   *  here as "USD", since the point value above is already in major units.
   *  null when Bloomberg supplies no currency. */
  currency: string | null;
  bidAskTicks: BidAskTick[];
  /** Where bidAskTicks came from: real Bloomberg quotes, or spreads estimated
   *  from 1-minute bar ranges. null when there are no ticks at all. */
  bidAskSource: BidAskSource;
  tradeTicks: TradeTick[];    // last-traded price+size ticks for short-order VWAP
  barsSnapshot: IntradayBar[]; // 1-min bars for the order window (used by volatility)
}

// ── Single-order parent aggregate (Mode 2 only) ───────────────────────────────
export interface ParentOrderSummary {
  symbol: string;
  side: "BUY" | "SELL";
  /** FIX tag 37 OrderID — broker/exchange identifier; null when absent or not provided. */
  brokerOrderId: string | null;
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
  marketVwap: number | null;        // Bloomberg market VWAP over the full order window
  marketTwap: number | null;        // Bloomberg market TWAP over the full order window
  /** Running market VWAP at each fill timestamp — null when Bloomberg not connected. */
  runningMarketVwap: Array<{ t: number; vwap: number }> | null;
  /** Running market TWAP at each fill timestamp — null when Bloomberg not connected. */
  runningMarketTwap: Array<{ t: number; twap: number }> | null;
  /** Qty-weighted average of fill-level market impact (Almgren/Chriss). */
  MI_bps: number | null;
  /** Time-weighted average spread over the full parent order window. */
  TWAS_bps: number | null;
  /** Same spread expressed as a raw price width (ask − bid), for instruments
   *  where bps against a near-zero mid is hard to read — e.g. calendar spreads. */
  TWAS_price: number | null;
  /** Provenance of the quotes behind TWAS: real ticks vs bar-range estimate. */
  bidAskSource: BidAskSource;
  /** Slippage in cash terms vs each benchmark. null when no point value is known. */
  IS_usd: number | null;
  VWAP_dev_usd: number | null;
  TWAP_dev_usd: number | null;
  /** The point value used for the figures above, for display/diagnosis. */
  pointValue: number | null;
  /** Currency of the cash figures, from the trade records (no FX conversion). */
  currency: string;
  /** Raw market price 1 minute after the parent order's last fill (from Bloomberg). */
  reversion1m_price: number | null;
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

// ── Spread-savings aggregation (multi-order, grouped by generic ticker) ───────
/**
 * How much of the quoted spread the execution actually kept, per instrument.
 *
 * savingsPct = (avgSpread_bps / 2 − wAvgIS_bps) / avgSpread_bps
 *
 * The IS term is subtracted because a positive IS_bps is a cost in this
 * codebase (see tca/slippage.ts). That makes the scale read:
 *   1.0  → filled at or better than the near touch
 *   0.5  → filled at mid
 *   0.0  → paid the full spread
 *   < 0  → worse than crossing the spread
 */
export interface SpreadSavingsRow {
  /** Generic ticker, e.g. "FV Comdty" — expiry deliberately dropped. */
  groupKey: string;
  count: number;
  totalQty: number;
  /** Simple mean of TWAS_bps across the group's orders. */
  avgSpread_bps: number | null;
  /** Quantity-weighted mean of IS_bps: Σ(IS × qty) / Σqty. */
  wAvgIS_bps: number | null;
  /** Median of per-order IS_bps, deliberately unweighted. Read against
   *  wAvgIS_bps, which is weighted: a gap between the two exposes an outlier
   *  order or a single large one carrying the group. */
  medianIS_bps: number | null;
  /** Simple mean of per-order vol_during_order_bps — 1σ of market price over
   *  each order's own window. The drift the orders were actually exposed to,
   *  and the context that makes a large negative savingsPct legible. */
  avgVol_bps: number | null;
  /** Mean of per-order σ ÷ √minutes: volatility as a rate rather than a total.
   *  σ grows with √duration, so this is what compares across orders and
   *  instruments of different lengths. */
  avgVolRate_bps: number | null;
  /** Fraction, not a percentage — the table multiplies by 100 for display. */
  savingsPct: number | null;
}

// ── Multi-order dashboard filter ─────────────────────────────────────────────
/**
 * Categorical dimensions are multi-select: an empty array means "no filter on
 * this dimension" (match everything), not "match nothing". Ticking several
 * values ORs them together — the common case being a handful of contracts out
 * of a report that spans many.
 */
export interface DataFilter {
  symbols: string[];
  accountIds: string[];
  accountDescriptions: string[];
  algos: string[];
  dateFrom: string | null; // "YYYY-MM-DD" inclusive lower bound on orderTime
  dateTo: string | null;   // "YYYY-MM-DD" inclusive upper bound on orderTime
}

export const EMPTY_FILTER: DataFilter = {
  symbols: [],
  accountIds: [],
  accountDescriptions: [],
  algos: [],
  dateFrom: null,
  dateTo: null,
};

// ── RIC → Bloomberg symbol mapping ────────────────────────────────────────────
export interface SymbolMapping {
  ric: string; // e.g. "ESc1", "ES=F"
  bbgTicker: string; // e.g. "ES1", "CL1"
  bbgYellowKey: string; // "Index" | "Comdty" | "Equity" | "Curncy" | etc.
  /** Multiplier applied to file fill prices before comparing with Bloomberg prices.
   *  Omitted / undefined means 1 (no scaling). */
  priceMultiplier?: number;
  /** Cash value of a 1.00 price move for one contract, in the contract's own
   *  currency — 1000 for a 3Y/10Y note, 50 for ES. Overrides the value derived
   *  from Bloomberg's FUT_CONT_SIZE. Omitted means "use Bloomberg". */
  pointValue?: number;
}

// ── Algo → benchmark mapping ──────────────────────────────────────────────────
/** Which benchmark an order should be measured against. */
export type BenchmarkKind = "arrival" | "vwap" | "twap";

export interface AlgoMapping {
  /** Algo name as it appears in the file, e.g. "VWAP 10%". Matched case-insensitively. */
  algo: string;
  benchmark: BenchmarkKind;
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
  | "accountDescription"
  | "fileVwap"
  | "fileTwap"
  | "brokerOrderId";

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
  /** Override order-window boundaries for the single-order Bloomberg fetch. */
  singleOrderTimeOverride: { start: Date; end: Date } | null;
  /** The exact time window (orderTime / lastFillTime) that was used for the most recent
   *  single-order Bloomberg fetch.  null = no fetch performed yet.  Used to detect whether
   *  the current time override is outside the already-fetched range. */
  singleOrderFetchWindow: { start: Date; end: Date } | null;
  /** Bloomberg ticker + yellow key typed directly on the single-order page (e.g. "ESH5 Index"). */
  singleOrderBbgSymbol: string | null;
  /** Multiplier applied to every fill price from the file before comparing with Bloomberg prices.
   *  null = 1 (no scaling). Use 0.01 if file prices are 100× Bloomberg, 100 for the reverse. */
  singleOrderPriceScale: number | null;
  /** True when symbol mappings changed since the last Bloomberg fetch — drives the
   *  "refresh data to pick up new mappings" banner on the dashboard. */
  symbolMapDirty: boolean;
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
  setSingleOrderTimeOverride: (v: { start: Date; end: Date } | null) => void;
  setSingleOrderFetchWindow: (v: { start: Date; end: Date } | null) => void;
  setSingleOrderBbgSymbol: (v: string | null) => void;
  setSingleOrderPriceScale: (v: number | null) => void;
  setSymbolMapDirty: (v: boolean) => void;
  reset: () => void;
}

// ── FIX 4.x / 5.0 tag constants ──────────────────────────────────────────────
export const FIX_TAGS = {
  ClOrdID: 11,
  ExecID: 17,
  OrderID: 37,
  SecurityID: 48,
  Symbol: 55,
  MaturityMonthYear: 200,
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
  /** 1=Single security  2=Individual leg  3=Multi-leg (spread) level — filter to 3 for spread TCA */
  MultiLegReportingType: 442,
} as const;

export type FixTagKey = keyof typeof FIX_TAGS;

/**
 * SettleAlgoDistribution — slippage vs settle, by spread cost then by algo.
 *
 * One chart per settle window, because the two benchmarks are different things:
 * 3PM is the contract's own official settle, 4PM the last print before the
 * equity close. Averaging an algo across both would hide which print it is
 * actually good into.
 *
 * The x-axis is categorical, in two tiers. Products are laid out left to right
 * by their 1-tick spread cost, cheapest first, so the eye moves from the tight
 * instruments to the wide ones; inside each product there is one column per algo
 * that traded it. Evenly spaced rather than plotted at true spread cost, because
 * a product's spread cost is essentially one value — orders on it would pile
 * into a single vertical line and the algos could not be told apart.
 *
 * Every order is a dot in its column: shape says which algo, colour says whether
 * it beat the full cost of that product's spread. So the chart carries the algo
 * comparison and the "was working it worth it" reading at once, and the per-algo
 * averages sit in the legend rather than as marks on a busy plot.
 *
 * Orders on a contract with no known tick size have no spread cost and so cannot
 * be placed; they are excluded and counted in the subtitle rather than dropped
 * silently.
 *
 * Sign convention is the report's: positive is a cost.
 */

import { useMemo } from "react";
import {
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SettleResult, SettleWindow, TradeRecord } from "@/types";
import { settleWindowLabel } from "@/tca/settle";
import { toGenericTicker } from "@/tca/genericTicker";
import { tickSpreadBps } from "@/tca/tickSize";
import { NO_ALGO_LABEL } from "@/tca/settleAggregate";
import { ChartCard, EmptyState, fmtBps, safeAvg } from "@/components/dashboard/dashboardUtils";

type SettledWindow = Exclude<SettleWindow, "unassigned">;

const BEAT_COLOR = "#10b981"; // emerald — slippage under the full spread cost
const MISS_COLOR = "#ef4444"; // red     — paid more than a full tick

/**
 * Marker shapes, one per algo, assigned in the order the algos appear on the
 * axis. Recharts' built-in symbol set; seven is more than any file has carried.
 */
const SHAPES = [
  "circle",
  "triangle",
  "square",
  "diamond",
  "wye",
  "cross",
  "star",
] as const;

type ShapeName = (typeof SHAPES)[number];

function shapeFor(index: number): ShapeName {
  return SHAPES[index % SHAPES.length] ?? "circle";
}

/**
 * How far a dot may be nudged sideways from its column centre, as a fraction of
 * the one-unit spacing between columns. Wide enough to separate a dozen orders,
 * narrow enough that no dot can be mistaken for its neighbour's column.
 */
const JITTER_SPREAD = 0.26;

/**
 * Plot-area geometry, shared between the chart and the product band drawn under
 * it in HTML.
 *
 * The band is not a second Recharts axis: with the x domain set to exactly one
 * unit per column, the plot area is (width − Y_AXIS_WIDTH − RIGHT_MARGIN) and
 * each column occupies exactly 1/n of it. A flex row with the same padding and
 * a per-block grow factor therefore lands on the columns precisely, and does so
 * without depending on how Recharts stacks two axes of the same orientation.
 */
const Y_AXIS_WIDTH = 44;
const RIGHT_MARGIN = 16;

interface Point {
  /** Column index, plus the dot's own jitter. */
  x: number;
  slip: number;
  /** This order's own 1-tick spread cost, in bps. */
  spread: number;
  /** Slippage came in under the full cost of the spread. */
  beat: boolean;
  algo: string;
  product: string;
  symbol: string;
}

/** One (product, algo) column. */
interface Column {
  index: number;
  product: string;
  algo: string;
}

/** A product's block of columns, and the spread cost that positions it. */
interface ProductBlock {
  product: string;
  spread: number;
  /** How many algo columns the block covers — its width in the band row. */
  span: number;
  /** Right-hand edge, for the divider between blocks. */
  end: number;
}

/** Per-algo legend entry: the shape's meaning, its count and its average. */
interface AlgoLegendEntry {
  algo: string;
  shapeIndex: number;
  count: number;
  mean: number | null;
}

function PointTooltip(props: unknown) {
  const { active, payload } = props as {
    active?: boolean;
    payload?: Array<{ payload?: Point }>;
  };
  const point = payload?.[0]?.payload;
  if (active !== true || point === undefined || point.symbol === undefined) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] shadow-lg dark:border-gray-700 dark:bg-gray-900">
      <p className="font-semibold text-gray-900 dark:text-white">{point.symbol}</p>
      <p className="text-gray-500 dark:text-gray-400">{point.algo}</p>
      <p className="tabular-nums text-gray-700 dark:text-gray-300">
        {fmtBps(point.slip)} vs settle
      </p>
      <p className="tabular-nums text-gray-500 dark:text-gray-400">
        {fmtBps(point.spread)} full spread &middot;{" "}
        <span className={point.beat ? "text-green-600" : "text-red-500"}>
          {point.beat ? "beat it" : "paid more"}
        </span>
      </p>
    </div>
  );
}

/**
 * Deterministic jitter in [-1, 1) from the order id.
 *
 * Deterministic on purpose: a random offset would make every dot hop on each
 * re-render, which reads as the data changing when only React did.
 */
function jitterOf(orderId: string): number {
  let h = 2166136261;
  for (let i = 0; i < orderId.length; i++) {
    h ^= orderId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

/** Named algos alphabetically, the blank sentinel always last. */
function compareAlgo(a: string, b: string): number {
  if (a === NO_ALGO_LABEL) return 1;
  if (b === NO_ALGO_LABEL) return -1;
  return a.localeCompare(b);
}

/** Axis labels are truncated rather than allowed to collide. */
function truncate(s: string, max = 12): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

interface SettleAlgoDistributionProps {
  window: SettledWindow;
  trades: TradeRecord[];
  results: SettleResult[];
  /** Decimal tick size for a Bloomberg symbol; null when unknown. */
  tickSizeFor: (bbgSymbol: string) => number | null;
  resolveSymbol: (ric: string) => string;
}

export function SettleAlgoDistribution({
  window,
  trades,
  results,
  tickSizeFor,
  resolveSymbol,
}: SettleAlgoDistributionProps) {
  const { pointsByAlgo, columns, blocks, legend, excluded, total } = useMemo(() => {
    const tradeById = new Map(trades.map((t) => [t.orderId, t]));

    interface Order {
      orderId: string;
      symbol: string;
      product: string;
      algo: string;
      slip: number;
      spread: number;
    }

    const orders: Order[] = [];
    let skipped = 0;

    for (const r of results) {
      if (r.window !== window || r.slip_bps === null) continue;
      const trade = tradeById.get(r.orderId);
      if (!trade) continue;

      const bbgSymbol = resolveSymbol(trade.symbol);
      const spread = tickSpreadBps(tickSizeFor(bbgSymbol), r.benchmark);
      if (spread === null) {
        skipped += 1;
        continue;
      }

      orders.push({
        orderId: trade.orderId,
        symbol: bbgSymbol,
        // Expiries collapse onto the instrument: the spread cost is a property
        // of the product, and FVU6 beside FVZ6 would be two blocks at the same
        // place on the axis.
        product: toGenericTicker(bbgSymbol),
        algo: trade.algo?.trim() || NO_ALGO_LABEL,
        slip: r.slip_bps,
        spread,
      });
    }

    // ── Products, ordered by spread cost ───────────────────────────────────
    //
    // A product's spread cost varies slightly across days, since the benchmark
    // price moves under a fixed tick. The block is positioned and labelled by
    // the mean; each dot is still coloured against its own order's spread.
    const byProduct = new Map<string, Order[]>();
    for (const o of orders) {
      const list = byProduct.get(o.product);
      if (list) list.push(o);
      else byProduct.set(o.product, [o]);
    }

    const productOrder = [...byProduct.entries()]
      .map(([product, os]) => ({
        product,
        spread: safeAvg(os.map((o) => o.spread)) ?? 0,
        orders: os,
      }))
      .sort((a, b) => (a.spread !== b.spread ? a.spread - b.spread : a.product.localeCompare(b.product)));

    // ── Columns: one per (product, algo) ───────────────────────────────────
    const cols: Column[] = [];
    const productBlocks: ProductBlock[] = [];
    const pts: Point[] = [];

    for (const { product, spread, orders: os } of productOrder) {
      const algos = [...new Set(os.map((o) => o.algo))].sort(compareAlgo);
      const start = cols.length;

      for (const algo of algos) {
        const index = cols.length;
        cols.push({ index, product, algo });
        for (const o of os) {
          if (o.algo !== algo) continue;
          pts.push({
            x: index + jitterOf(o.orderId) * JITTER_SPREAD,
            slip: o.slip,
            spread: o.spread,
            beat: o.slip < o.spread,
            algo,
            product,
            symbol: o.symbol,
          });
        }
      }

      const end = cols.length - 1;
      productBlocks.push({
        product,
        spread,
        span: end - start + 1,
        end,
      });
    }

    // ── Shapes: one per algo, stable across the whole chart ────────────────
    //
    // Assigned over the algos present anywhere, not per block, so a shape means
    // the same algo in every product on the plot.
    const allAlgos = [...new Set(orders.map((o) => o.algo))].sort(compareAlgo);
    const shapeIndexByAlgo = new Map(allAlgos.map((a, i) => [a, i]));

    const legendEntries: AlgoLegendEntry[] = allAlgos.map((algo) => {
      const own = orders.filter((o) => o.algo === algo);
      return {
        algo,
        shapeIndex: shapeIndexByAlgo.get(algo) ?? 0,
        count: own.length,
        mean: safeAvg(own.map((o) => o.slip)),
      };
    });

    // Recharts takes one shape per Scatter series, so the points are split by
    // algo and the beat/miss colour is applied per point inside each series.
    const grouped = allAlgos.map((algo) => ({
      algo,
      shapeIndex: shapeIndexByAlgo.get(algo) ?? 0,
      pts: pts.filter((p) => p.algo === algo),
    }));

    return {
      pointsByAlgo: grouped,
      columns: cols,
      blocks: productBlocks,
      legend: legendEntries,
      excluded: skipped,
      total: pts.length,
    };
  }, [window, trades, results, tickSizeFor, resolveSymbol]);

  const title = `${settleWindowLabel(window)} — Slippage by Spread Cost & Algo`;

  if (total === 0) {
    return (
      <ChartCard
        title={title}
        subtitle="Slippage vs the settle benchmark, by product spread cost then algo"
      >
        <EmptyState
          message={
            excluded > 0
              ? `No tick size known for the ${excluded} benchmarked order${excluded !== 1 ? "s" : ""} in this window`
              : `No benchmarked orders in the ${settleWindowLabel(window)} window`
          }
        />
      </ChartCard>
    );
  }

  const beatCount = pointsByAlgo.reduce(
    (n, g) => n + g.pts.filter((p) => p.beat).length,
    0,
  );

  return (
    <ChartCard
      title={title}
      subtitle={
        `${beatCount} of ${total} beat the full cost of their product's spread` +
        (excluded > 0 ? ` — ${excluded} excluded, no tick size known` : "")
      }
    >
      <ResponsiveContainer width="100%" height={280}>
        <ScatterChart margin={{ top: 8, right: RIGHT_MARGIN, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />

          {/* Upper tick row: the algo within its product block. */}
          <XAxis
            dataKey="x"
            type="number"
            name="Algo"
            // Padded half a column each side so the outermost columns' jitter is
            // not clipped by the axis.
            domain={[-0.5, columns.length - 0.5]}
            ticks={columns.map((c) => c.index)}
            tick={{ fontSize: 9 }}
            tickFormatter={(v: unknown) =>
              typeof v === "number" ? truncate(columns[Math.round(v)]?.algo ?? "") : ""
            }
            interval={0}
            height={20}
          />

          <YAxis
            dataKey="slip"
            type="number"
            name="Slippage"
            tick={{ fontSize: 11 }}
            width={Y_AXIS_WIDTH}
            label={{
              value: "slip vs settle (bps)",
              angle: -90,
              position: "insideLeft",
              offset: 14,
              fontSize: 10,
              fill: "#6b7280",
            }}
          />

          {/* Custom content: the x value is a jittered column index, so the
              default tooltip would report a number that means nothing. */}
          <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<PointTooltip />} />

          {/* Zero slippage: filled exactly at the settle. */}
          <ReferenceLine y={0} stroke="#94a3b8" />

          {/* Divider between product blocks, so the tiers read as groups. */}
          {blocks.slice(0, -1).map((b) => (
            <ReferenceLine
              key={b.product}
              x={b.end + 0.5}
              stroke="#e5e7eb"
              strokeDasharray="2 3"
            />
          ))}

          {pointsByAlgo.map((g) => (
            <Scatter
              key={g.algo}
              data={g.pts}
              shape={shapeFor(g.shapeIndex)}
              isAnimationActive={false}
            >
              {g.pts.map((p, i) => (
                <Cell key={i} fill={p.beat ? BEAT_COLOR : MISS_COLOR} fillOpacity={0.8} />
              ))}
            </Scatter>
          ))}
        </ScatterChart>
      </ResponsiveContainer>

      {/* Product band: the lower tier of the x-axis, laid out to match the
          columns exactly (see Y_AXIS_WIDTH above). */}
      <div
        className="flex"
        style={{ paddingLeft: Y_AXIS_WIDTH, paddingRight: RIGHT_MARGIN }}
      >
        {blocks.map((b) => (
          <div key={b.product} className="min-w-0 px-1" style={{ flexGrow: b.span, flexBasis: 0 }}>
            <div className="truncate border-t border-gray-200 pt-1 text-center text-[10px] text-gray-600 dark:border-gray-700 dark:text-gray-400">
              {b.product} &middot; {b.spread.toFixed(2)} bps
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-gray-500 dark:text-gray-400">
        {legend.map((e) => (
          <span key={e.algo} className="flex items-center gap-1.5">
            <ShapeSwatch index={e.shapeIndex} />
            {e.algo} ({e.count}) {fmtBps(e.mean)} avg
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: BEAT_COLOR }} />
          beat the spread
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: MISS_COLOR }} />
          paid more than the spread
        </span>
      </div>
    </ChartCard>
  );
}

/**
 * The legend's copy of an algo's marker.
 *
 * Drawn here rather than reusing Recharts' symbol renderer so the swatch is
 * unfilled — the fill on the plot means beat or miss, and a legend swatch in
 * either colour would claim the algo is one of the two.
 */
function ShapeSwatch({ index }: { index: number }) {
  const shape = shapeFor(index);
  const stroke = "#6b7280";
  return (
    <svg width="10" height="10" viewBox="-5 -5 10 10" aria-hidden>
      {shape === "circle" && <circle r="3.5" fill="none" stroke={stroke} strokeWidth="1.3" />}
      {shape === "triangle" && (
        <path d="M0 -4 L4 3 L-4 3 Z" fill="none" stroke={stroke} strokeWidth="1.3" />
      )}
      {shape === "square" && (
        <rect x="-3.3" y="-3.3" width="6.6" height="6.6" fill="none" stroke={stroke} strokeWidth="1.3" />
      )}
      {shape === "diamond" && (
        <path d="M0 -4.2 L4.2 0 L0 4.2 L-4.2 0 Z" fill="none" stroke={stroke} strokeWidth="1.3" />
      )}
      {shape === "wye" && (
        <path d="M0 0 L0 4 M0 0 L-3.5 -2 M0 0 L3.5 -2" fill="none" stroke={stroke} strokeWidth="1.3" />
      )}
      {shape === "cross" && (
        <path d="M-4 0 L4 0 M0 -4 L0 4" fill="none" stroke={stroke} strokeWidth="1.3" />
      )}
      {shape === "star" && (
        <path
          d="M0 -4.5 L1.3 -1.4 L4.5 -1.4 L1.9 0.6 L2.9 3.8 L0 1.9 L-2.9 3.8 L-1.9 0.6 L-4.5 -1.4 L-1.3 -1.4 Z"
          fill="none"
          stroke={stroke}
          strokeWidth="1"
        />
      )}
    </svg>
  );
}

/**
 * FAQModal — Methodology reference for all Bloomberg-enriched TCA fields.
 *
 * Accessible from the header on both Multi-Order and Single-Order pages.
 * Covers every metric that requires Bloomberg data, with formulas,
 * data sources, and positive/adverse interpretations.
 */

interface FAQModalProps {
  onClose: () => void;
}

// ── Small layout primitives ───────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-xs font-bold uppercase tracking-widest text-blue-500 dark:text-blue-400 mb-3 pb-1 border-b border-gray-100 dark:border-gray-800">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Entry({
  name,
  tag,
  children,
}: {
  name: string;
  tag?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4">
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{name}</h3>
        {tag && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
            {tag}
          </span>
        )}
      </div>
      <div className="text-xs text-gray-600 dark:text-gray-300 space-y-1.5 leading-relaxed">
        {children}
      </div>
    </div>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[11px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-3 py-1.5 text-gray-800 dark:text-gray-200 my-1.5">
      {children}
    </p>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <p>
      <span className="font-medium text-gray-500 dark:text-gray-400">{label}: </span>
      {value}
    </p>
  );
}

function Pill({ children, color }: { children: React.ReactNode; color: "green" | "red" | "gray" }) {
  const cls =
    color === "green"
      ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
      : color === "red"
        ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
        : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300";
  return (
    <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${cls}`}>
      {children}
    </span>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

export function FAQModal({ onClose }: FAQModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-4 sm:p-8"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-3xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 my-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h1 className="text-base font-bold text-gray-900 dark:text-white">
              Methodology &amp; Bloomberg Fields
            </h1>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              How each Bloomberg-enriched metric is calculated
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="px-6 py-6 overflow-y-auto max-h-[calc(100vh-10rem)]">

          {/* ── Bloomberg Data Sources ───────────────────────────────────── */}
          <Section title="Bloomberg Data Sources">
            <Entry name="Arrival Price" tag="/snapshot">
              <Row label="Bloomberg call" value="IntradayTick snapshot at orderTime (TRADE event)" />
              <Row label="Fallback" value="First open price from the nearest 1-min bar if no tick is available" />
              <p>The price of the security at the moment the order was submitted. Used as the benchmark for Implementation Shortfall.</p>
            </Entry>

            <Entry name="1-Minute Intraday Bars" tag="IntradayBarRequest">
              <Row label="Window" value="orderTime − 5 min → end-of-day (EOD close)" />
              <Row label="Fields per bar" value="open, high, low, close, volume, numEvents" />
              <p>The primary data source for VWAP, TWAP (long orders), volatility, participation rate, and all reversion benchmarks.</p>
            </Entry>

            <Entry name="Bid/Ask Ticks" tag="IntradayTickRequest · BID/ASK">
              <Row label="Window" value="orderTime − 2 min → lastFillTime + 30 s" />
              <Row label="Fields per tick" value="time, bid, ask" />
              <p>Used exclusively for TWAS (Time-Weighted Average Spread). Not used for price benchmarks.</p>
            </Entry>

            <Entry name="Trade Ticks (Last Traded)" tag="IntradayTickRequest · TRADE">
              <Row label="Window" value="orderTime → lastFillTime + 30 s" />
              <Row label="Fields per tick" value="time, last price, size" />
              <p>Used for market VWAP on short orders (≤ 5 min) and for running market TWAP on all single-order durations. These are actual exchange prints, not quoted bid/ask mid-prices.</p>
            </Entry>

            <Entry name="Reference Data" tag="ReferenceDataRequest">
              <Row label="HIST_VOL_30D" value="30-day historical annualised volatility (%)" />
              <Row label="VOLUME_AVG_30D" value="30-day average daily volume (contracts)" />
              <p>Fetched once per unique symbol. Used for Market Impact estimation.</p>
            </Entry>
          </Section>

          {/* ── Execution Benchmarks ─────────────────────────────────────── */}
          <Section title="Execution Benchmarks">
            <Entry name="Arrival Price">
              <p>The Bloomberg snapshot price at orderTime. See <em>Bloomberg Data Sources</em> above for fetch details.</p>
            </Entry>

            <Entry name="Implementation Shortfall (IS)" tag="bps">
              <Formula>IS = (avgFillPrice − arrivalPrice) / arrivalPrice × sideSign × 10,000</Formula>
              <Row label="sideSign" value="+1 for BUY, −1 for SELL" />
              <Row label="Favorable" value={<Pill color="green">negative</Pill>} />
              <Row label="Adverse" value={<Pill color="red">positive</Pill>} />
              <p>Measures the total slippage cost of the order versus the price at decision time. A BUY that fills above arrival, or a SELL that fills below arrival, incurs a positive (adverse) IS.</p>
            </Entry>

            <Entry name="VWAP Deviation" tag="bps">
              <Formula>VWAP Dev = (avgFillPrice − marketVWAP) / marketVWAP × sideSign × 10,000</Formula>
              <Row
                label="marketVWAP source (short orders ≤ 5 min)"
                value="Σ(lastPrice × size) / Σ(size) from Bloomberg TRADE ticks over [orderTime, lastFillTime]"
              />
              <Row
                label="marketVWAP source (long orders > 5 min)"
                value="Σ(barClose × barVolume) / Σ(barVolume) from 1-min bars over [orderTime, lastFillTime]"
              />
              <Row label="Favorable" value={<Pill color="green">negative</Pill>} />
              <Row label="Adverse" value={<Pill color="red">positive</Pill>} />
              <p>Compares your average fill price to the market's volume-weighted average over the same window. Outperforming VWAP means you bought below (or sold above) the market average.</p>
            </Entry>

            <Entry name="TWAP Deviation" tag="bps">
              <Formula>TWAP Dev = (avgFillPrice − marketTWAP) / marketTWAP × sideSign × 10,000</Formula>
              <Row
                label="marketTWAP source (short orders ≤ 5 min)"
                value="Simple average of (bid+ask)/2 from Bloomberg bid/ask ticks over [orderTime, lastFillTime]"
              />
              <Row
                label="marketTWAP source (long orders > 5 min)"
                value="Simple average of (barOpen+barClose)/2 across 1-min bars over [orderTime, lastFillTime]"
              />
              <Row label="Favorable" value={<Pill color="green">negative</Pill>} />
              <Row label="Adverse" value={<Pill color="red">positive</Pill>} />
              <p>Time-weighted benchmark: each minute (or tick) contributes equally regardless of volume. Useful for evaluating participation-rate strategies where you aim to track the schedule, not the volume.</p>
            </Entry>
          </Section>

          {/* ── Market Context ───────────────────────────────────────────── */}
          <Section title="Market Context">
            <Entry name="Market Impact (MI)" tag="bps · Almgren/Chriss model">
              <Formula>MI = σ_daily × sideSign × √(Q / ADV) × 10,000</Formula>
              <Row label="σ_daily" value="Realised daily volatility (fraction) from Bloomberg HIST_VOL_30D ÷ 100 ÷ √252" />
              <Row label="Q" value="Order quantity (contracts)" />
              <Row label="ADV" value="30-day average daily volume from Bloomberg VOLUME_AVG_30D" />
              <Row label="Q/ADV clipped to" value="[0, 1]" />
              <Row label="Positive" value={<><Pill color="red">cost</Pill> — you moved the market against yourself</>} />
              <p>An estimate of the price impact caused by the order itself. Larger orders relative to ADV in more volatile names produce higher estimated impact.</p>
            </Entry>

            <Entry name="1σ Volatility (price &amp; bps)" tag="sample std dev">
              <Formula>σ_price = stdDev( (barHigh + barLow) / 2 ) over [orderTime, lastFillTime]</Formula>
              <Formula>σ_bps = σ_price / mean(barMidpoints) × 10,000</Formula>
              <Row label="Source (long orders ≥ 2 bars)" value="(high+low)/2 per 1-min bar — bar midpoint represents where price spent time, not just the closing tick" />
              <Row label="Source (short orders, fallback)" value="(bid+ask)/2 from Bloomberg bid/ask ticks" />
              <p>The one-standard-deviation price range of the market during the execution window. High vol during a low-IS order indicates good execution in a turbulent environment.</p>
            </Entry>

            <Entry name="TWAS — Time-Weighted Average Spread" tag="bps">
              <Formula>TWAS = Σ( spreadᵢ_bps × Δtᵢ ) / totalDuration</Formula>
              <Formula>spreadᵢ_bps = (askᵢ − bidᵢ) / midᵢ × 10,000</Formula>
              <Row label="Δtᵢ" value="Time tick i was valid (until next tick, or lastFillTime for the final tick)" />
              <Row label="Source" value="Bloomberg bid/ask ticks over [orderTime − 2 min, lastFillTime + 30 s]" />
              <p>A liquidity environment proxy: how wide the market spread was, on average, while the order was executing. Comparing TWAS to IS helps distinguish execution skill from market conditions — high IS in a wide-spread environment is less concerning than high IS with a tight spread.</p>
            </Entry>
          </Section>

          {/* ── Post-Trade Reversion ─────────────────────────────────────── */}
          <Section title="Post-Trade Price Reversion">
            <Entry name="Reversion at +1 m / +5 m / +30 m / EOD" tag="bps">
              <Formula>Reversion_t = (priceAtT − avgFillPrice) / avgFillPrice × −sideSign × 10,000</Formula>
              <Row label="priceAtT" value="Bloomberg 1-min bar close price at lastFillTime + t" />
              <Row label="EOD" value="Last available bar close before market close on the trade date" />
              <Row label="Fallback" value="If no bar exists at the offset (e.g. market closed), avgFillPrice is used → 0 bps" />
              <Row label="Positive" value={<><Pill color="green">favorable</Pill> — price reverted back toward arrival (temporary impact)</>} />
              <Row label="Negative" value={<><Pill color="red">adverse</Pill> — price continued away from fill (permanent impact / information leakage)</>} />
              <p>
                Measures whether the price moved caused by your order was temporary (it reversed) or permanent (it persisted).
                A BUY that filled high but saw the price fall back registers positive reversion.
                A pattern of large negative reversion may indicate information leakage or adverse selection.
              </p>
            </Entry>
          </Section>

          {/* ── Single Order Charts ──────────────────────────────────────── */}
          <Section title="Single Order Page — Additional Metrics">
            <Entry name="Participation Rate">
              <Formula>Participation Rate = totalOrderQty / exchangeVolumeInWindow</Formula>
              <Row label="exchangeVolumeInWindow" value="Sum of Bloomberg 1-min bar volumes over [orderTime, lastFillTime]" />
              <p>What fraction of total market volume during the order window your order represented. High participation may increase market impact; low participation may indicate excessive caution.</p>
            </Entry>

            <Entry name="Running Market VWAP (Cumulative Fill VWAP chart)" tag="per-fill line">
              <Row
                label="Short orders (≤ 5 min)"
                value="At each fill: Σ(lastPrice × size) / Σ(size) from Bloomberg TRADE ticks over [orderTime, fillSecond]"
              />
              <Row
                label="Long orders (> 5 min)"
                value="At each fill: Σ(barClose × barVolume) / Σ(barVolume) from 1-min bars over [orderTime, fillMinute]"
              />
              <p>The evolving volume-weighted average price of the market from order submission up to each fill. Plotted as the blue dashed line on the Cumulative Fill VWAP chart. When your running fill average (green) tracks at or below (BUY) / above (SELL) this line, you are outperforming VWAP in real time.</p>
            </Entry>

            <Entry name="Running Market TWAP (Cumulative Fill TWAP chart)" tag="per-fill line">
              <Row
                label="All order durations"
                value="At each fill: simple average of last-traded prices from Bloomberg TRADE ticks over [orderTime, fillSecond]"
              />
              <p>The evolving time-weighted average price of the market from order submission up to each fill, always computed from Bloomberg TRADE ticks regardless of order duration. Plotted as the amber dashed line on the Cumulative Fill TWAP chart. Trade ticks are used (not bar midpoints) to avoid introducing bar-boundary rounding artefacts.</p>
            </Entry>
          </Section>

          {/* ── Sign Convention ──────────────────────────────────────────── */}
          <Section title="Sign Convention Summary">
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                    <th className="text-left px-3 py-2 font-medium">Metric</th>
                    <th className="text-left px-3 py-2 font-medium">Favorable</th>
                    <th className="text-left px-3 py-2 font-medium">Adverse</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-gray-700 dark:text-gray-300">
                  {[
                    ["IS (bps)", "negative", "positive"],
                    ["VWAP Deviation (bps)", "negative", "positive"],
                    ["TWAP Deviation (bps)", "negative", "positive"],
                    ["Market Impact (bps)", "—", "positive (always a cost)"],
                    ["Reversion (bps)", "positive (price reverts)", "negative (price persists)"],
                    ["TWAS (bps)", "context only", "context only"],
                    ["Volatility", "context only", "context only"],
                    ["Participation Rate", "context only", "context only"],
                  ].map(([metric, fav, adv]) => (
                    <tr key={metric}>
                      <td className="px-3 py-2 font-mono text-[11px]">{metric}</td>
                      <td className="px-3 py-2"><Pill color={fav === "context only" ? "gray" : "green"}>{fav}</Pill></td>
                      <td className="px-3 py-2"><Pill color={adv === "context only" ? "gray" : "red"}>{adv}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

        </div>
      </div>
    </div>
  );
}

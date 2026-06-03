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
              <Row label="Bloomberg call" value="(bid + ask) / 2 — mid-price from the nearest bid/ask tick at orderTime" />
              <Row label="Fallback" value="(barOpen + barClose) / 2 from the 1-min bar covering orderTime, if no bid/ask tick is available" />
              <p>The mid-price of the security at the moment the order was submitted — the average of the best bid and best ask at Order Start time. Used as the benchmark for Implementation Shortfall.</p>
            </Entry>

            <Entry name="1-Minute Intraday Bars" tag="IntradayBarRequest">
              <Row label="Window" value="orderTime − 5 min → end-of-day (EOD close)" />
              <Row label="Fields per bar" value="open, high, low, close, volume, numEvents" />
              <p>Primary data source for volatility, participation rate, and post-trade reversion benchmarks. Also used as a fallback for VWAP when the trade-tick stream is empty.</p>
            </Entry>

            <Entry name="Bid/Ask Ticks" tag="IntradayTickRequest · BID/ASK">
              <Row label="Window" value="orderTime − 2 min → lastFillTime + 30 s" />
              <Row label="Fields per tick" value="time, bid, ask" />
              <p>Used for TWAS (Time-Weighted Average Spread) and for the arrival price snapshot. Not used for VWAP or TWAP price benchmarks.</p>
            </Entry>

            <Entry name="Trade Ticks (Last Traded)" tag="IntradayTickRequest · TRADE">
              <Row label="Window" value="orderTime → lastFillTime + 30 s" />
              <Row label="Fields per tick" value="time, last price, size" />
              <p>Used for market VWAP (all order durations on the single-order page), time-weighted market TWAP, and participation rate volume denominator. These are actual exchange prints, not quoted bid/ask mid-prices.</p>
            </Entry>

            <Entry name="Reference Data" tag="ReferenceDataRequest">
              <Row label="HIST_VOL_30D" value="30-day historical annualised volatility (%)" />
              <Row label="VOLUME_AVG_30D" value="30-day average daily volume (contracts)" />
              <p>Fetched once per unique symbol. Used for Market Impact estimation.</p>
            </Entry>

            <Entry name="FIX File Symbol Resolution" tag="tag 48 / tag 55">
              <Row label="Primary" value="Tag 48 — SecurityID (raw RIC code, e.g. ESc1, CLZ4)" />
              <Row label="Fallback" value="Tag 55 — Symbol (used when tag 48 is absent)" />
              <p>When loading FIX execution report files, the parser prefers tag 48 (SecurityID) over tag 55 (Symbol) for the instrument identifier. Tag 48 typically carries a purer RIC code. A Bloomberg symbol mapping or manual override on the Single Order page will still apply on top of whichever tag is used.</p>
            </Entry>
          </Section>

          {/* ── Execution Benchmarks ─────────────────────────────────────── */}
          <Section title="Execution Benchmarks">
            <Entry name="Arrival Price">
              <p>The mid-price of the security at Order Start time — <strong>(bid + ask) / 2</strong> from the nearest Bloomberg bid/ask tick. This is the price at which you could theoretically trade at the moment the order was submitted, before any execution impact. See <em>Bloomberg Data Sources → Arrival Price</em> for fallback details.</p>
            </Entry>

            <Entry name="Implementation Shortfall (IS)" tag="bps">
              <Formula>IS = (avgFillPrice − arrivalPrice) / arrivalPrice × sideSign × 10,000</Formula>
              <Row label="sideSign" value="+1 for BUY, −1 for SELL" />
              <Row label="Favorable" value={<Pill color="green">negative</Pill>} />
              <Row label="Adverse" value={<Pill color="red">positive</Pill>} />
              <p>Measures the total slippage cost of the order versus the price at decision time. A BUY that fills above arrival, or a SELL that fills below arrival, incurs a positive (adverse) IS. On the Single Order Parent Summary, IS is computed at the parent order level using the qty-weighted average fill price (fillVWAP) versus the arrival price.</p>
            </Entry>

            <Entry name="VWAP Deviation" tag="bps">
              <Formula>VWAP Dev = (avgFillPrice − marketVWAP) / marketVWAP × sideSign × 10,000</Formula>
              <Row
                label="marketVWAP source (single-order page)"
                value="Σ(lastPrice × size) / Σ(size) from Bloomberg TRADE ticks over [orderTime, lastFillTime] — all order durations. 1-min bar Σ(close × volume) / Σ(volume) used only as fallback when tick stream is empty."
              />
              <Row
                label="marketVWAP source (multi-order page)"
                value="Σ(lastPrice × size) / Σ(size) from TRADE ticks for orders ≤ 5 min; Σ(barClose × barVolume) / Σ(barVolume) from 1-min bars for orders > 5 min"
              />
              <Row label="Favorable" value={<Pill color="green">negative</Pill>} />
              <Row label="Adverse" value={<Pill color="red">positive</Pill>} />
              <p>Compares your average fill price to the market's volume-weighted average over the same execution window. On the single-order page, marketVWAP is computed from actual exchange prints for all order durations, matching the Bloomberg terminal figure precisely.</p>
            </Entry>

            <Entry name="TWAP Deviation" tag="bps">
              <Formula>TWAP Dev = (avgFillPrice − marketTWAP) / marketTWAP × sideSign × 10,000</Formula>
              <Row
                label="marketTWAP source (single-order page)"
                value="True time-weighted average: Σ(price_i × holdDuration_i) / windowDuration — each last-traded price is weighted by how long it prevailed until the next tick (or window end). The first tick is extended back to orderTime so the full window is always covered."
              />
              <Row
                label="marketTWAP source (multi-order page)"
                value="Simple average of (barOpen + barClose) / 2 across 1-min bars over [orderTime, lastFillTime]"
              />
              <Row label="Favorable" value={<Pill color="green">negative</Pill>} />
              <Row label="Adverse" value={<Pill color="red">positive</Pill>} />
              <p>Time-weighted benchmark: price is weighted by the duration it held, not by volume. A quiet period counts more than a burst of prints at the same price level. On the single-order page, this matches how Bloomberg computes TWAP.</p>
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
              <p className="text-gray-400 dark:text-gray-500 text-[11px] italic">Parent Order Summary: shows the qty-weighted average of MI across all fills in the order.</p>
            </Entry>

            <Entry name="1σ Volatility (price &amp; bps)" tag="sample std dev">
              <Formula>σ_price = stdDev( (barHigh + barLow) / 2 ) over [orderTime, lastFillTime]</Formula>
              <Formula>σ_bps = σ_price / mean(barMidpoints) × 10,000</Formula>
              <Row label="Source (long orders ≥ 2 bars)" value="(high+low)/2 per 1-min bar — bar midpoint represents where price spent time, not just the closing tick" />
              <Row label="Source (short orders, fallback)" value="last-traded price from Bloomberg TRADE ticks" />
              <p>The one-standard-deviation price range of the market during the execution window. High vol during a low-IS order indicates good execution in a turbulent environment.</p>
            </Entry>

            <Entry name="TWAS — Time-Weighted Average Spread" tag="bps">
              <Formula>TWAS = Σ( spreadᵢ_bps × Δtᵢ ) / totalDuration</Formula>
              <Formula>spreadᵢ_bps = (askᵢ − bidᵢ) / midᵢ × 10,000</Formula>
              <Row label="Δtᵢ" value="Time tick i was valid (until next tick, or lastFillTime for the final tick)" />
              <Row label="Source (per fill)" value="Bloomberg bid/ask ticks filtered to [orderTime, lastFillTime] for that fill" />
              <Row label="Source (Parent Order Summary)" value="Single TWAS computed over the full parent order window [orderTime, lastFillTime] — not an average of per-fill values" />
              <p>A liquidity environment proxy: how wide the market spread was, on average, while the order was executing. Comparing TWAS to IS helps distinguish execution skill from market conditions — high IS in a wide-spread environment is less concerning than high IS with a tight spread.</p>
            </Entry>

            <Entry name="Trend Cost" tag="bps · IS decomposition">
              <Formula>Trend Cost = IS − Market Impact − TWAS / 2</Formula>
              <Row label="IS" value="Implementation Shortfall (see above)" />
              <Row label="Market Impact" value="Almgren/Chriss estimated impact (see above)" />
              <Row label="TWAS / 2" value="Estimated one-way spread cost (half the time-weighted average spread)" />
              <Row label="Favorable" value={<Pill color="green">negative</Pill>} />
              <Row label="Adverse" value={<Pill color="red">positive</Pill>} />
              <p>
                The residual execution cost after removing the two explainable components of IS: the estimated price impact you caused yourself (Market Impact) and the cost of crossing the bid/ask spread (TWAS/2). What remains is attributed to adverse market drift — the market moving against you during the execution window for reasons unrelated to your own order.
              </p>
              <p>
                A negative Trend Cost means the market drifted in your favour during execution (you benefited from timing). A positive Trend Cost means the market moved adversely. Only shown on the Single Order Parent Summary when all three inputs are available (Bloomberg enrichment required).
              </p>
            </Entry>
          </Section>

          {/* ── Post-Trade Reversion ─────────────────────────────────────── */}
          <Section title="Post-Trade Price Reversion">
            <Entry name="Reversion at +30 s and +1 m" tag="bps">
              <p className="font-medium text-gray-700 dark:text-gray-200">Per-fill (Fill Detail table):</p>
              <Formula>Reversion_t = (priceAtT − avgFillPrice) / avgFillPrice × −sideSign × 10,000</Formula>
              <p className="font-medium text-gray-700 dark:text-gray-200 mt-2">Parent Order Summary (Single Order page):</p>
              <Formula>Reversion_1m = (price_1m_after_lastFill − benchmarkPrice) / benchmarkPrice × −sideSign × 10,000</Formula>
              <Row label="benchmarkPrice" value="Arrival Price for Arrival/other algos · Market VWAP for VWAP algo · Market TWAP for TWAP algo (follows the selected algo's highlighted benchmark)" />
              <Row label="price_1m_after_lastFill" value="Bloomberg 1-min bar close at the parent order's lastFillTime + 1 min" />
              <Row
                label="+30 s price source (per fill)"
                value="Last Bloomberg TRADE tick at or before lastFillTime + 30 s — the actual last-traded market price. Tick window is fetched to lastFillTime + 35 s for a 5-second capture buffer."
              />
              <Row
                label="+1 m price source (per fill)"
                value="Bloomberg 1-min bar close at lastFillTime + 1 min — last traded price in that minute bar."
              />
              <Row label="Fallback" value="If no tick / bar is available at the mark, avgFillPrice is used → 0 bps (conservative no-data signal)" />
              <Row label="Positive" value={<><Pill color="green">favorable</Pill> — price reverted back (temporary impact)</>} />
              <Row label="Negative" value={<><Pill color="red">adverse</Pill> — price continued away (permanent impact / information leakage)</>} />
              <p>
                Measures whether the price movement caused by your order was temporary (it reversed) or permanent (it persisted).
                A BUY that filled high but saw the price fall back within 30 s or 1 m registers positive reversion.
                Consistent negative reversion may indicate information leakage or adverse selection.
              </p>
              <p>
                On the Parent Order Summary, Reversion 1m is computed relative to the selected algo's primary benchmark rather than the fill price, so it answers: "did the market return to the benchmark level after the order completed?" The active algo is selected from the Execution Algo dropdown on the Single Order page.
              </p>
            </Entry>
          </Section>

          {/* ── Single Order Page ────────────────────────────────────────── */}
          <Section title="Single Order Page — Additional Metrics">
            <Entry name="Parent Order Summary — column layout">
              <p>The Parent Order Summary card is divided into three columns:</p>
              <Row label="Order Details" value="Total Qty, Order Avg. Price (fillVWAP), Duration, Participation Rate, Order Start (UTC), Order End Time (UTC)" />
              <Row label="Market Conditions" value="1σ Vol (bps), 1σ Vol (price), Impact (bps), Reversion 1m (bps), TWAS (bps), Trend Cost (bps)" />
              <Row label="Benchmark Performance" value="Arrival Price with IS (bps) · Market VWAP with VWAP Slippage · Market TWAP with TWAP Slippage — the card corresponding to the selected Execution Algo is highlighted" />
              <p className="text-gray-400 dark:text-gray-500 text-[11px] italic">Market Conditions metrics are computed at the parent order level across the full [orderTime, lastFillTime] window — see individual metric entries for details.</p>
            </Entry>

            <Entry name="Participation Rate">
              <Formula>Participation Rate = totalOrderQty / Σ(tradeTickSize) over [orderTime, lastFillTime]</Formula>
              <Row label="Volume denominator" value="Sum of Bloomberg TRADE tick sizes (actual exchange prints) within the order window — not 1-min bar volumes" />
              <p>What fraction of total market volume during the order window your order represented. High participation may increase market impact; low participation may indicate excessive caution.</p>
            </Entry>

            <Entry name="Running Market VWAP (Cumulative Fill VWAP chart)" tag="per-fill line">
              <Row
                label="All order durations"
                value="At each fill: Σ(lastPrice × size) / Σ(size) from Bloomberg TRADE ticks over [orderTime, fillTime]. 1-min bar Σ(close × volume) / Σ(volume) used as fallback if ticks are unavailable."
              />
              <p>The evolving volume-weighted average price of the market from order submission up to each fill — computed from actual exchange prints for all order durations. Plotted as the blue dashed line on the Cumulative Fill VWAP chart. When your running fill average (green) tracks at or below (BUY) / above (SELL) this line, you are outperforming VWAP in real time.</p>
            </Entry>

            <Entry name="Running Market TWAP (Cumulative Fill TWAP chart)" tag="per-fill line">
              <Row
                label="All order durations"
                value="At each fill: Σ(price_i × holdDuration_i) / windowDuration — each last-traded price weighted by how long it prevailed until the next tick (or fill time). First tick extended to orderTime so the full window is covered."
              />
              <p>The evolving time-weighted average price of the market from order submission up to each fill. Plotted as the amber dashed line on the Cumulative Fill TWAP chart. Because each price is weighted by its hold duration rather than by tick count, a 30-second quiet period weighs 30× more than a one-second burst of prints — matching how Bloomberg calculates TWAP.</p>
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
                    ["Trend Cost (bps)", "negative", "positive"],
                    ["Reversion +30s / +1m (bps)", "positive (price reverts)", "negative (price persists)"],
                    ["TWAS (bps)", "context only", "context only"],
                    ["Volatility", "context only", "context only"],
                    ["Participation Rate", "context only", "context only"],
                  ].map(([metric, fav, adv]) => (
                    <tr key={metric}>
                      <td className="px-3 py-2 font-mono text-[11px]">{metric}</td>
                      <td className="px-3 py-2"><Pill color={fav === "context only" || fav === "—" ? "gray" : "green"}>{fav}</Pill></td>
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

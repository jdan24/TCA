/**
 * ImportWizardMulti — post-import configuration wizard for multi-order mode.
 *
 * Inserted between FileDropZone.onComplete and setRawTrades in App.tsx.
 * Lets the user configure symbol / price remapping, algo normalisation, and
 * timestamp adjustments before the data reaches the dashboard.
 *
 * Steps:
 *   1 — Symbol Mapping & Price Scale   (always shown)
 *   2 — Algo Mapping                   (skipped if no algo column in file)
 *   3 — Time Adjustments               (always shown)
 */

import { useState, useMemo } from "react";
import { useSymbolMap } from "@/hooks/useSymbolMap";
import type { TradeRecord } from "@/types";

// ── Constants ─────────────────────────────────────────────────────────────────

const YELLOW_KEYS = [
  "Index", "Comdty", "Equity", "Curncy",
  "Corp",  "Govt",   "Mtge",   "Muni",
] as const;

const ALGO_OPTIONS = [
  "TWAP", "VWAP", "POV", "Pegger", "Sniper", "ArtemIS", "Apollo",
] as const;

// ── UTC helpers (same pattern as ParentSummaryCard) ───────────────────────────

function toInputUtc(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

function parseInputAsUtc(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s + "Z");
  return isNaN(d.getTime()) ? null : d;
}

function fmtUtc(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`
  );
}

// ── Row state types ───────────────────────────────────────────────────────────

interface SymbolRow {
  ric: string;
  bbgTicker: string;
  bbgYellowKey: string;
  priceMultiplier: string; // controlled string input
}

interface AlgoRow {
  fileValue: string;
  mapsTo: string; // "" = keep as-is
}

type OverridesMap = Record<string, { orderTime?: Date; lastFillTime?: Date }>;

// ── Initializers ──────────────────────────────────────────────────────────────

type ExistingMappings = ReturnType<typeof useSymbolMap>["mappings"];

function initSymbolRows(
  trades: TradeRecord[],
  mappings: ExistingMappings,
): SymbolRow[] {
  const uniq = [...new Set(trades.map((t) => t.symbol))].sort();
  return uniq.map((ric) => {
    const ex = mappings.find((m) => m.ric === ric);
    return {
      ric,
      bbgTicker:       ex?.bbgTicker    ?? "",
      bbgYellowKey:    ex?.bbgYellowKey ?? "Index",
      priceMultiplier: ex?.priceMultiplier !== undefined
        ? String(ex.priceMultiplier)
        : "1",
    };
  });
}

function initAlgoRows(trades: TradeRecord[]): AlgoRow[] {
  const uniq = [
    ...new Set(trades.map((t) => t.algo).filter((a): a is string => a !== null)),
  ].sort();
  return uniq.map((fileValue) => {
    const match = ALGO_OPTIONS.find(
      (opt) => opt.toLowerCase() === fileValue.toLowerCase(),
    );
    return { fileValue, mapsTo: match ?? "" };
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StepIndicator({
  current,
  labels,
}: {
  current: number;
  labels: string[];
}) {
  return (
    <div className="flex items-center">
      {labels.map((label, i) => {
        const n = i + 1;
        const done   = n < current;
        const active = n === current;
        return (
          <div key={n} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={[
                  "w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors",
                  done
                    ? "bg-blue-500 text-white"
                    : active
                      ? "bg-blue-600 text-white ring-2 ring-blue-200 dark:ring-blue-800"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500",
                ].join(" ")}
              >
                {done ? "✓" : n}
              </div>
              <span
                className={[
                  "text-[10px] font-medium whitespace-nowrap",
                  active
                    ? "text-blue-600 dark:text-blue-400"
                    : done
                      ? "text-gray-400"
                      : "text-gray-300 dark:text-gray-600",
                ].join(" ")}
              >
                {label}
              </span>
            </div>
            {i < labels.length - 1 && (
              <div
                className={[
                  "h-px w-10 mx-1 mb-3.5 transition-colors",
                  done ? "bg-blue-400" : "bg-gray-200 dark:bg-gray-700",
                ].join(" ")}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Inline time cell — shows the time with a pencil icon; clicking the pencil
 * opens a datetime-local input (same pattern as ParentSummaryCard's
 * EditableTimeRow but adapted for a compact table cell).
 */
function EditableTimeCell({
  date,
  onChange,
}: {
  date: Date;
  onChange: (d: Date) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const [err, setErr] = useState(false);

  function start() {
    setVal(toInputUtc(date));
    setErr(false);
    setEditing(true);
  }
  function confirm() {
    const d = parseInputAsUtc(val);
    if (!d) { setErr(true); return; }
    onChange(d);
    setEditing(false);
    setErr(false);
  }
  function cancel() { setEditing(false); setErr(false); }

  if (editing) {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1">
          <input
            type="datetime-local"
            step="1"
            value={val}
            onChange={(e) => { setVal(e.target.value); setErr(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirm();
              if (e.key === "Escape") cancel();
            }}
            className={[
              "text-[10px] font-mono rounded border px-1 py-0.5 w-36",
              "bg-white dark:bg-gray-800 text-gray-900 dark:text-white",
              "focus:outline-none focus:ring-1 focus:ring-blue-500",
              err ? "border-red-400" : "border-gray-300 dark:border-gray-600",
            ].join(" ")}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          <button
            type="button"
            onClick={confirm}
            title="Confirm (UTC)"
            className="text-green-500 hover:text-green-600 transition-colors"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={cancel}
            title="Cancel"
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {err && (
          <span className="text-[9px] text-red-500">Invalid — use YYYY-MM-DDTHH:MM:SS</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 group">
      <span className="text-[10px] font-mono text-gray-700 dark:text-gray-300 tabular-nums">
        {fmtUtc(date)}
      </span>
      <button
        type="button"
        onClick={start}
        title="Edit time (UTC)"
        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-blue-500 dark:text-gray-600 dark:hover:text-blue-400 transition-all"
      >
        <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
        </svg>
      </button>
    </div>
  );
}

function OffsetRow({
  label,
  sign, min, sec,
  onSign, onMin, onSec,
}: {
  label: string;
  sign: "+" | "-";
  min: number;
  sec: number;
  onSign: (s: "+" | "-") => void;
  onMin: (n: number) => void;
  onSec: (n: number) => void;
}) {
  const hasOffset = min !== 0 || sec !== 0;
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-xs text-gray-500 dark:text-gray-400 w-24 shrink-0">{label}</span>
      <select
        value={sign}
        onChange={(e) => onSign(e.target.value as "+" | "-")}
        className="px-2 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-14"
      >
        <option value="+">+</option>
        <option value="-">−</option>
      </select>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          value={min}
          onChange={(e) => onMin(Math.max(0, parseInt(e.target.value) || 0))}
          className="w-16 px-2 py-1.5 text-xs font-mono rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-right"
        />
        <span className="text-xs text-gray-400 dark:text-gray-500">min</span>
      </div>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          max={59}
          value={sec}
          onChange={(e) =>
            onSec(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))
          }
          className="w-16 px-2 py-1.5 text-xs font-mono rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-right"
        />
        <span className="text-xs text-gray-400 dark:text-gray-500">sec</span>
      </div>
      {hasOffset && (
        <span
          className={`text-xs font-medium tabular-nums ${
            sign === "+"
              ? "text-blue-600 dark:text-blue-400"
              : "text-amber-600 dark:text-amber-400"
          }`}
        >
          {sign}{min > 0 ? `${min}m ` : ""}{sec > 0 ? `${sec}s` : ""}
        </span>
      )}
    </div>
  );
}

// ── Wizard props ──────────────────────────────────────────────────────────────

interface ImportWizardMultiProps {
  trades: TradeRecord[];
  onComplete: (transformed: TradeRecord[]) => void;
  onCancel: () => void;
}

// ── Main component ────────────────────────────────────────────────────────────

export function ImportWizardMulti({
  trades,
  onComplete,
  onCancel,
}: ImportWizardMultiProps) {
  const { mappings, addMapping } = useSymbolMap();

  // Does the imported dataset have any non-null algo values?
  const hasAlgos = useMemo(
    () => trades.some((t) => t.algo !== null),
    [trades],
  );

  // Logical step: 1 = symbol/price, 2 = algo (may be skipped), 3 = time
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // ── Step 1: Symbol & Price ─────────────────────────────────────────────────
  const [symbolRows, setSymbolRows] = useState<SymbolRow[]>(() =>
    initSymbolRows(trades, mappings),
  );

  const unmappedCount = symbolRows.filter((r) => !r.bbgTicker.trim()).length;

  function updateSymbolRow(ric: string, patch: Partial<SymbolRow>) {
    setSymbolRows((rows) =>
      rows.map((r) => (r.ric === ric ? { ...r, ...patch } : r)),
    );
  }

  // ── Step 2: Algo Mapping ───────────────────────────────────────────────────
  const [algoRows, setAlgoRows] = useState<AlgoRow[]>(() => initAlgoRows(trades));

  function updateAlgoRow(fileValue: string, mapsTo: string) {
    setAlgoRows((rows) =>
      rows.map((r) => (r.fileValue === fileValue ? { ...r, mapsTo } : r)),
    );
  }

  // ── Step 3: Time Adjustments ───────────────────────────────────────────────
  const [startSign, setStartSign] = useState<"+" | "-">("+" );
  const [startMin,  setStartMin]  = useState(0);
  const [startSec,  setStartSec]  = useState(0);
  const [endSign,   setEndSign]   = useState<"+" | "-">("+" );
  const [endMin,    setEndMin]    = useState(0);
  const [endSec,    setEndSec]    = useState(0);

  const [showOverrides, setShowOverrides] = useState(false);
  const [overrides, setOverrides] = useState<OverridesMap>({});

  const startOffsetMs = useMemo(
    () => (startSign === "+" ? 1 : -1) * (startMin * 60 + startSec) * 1_000,
    [startSign, startMin, startSec],
  );
  const endOffsetMs = useMemo(
    () => (endSign === "+" ? 1 : -1) * (endMin * 60 + endSec) * 1_000,
    [endSign, endMin, endSec],
  );

  function effectiveOrderTime(trade: TradeRecord): Date {
    return (
      overrides[trade.orderId]?.orderTime ??
      new Date(trade.orderTime.getTime() + startOffsetMs)
    );
  }
  function effectiveLastFillTime(trade: TradeRecord): Date {
    return (
      overrides[trade.orderId]?.lastFillTime ??
      new Date(trade.lastFillTime.getTime() + endOffsetMs)
    );
  }

  function setOrderTimeOverride(orderId: string, d: Date) {
    setOverrides((prev) => ({
      ...prev,
      [orderId]: { ...prev[orderId], orderTime: d },
    }));
  }
  function setLastFillTimeOverride(orderId: string, d: Date) {
    setOverrides((prev) => ({
      ...prev,
      [orderId]: { ...prev[orderId], lastFillTime: d },
    }));
  }
  function clearOverride(orderId: string) {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[orderId];
      return next;
    });
  }

  const overrideCount = Object.keys(overrides).length;

  // ── Navigation ─────────────────────────────────────────────────────────────
  function goNext() {
    if (step === 1) setStep(hasAlgos ? 2 : 3);
    else if (step === 2) setStep(3);
  }
  function goBack() {
    if (step === 3) setStep(hasAlgos ? 2 : 1);
    else if (step === 2) setStep(1);
  }

  // ── Transformation + completion ────────────────────────────────────────────
  function handleComplete() {
    // 1. Build price-multiplier and symbol-replacement lookups.
    //    Also persist each mapped symbol to localStorage.
    const multMap: Record<string, number> = {};
    // Maps original file RIC → full Bloomberg identifier ("ES1 Index")
    const symbolReplace: Record<string, string> = {};

    for (const row of symbolRows) {
      const mult = parseFloat(row.priceMultiplier);
      const effectiveMult = !isNaN(mult) && mult > 0 ? mult : 1;
      if (effectiveMult !== 1) {
        multMap[row.ric] = effectiveMult;
      }

      if (row.bbgTicker.trim()) {
        const fullId = `${row.bbgTicker.trim()} ${row.bbgYellowKey}`;
        symbolReplace[row.ric] = fullId;

        // Persist original-RIC → Bloomberg mapping (for future imports)
        addMapping({
          ric:          row.ric,
          bbgTicker:    row.bbgTicker.trim(),
          bbgYellowKey: row.bbgYellowKey,
          ...(effectiveMult !== 1 ? { priceMultiplier: effectiveMult } : {}),
        });

        // Add a passthrough mapping so resolve("ES1 Index") = "ES1 Index"
        // for Bloomberg API calls after the symbol field is replaced in the store.
        if (fullId !== row.ric) {
          addMapping({
            ric:          fullId,
            bbgTicker:    row.bbgTicker.trim(),
            bbgYellowKey: row.bbgYellowKey,
            ...(effectiveMult !== 1 ? { priceMultiplier: effectiveMult } : {}),
          });
        }
      }
    }

    // 2. Build a remapping lookup for algos that have an explicit mapping.
    const algoMap = new Map<string, string>(
      algoRows
        .filter((r) => r.mapsTo !== "")
        .map((r) => [r.fileValue, r.mapsTo]),
    );

    // 3. Apply all transformations to produce the final trade list.
    const transformed: TradeRecord[] = trades.map((trade) => {
      // Price multiplier (keyed by original file RIC before symbol replacement)
      const mult = multMap[trade.symbol] ?? 1;

      // Replace symbol with full Bloomberg identifier when a mapping exists
      const newSymbol = symbolReplace[trade.symbol] ?? trade.symbol;

      // Scale ALL file-sourced price fields by the same multiplier so they
      // remain aligned with the (scaled) fill price.
      const newArrivalPrice = trade.arrivalPrice !== null ? trade.arrivalPrice * mult : null;
      const newFileVwap     = trade.fileVwap      !== null ? trade.fileVwap      * mult : null;
      const newFileTwap     = trade.fileTwap      !== null ? trade.fileTwap      * mult : null;

      // Algo
      const newAlgo =
        trade.algo !== null && algoMap.has(trade.algo)
          ? algoMap.get(trade.algo)!
          : trade.algo;

      // Timestamps
      const ov           = overrides[trade.orderId];
      const newOrderTime = ov?.orderTime    ?? new Date(trade.orderTime.getTime()    + startOffsetMs);
      const newLastFill  = ov?.lastFillTime ?? new Date(trade.lastFillTime.getTime() + endOffsetMs);
      // firstFillTime always shifts by the same amount as orderTime
      const newFirstFill = new Date(trade.firstFillTime.getTime() + startOffsetMs);

      return {
        ...trade,
        symbol:        newSymbol,
        avgFillPrice:  trade.avgFillPrice * mult,
        arrivalPrice:  newArrivalPrice,
        fileVwap:      newFileVwap,
        fileTwap:      newFileTwap,
        algo:          newAlgo,
        orderTime:     newOrderTime,
        firstFillTime: newFirstFill,
        lastFillTime:  newLastFill,
      };
    });

    onComplete(transformed);
  }

  // ── Step indicator ─────────────────────────────────────────────────────────
  const stepLabels = hasAlgos
    ? ["Symbol & Price", "Algo Mapping", "Timestamps"]
    : ["Symbol & Price", "Timestamps"];
  const visibleStep =
    step === 1 ? 1 : step === 2 ? 2 : hasAlgos ? 3 : 2;

  // Unique trades for the per-order override table (one entry per orderId)
  const uniqueTrades = useMemo(() => {
    const seen = new Set<string>();
    return trades.filter((t) => {
      if (seen.has(t.orderId)) return false;
      seen.add(t.orderId);
      return true;
    });
  }, [trades]);

  // First 5 unique orders for the time-adjustment preview
  const previewTrades = useMemo(() => uniqueTrades.slice(0, 5), [uniqueTrades]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="w-full max-w-4xl bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">

      {/* ── Wizard header ─────────────────────────────────────────────────── */}
      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            Configure Import
          </h2>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {trades.length.toLocaleString()} order{trades.length !== 1 ? "s" : ""} ·{" "}
            {[...new Set(trades.map((t) => t.symbol))].length} symbol
            {[...new Set(trades.map((t) => t.symbol))].length !== 1 ? "s" : ""}
          </p>
        </div>
        <StepIndicator current={visibleStep} labels={stepLabels} />
      </div>

      {/* ══════════════ STEP 1: Symbol Mapping & Price Scale ══════════════ */}
      {step === 1 && (
        <>
          <div className="px-6 py-3 border-b border-gray-50 dark:border-gray-800 flex items-center gap-3">
            <div className="flex-1">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">
                Symbol Mapping &amp; Price Scale
              </h3>
              <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                Map file symbols to Bloomberg ticker + yellow key, and set a per-symbol price
                multiplier if your file prices are on a different scale.
              </p>
            </div>
            {unmappedCount > 0 ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-700 whitespace-nowrap">
                {unmappedCount} unmapped
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-700 whitespace-nowrap">
                ✓ all mapped
              </span>
            )}
          </div>

          <div className="overflow-y-auto max-h-[420px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                <tr>
                  <th className="text-left px-6 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    File Symbol
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Bloomberg Ticker
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Yellow Key
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Price Multiplier
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800/60">
                {symbolRows.map((row) => {
                  const mult    = parseFloat(row.priceMultiplier);
                  const isActive = !isNaN(mult) && mult > 0 && mult !== 1;
                  return (
                    <tr
                      key={row.ric}
                      className="hover:bg-gray-50/60 dark:hover:bg-gray-800/30 transition-colors"
                    >
                      {/* File symbol */}
                      <td className="px-6 py-3">
                        <span className="font-mono text-sm font-medium text-gray-900 dark:text-white">
                          {row.ric}
                        </span>
                      </td>

                      {/* Bloomberg ticker input */}
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          placeholder="e.g. ES1"
                          value={row.bbgTicker}
                          onChange={(e) =>
                            updateSymbolRow(row.ric, { bbgTicker: e.target.value })
                          }
                          spellCheck={false}
                          className={[
                            "w-28 px-2.5 py-1.5 text-xs font-mono rounded-md border",
                            "focus:outline-none focus:ring-2 focus:ring-blue-500",
                            "bg-white dark:bg-gray-800 text-gray-900 dark:text-white",
                            row.bbgTicker.trim()
                              ? "border-gray-300 dark:border-gray-600"
                              : "border-amber-300 dark:border-amber-700 placeholder:text-amber-400 dark:placeholder:text-amber-600",
                          ].join(" ")}
                        />
                      </td>

                      {/* Yellow key select */}
                      <td className="px-4 py-3">
                        <select
                          value={row.bbgYellowKey}
                          onChange={(e) =>
                            updateSymbolRow(row.ric, { bbgYellowKey: e.target.value })
                          }
                          className="px-2.5 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {YELLOW_KEYS.map((k) => (
                            <option key={k} value={k}>{k}</option>
                          ))}
                        </select>
                      </td>

                      {/* Price multiplier input */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="1.0"
                            value={row.priceMultiplier}
                            onChange={(e) =>
                              updateSymbolRow(row.ric, {
                                priceMultiplier: e.target.value,
                              })
                            }
                            className={[
                              "w-24 px-2.5 py-1.5 text-xs font-mono rounded-md border",
                              "focus:outline-none focus:ring-2 focus:ring-blue-500",
                              "bg-white dark:bg-gray-800 text-gray-900 dark:text-white",
                              isActive
                                ? "border-amber-400 dark:border-amber-500"
                                : "border-gray-300 dark:border-gray-600",
                            ].join(" ")}
                          />
                          {isActive && (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium tabular-nums">
                              ×{mult.toFixed(4)}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <button
              type="button"
              onClick={onCancel}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              ↺ Cancel import
            </button>
            <button
              type="button"
              onClick={goNext}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
            >
              Next →
            </button>
          </div>
        </>
      )}

      {/* ══════════════════ STEP 2: Algo Mapping ══════════════════════════ */}
      {step === 2 && (
        <>
          <div className="px-6 py-3 border-b border-gray-50 dark:border-gray-800">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">
              Algo Mapping
            </h3>
            <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
              Map free-text algo values from the file to standard names, or leave
              as&nbsp;"keep as-is" to preserve the original strings.
            </p>
          </div>

          <div className="overflow-y-auto max-h-[420px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                <tr>
                  <th className="text-left px-6 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    File Value
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Maps To
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800/60">
                {algoRows.map((row) => (
                  <tr
                    key={row.fileValue}
                    className="hover:bg-gray-50/60 dark:hover:bg-gray-800/30 transition-colors"
                  >
                    <td className="px-6 py-3">
                      <span className="font-mono text-sm text-gray-800 dark:text-gray-200">
                        &ldquo;{row.fileValue}&rdquo;
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <select
                          value={row.mapsTo}
                          onChange={(e) =>
                            updateAlgoRow(row.fileValue, e.target.value)
                          }
                          className="px-2.5 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[160px]"
                        >
                          <option value="">— keep as-is —</option>
                          {ALGO_OPTIONS.map((a) => (
                            <option key={a} value={a}>{a}</option>
                          ))}
                        </select>
                        {row.mapsTo && (
                          <span className="text-[11px] text-blue-600 dark:text-blue-400 font-medium">
                            → {row.mapsTo}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <button
              type="button"
              onClick={goBack}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              ← Back
            </button>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={goNext}
                className="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={goNext}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
              >
                Next →
              </button>
            </div>
          </div>
        </>
      )}

      {/* ════════════════ STEP 3: Time Adjustments ════════════════════════ */}
      {step === 3 && (
        <>
          <div className="px-6 py-3 border-b border-gray-50 dark:border-gray-800">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">
              Timestamp Adjustments
            </h3>
            <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
              Apply a global offset to every order and fill time, then fine-tune
              individual orders if needed.
            </p>
          </div>

          <div className="px-6 py-5 space-y-6">

            {/* ── Global offsets ─────────────────────────────────────────── */}
            <div className="space-y-2.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                Global Offset
              </p>
              <OffsetRow
                label="Order Start"
                sign={startSign} min={startMin} sec={startSec}
                onSign={setStartSign} onMin={setStartMin} onSec={setStartSec}
              />
              <OffsetRow
                label="Order End"
                sign={endSign} min={endMin} sec={endSec}
                onSign={setEndSign} onMin={setEndMin} onSec={setEndSec}
              />
              <p className="text-[10px] text-gray-400 dark:text-gray-500 pl-[108px]">
                firstFillTime shifts by the same amount as Order Start.
              </p>
            </div>

            {/* ── Preview table ──────────────────────────────────────────── */}
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                Preview — first {previewTrades.length} order{previewTrades.length !== 1 ? "s" : ""}
              </p>
              <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-800">
                <table className="w-full text-[11px]">
                  <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Order ID</th>
                      <th className="text-left px-3 py-2 font-semibold text-gray-400 uppercase tracking-wide">Symbol</th>
                      <th className="text-left px-3 py-2 font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Original Start</th>
                      <th className="text-left px-3 py-2 font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">→ Adjusted Start</th>
                      <th className="text-left px-3 py-2 font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Original End</th>
                      <th className="text-left px-3 py-2 font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">→ Adjusted End</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                    {previewTrades.map((t) => {
                      const adjStart = new Date(t.orderTime.getTime()    + startOffsetMs);
                      const adjEnd   = new Date(t.lastFillTime.getTime() + endOffsetMs);
                      return (
                        <tr
                          key={t.orderId}
                          className="hover:bg-gray-50/60 dark:hover:bg-gray-800/30"
                        >
                          <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300 max-w-[120px] truncate">
                            {t.orderId}
                          </td>
                          <td className="px-3 py-2 font-mono text-gray-600 dark:text-gray-400">
                            {t.symbol}
                          </td>
                          <td className="px-3 py-2 font-mono text-gray-400 dark:text-gray-500 whitespace-nowrap">
                            {fmtUtc(t.orderTime)}
                          </td>
                          <td className={`px-3 py-2 font-mono whitespace-nowrap font-medium ${
                            startOffsetMs !== 0
                              ? "text-blue-600 dark:text-blue-400"
                              : "text-gray-400 dark:text-gray-600"
                          }`}>
                            {fmtUtc(adjStart)}
                          </td>
                          <td className="px-3 py-2 font-mono text-gray-400 dark:text-gray-500 whitespace-nowrap">
                            {fmtUtc(t.lastFillTime)}
                          </td>
                          <td className={`px-3 py-2 font-mono whitespace-nowrap font-medium ${
                            endOffsetMs !== 0
                              ? "text-blue-600 dark:text-blue-400"
                              : "text-gray-400 dark:text-gray-600"
                          }`}>
                            {fmtUtc(adjEnd)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Per-order overrides ─────────────────────────────────────── */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowOverrides((v) => !v)}
                className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <svg
                  className={`h-3 w-3 transition-transform duration-150 ${showOverrides ? "rotate-90" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                Fine-tune individual orders
                {overrideCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 font-bold text-[10px]">
                    {overrideCount} override{overrideCount !== 1 ? "s" : ""}
                  </span>
                )}
              </button>

              {showOverrides && (
                <div className="overflow-y-auto max-h-[320px] rounded-lg border border-gray-100 dark:border-gray-800">
                  <table className="w-full text-[10px]">
                    <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Order ID</th>
                        <th className="text-left px-3 py-2 font-semibold text-gray-400 uppercase tracking-wide">Symbol</th>
                        <th className="text-left px-3 py-2 font-semibold text-gray-400 uppercase tracking-wide">Side</th>
                        <th className="text-left px-3 py-2 font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Order Start (UTC)</th>
                        <th className="text-left px-3 py-2 font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Last Fill (UTC)</th>
                        <th className="px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                      {uniqueTrades.map((t) => {
                        const isOverridden = !!overrides[t.orderId];
                        return (
                          <tr
                            key={t.orderId}
                            className={`transition-colors ${
                              isOverridden
                                ? "bg-blue-50/40 dark:bg-blue-900/10"
                                : "hover:bg-gray-50/60 dark:hover:bg-gray-800/30"
                            }`}
                          >
                            <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300 max-w-[100px] truncate">
                              {t.orderId}
                            </td>
                            <td className="px-3 py-2 font-mono text-gray-600 dark:text-gray-400">
                              {t.symbol}
                            </td>
                            <td className="px-3 py-2">
                              <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${
                                t.side === "BUY"
                                  ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                                  : "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                              }`}>
                                {t.side}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <EditableTimeCell
                                date={effectiveOrderTime(t)}
                                onChange={(d) => setOrderTimeOverride(t.orderId, d)}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <EditableTimeCell
                                date={effectiveLastFillTime(t)}
                                onChange={(d) => setLastFillTimeOverride(t.orderId, d)}
                              />
                            </td>
                            <td className="px-2 py-2 text-right">
                              {isOverridden && (
                                <button
                                  type="button"
                                  onClick={() => clearOverride(t.orderId)}
                                  title="Clear override — revert to global offset"
                                  className="text-gray-300 hover:text-red-400 dark:text-gray-600 dark:hover:text-red-400 transition-colors"
                                >
                                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <button
              type="button"
              onClick={goBack}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={handleComplete}
              className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
            >
              Import &amp; Analyze →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

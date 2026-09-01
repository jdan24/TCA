/**
 * Shared utilities and wrapper components for dashboard charts.
 */

import type { ReactNode } from "react";

// ── Color palette ─────────────────────────────────────────────────────────────

export const PALETTE = [
  "#3b82f6", // blue-500
  "#f59e0b", // amber-500
  "#10b981", // emerald-500
  "#ef4444", // red-500
  "#8b5cf6", // violet-500
  "#06b6d4", // cyan-500
  "#f97316", // orange-500
  "#84cc16", // lime-500
] as const;

/** Stable color from palette by index (wraps). */
export function paletteColor(index: number): string {
  return PALETTE[index % PALETTE.length] ?? "#94a3b8";
}

// ── Number formatters ─────────────────────────────────────────────────────────

/** Format a nullable bps value, e.g. "+2.3 bps" / "-1.1 bps" / "N/A". */
export function fmtBps(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined || !isFinite(v)) return "N/A";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(decimals)} bps`;
}

/**
 * Format a nullable cash amount, e.g. "+$1,240" / "-$310" / "N/A".
 *
 * Sign is explicit so a cost reads differently from a saving at a glance,
 * matching the bps convention: positive is a cost.
 *
 * `currency` is the contract's own currency — there is no FX conversion, so a
 * EUR contract is labelled EUR rather than silently reported as dollars.
 */
export function fmtUsd(
  v: number | null | undefined,
  currency = "USD",
  decimals = 0,
): string {
  if (v === null || v === undefined || !isFinite(v)) return "N/A";
  let body: string;
  try {
    body = Math.abs(v).toLocaleString(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    // Unknown / non-ISO currency code from the file — fall back to a plain number
    body = `${Math.abs(v).toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })} ${currency}`;
  }
  return `${v > 0 ? "+" : v < 0 ? "-" : ""}${body}`;
}

/**
 * Colour class for a signed slippage figure — bps or cash.
 *
 * Positive is a cost everywhere in this app, so favourable (<= 0) is green and a
 * cost is red. Shared rather than written out at each call site because the
 * screen tables and the print layouts had drifted apart once already: print was
 * rendering these figures as plain black text.
 *
 * `dark` adds the dark-mode variants the screen tables use. The print layouts
 * pass false — they render for paper and deliberately carry no dark: classes.
 */
export function slipToneClass(v: number, dark = true): string {
  if (v <= 0) return dark ? "text-green-600 dark:text-green-400" : "text-green-600";
  return dark ? "text-red-500 dark:text-red-400" : "text-red-500";
}

/** Format time-to-fill milliseconds as a human-readable string. */
export function fmtTtf(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  const s = Math.floor(ms / 1_000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return remS > 0 ? `${m}m ${remS}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
}

/** Average of non-null, finite numbers. Returns null when none qualify. */
export function safeAvg(values: (number | null | undefined)[]): number | null {
  const valid = values.filter((v): v is number => typeof v === "number" && isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/**
 * Map a bps value to an HSL color for the timing heatmap.
 *   Favorable (negative) → green
 *   Adverse (positive)   → red
 *   No data              → light gray
 */
export function bpsToHsl(bps: number | null | undefined, absMax: number): string {
  if (bps === null || bps === undefined) return "hsl(0,0%,93%)";
  if (absMax === 0 || !isFinite(bps)) return "hsl(0,0%,100%)";
  const t = Math.max(-1, Math.min(1, bps / absMax));
  const hue = t <= 0 ? 120 : 0;
  const sat = Math.round(Math.abs(t) * 65);
  const light = Math.round(100 - Math.abs(t) * 30);
  return `hsl(${hue},${sat}%,${light}%)`;
}

// ── Shared wrapper components ─────────────────────────────────────────────────

interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Optional DOM id — used by html2canvas to capture the card for PDF export. */
  id?: string;
  /** Optional controls rendered top-right, e.g. a display toggle. Hidden in print. */
  actions?: ReactNode;
}

export function ChartCard({ title, subtitle, children, id, actions }: ChartCardProps) {
  return (
    <div id={id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
          {subtitle !== undefined && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>
          )}
        </div>
        {actions !== undefined && (
          <div className="shrink-0 print:hidden">{actions}</div>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * The FX disclosure printed under any table or card showing converted figures.
 *
 * Renders nothing when there is nothing to disclose — native mode, or a report
 * that is entirely USD — so a single-currency report carries no footnote. It is
 * repeated under every such surface rather than stated once at the top, so a
 * figure cannot be read, screenshotted or printed apart from the rate that
 * produced it.
 */
export function FxNote({ text }: { text: string }) {
  if (text.trim() === "") return null;
  return (
    <p className="mt-2 text-[10px] text-gray-400 dark:text-gray-500">{text}</p>
  );
}

/** Marker on a figure left in its native currency because no USD rate exists. */
export function UnconvertedMark() {
  return (
    <span
      className="ml-1 text-amber-600 dark:text-amber-400"
      title="No USD rate available for this currency — shown in the contract's own currency. Set one in Symbols, or fetch Bloomberg."
    >
      &#9888;
    </span>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-44 text-sm text-gray-400 dark:text-gray-600 italic text-center px-4">
      {message}
    </div>
  );
}

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
}

export function ChartCard({ title, subtitle, children, id }: ChartCardProps) {
  return (
    <div id={id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
        {subtitle !== undefined && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-44 text-sm text-gray-400 dark:text-gray-600 italic text-center px-4">
      {message}
    </div>
  );
}

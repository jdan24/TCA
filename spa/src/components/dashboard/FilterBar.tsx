/**
 * FilterBar — dataset-level filter controls for the multi-order dashboard.
 *
 * Renders compact dropdowns for categorical dimensions (Symbol, Account ID,
 * Client, Algo) and two date inputs (From / To) for the order-time range.
 *
 * A dimension's dropdown is only shown when the dataset contains ≥ 2 distinct
 * non-null values for that dimension — hiding irrelevant controls when the
 * uploaded file doesn't have that column.
 *
 * Each active filter shows a small × button to clear it independently.
 * A "Clear all" pill appears when ≥ 2 dimensions are active simultaneously.
 */

import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import type { DataFilter, TradeRecord } from "@/types";
import { EMPTY_FILTER } from "@/types";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FilterBarProps {
  /** Full unfiltered trades — used to derive dropdown options. */
  trades: TradeRecord[];
  filter: DataFilter;
  onChange: (f: DataFilter) => void;
}

// ── Main component ────────────────────────────────────────────────────────────

export function FilterBar({ trades, filter, onChange }: FilterBarProps) {
  // Derive distinct option lists from the full (unfiltered) dataset
  const opts = useMemo(() => {
    const symbols = [...new Set(trades.map((t) => t.symbol))].sort();
    const accountIds = [
      ...new Set(trades.map((t) => t.accountId).filter((v): v is string => v !== null)),
    ].sort();
    const accountDescs = [
      ...new Set(
        trades.map((t) => t.accountDescription).filter((v): v is string => v !== null),
      ),
    ].sort();
    const algos = [
      ...new Set(trades.map((t) => t.algo).filter((v): v is string => v !== null)),
    ].sort();
    const allDates = [...new Set(trades.map((t) => t.orderTime.toISOString().slice(0, 10)))].sort();
    const minDate = allDates[0] ?? "";
    const maxDate = allDates[allDates.length - 1] ?? "";

    return { symbols, accountIds, accountDescs, algos, minDate, maxDate };
  }, [trades]);

  const activeCount = [
    filter.symbol,
    filter.accountId,
    filter.accountDescription,
    filter.algo,
    filter.dateFrom,
    filter.dateTo,
  ].filter(Boolean).length;

  function set<K extends keyof DataFilter>(key: K, value: DataFilter[K]) {
    onChange({ ...filter, [key]: value });
  }

  // Nothing to show if every dimension has < 2 values and no dates to range
  const hasDateRange = opts.minDate !== opts.maxDate;
  const hasCategorical =
    opts.symbols.length >= 2 ||
    opts.accountIds.length >= 2 ||
    opts.accountDescs.length >= 2 ||
    opts.algos.length >= 2;

  if (!hasCategorical && !hasDateRange) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 py-2 border-b border-gray-100 dark:border-gray-800">
      {/* ── Categorical dropdowns ─────────────────────────────────────── */}
      {opts.symbols.length >= 2 && (
        <FilterSelect
          label="Symbol"
          options={opts.symbols}
          value={filter.symbol}
          onChange={(v) => set("symbol", v)}
        />
      )}

      {opts.accountIds.length >= 2 && (
        <FilterSelect
          label="Account"
          options={opts.accountIds}
          value={filter.accountId}
          onChange={(v) => set("accountId", v)}
        />
      )}

      {opts.accountDescs.length >= 2 && (
        <FilterSelect
          label="Client"
          options={opts.accountDescs}
          value={filter.accountDescription}
          onChange={(v) => set("accountDescription", v)}
        />
      )}

      {opts.algos.length >= 2 && (
        <FilterSelect
          label="Algo"
          options={opts.algos}
          value={filter.algo}
          onChange={(v) => set("algo", v)}
        />
      )}

      {/* ── Date range ───────────────────────────────────────────────── */}
      {hasDateRange && (
        <DateRangeFilter
          dateFrom={filter.dateFrom}
          dateTo={filter.dateTo}
          minDate={opts.minDate}
          maxDate={opts.maxDate}
          onChange={(from, to) => onChange({ ...filter, dateFrom: from, dateTo: to })}
        />
      )}

      {/* ── Clear all ────────────────────────────────────────────────── */}
      {activeCount >= 2 && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTER)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          <span aria-hidden>✕</span> Clear all
        </button>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface FilterSelectProps {
  label: string;
  options: string[];
  value: string | null;
  onChange: (v: string | null) => void;
}

function FilterSelect({ label, options, value, onChange }: FilterSelectProps) {
  const isActive = value !== null;
  return (
    <div className="flex items-center gap-1">
      <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
        {label}
      </label>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className={[
          "text-xs rounded-lg border py-1 pl-2 pr-6 appearance-none cursor-pointer transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-blue-500",
          isActive
            ? "border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-medium"
            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300",
        ].join(" ")}
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {isActive && (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={`Clear ${label} filter`}
          className="flex items-center justify-center w-4 h-4 rounded-full text-xs text-blue-500 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors leading-none"
        >
          ×
        </button>
      )}
    </div>
  );
}

interface DateRangeFilterProps {
  dateFrom: string | null;
  dateTo: string | null;
  minDate: string;
  maxDate: string;
  onChange: (from: string | null, to: string | null) => void;
}

function DateRangeFilter({ dateFrom, dateTo, minDate, maxDate, onChange }: DateRangeFilterProps) {
  const fmtLabel = (d: string) => {
    try {
      return format(parseISO(d), "MMM d, yyyy");
    } catch {
      return d;
    }
  };

  return (
    <>
      {/* From date */}
      <div className="flex items-center gap-1">
        <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
          From
        </label>
        <input
          type="date"
          value={dateFrom ?? ""}
          min={minDate}
          max={dateTo ?? maxDate}
          onChange={(e) => onChange(e.target.value || null, dateTo)}
          title={dateFrom ? fmtLabel(dateFrom) : "Start date"}
          className={[
            "text-xs rounded-lg border py-1 px-2 cursor-pointer transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-blue-500",
            dateFrom
              ? "border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-medium"
              : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300",
          ].join(" ")}
        />
        {dateFrom && (
          <button
            type="button"
            onClick={() => onChange(null, dateTo)}
            aria-label="Clear from-date filter"
            className="flex items-center justify-center w-4 h-4 rounded-full text-xs text-blue-500 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors leading-none"
          >
            ×
          </button>
        )}
      </div>

      {/* To date */}
      <div className="flex items-center gap-1">
        <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
          To
        </label>
        <input
          type="date"
          value={dateTo ?? ""}
          min={dateFrom ?? minDate}
          max={maxDate}
          onChange={(e) => onChange(dateFrom, e.target.value || null)}
          title={dateTo ? fmtLabel(dateTo) : "End date"}
          className={[
            "text-xs rounded-lg border py-1 px-2 cursor-pointer transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-blue-500",
            dateTo
              ? "border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-medium"
              : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300",
          ].join(" ")}
        />
        {dateTo && (
          <button
            type="button"
            onClick={() => onChange(dateFrom, null)}
            aria-label="Clear to-date filter"
            className="flex items-center justify-center w-4 h-4 rounded-full text-xs text-blue-500 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors leading-none"
          >
            ×
          </button>
        )}
      </div>
    </>
  );
}

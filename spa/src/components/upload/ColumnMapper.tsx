import { useState } from "react";
import {
  FIELD_META,
  OPTIONAL_FIELDS,
  REQUIRED_FIELDS,
} from "@/parsers/autoDetect";
import type { ColumnMapping, OptionalField, RequiredField } from "@/types";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ColumnMapperProps {
  fileName: string;
  headers: string[];
  /** Pre-filled suggestions from autoDetect — may be partial */
  suggested: Partial<ColumnMapping>;
  onConfirm: (mapping: ColumnMapping) => void;
  onCancel: () => void;
}

type MappingState = Record<RequiredField | OptionalField, string>;

const UNMAPPED = "";

// ── Component ─────────────────────────────────────────────────────────────────

export function ColumnMapper({
  fileName,
  headers,
  suggested,
  onConfirm,
  onCancel,
}: ColumnMapperProps) {
  const [state, setState] = useState<MappingState>(() => {
    const init: MappingState = {
      orderId: suggested.orderId ?? UNMAPPED,
      symbol: suggested.symbol ?? UNMAPPED,
      side: suggested.side ?? UNMAPPED,
      orderQty: suggested.orderQty ?? UNMAPPED,
      avgFillPrice: suggested.avgFillPrice ?? UNMAPPED,
      orderTime: suggested.orderTime ?? UNMAPPED,
      firstFillTime: suggested.firstFillTime ?? UNMAPPED,
      lastFillTime: suggested.lastFillTime ?? UNMAPPED,
      arrivalPrice: suggested.arrivalPrice ?? UNMAPPED,
      contractMultiplier: suggested.contractMultiplier ?? UNMAPPED,
      currency: suggested.currency ?? UNMAPPED,
      algo: suggested.algo ?? UNMAPPED,
      accountId: suggested.accountId ?? UNMAPPED,
      accountDescription: suggested.accountDescription ?? UNMAPPED,
      fileVwap: suggested.fileVwap ?? UNMAPPED,
      fileTwap: suggested.fileTwap ?? UNMAPPED,
      brokerOrderId: suggested.brokerOrderId ?? UNMAPPED,
    };
    return init;
  });

  const isValid = REQUIRED_FIELDS.every((f) => state[f] !== UNMAPPED);

  function handleChange(field: RequiredField | OptionalField, col: string) {
    setState((prev) => ({ ...prev, [field]: col }));
  }

  function handleConfirm() {
    if (!isValid) return;
    const mapping: ColumnMapping = {
      orderId: state.orderId,
      symbol: state.symbol,
      side: state.side,
      orderQty: state.orderQty,
      avgFillPrice: state.avgFillPrice,
      orderTime: state.orderTime,
      firstFillTime: state.firstFillTime,
      lastFillTime: state.lastFillTime,
    };
    if (state.arrivalPrice) mapping.arrivalPrice = state.arrivalPrice;
    if (state.contractMultiplier) mapping.contractMultiplier = state.contractMultiplier;
    if (state.currency) mapping.currency = state.currency;
    if (state.algo) mapping.algo = state.algo;
    if (state.accountId) mapping.accountId = state.accountId;
    if (state.accountDescription) mapping.accountDescription = state.accountDescription;
    onConfirm(mapping);
  }

  const autoMatchedCount = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].filter(
    (f) => suggested[f as keyof typeof suggested] !== undefined
  ).length;

  return (
    <div className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
          Map file columns
        </h2>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          <span className="font-mono">{fileName}</span> · {headers.length} columns detected ·{" "}
          {autoMatchedCount} auto-matched
        </p>
      </div>

      {/* Table */}
      <div className="overflow-y-auto max-h-[440px]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
            <tr>
              <th className="text-left px-6 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide w-1/2">
                TCA Field
              </th>
              <th className="text-left px-6 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide w-1/2">
                Your Column
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
            {/* Required fields */}
            {REQUIRED_FIELDS.map((field) => (
              <FieldRow
                key={field}
                field={field}
                required
                headers={headers}
                value={state[field]}
                onChange={(col) => handleChange(field, col)}
              />
            ))}

            {/* Divider */}
            <tr>
              <td
                colSpan={2}
                className="px-6 py-2 bg-gray-50 dark:bg-gray-800/60 text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide"
              >
                Optional — leave unmapped to use defaults or Bloomberg
              </td>
            </tr>

            {/* Optional fields */}
            {OPTIONAL_FIELDS.map((field) => (
              <FieldRow
                key={field}
                field={field}
                required={false}
                headers={headers}
                value={state[field]}
                onChange={(col) => handleChange(field, col)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          ↺ Start over
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!isValid}
          className={[
            "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
            isValid
              ? "bg-blue-600 hover:bg-blue-700 text-white"
              : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed",
          ].join(" ")}
        >
          Confirm & Parse →
        </button>
      </div>
    </div>
  );
}

// ── Sub-component ─────────────────────────────────────────────────────────────

interface FieldRowProps {
  field: RequiredField | OptionalField;
  required: boolean;
  headers: string[];
  value: string;
  onChange: (col: string) => void;
}

function FieldRow({ field, required, headers, value, onChange }: FieldRowProps) {
  const meta = FIELD_META[field];
  const isSet = value !== UNMAPPED;

  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
      {/* Left: field label + description */}
      <td className="px-6 py-3 align-top">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-gray-800 dark:text-gray-200">
            {meta.label}
          </span>
          {required && (
            <span className="text-red-500 text-xs leading-none" title="Required">
              *
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
          {meta.description}
        </p>
      </td>

      {/* Right: dropdown */}
      <td className="px-6 py-3 align-top">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={[
            "w-full rounded-md border px-3 py-1.5 text-sm bg-white dark:bg-gray-900 transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-blue-500",
            isSet
              ? "border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
              : required
                ? "border-amber-300 dark:border-amber-700 text-gray-400 dark:text-gray-500"
                : "border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500",
          ].join(" ")}
        >
          <option value="">
            {required ? "— select a column —" : "Not in file"}
          </option>
          {headers.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>

        {/* Status indicator */}
        {isSet && (
          <span className="mt-1 flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />
            mapped
          </span>
        )}
        {!isSet && required && (
          <span className="mt-1 text-xs text-amber-500">required</span>
        )}
      </td>
    </tr>
  );
}

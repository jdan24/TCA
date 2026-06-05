/**
 * SymbolMappingModal — RIC → Bloomberg symbol mapping table.
 *
 * Allows users to map RIC codes (e.g. "ESc1") to Bloomberg
 * "{ticker} {yellowKey}" format (e.g. "ES1 Index") used by the bridge API.
 * All changes persist to localStorage immediately via useSymbolMap().
 *
 * The modal shows which symbols in the current dataset are mapped / unmapped.
 */

import { useRef, useState } from "react";
import { useSymbolMap } from "@/hooks/useSymbolMap";
import { parseSymbolMapCsv } from "@/parsers/symbolMapCsv";
import { useTCAStore } from "@/store/useTCAStore";
import type { SymbolMapping } from "@/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const YELLOW_KEYS = [
  "Index",
  "Comdty",
  "Equity",
  "Curncy",
  "Corp",
  "Govt",
  "Mtge",
  "Muni",
] as const;

interface SymbolMappingModalProps {
  onClose: () => void;
}

export function SymbolMappingModal({ onClose }: SymbolMappingModalProps) {
  const { mappings, addMapping, updateMapping, deleteMapping, importMappings } = useSymbolMap();
  const rawTrades = useTCAStore((s) => s.rawTrades);
  const setSymbolMapDirty = useTCAStore((s) => s.setSymbolMapDirty);

  // Unique RICs from current dataset
  const datasetRics = [...new Set(rawTrades.map((t) => t.symbol))];
  const mappedRics = new Set(mappings.map((m) => m.ric));

  // Tracks whether mappings changed this session, so we can prompt for a data
  // refresh when the modal closes.
  const [dirty, setDirty] = useState(false);
  // CSV import flow: parsed rows awaiting a replace-vs-add choice, plus status text.
  const [pendingImport, setPendingImport] = useState<SymbolMapping[] | null>(null);
  const [importMsg, setImportMsg] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [newRow, setNewRow] = useState<{
    ric: string;
    bbgTicker: string;
    bbgYellowKey: string;
    priceMultiplier: string;
  }>({
    ric: "",
    bbgTicker: "",
    bbgYellowKey: "Index",
    priceMultiplier: "",
  });

  function handleClose() {
    if (dirty) setSymbolMapDirty(true);
    onClose();
  }

  // Export the current mappings to a .csv (same columns as the import format,
  // so an exported file re-imports cleanly).
  function handleExport() {
    if (mappings.length === 0) return;
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const header = ["Symbol", "Bloomberg Ticker", "Yellow Key", "Price Multiplier"];
    const lines = [header.join(",")];
    for (const m of mappings) {
      const mult = m.priceMultiplier !== undefined && m.priceMultiplier !== 1 ? String(m.priceMultiplier) : "";
      lines.push([esc(m.ric), esc(m.bbgTicker), esc(m.bbgYellowKey), mult].join(","));
    }
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "symbol-mappings.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleAdd() {
    const ric = newRow.ric.trim();
    const ticker = newRow.bbgTicker.trim();
    if (!ric || !ticker) return;
    const mult = parseFloat(newRow.priceMultiplier);
    const isValidMult = !isNaN(mult) && mult > 0 && mult !== 1;
    // Build the mapping object without priceMultiplier when it's not needed —
    // exactOptionalPropertyTypes prohibits passing `priceMultiplier: undefined`.
    const newMapping: SymbolMapping = isValidMult
      ? { ric, bbgTicker: ticker, bbgYellowKey: newRow.bbgYellowKey, priceMultiplier: mult }
      : { ric, bbgTicker: ticker, bbgYellowKey: newRow.bbgYellowKey };
    addMapping(newMapping);
    setDirty(true);
    setNewRow({ ric: "", bbgTicker: "", bbgYellowKey: "Index", priceMultiplier: "" });
  }

  function handleUpdate(ric: string, patch: Partial<SymbolMapping>) {
    updateMapping(ric, patch);
    setDirty(true);
  }

  function handleDelete(ric: string) {
    deleteMapping(ric);
    setDirty(true);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleAdd();
    if (e.key === "Escape") handleClose();
  }

  // ── CSV import ────────────────────────────────────────────────────────────

  async function readCsv(file: File) {
    setImportMsg(null);
    setPendingImport(null);
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setImportMsg({ kind: "error", text: "Please drop a .csv file." });
      return;
    }
    try {
      const { mappings: parsed, skipped } = await parseSymbolMapCsv(file);
      const note = skipped > 0 ? ` (${skipped} row${skipped === 1 ? "" : "s"} skipped)` : "";
      if (mappings.length === 0) {
        // Nothing to merge against — import directly.
        const count = importMappings(parsed, "replace");
        setDirty(true);
        setImportMsg({ kind: "info", text: `Imported ${count} mapping${count === 1 ? "" : "s"}.${note}` });
      } else {
        setPendingImport(parsed);
        setImportMsg({
          kind: "info",
          text: `Found ${parsed.length} mapping${parsed.length === 1 ? "" : "s"} in file.${note} Replace all or add to existing?`,
        });
      }
    } catch (err) {
      setImportMsg({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    }
  }

  function applyImport(strategy: "replace" | "merge") {
    if (!pendingImport) return;
    const count = importMappings(pendingImport, strategy);
    setDirty(true);
    setPendingImport(null);
    setImportMsg({
      kind: "info",
      text: strategy === "replace"
        ? `Replaced table with ${count} mapping${count === 1 ? "" : "s"}.`
        : `Merged — table now has ${count} mapping${count === 1 ? "" : "s"}.`,
    });
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void readCsv(file);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void readCsv(file);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm pt-16 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        className="relative w-full max-w-2xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col max-h-[80vh]"
        onDragOver={(e) => { e.preventDefault(); if (!isDragging) setIsDragging(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDragging(false); }}
        onDrop={handleDrop}
      >

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              Symbol Mapping
            </h2>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Translate RIC codes to Bloomberg ticker + yellow key for the bridge API.
              Changes save automatically.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="sr-only"
              onChange={handleFileInput}
              tabIndex={-1}
              aria-hidden
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title="Bulk-import mappings from a .csv (or drag a file onto this dialog)"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 7.5L12 3m0 0L7.5 7.5M12 3v13.5" />
              </svg>
              Import CSV
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={mappings.length === 0}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Export the current mappings to a .csv to share"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M7.5 12l4.5 4.5m0 0l4.5-4.5m-4.5 4.5V3" />
              </svg>
              Export CSV
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors text-xl leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* CSV import status / replace-vs-add choice */}
        {importMsg && (
          <div
            className={[
              "px-6 py-3 border-b text-xs flex flex-wrap items-center gap-3",
              importMsg.kind === "error"
                ? "bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-900/40 text-red-700 dark:text-red-300"
                : "bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-900/40 text-blue-700 dark:text-blue-300",
            ].join(" ")}
          >
            <span className="flex-1">{importMsg.text}</span>
            {pendingImport ? (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => applyImport("replace")}
                  className="px-2.5 py-1 rounded text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                >
                  Replace all
                </button>
                <button
                  type="button"
                  onClick={() => applyImport("merge")}
                  className="px-2.5 py-1 rounded text-[11px] font-semibold border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                >
                  Add to existing
                </button>
                <button
                  type="button"
                  onClick={() => { setPendingImport(null); setImportMsg(null); }}
                  className="px-2 py-1 rounded text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setImportMsg(null)}
                className="text-current opacity-60 hover:opacity-100 text-base leading-none"
                aria-label="Dismiss"
              >
                ×
              </button>
            )}
          </div>
        )}

        {/* Drag-to-import overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-blue-500/10 dark:bg-blue-500/20 border-2 border-dashed border-blue-400 dark:border-blue-500 rounded-2xl pointer-events-none">
            <p className="text-sm font-semibold text-blue-600 dark:text-blue-300">
              Drop .csv to import mappings
            </p>
          </div>
        )}

        {/* Dataset status */}
        {datasetRics.length > 0 && (
          <div className="px-6 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800 flex flex-wrap gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400 self-center mr-1">
              In current file:
            </span>
            {datasetRics.map((ric) => (
              <span
                key={ric}
                className={[
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium",
                  mappedRics.has(ric)
                    ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                    : "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
                ].join(" ")}
              >
                {mappedRics.has(ric) ? "✓" : "⚠"} {ric}
              </span>
            ))}
          </div>
        )}

        {/* Table */}
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Symbol</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Bloomberg Ticker</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Yellow Key</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Price Multiplier</th>
                <th className="px-4 py-2.5 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {mappings.map((m) => (
                <MappingRow
                  key={m.ric}
                  mapping={m}
                  onUpdate={(patch) => handleUpdate(m.ric, patch)}
                  onDelete={() => handleDelete(m.ric)}
                  onClearMultiplier={() => {
                    // Replace with a fresh mapping that has no priceMultiplier field.
                    addMapping({ ric: m.ric, bbgTicker: m.bbgTicker, bbgYellowKey: m.bbgYellowKey });
                    setDirty(true);
                  }}
                />
              ))}

              {mappings.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-xs text-gray-400 dark:text-gray-600 italic">
                    No mappings yet — add one below
                  </td>
                </tr>
              )}

              {/* Add row */}
              <tr className="bg-blue-50/40 dark:bg-blue-900/10">
                <td className="px-4 py-2.5">
                  <input
                    type="text"
                    value={newRow.ric}
                    onChange={(e) => setNewRow((p) => ({ ...p, ric: e.target.value }))}
                    onKeyDown={handleKeyDown}
                    placeholder="ESc1"
                    className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </td>
                <td className="px-4 py-2.5">
                  <input
                    type="text"
                    value={newRow.bbgTicker}
                    onChange={(e) => setNewRow((p) => ({ ...p, bbgTicker: e.target.value }))}
                    onKeyDown={handleKeyDown}
                    placeholder="ES1"
                    className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </td>
                <td className="px-4 py-2.5">
                  <YellowKeySelect
                    value={newRow.bbgYellowKey}
                    onChange={(v) => setNewRow((p) => ({ ...p, bbgYellowKey: v }))}
                  />
                </td>
                <td className="px-4 py-2.5">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={newRow.priceMultiplier}
                    onChange={(e) => setNewRow((p) => ({ ...p, priceMultiplier: e.target.value }))}
                    onKeyDown={handleKeyDown}
                    placeholder="1.0"
                    className="w-20 px-2 py-1 text-xs font-mono rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </td>
                <td className="px-4 py-2.5 text-center">
                  <button
                    type="button"
                    onClick={handleAdd}
                    disabled={!newRow.ric.trim() || !newRow.bbgTicker.trim()}
                    className="px-2.5 py-1 rounded text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    + Add
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3">
          <span className="text-[11px] text-gray-400 dark:text-gray-500">
            Tip: drag a .csv onto this dialog to bulk-import mappings.
          </span>
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface MappingRowProps {
  mapping: SymbolMapping;
  onUpdate: (patch: Partial<SymbolMapping>) => void;
  onDelete: () => void;
  /** Called when the user blanks out the multiplier — replaces the mapping without the field. */
  onClearMultiplier: () => void;
}

function MappingRow({ mapping, onUpdate, onDelete, onClearMultiplier }: MappingRowProps) {
  const [multStr, setMultStr] = useState(
    mapping.priceMultiplier !== undefined && mapping.priceMultiplier !== 1
      ? String(mapping.priceMultiplier)
      : "",
  );
  const isActive = (() => {
    const n = parseFloat(multStr);
    return !isNaN(n) && n > 0 && n !== 1;
  })();

  function commitMultiplier(s: string) {
    const n = parseFloat(s);
    if (!s.trim() || isNaN(n) || n <= 0 || n === 1) {
      // Can't patch with `priceMultiplier: undefined` (exactOptionalPropertyTypes).
      // Delegate to parent which replaces the entire mapping object without the field.
      onClearMultiplier();
    } else {
      onUpdate({ priceMultiplier: n });
    }
  }

  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
      <td className="px-4 py-2">
        <span className="font-mono text-xs text-gray-700 dark:text-gray-300">{mapping.ric}</span>
      </td>
      <td className="px-4 py-2">
        <input
          type="text"
          value={mapping.bbgTicker}
          onChange={(e) => onUpdate({ bbgTicker: e.target.value })}
          placeholder="—"
          className={`w-full px-2 py-1 text-xs rounded border bg-transparent focus:bg-white dark:focus:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 ${
            mapping.bbgTicker.trim()
              ? "border-gray-200 dark:border-gray-600"
              : "border-amber-300 dark:border-amber-700 placeholder:text-amber-400"
          }`}
        />
      </td>
      <td className="px-4 py-2">
        <YellowKeySelect
          value={mapping.bbgYellowKey}
          onChange={(v) => onUpdate({ bbgYellowKey: v })}
        />
      </td>
      <td className="px-4 py-2">
        <input
          type="text"
          inputMode="decimal"
          value={multStr}
          placeholder="1.0"
          onChange={(e) => setMultStr(e.target.value)}
          onBlur={(e) => commitMultiplier(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commitMultiplier(multStr); }}
          className={`w-20 px-2 py-1 text-xs font-mono rounded border bg-transparent focus:bg-white dark:focus:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 ${
            isActive
              ? "border-amber-400 dark:border-amber-500"
              : "border-gray-200 dark:border-gray-600"
          }`}
        />
        {isActive && (
          <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400 font-medium">
            ×{parseFloat(multStr).toFixed(4)}
          </span>
        )}
      </td>
      <td className="px-4 py-2 text-center">
        <button
          type="button"
          onClick={onDelete}
          className="text-gray-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400 transition-colors text-base leading-none font-bold"
          aria-label={`Delete mapping for ${mapping.ric}`}
        >
          ×
        </button>
      </td>
    </tr>
  );
}

interface YellowKeySelectProps {
  value: string;
  onChange: (v: string) => void;
}

function YellowKeySelect({ value, onChange }: YellowKeySelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
    >
      {YELLOW_KEYS.map((k) => (
        <option key={k} value={k}>{k}</option>
      ))}
    </select>
  );
}

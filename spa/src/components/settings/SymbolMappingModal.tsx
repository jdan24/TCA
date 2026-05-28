/**
 * SymbolMappingModal — RIC → Bloomberg symbol mapping table.
 *
 * Allows users to map RIC codes (e.g. "ESc1") to Bloomberg
 * "{ticker} {yellowKey}" format (e.g. "ES1 Index") used by the bridge API.
 * All changes persist to localStorage immediately via useSymbolMap().
 *
 * The modal shows which symbols in the current dataset are mapped / unmapped.
 */

import { useState } from "react";
import { useSymbolMap } from "@/hooks/useSymbolMap";
import { useTCAStore } from "@/store/useTCAStore";
import type { SymbolMapping } from "@/types";

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
  const { mappings, addMapping, updateMapping, deleteMapping } = useSymbolMap();
  const rawTrades = useTCAStore((s) => s.rawTrades);

  // Unique RICs from current dataset
  const datasetRics = [...new Set(rawTrades.map((t) => t.symbol))];
  const mappedRics = new Set(mappings.map((m) => m.ric));

  const [newRow, setNewRow] = useState<{ ric: string; bbgTicker: string; bbgYellowKey: string }>({
    ric: "",
    bbgTicker: "",
    bbgYellowKey: "Index",
  });

  function handleAdd() {
    const ric = newRow.ric.trim();
    const ticker = newRow.bbgTicker.trim();
    if (!ric || !ticker) return;
    addMapping({ ric, bbgTicker: ticker, bbgYellowKey: newRow.bbgYellowKey });
    setNewRow({ ric: "", bbgTicker: "", bbgYellowKey: "Index" });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleAdd();
    if (e.key === "Escape") onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm pt-16 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col max-h-[80vh]">

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
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

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
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">RIC</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Bloomberg Ticker</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Yellow Key</th>
                <th className="px-4 py-2.5 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {mappings.map((m) => (
                <MappingRow
                  key={m.ric}
                  mapping={m}
                  onUpdate={(patch) => updateMapping(m.ric, patch)}
                  onDelete={() => deleteMapping(m.ric)}
                />
              ))}

              {mappings.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-xs text-gray-400 dark:text-gray-600 italic">
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
        <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
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
}

function MappingRow({ mapping, onUpdate, onDelete }: MappingRowProps) {
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
          className="w-full px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-600 bg-transparent focus:bg-white dark:focus:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </td>
      <td className="px-4 py-2">
        <YellowKeySelect
          value={mapping.bbgYellowKey}
          onChange={(v) => onUpdate({ bbgYellowKey: v })}
        />
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

/**
 * AlgoMappingModal — algo name → benchmark table.
 *
 * Multi-order files carry the algo as free text, so which benchmark an order
 * should be judged against cannot be inferred reliably. This table makes it
 * explicit and drives the Total Cost tile on the multi-order dashboard: every
 * order contributes its cash slippage against the benchmark its algo maps to.
 *
 * Changes persist to localStorage immediately via useAlgoMap(). Algo names in
 * the loaded file that have no entry are listed at the top so the gaps are
 * visible; unmapped names fall back to the arrival-price benchmark.
 */

import { useState } from "react";
import { useAlgoMap } from "@/hooks/useAlgoMap";
import { useTCAStore } from "@/store/useTCAStore";
import type { BenchmarkKind } from "@/types";

const BENCHMARKS: Array<{ value: BenchmarkKind; label: string }> = [
  { value: "arrival", label: "Arrival (IS)" },
  { value: "vwap",    label: "Market VWAP" },
  { value: "twap",    label: "Market TWAP" },
];

interface AlgoMappingModalProps {
  onClose: () => void;
}

export function AlgoMappingModal({ onClose }: AlgoMappingModalProps) {
  const { mappings, addMapping, updateMapping, deleteMapping, resetToDefaults } = useAlgoMap();
  const rawTrades = useTCAStore((s) => s.rawTrades);

  const [newAlgo, setNewAlgo] = useState("");
  const [newBenchmark, setNewBenchmark] = useState<BenchmarkKind>("arrival");

  // Algo names present in the loaded file with no entry in the table.
  const mappedKeys = new Set(mappings.map((m) => m.algo.trim().toLowerCase()));
  const unmapped = [
    ...new Set(
      rawTrades
        .map((t) => (t.algo ?? "").trim())
        .filter((a) => a !== "" && !mappedKeys.has(a.toLowerCase())),
    ),
  ];

  function handleAdd(algo: string, benchmark: BenchmarkKind) {
    const name = algo.trim();
    if (!name) return;
    addMapping({ algo: name, benchmark });
    setNewAlgo("");
    setNewBenchmark("arrival");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm pt-16 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col max-h-[80vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              Algo Benchmarks
            </h2>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Which benchmark each algo is measured against. Drives the Total Cost tile.
              Changes save automatically.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={resetToDefaults}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title="Restore the built-in algo list"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors text-xl leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* Unmapped algos from the current file */}
        {unmapped.length > 0 && (
          <div className="px-6 py-3 bg-amber-50 dark:bg-amber-900/10 border-b border-amber-100 dark:border-amber-900/30">
            <p className="text-xs text-amber-700 dark:text-amber-300 mb-2">
              In the current file with no mapping — these fall back to Arrival (IS):
            </p>
            <div className="flex flex-wrap gap-2">
              {unmapped.map((algo) => (
                <button
                  key={algo}
                  type="button"
                  onClick={() => handleAdd(algo, "arrival")}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
                  title={`Add "${algo}" to the table`}
                >
                  + {algo}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Algo</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Benchmark</th>
                <th className="px-4 py-2.5 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {mappings.map((m) => (
                <tr key={m.algo} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                  <td className="px-4 py-2">
                    <span className="font-mono text-xs text-gray-700 dark:text-gray-300">{m.algo}</span>
                  </td>
                  <td className="px-4 py-2">
                    <BenchmarkSelect
                      value={m.benchmark}
                      onChange={(v) => updateMapping(m.algo, { benchmark: v })}
                    />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => deleteMapping(m.algo)}
                      className="text-gray-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400 transition-colors text-base leading-none font-bold"
                      aria-label={`Delete mapping for ${m.algo}`}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}

              {mappings.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-xs text-gray-400 dark:text-gray-600 italic">
                    No mappings — every algo falls back to Arrival (IS)
                  </td>
                </tr>
              )}

              {/* Add row */}
              <tr className="bg-blue-50/40 dark:bg-blue-900/10">
                <td className="px-4 py-2.5">
                  <input
                    type="text"
                    value={newAlgo}
                    onChange={(e) => setNewAlgo(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAdd(newAlgo, newBenchmark); }}
                    placeholder="VWAP 10%"
                    className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </td>
                <td className="px-4 py-2.5">
                  <BenchmarkSelect value={newBenchmark} onChange={setNewBenchmark} />
                </td>
                <td className="px-4 py-2.5 text-center">
                  <button
                    type="button"
                    onClick={() => handleAdd(newAlgo, newBenchmark)}
                    disabled={!newAlgo.trim()}
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
        <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Matching is case-insensitive but otherwise exact — add "VWAP 10%" separately from "VWAP".
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function BenchmarkSelect({
  value,
  onChange,
}: {
  value: BenchmarkKind;
  onChange: (v: BenchmarkKind) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as BenchmarkKind)}
      className="px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-600 bg-transparent focus:bg-white dark:focus:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
    >
      {BENCHMARKS.map((b) => (
        <option key={b.value} value={b.value} className="dark:bg-gray-800">
          {b.label}
        </option>
      ))}
    </select>
  );
}

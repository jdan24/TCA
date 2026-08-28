/**
 * AlgoFilterMenu — the checkbox menu behind each chart's algo button.
 *
 * Presentational only; the selection itself lives in useChartAlgoFilter. Renders
 * nothing when the dataset has fewer than two algos, since a filter that cannot
 * change anything is only noise in the card header.
 */

import { createPortal } from "react-dom";
import { usePortalMenu } from "@/hooks/usePortalMenu";
import { algoLabel, type ChartAlgoFilter } from "@/hooks/useChartAlgoFilter";

export function AlgoFilterMenu({ filter }: { filter: ChartAlgoFilter }) {
  const { open, btnRef, menuRef, pos, toggle } = usePortalMenu("right");
  const { options, selected, setSelected, isNarrowed } = filter;

  if (options.length < 2) return null;

  function toggleAlgo(algo: string) {
    setSelected(
      selected.includes(algo)
        ? selected.filter((a) => a !== algo)
        : [...selected, algo],
    );
  }

  // "All algos" and "4 algos" mean the same thing when nothing is hidden, so the
  // count only appears once the selection is genuinely a subset.
  const label = !isNarrowed
    ? "All algos"
    : selected.length === 0
      ? "No algos"
      : selected.length === 1
        ? algoLabel(selected[0]!)
        : `${selected.length} algos`;

  return (
    <div className="print:hidden">
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        title={isNarrowed ? selected.map(algoLabel).join(", ") : "Filter which algos are plotted"}
        className={[
          "px-2 py-1 text-[11px] rounded-lg border transition-colors select-none whitespace-nowrap",
          isNarrowed
            ? "border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-medium"
            : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700",
        ].join(" ")}
      >
        {label} &#9662;
      </button>

      {open && pos !== null && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", top: pos.top, right: pos.right }}
          className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-2 z-50 min-w-[180px] max-h-[70vh] overflow-y-auto"
        >
          <div className="flex items-center gap-2 px-2 pb-1.5">
            <button
              type="button"
              onClick={() => setSelected([...options])}
              className="text-[10px] text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
            >
              Select all
            </button>
            <span className="text-[10px] text-gray-300 dark:text-gray-600">&middot;</span>
            <button
              type="button"
              onClick={() => setSelected([])}
              className="text-[10px] text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
            >
              Clear
            </button>
          </div>
          <hr className="mb-1 border-gray-100 dark:border-gray-800" />
          {options.map((o) => (
            <label
              key={o}
              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer text-xs text-gray-700 dark:text-gray-300 select-none"
            >
              <input
                type="checkbox"
                checked={selected.includes(o)}
                onChange={() => toggleAlgo(o)}
                className="rounded accent-blue-500"
              />
              <span className="truncate">{algoLabel(o)}</span>
            </label>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

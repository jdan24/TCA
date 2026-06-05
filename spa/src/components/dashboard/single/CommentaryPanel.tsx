/**
 * CommentaryPanel — isolated analyst-commentary editor for the single-order view.
 *
 * Why this is its own component: the commentary text used to live in
 * SingleOrderDashboard's state, so every keystroke re-rendered the whole
 * dashboard — including every (expensive) Recharts chart. On slower machines
 * that made typing visibly laggy. Here the text lives in local state, so
 * keystrokes only re-render this small panel. The value is pushed up to the
 * parent on a debounce, on blur, and on unmount — the parent only needs it at
 * "point in time" moments (the toolbar dot indicator and when the print layout
 * opens), not on every character.
 */

import { useEffect, useRef, useState } from "react";
import { marked } from "marked";

interface CommentaryPanelProps {
  /** Initial text (read once on mount; later parent updates are ignored). */
  initialValue: string;
  /** Sync the latest text up to the parent. */
  onChange: (value: string) => void;
  /** Close the panel. */
  onClose: () => void;
}

const COMMIT_DEBOUNCE_MS = 400;

export function CommentaryPanel({ initialValue, onChange, onClose }: CommentaryPanelProps) {
  const [text, setText] = useState(initialValue);
  const [tab, setTab] = useState<"edit" | "preview">("edit");

  // Refs let the debounce/unmount callbacks read the latest values without
  // being part of their dependency arrays.
  const textRef = useRef(text);
  textRef.current = text;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function commitNow() {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    onChangeRef.current(textRef.current);
  }

  function handleInput(next: string) {
    setText(next);
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      onChangeRef.current(next);
    }, COMMIT_DEBOUNCE_MS);
  }

  // Flush any pending text up to the parent when the panel unmounts (e.g. the
  // dashboard swaps to the print layout, or the panel is closed).
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      onChangeRef.current(textRef.current);
    };
  }, []);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-gray-800">
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
          Commentary
          <span className="ml-1.5 text-[10px] font-normal text-gray-400">
            · appears in Print Layout
          </span>
        </span>
        <div className="flex items-center gap-0.5">
          {/* Edit / Preview tabs */}
          {(["edit", "preview"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { if (t === "preview") commitNow(); setTab(t); }}
              className={`px-3 py-1 text-xs rounded-md capitalize transition-colors ${
                tab === t
                  ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}
            >
              {t}
            </button>
          ))}
          {/* Close */}
          <button
            type="button"
            onClick={() => { commitNow(); onClose(); }}
            title="Close panel"
            className="ml-2 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="p-4">
        {tab === "edit" ? (
          <textarea
            value={text}
            onChange={(e) => handleInput(e.target.value)}
            onBlur={commitNow}
            placeholder={"Add analysis or notes — Markdown or plain text\n\n## Observations\n- Market was volatile during the execution window\n\n**Bold**, *italic*, `code`, > blockquote"}
            rows={8}
            className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-600 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y font-mono leading-relaxed"
            spellCheck={false}
          />
        ) : (
          <div className="min-h-[120px]">
            {text.trim() ? (
              <div
                className="md-body text-sm text-gray-700 dark:text-gray-300"
                /* Commentary is authored by the user themselves — no third-party input */
                dangerouslySetInnerHTML={{ __html: marked.parse(text, { breaks: true }) as string }}
              />
            ) : (
              <p className="text-sm text-gray-400 italic">Nothing to preview yet — switch to Edit and start typing.</p>
            )}
          </div>
        )}
      </div>

      {/* Footer hint (edit tab only) */}
      {tab === "edit" && (
        <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <p className="text-[11px] text-gray-400">
            Markdown supported ·{" "}
            <span className="font-mono">**bold**</span> ·{" "}
            <span className="font-mono">*italic*</span> ·{" "}
            <span className="font-mono"># Heading</span> ·{" "}
            <span className="font-mono">- list</span> ·{" "}
            <span className="font-mono">&gt; blockquote</span>
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * ModeSelector — two-card landing screen shown before file upload.
 *
 * Lets the user choose between:
 *   • Multi-order TCA (aggregate analytics across a portfolio of orders)
 *   • Single-order TCA (slice-level analysis for one parent order)
 *
 * The selected card gains a blue ring; the choice is persisted in the store.
 */

import type { TCAMode } from "@/types";
import { useTCAStore } from "@/store/useTCAStore";

export function ModeSelector() {
  const mode = useTCAStore((s) => s.mode);
  const setMode = useTCAStore((s) => s.setMode);

  return (
    <div className="w-full max-w-xl">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">
        Select analysis mode
      </p>
      <div className="grid grid-cols-2 gap-3">
        <ModeCard
          mode="single"
          active={mode === "single"}
          onSelect={setMode}
          title="Single Order TCA"
          subtitle="Slice-level execution analysis for one parent order"
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M8.25 6.75h7.5M8.25 9.75h7.5m-7.5 3h4.5M3.75 3h16.5A1.5 1.5 0 0121.75 4.5v15a1.5 1.5 0 01-1.5 1.5H3.75a1.5 1.5 0 01-1.5-1.5v-15A1.5 1.5 0 013.75 3z" />
            </svg>
          }
        />
        <ModeCard
          mode="multi"
          active={mode === "multi"}
          onSelect={setMode}
          title="Multiple Order TCA"
          subtitle="Aggregate analytics across a portfolio of parent orders"
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75.125A1.125 1.125 0 012.25 18.375V15m0 3.375v-3.375m0 0a1.125 1.125 0 011.125-1.125h1.5c.621 0 1.125.504 1.125 1.125M2.25 15V6.75m0 0A1.125 1.125 0 013.375 5.625h1.5C5.496 5.625 6 6.129 6 6.75m-3.75 0v8.25M6 6.75h12M6 6.75V18.375M18 6.75v11.625M18 6.75A1.125 1.125 0 0116.875 5.625h-1.5C14.754 5.625 14.25 6.129 14.25 6.75M18 18.375c0 .621-.504 1.125-1.125 1.125h-1.5A1.125 1.125 0 0114.25 18.375V6.75" />
            </svg>
          }
        />
      </div>
    </div>
  );
}

interface ModeCardProps {
  mode: TCAMode;
  active: boolean;
  onSelect: (m: TCAMode) => void;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
}

function ModeCard({ mode, active, onSelect, title, subtitle, icon }: ModeCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(mode)}
      className={[
        "flex flex-col items-start gap-2 rounded-xl border-2 p-4 text-left transition-all",
        active
          ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
          : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-900",
      ].join(" ")}
    >
      <span className={active ? "text-blue-600 dark:text-blue-400" : "text-gray-400 dark:text-gray-500"}>
        {icon}
      </span>
      <div>
        <p className={`text-sm font-semibold ${active ? "text-blue-700 dark:text-blue-300" : "text-gray-800 dark:text-gray-200"}`}>
          {title}
        </p>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          {subtitle}
        </p>
      </div>
      {active && (
        <span className="mt-auto self-end text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
          Selected ✓
        </span>
      )}
    </button>
  );
}

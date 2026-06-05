/**
 * SymbolRefreshBanner — prompts the user to re-fetch Bloomberg data after the
 * RIC → Bloomberg symbol mappings have changed (via manual edit or CSV import),
 * so the displayed analysis picks up the new mappings.
 */

interface SymbolRefreshBannerProps {
  /** Re-run the Bloomberg fetch with the current mappings. */
  onRefresh: () => void;
  /** Dismiss without refreshing. */
  onDismiss: () => void;
  /** Disable refresh (Bloomberg not connected or a fetch is in progress). */
  disabled: boolean;
  /** True while a fetch is running — shows progress label. */
  busy: boolean;
  /** True when Bloomberg isn't connected — shows an explanatory hint. */
  notConnected: boolean;
}

export function SymbolRefreshBanner({
  onRefresh,
  onDismiss,
  disabled,
  busy,
  notConnected,
}: SymbolRefreshBannerProps) {
  return (
    <div className="print:hidden flex items-center gap-3 px-6 py-2.5 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-900/40">
      <svg className="h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
      </svg>
      <p className="flex-1 text-xs text-amber-800 dark:text-amber-200">
        Symbol mappings changed.{" "}
        {notConnected
          ? "Connect Bloomberg and re-fetch to pick up the new mappings."
          : "Refresh the data to pick up the new mappings."}
      </p>
      <button
        type="button"
        onClick={onRefresh}
        disabled={disabled}
        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? "Refreshing…" : "Refresh data"}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 transition-colors text-lg leading-none"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

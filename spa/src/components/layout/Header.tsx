import { BloombergStatus } from "./BloombergStatus";

export function Header() {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white dark:bg-gray-900 dark:border-gray-700">
      <div className="flex items-center gap-3">
        <span className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">
          Futures TCA
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">
          Transaction Cost Analysis
        </span>
      </div>
      <BloombergStatus />
    </header>
  );
}

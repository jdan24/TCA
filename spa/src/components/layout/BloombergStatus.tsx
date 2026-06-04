/**
 * Bloomberg connection badge.
 *
 * Connected   → simple green indicator (non-interactive).
 * Disconnected → pulsing red button; click opens a "how to start the bridge"
 *                popover with launcher instructions, a copy-command button,
 *                and a 3-second auto-retry loop that closes the popover the
 *                moment the bridge comes online.
 */

import { useEffect, useRef, useState } from "react";
import { checkHealth } from "@/bloomberg/bloombergClient";
import { useTCAStore } from "@/store/useTCAStore";

const POLL_SLOW_MS = 30_000;
const POLL_FAST_MS =  3_000; // while popover is open

const MANUAL_CMD = "python bloomberg-bridge\\bridge.py";

export function BloombergStatus() {
  const connected            = useTCAStore((s) => s.bloombergConnected);
  const setBloombergConnected = useTCAStore((s) => s.setBloombergConnected);

  const [open,     setOpen]     = useState(false);
  const [checking, setChecking] = useState(false);
  const [copied,   setCopied]   = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Auto-close popover when connection is restored.
  useEffect(() => {
    if (connected) setOpen(false);
  }, [connected]);

  // Close on click outside.
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Health polling — slow normally, fast while popover is open.
  useEffect(() => {
    let cancelled = false;
    const interval = open ? POLL_FAST_MS : POLL_SLOW_MS;

    async function poll() {
      const ok = await checkHealth();
      if (!cancelled) setBloombergConnected(ok);
    }

    void poll();
    const id = setInterval(() => { void poll(); }, interval);
    return () => { cancelled = true; clearInterval(id); };
  }, [open, setBloombergConnected]);

  async function recheckNow() {
    setChecking(true);
    const ok = await checkHealth();
    setBloombergConnected(ok);
    setChecking(false);
  }

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(MANUAL_CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — silently ignore */
    }
  }

  // ── Connected ─────────────────────────────────────────────────────────────
  if (connected) {
    return (
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <span className="h-2 w-2 rounded-full bg-green-500" />
        <span className="text-green-600 dark:text-green-400">Bloomberg Connected</span>
      </div>
    );
  }

  // ── Disconnected ──────────────────────────────────────────────────────────
  return (
    <div className="relative" ref={wrapRef}>

      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs font-medium hover:opacity-75 transition-opacity"
        title="Click for setup instructions"
      >
        <span className="h-2 w-2 rounded-full bg-red-400 animate-pulse" />
        <span className="text-red-500 dark:text-red-400">Bloomberg Disconnected</span>
        <svg className="h-3 w-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>

      {/* Popover */}
      {open && (
        <div className="absolute right-0 top-8 z-50 w-84 bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 p-4 min-w-[320px]">

          {/* Header */}
          <div className="flex items-start justify-between gap-2 mb-3">
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                Start the Bloomberg Bridge
              </p>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                The local bridge must be running to fetch market data.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="shrink-0 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Option 1: launcher script */}
          <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 px-3 py-2.5 mb-3">
            <p className="text-[11px] font-semibold text-blue-700 dark:text-blue-300 mb-1">
              Option 1 — easiest
            </p>
            <p className="text-xs text-blue-800 dark:text-blue-200 leading-relaxed">
              Double-click <span className="font-mono font-bold">Start TCA.bat</span> in the TCA project folder. It starts the bridge and opens the app automatically.
            </p>
          </div>

          {/* Option 2: terminal command */}
          <div className="mb-4">
            <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1.5">
              Option 2 — run in a terminal from the TCA project folder
            </p>
            <div className="flex items-center gap-1.5">
              <code className="flex-1 text-[11px] font-mono bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded px-2.5 py-1.5 truncate">
                {MANUAL_CMD}
              </code>
              <button
                type="button"
                onClick={() => { void copyCommand(); }}
                className={`shrink-0 px-2.5 py-1.5 text-[11px] rounded border transition-colors whitespace-nowrap ${
                  copied
                    ? "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400"
                    : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
          </div>

          {/* Status + re-check */}
          <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-800 pt-3">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
              <span className="text-[11px] text-gray-400 dark:text-gray-500">
                {checking ? "Checking…" : "Auto-retrying every 3 s"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => { void recheckNow(); }}
              disabled={checking}
              className="text-[11px] text-blue-500 hover:text-blue-600 dark:hover:text-blue-400 disabled:opacity-40 transition-colors"
            >
              Check now
            </button>
          </div>

        </div>
      )}
    </div>
  );
}

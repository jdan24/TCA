/**
 * Bloomberg connection badge.
 *
 * Polls /health every 30 seconds and updates the store's bloombergConnected
 * flag.  The badge is shown in the Header on every screen.
 *
 * Visual states:
 *   • green dot + "Bloomberg Connected"    — bridge up, blpapi installed
 *   • red dot   + "Bloomberg Disconnected" — bridge down or blpapi missing
 */

import { useEffect } from "react";
import { checkHealth } from "@/bloomberg/bloombergClient";
import { useTCAStore } from "@/store/useTCAStore";

const POLL_INTERVAL_MS = 30_000;

export function BloombergStatus() {
  const connected = useTCAStore((s) => s.bloombergConnected);
  const setBloombergConnected = useTCAStore((s) => s.setBloombergConnected);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const ok = await checkHealth();
      if (!cancelled) setBloombergConnected(ok);
    }

    // Check immediately, then on interval
    void poll();
    const id = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [setBloombergConnected]);

  return (
    <div className="flex items-center gap-1.5 text-xs font-medium">
      <span
        className={`h-2 w-2 rounded-full ${
          connected ? "bg-green-500" : "bg-red-400"
        }`}
      />
      <span
        className={
          connected ? "text-green-600 dark:text-green-400" : "text-red-500"
        }
      >
        Bloomberg {connected ? "Connected" : "Disconnected"}
      </span>
    </div>
  );
}

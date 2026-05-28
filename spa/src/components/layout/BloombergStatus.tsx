// TODO Phase 4 — polls /health, shows live green/red badge
import { useTCAStore } from "@/store/useTCAStore";

export function BloombergStatus() {
  const connected = useTCAStore((s) => s.bloombergConnected);

  return (
    <div className="flex items-center gap-1.5 text-xs font-medium">
      <span
        className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-red-400"}`}
      />
      <span className={connected ? "text-green-600 dark:text-green-400" : "text-red-500"}>
        Bloomberg {connected ? "Connected" : "Disconnected"}
      </span>
    </div>
  );
}

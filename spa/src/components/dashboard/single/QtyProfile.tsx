/**
 * QtyProfile — bar chart of filled quantity per 5-minute bucket
 * over the order's execution duration.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TradeRecord } from "@/types";
import { ChartCard, EmptyState } from "@/components/dashboard/dashboardUtils";

interface QtyProfileProps {
  trades: TradeRecord[];
}

const BUCKET_MS = 5 * 60 * 1_000; // 5 minutes

interface Bucket {
  label: string;
  qty: number;
  startMs: number;
}

function buildBuckets(trades: TradeRecord[]): Bucket[] {
  if (trades.length === 0) return [];

  const firstMs = Math.min(...trades.map((t) => t.firstFillTime.getTime()));
  const lastMs = Math.max(...trades.map((t) => t.lastFillTime.getTime()));
  const nBuckets = Math.max(1, Math.ceil((lastMs - firstMs) / BUCKET_MS) + 1);

  const buckets: Bucket[] = Array.from({ length: nBuckets }, (_, i) => {
    const startMs = firstMs + i * BUCKET_MS;
    const d = new Date(startMs);
    const label = d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    return { label, qty: 0, startMs };
  });

  for (const t of trades) {
    const fillMs = t.firstFillTime.getTime();
    const idx = Math.floor((fillMs - firstMs) / BUCKET_MS);
    const bucket = buckets[Math.min(idx, nBuckets - 1)];
    if (bucket) bucket.qty += t.orderQty;
  }

  return buckets;
}

export function QtyProfile({ trades }: QtyProfileProps) {
  const buckets = buildBuckets(trades);

  if (buckets.length === 0) {
    return (
      <ChartCard title="Qty Profile" subtitle="Filled qty per 5-min bucket">
        <EmptyState message="No fill data" />
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Qty Profile" subtitle="Filled contracts per 5-min bucket">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={buckets} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => v.toLocaleString()}
          />
          <Tooltip
            cursor={{ fill: "rgba(59,130,246,0.08)" }}
            content={({ payload, label }) => {
              const qty = (payload?.[0]?.value as number | undefined) ?? 0;
              return (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 shadow-lg text-xs">
                  <p className="text-gray-500 dark:text-gray-400 mb-1">{label}</p>
                  <p className="text-gray-800 dark:text-gray-200">
                    Qty: <span className="font-semibold tabular-nums">{qty.toLocaleString()}</span>
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey="qty" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

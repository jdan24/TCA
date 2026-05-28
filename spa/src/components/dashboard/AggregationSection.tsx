/**
 * AggregationSection — renders the four aggregation tables between the charts
 * and the TradeTable in the Multi-order dashboard.
 *
 * Layout:
 *   By Symbol (full width)
 *   By Algo | By Symbol + Algo (2-col)
 *   By Symbol + Side (full width)
 *
 * Clicking any row calls setAggregationFilter in the store; clicking the
 * active row again clears the filter.
 */

import { useTCAStore } from "@/store/useTCAStore";
import type { AggregateRow, AggregationSet } from "@/types";
import { AggregateTable } from "./AggregateTable";

interface AggregationSectionProps {
  aggregations: AggregationSet;
}

export function AggregationSection({ aggregations }: AggregationSectionProps) {
  const aggregationFilter = useTCAStore((s) => s.aggregationFilter);
  const setAggregationFilter = useTCAStore((s) => s.setAggregationFilter);

  function makeHandler(type: "symbol" | "algo" | "symbol+algo" | "symbol+side") {
    return (row: AggregateRow) => {
      // Toggle: clicking the active row clears the filter
      if (aggregationFilter?.type === type && aggregationFilter.key === row.groupKey) {
        setAggregationFilter(null);
      } else {
        setAggregationFilter({ type, key: row.groupKey, orderIds: row.orderIds });
      }
    };
  }

  function activeKeyFor(type: "symbol" | "algo" | "symbol+algo" | "symbol+side"): string | null {
    return aggregationFilter?.type === type ? (aggregationFilter.key ?? null) : null;
  }

  return (
    <div className="space-y-4">
      {/* By Symbol — full width */}
      <AggregateTable
        title="By Symbol"
        rows={aggregations.bySymbol}
        activeKey={activeKeyFor("symbol")}
        onRowClick={makeHandler("symbol")}
      />

      {/* By Algo + By Symbol+Algo — 2-col */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AggregateTable
          title="By Algo"
          rows={aggregations.byAlgo}
          activeKey={activeKeyFor("algo")}
          onRowClick={makeHandler("algo")}
        />
        <AggregateTable
          title="By Symbol + Algo"
          rows={aggregations.bySymbolAlgo}
          activeKey={activeKeyFor("symbol+algo")}
          onRowClick={makeHandler("symbol+algo")}
        />
      </div>

      {/* By Symbol+Side — full width */}
      <AggregateTable
        title="By Symbol + Side"
        rows={aggregations.bySymbolSide}
        activeKey={activeKeyFor("symbol+side")}
        onRowClick={makeHandler("symbol+side")}
      />
    </div>
  );
}

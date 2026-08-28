/**
 * AggregationSection — renders the aggregation tables between the charts
 * and the TradeTable in the Multi-order dashboard.
 *
 * Layout:
 *   Spread Savings (full width)
 *   By Symbol (full width)
 *   By Algo | By Symbol + Algo (2-col)
 *   By Symbol + Side (full width)
 *   By Symbol + Algo + Side (full width)
 *
 * Clicking any row calls setAggregationFilter in the store; clicking the
 * active row again clears the filter.
 *
 * Every symbol-keyed table groups by generic ticker or specific expiry, per the
 * toggle in the header. Spread Savings is always generic.
 *
 * Each table carries its own column selection, stored per grouping — By Algo can
 * show a different set from By Symbol.
 */

import { useTCAStore } from "@/store/useTCAStore";
import type { AggGroupType, AggregateRow, AggregationSet, SpreadSavingsRow } from "@/types";
import { AggregateTable, type AggregateColumnId } from "./AggregateTable";
import { SpreadSavingsTable, type SpreadSavingsColumnId } from "./SpreadSavingsTable";

interface AggregationSectionProps {
  aggregations: AggregationSet;
  spreadSavings: SpreadSavingsRow[];
  /** Optional Spread Savings columns currently shown — also drives the print view. */
  spreadSavingsColumns: SpreadSavingsColumnId[];
  onSpreadSavingsColumnsChange: (ids: SpreadSavingsColumnId[]) => void;
  /** Visible columns per grouping — also drives the print view. */
  aggregateColumns: Record<AggGroupType, AggregateColumnId[]>;
  onAggregateColumnsChange: (type: AggGroupType, ids: AggregateColumnId[]) => void;
  /** True = symbol tables keyed on generic ticker; false = on specific expiry. */
  groupGeneric: boolean;
  onGroupGenericChange: (v: boolean) => void;
}

export function AggregationSection({
  aggregations,
  spreadSavings,
  spreadSavingsColumns,
  onSpreadSavingsColumnsChange,
  aggregateColumns,
  onAggregateColumnsChange,
  groupGeneric,
  onGroupGenericChange,
}: AggregationSectionProps) {
  const aggregationFilter = useTCAStore((s) => s.aggregationFilter);
  const setAggregationFilter = useTCAStore((s) => s.setAggregationFilter);

  function makeHandler(type: AggGroupType) {
    return (row: AggregateRow) => {
      // Toggle: clicking the active row clears the filter
      if (aggregationFilter?.type === type && aggregationFilter.key === row.groupKey) {
        setAggregationFilter(null);
      } else {
        setAggregationFilter({ type, key: row.groupKey, orderIds: row.orderIds });
      }
    };
  }

  function activeKeyFor(type: AggGroupType): string | null {
    return aggregationFilter?.type === type ? (aggregationFilter.key ?? null) : null;
  }

  return (
    <div className="space-y-4">
      {/* Spread savings — full width, always by generic ticker */}
      <SpreadSavingsTable
        rows={spreadSavings}
        visibleColumns={spreadSavingsColumns}
        onVisibleColumnsChange={onSpreadSavingsColumnsChange}
      />

      {/* Grouping toggle for the three symbol-keyed tables below */}
      <div className="flex items-center justify-end gap-2 print:hidden">
        <span className="text-[11px] text-gray-400 dark:text-gray-500">
          Group symbols by
        </span>
        <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <GroupToggleButton
            label="Generic"
            title="Collapse expiries onto the instrument — FVU6 and FVZ6 both count as FV Comdty"
            active={groupGeneric}
            onClick={() => onGroupGenericChange(true)}
          />
          <GroupToggleButton
            label="Expiry"
            title="One row per contract, as it appears in the file"
            active={!groupGeneric}
            onClick={() => onGroupGenericChange(false)}
          />
        </div>
      </div>

      {/* By Symbol — full width */}
      <AggregateTable
        title="By Symbol"
        rows={aggregations.bySymbol}
        activeKey={activeKeyFor("symbol")}
        onRowClick={makeHandler("symbol")}
        visibleColumns={aggregateColumns["symbol"]}
        onVisibleColumnsChange={(ids) => onAggregateColumnsChange("symbol", ids)}
      />

      {/* By Algo + By Symbol+Algo — 2-col */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AggregateTable
          title="By Algo"
          rows={aggregations.byAlgo}
          activeKey={activeKeyFor("algo")}
          onRowClick={makeHandler("algo")}
          visibleColumns={aggregateColumns["algo"]}
          onVisibleColumnsChange={(ids) => onAggregateColumnsChange("algo", ids)}
        />
        <AggregateTable
          title="By Symbol + Algo"
          rows={aggregations.bySymbolAlgo}
          activeKey={activeKeyFor("symbol+algo")}
          onRowClick={makeHandler("symbol+algo")}
          visibleColumns={aggregateColumns["symbol+algo"]}
          onVisibleColumnsChange={(ids) => onAggregateColumnsChange("symbol+algo", ids)}
        />
      </div>

      {/* By Symbol+Side — full width */}
      <AggregateTable
        title="By Symbol + Side"
        rows={aggregations.bySymbolSide}
        activeKey={activeKeyFor("symbol+side")}
        onRowClick={makeHandler("symbol+side")}
        visibleColumns={aggregateColumns["symbol+side"]}
        onVisibleColumnsChange={(ids) => onAggregateColumnsChange("symbol+side", ids)}
      />

      {/* By Symbol+Algo+Side — full width; the most granular, so the most rows */}
      <AggregateTable
        title="By Symbol + Algo + Side"
        rows={aggregations.bySymbolAlgoSide}
        activeKey={activeKeyFor("symbol+algo+side")}
        onRowClick={makeHandler("symbol+algo+side")}
        visibleColumns={aggregateColumns["symbol+algo+side"]}
        onVisibleColumnsChange={(ids) => onAggregateColumnsChange("symbol+algo+side", ids)}
      />
    </div>
  );
}

function GroupToggleButton({
  label,
  title,
  active,
  onClick,
}: {
  label: string;
  title: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={[
        "px-2.5 py-1 text-[11px] font-medium transition-colors",
        active
          ? "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
          : "bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

/**
 * useCashDisplay — the one place every surface asks how to render a cash figure.
 *
 * Cash appears on nine different tables and cards across three reports. Each of
 * them formats through fmtUsd, so routing all of them through this hook means
 * the display currency, the rate that produced a figure and the marker on an
 * unconvertible one are decided once rather than nine times — the same reasoning
 * behind slipToneClass, after the print layouts were found rendering slippage in
 * plain black because they had their own copy of the condition.
 *
 * The hook merges the manual overrides over Bloomberg's fetched rates on read,
 * so changing an override in the Symbols modal updates every figure on screen
 * without a re-fetch.
 */

import { useMemo } from "react";
import { useTCAStore } from "@/store/useTCAStore";
import { useFxSettings } from "./useFxSettings";
import { applyFxOverrides, ratesInUse } from "@/bloomberg/fxService";
import { fmtUsd } from "@/components/dashboard/dashboardUtils";
import {
  canTotal,
  convertCash,
  fxDisclosure,
  totalCurrency,
  type DisplayCurrency,
  type FxRate,
  type FxRateMap,
} from "@/tca/fx";

export interface CashDisplay {
  display: DisplayCurrency;
  /** Bloomberg's rates with any manual overrides applied. */
  rates: FxRateMap;

  /**
   * Format one cash figure for display, converting when the mode asks for it.
   *
   * `nativeCcy` is the currency the figure was computed in — the contract's own.
   * Returns "N/A" for a null value, matching fmtUsd.
   */
  formatCash: (value: number | null | undefined, nativeCcy: string, decimals?: number) => string;

  /**
   * True when this figure is being shown in its native currency despite USD
   * mode, because no rate was available. Surfaces mark these so a mixed report
   * reads as mixed.
   */
  isUnconverted: (value: number | null | undefined, nativeCcy: string) => boolean;

  /**
   * Whether a group spanning these currencies can report a total, and in what
   * currency. In native mode that means one currency; in USD mode it means every
   * currency has a rate.
   */
  canTotal: (currencies: readonly string[]) => boolean;
  totalCurrency: (currencies: readonly string[]) => string | null;

  /**
   * Convert for totalling. Returns null when the figure cannot be expressed in
   * the display currency, so a caller summing a group can suppress the total
   * rather than quietly omit a member.
   */
  toDisplay: (value: number, nativeCcy: string) => number | null;

  /**
   * The disclosure line for the currencies given — empty when nothing was
   * converted, so a USD-only report carries no pointless footnote.
   */
  disclosureFor: (currencies: Iterable<string>) => string;

  /** The rates actually backing a set of currencies, for richer displays. */
  ratesFor: (currencies: Iterable<string>) => FxRate[];
}

export function useCashDisplay(): CashDisplay {
  const fetched = useTCAStore((s) => s.fxRates);
  const { display, overrides } = useFxSettings();

  const rates = useMemo(
    () => applyFxOverrides(fetched, overrides),
    [fetched, overrides],
  );

  return useMemo<CashDisplay>(() => {
    const formatCash = (
      value: number | null | undefined,
      nativeCcy: string,
      decimals = 0,
    ): string => {
      if (value === null || value === undefined || !isFinite(value)) return "N/A";
      const c = convertCash(value, nativeCcy, display, rates);
      return fmtUsd(c.value, c.currency, decimals);
    };

    const isUnconverted = (
      value: number | null | undefined,
      nativeCcy: string,
    ): boolean => {
      if (value === null || value === undefined || !isFinite(value)) return false;
      return convertCash(value, nativeCcy, display, rates).unconverted;
    };

    const toDisplay = (value: number, nativeCcy: string): number | null => {
      const c = convertCash(value, nativeCcy, display, rates);
      return c.unconverted ? null : c.value;
    };

    return {
      display,
      rates,
      formatCash,
      isUnconverted,
      toDisplay,
      canTotal: (currencies) => canTotal(currencies, display, rates),
      totalCurrency: (currencies) => totalCurrency(currencies, display, rates),
      disclosureFor: (currencies) =>
        // Native mode converts nothing, so there is no rate to disclose.
        display === "usd" ? fxDisclosure(ratesInUse(currencies, rates)) : "",
      ratesFor: (currencies) => ratesInUse(currencies, rates),
    };
  }, [display, rates]);
}

import { useState } from "react";
import { useFxSettings } from "@/hooks/useFxSettings";
import { AlgoMappingModal } from "@/components/settings/AlgoMappingModal";
import { SymbolMappingModal } from "@/components/settings/SymbolMappingModal";
import { FAQModal } from "./FAQModal";
import { BloombergStatus } from "./BloombergStatus";

export function Header() {
  const { display, setDisplay } = useFxSettings();
  const [showMapping, setShowMapping] = useState(false);
  const [showAlgos, setShowAlgos] = useState(false);
  const [showFAQ, setShowFAQ] = useState(false);

  return (
    <>
      <header className="print:hidden flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white dark:bg-gray-900 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <span className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">
            Futures TCA
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">
            Transaction Cost Analysis
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Display currency — global, so a report can never mix the two and a
              printed page is unambiguous about which it is. */}
          <div
            className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
            role="group"
            aria-label="Display currency"
          >
            <CurrencyButton
              label="USD"
              title="Convert every cash figure to USD at the current Bloomberg rate. Rates and overrides are set in Symbols."
              active={display === "usd"}
              onClick={() => setDisplay("usd")}
            />
            <CurrencyButton
              label="Native"
              title="Show each cash figure in the contract's own currency. No conversion; groups spanning more than one currency report no total."
              active={display === "native"}
              onClick={() => setDisplay("native")}
            />
          </div>
          <button
            type="button"
            onClick={() => setShowFAQ(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Methodology &amp; Bloomberg field definitions"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
            </svg>
            Methodology
          </button>
          <button
            type="button"
            onClick={() => setShowMapping(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="RIC → Bloomberg symbol mapping"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Symbols
          </button>
          <button
            type="button"
            onClick={() => setShowAlgos(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Algo → benchmark mapping"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
            </svg>
            Algos
          </button>
          <BloombergStatus />
        </div>
      </header>

      {showMapping && <SymbolMappingModal onClose={() => setShowMapping(false)} />}
      {showAlgos && <AlgoMappingModal onClose={() => setShowAlgos(false)} />}
      {showFAQ && <FAQModal onClose={() => setShowFAQ(false)} />}
    </>
  );
}

function CurrencyButton({
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
        "px-2.5 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
          : "bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

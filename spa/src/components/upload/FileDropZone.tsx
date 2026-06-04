import { useCallback, useRef, useState } from "react";
import { autoDetectMapping, REQUIRED_FIELDS } from "@/parsers/autoDetect";
import { parseCsvFile } from "@/parsers/csvParser";
import { parseFixFile, parseFixFileSingleOrder } from "@/parsers/fixParser";
import { parseXlsxFile } from "@/parsers/xlsxParser";
import { normalizeRows } from "@/tca/normalize";
import type { ColumnMapping, RawFileData, TCAMode, TradeRecord } from "@/types";
import { ColumnMapper } from "./ColumnMapper";

// ── State machine ─────────────────────────────────────────────────────────────

type Phase =
  | { tag: "idle" }
  | { tag: "dragging" }
  | { tag: "parsing" }
  | {
      tag: "mapping";
      fileName: string;
      rawData: RawFileData;
      suggested: Partial<ColumnMapping>;
    }
  | { tag: "error"; message: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectFileType(file: File): "csv" | "xlsx" | "fix" {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return "csv";
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return "xlsx";
  return "fix";
}

function isConfidentMapping(
  mapping: Partial<ColumnMapping>,
  confident: Set<string>
): boolean {
  return REQUIRED_FIELDS.every(
    (f) => mapping[f] !== undefined && confident.has(f)
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface FileDropZoneProps {
  onComplete: (trades: TradeRecord[]) => void;
  /** Controls how FIX files are parsed. "single" emits one record per fill. */
  mode?: TCAMode;
}

export function FileDropZone({ onComplete, mode = "multi" }: FileDropZoneProps) {
  const [phase, setPhase] = useState<Phase>({ tag: "idle" });
  const [pasteText, setPasteText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // ── File processing ──────────────────────────────────────────────────────

  const processFile = useCallback(
    async (file: File) => {
      setPhase({ tag: "parsing" });
      try {
        const type = detectFileType(file);

        if (type === "fix") {
          // Mode 2 (single order): one TradeRecord per fill, each with its
          // own TransactTime (tag 60) so the Execution Timeline can plot
          // every fill at the correct time.
          const parser = mode === "single" ? parseFixFileSingleOrder : parseFixFile;
          const trades = await parser(file);
          onComplete(trades);
          setPhase({ tag: "idle" });
          return;
        }

        // CSV or XLSX — auto-detect columns first
        const rawData =
          type === "csv"
            ? await parseCsvFile(file)
            : await parseXlsxFile(file);

        const { mapping, confident } = autoDetectMapping(rawData.headers);

        if (isConfidentMapping(mapping, confident)) {
          // All required fields confidently matched — skip the mapper
          const fullMapping = mapping as ColumnMapping;
          const trades = normalizeRows(rawData, fullMapping);
          onComplete(trades);
          setPhase({ tag: "idle" });
        } else {
          // Show the mapper so the user can confirm / fix uncertain fields
          setPhase({ tag: "mapping", fileName: file.name, rawData, suggested: mapping });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setPhase({ tag: "error", message });
      }
    },
    [onComplete, mode]
  );

  // ── Paste area parse ─────────────────────────────────────────────────────

  function handleTextParse() {
    const text = pasteText.trim();
    if (!text) return;
    // Treat as FIX if any line starts with BeginString (8=FIX…) — allowing optional
    // leading whitespace or quote characters (some loggers wrap lines in double quotes).
    const isLikelyFix = /^[\s"']*8=FIXT?\./m.test(text) || text.includes("\x01");
    const fileName = isLikelyFix ? "pasted.fix" : "pasted.csv";
    void processFile(new File([text], fileName, { type: "text/plain" }));
  }

  // ── Mapping confirmed ────────────────────────────────────────────────────

  function handleMappingConfirm(mapping: ColumnMapping) {
    if (phase.tag !== "mapping") return;
    try {
      const trades = normalizeRows(phase.rawData, mapping);
      onComplete(trades);
      setPhase({ tag: "idle" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPhase({ tag: "error", message });
    }
  }

  // ── Drag events ──────────────────────────────────────────────────────────

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (phase.tag === "idle") setPhase({ tag: "dragging" });
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    // Only reset if leaving the drop zone entirely (not a child element)
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      if (phase.tag === "dragging") setPhase({ tag: "idle" });
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void processFile(file);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void processFile(file);
    // Reset input so the same file can be re-selected after a reset
    e.target.value = "";
  }

  // ── Render: mapping phase ────────────────────────────────────────────────

  if (phase.tag === "mapping") {
    return (
      <ColumnMapper
        fileName={phase.fileName}
        headers={phase.rawData.headers}
        suggested={phase.suggested}
        onConfirm={handleMappingConfirm}
        onCancel={() => setPhase({ tag: "idle" })}
      />
    );
  }

  // ── Render: drop zone + paste area ──────────────────────────────────────

  const isDragging = phase.tag === "dragging";
  const isParsing  = phase.tag === "parsing";
  const isError    = phase.tag === "error";

  return (
    <div className="w-full max-w-xl flex flex-col gap-4">

      {/* ── File drop zone ──────────────────────────────────────────────── */}
      <div
        role="button"
        tabIndex={0}
        aria-label="File upload area"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isParsing && inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && !isParsing && inputRef.current?.click()}
        className={[
          "w-full rounded-xl border-2 border-dashed p-12",
          "flex flex-col items-center justify-center gap-3",
          "transition-colors duration-150 select-none",
          isParsing
            ? "border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/20 cursor-wait"
            : isError
              ? "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/20 cursor-pointer"
              : isDragging
                ? "border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-950/20 cursor-copy"
                : "border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500 bg-transparent cursor-pointer",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls,.txt,.fix,.log,.dat"
          className="sr-only"
          onChange={handleInputChange}
          tabIndex={-1}
          aria-hidden
        />

        {isParsing ? (
          <ParseIcon />
        ) : isError ? (
          <ErrorIcon />
        ) : (
          <UploadIcon dragging={isDragging} />
        )}

        {isParsing && (
          <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
            Parsing…
          </p>
        )}

        {isError && phase.tag === "error" && (
          <>
            <p className="text-sm font-semibold text-red-600 dark:text-red-400">
              Parse failed
            </p>
            <p className="text-xs text-red-500 dark:text-red-400 text-center max-w-xs">
              {phase.message}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-600">
              Click to try a different file
            </p>
          </>
        )}

        {!isParsing && !isError && (
          <>
            <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
              {isDragging ? "Drop file to upload" : "Drop file here or click to browse"}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-600">
              CSV · XLSX · FIX execution reports
            </p>
          </>
        )}
      </div>

      {/* ── Paste area ──────────────────────────────────────────────────── */}
      <div>
        {/* Divider */}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
          <span className="text-xs text-gray-400 dark:text-gray-600 select-none">
            or paste FIX / CSV below
          </span>
          <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
        </div>

        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          disabled={isParsing}
          placeholder={"Paste FIX messages or CSV rows here…\n\nYou can paste multiple times to accumulate data before parsing."}
          rows={8}
          className={[
            "w-full font-mono text-xs rounded-xl border px-3 py-2.5 resize-y",
            "focus:outline-none focus:ring-2 focus:ring-blue-500",
            "placeholder:text-gray-300 dark:placeholder:text-gray-700",
            isParsing
              ? "border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/20 text-gray-400 cursor-wait"
              : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100",
          ].join(" ")}
        />

        <div className="flex items-center justify-between mt-2">
          <button
            type="button"
            onClick={() => { setPasteText(""); setPhase({ tag: "idle" }); }}
            disabled={!pasteText && phase.tag !== "error"}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={handleTextParse}
            disabled={!pasteText.trim() || isParsing}
            className="text-xs px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isParsing ? "Parsing…" : "Parse"}
          </button>
        </div>
      </div>

    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function UploadIcon({ dragging }: { dragging: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={`h-10 w-10 transition-colors ${dragging ? "text-blue-500" : "text-gray-300 dark:text-gray-600"}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
      />
    </svg>
  );
}

function ParseIcon() {
  return (
    <svg
      className="h-10 w-10 text-blue-400 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-10 w-10 text-red-400"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
      />
    </svg>
  );
}

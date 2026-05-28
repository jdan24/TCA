import * as XLSX from "xlsx";
import type { RawFileData } from "@/types";

/**
 * Parse an XLSX / XLS file with SheetJS.
 * Date cells are formatted as FIX-style strings (YYYYMMDD-HH:mm:ss.000) so
 * normalize.ts can use a single timestamp parser for both CSV and XLSX inputs.
 * All other values are coerced to trimmed strings.
 */
export function parseXlsxFile(file: File): Promise<RawFileData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const buffer = e.target?.result;
        if (!(buffer instanceof ArrayBuffer)) {
          reject(new Error("Failed to read XLSX file as ArrayBuffer"));
          return;
        }

        const workbook = XLSX.read(buffer, {
          type: "array",
          cellDates: true, // parse date cells into JS Date objects
        });

        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          reject(new Error("Workbook is empty — no sheets found"));
          return;
        }

        const sheet = workbook.Sheets[sheetName];
        if (!sheet) {
          reject(new Error(`Sheet "${sheetName}" not found`));
          return;
        }

        // sheet_to_json with header:1 gives us rows as arrays; first row = headers
        const rawArrays = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          defval: "",
          raw: false,
          // Format dates as FIX TransactTime: YYYYMMDD-HH:mm:ss.000
          dateNF: "yyyymmdd-HH:MM:ss.000",
        });

        if (rawArrays.length === 0) {
          reject(new Error("Spreadsheet appears to be empty"));
          return;
        }

        const headerRow = rawArrays[0];
        if (!Array.isArray(headerRow)) {
          reject(new Error("Could not read header row"));
          return;
        }

        const headers: string[] = headerRow
          .map((h) => String(h ?? "").trim())
          .filter(Boolean);

        const rows: Record<string, string>[] = [];

        for (let i = 1; i < rawArrays.length; i++) {
          const rowArr = rawArrays[i];
          if (!Array.isArray(rowArr)) continue;

          const row: Record<string, string> = {};
          let hasValue = false;

          for (let j = 0; j < headers.length; j++) {
            const header = headers[j];
            const cell = rowArr[j];
            if (header) {
              const val = String(cell ?? "").trim();
              row[header] = val;
              if (val) hasValue = true;
            }
          }

          if (hasValue) rows.push(row);
        }

        resolve({ headers, rows, fileType: "xlsx" });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };

    reader.onerror = () => reject(new Error("FileReader error while reading XLSX"));
    reader.readAsArrayBuffer(file);
  });
}

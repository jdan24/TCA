import Papa from "papaparse";
import type { RawFileData } from "@/types";

/**
 * Parse a CSV file with PapaParse.
 * Returns raw headers + string rows; column mapping is applied later in normalize.ts.
 */
export function parseCsvFile(file: File): Promise<RawFileData> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete(results) {
        if (results.errors.length > 0 && results.data.length === 0) {
          const msg = results.errors[0]?.message ?? "CSV parse error";
          reject(new Error(msg));
          return;
        }
        const headers = (results.meta.fields ?? []).map((h) => h.trim()).filter(Boolean);
        resolve({ headers, rows: results.data, fileType: "csv" });
      },
      error(err: Error) {
        reject(err);
      },
    });
  });
}

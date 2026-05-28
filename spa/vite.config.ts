import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  build: {
    // Vendor chunks are individually cacheable and excluded from the initial
    // app bundle.  recharts + @tanstack/react-table are only pulled in when
    // the lazy Dashboard chunk loads (i.e. after a file is uploaded).
    rollupOptions: {
      output: {
        // Rolldown (Vite 8) requires the function form of manualChunks.
        // Gives stable, cache-friendly names to heavy third-party modules.
        manualChunks(id: string): string | undefined {
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/")) {
            return "vendor-react";
          }
          if (id.includes("node_modules/recharts") || id.includes("node_modules/victory")) {
            return "vendor-charts";
          }
          if (id.includes("node_modules/@tanstack")) {
            return "vendor-table";
          }
          if (id.includes("node_modules/xlsx")) {
            return "vendor-xlsx";
          }
          if (id.includes("node_modules/jspdf")) {
            return "vendor-pdf";
          }
          if (id.includes("node_modules/papaparse")) {
            return "vendor-parsers";
          }
          return undefined;
        },
      },
    },
  },
});

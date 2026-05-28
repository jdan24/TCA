import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "path";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: "./",
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  build: {
    // viteSingleFile inlines every chunk into index.html, producing a single
    // portable file that works from file:// without any dev server.
    // inlineDynamicImports collapses dynamic import() calls (lazy Dashboard,
    // xlsx/jspdf dynamic imports) into the single bundle.
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    // Raise the inline threshold so images / fonts embed as data URIs.
    assetsInlineLimit: 100_000_000,
  },
});

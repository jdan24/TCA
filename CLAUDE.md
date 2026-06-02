# TCA Project — Claude Instructions

## Build & Deploy Workflow

**After every code change to `spa/src/`, always:**

1. Run `npm run build` from the `spa/` directory
2. Commit the updated `spa/dist/index.html` (and any other changed `spa/dist/` files) to git
3. Push to `origin/master`

**Why:** The app runs as a fully self-contained single HTML file (`spa/dist/index.html`) with no local Node.js server. The `index.html` is the deliverable — it must be kept in sync with source changes so the user can open it directly in a browser.

The build uses `vite-plugin-singlefile` to inline all JS and CSS into `index.html`. Running `npm run build` takes ~1 second.

## Project Structure

- `spa/` — Vite + React + TypeScript front-end
- `spa/src/` — all source code
- `spa/dist/index.html` — compiled single-file app (tracked in git)
- `bloomberg-bridge/bridge.py` — FastAPI bridge to Bloomberg blpapi (runs locally, optional)

## Key Rules

- Always run `npm run build` and commit `spa/dist/index.html` after any `spa/src/` change
- TypeScript strict mode is on — run `npx tsc --noEmit` before building if unsure
- The Bloomberg bridge is optional; the app degrades gracefully when offline

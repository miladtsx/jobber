# JobJo

Simple static RSS job board built with vanilla HTML/JS.

## Workflow

1. Make changes inside `src/` (keep `fetch.js` in sync with `index.html`).
2. Run `pnpm install` once per machine to install dependencies (the codebase otherwise stays dependency-free).
3. Execute `pnpm run build` to recreate `docs/` from the `src/` sources and any `cache/` files you want to ship for the fallback feed.
4. Commit the updated `docs/` tree before pushing.

## GitHub Pages setup

- In the repository settings, point GitHub Pages to the **main** (or `master`) branch and select the `/docs` folder as the publishing source.
- After each change, run `pnpm run build`, then push both the `src/` edits and the updated `docs/` output.

## Cache files

Prefetched feed snapshots live under `cache/` and are copied into `docs/cache/` by the build script so the browser can still fall back to them. Regenerate this data however your workflow provides it, then rerun `pnpm run build`.

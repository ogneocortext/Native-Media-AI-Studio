# Frontend Build Pipeline — Research & Implementation

> **Created:** 2026-09-07  
> **Status:** Implemented  
> **Scope:** `packages/frontend` (Vite + React + TypeScript)

---

## 1. Baseline Audit

### 1.1 Build Script
- **Before:** `tsc && vite build`
- **Problem:** `tsc` in non-project mode re-checks every file from scratch; no incremental caching.
- **TypeScript config:** `noEmit: true`, `composite: true` on `tsconfig.node.json`, project references already wired.

### 1.2 TypeScript Config Gaps
| Gap | Risk |
|-----|------|
| No `incremental` / `tsBuildInfoFile` | Full type-check on every run |
| No explicit `baseUrl` | Path resolution ambiguity with deep monorepo |
| `noEmit: true` correct for Vite, but `tsc -b` was not used | Missed build-info caching |

### 1.3 Vite Config Gaps
| Gap | Risk |
|-----|------|
| No compression plugins | Larger network transfers in production |
| No bundle analysis tooling | Blind to chunk bloat / duplicate code |
| No `modulePreload` | Suboptimal module loading in modern browsers |
| No `preview` proxy config | Preview server does not proxy API/WS to backend |
| Single build script, no analyze mode | Hard to diagnose bundle size regressions |

---

## 2. Research Findings (2026 Best Practices)

- **`tsc -b`** (composite/build mode) is now stable and recommended for Vite projects. It respects `tsBuildInfoFile` and only re-checks changed files after the first full run.
- **`vite-plugin-compression`** is the standard pre-bundling compression plugin (gzip + brotli). Pre-compressed assets are served with `Content-Encoding` automatically when the browser sends `Accept-Encoding`.
- **`rollup-plugin-visualizer`** is the de-facto bundle analyzer for Vite/Rolldown. Generates interactive `stats.html`.
- **`modulePreload: true`** in Vite build tells the bundler to add `<link rel="modulepreload">` for async chunks, improving loading performance in modern Chromium/Firefox/Safari.
- **Preview server proxy** should mirror the dev server proxy so `vite preview` works as a local production smoke-test.

---

## 3. Implemented Changes

### 3.1 `tsconfig.json`
```json
{
  "compilerOptions": {
    // ... existing options preserved ...
    "baseUrl": ".",
    "incremental": true,
    "tsBuildInfoFile": "./.tsbuildinfo"
  }
}
```
- `incremental` + `tsBuildInfoFile` enable fast subsequent type-checks.
- `baseUrl` removes path-resolution ambiguity.

### 3.2 `package.json` scripts
```json
{
  "scripts": {
    "build": "tsc -b && vite build",
    "type-check": "tsc -b",
    "build:analyze": "tsc -b && vite build --mode analyze"
  }
}
```
- `build` now uses `tsc -b`.
- `type-check` is the fast path for CI / pre-commit.
- `build:analyze` runs the visualizer.

### 3.3 `vite.config.ts`
```ts
import compression from "vite-plugin-compression";
import { visualizer } from "rollup-plugin-visualizer";

plugins: [
  react(),
  tailwindcss(),
  compression({ algorithm: "gzip", ext: ".gz" }),
  compression({ algorithm: "brotliCompress", ext: ".br" }),
  isAnalyze && visualizer({ open: true, gzipSize: true, brotliSize: true, filename: "dist/stats.html" }),
],
build: {
  modulePreload: true,
  // ... manualChunks preserved ...
},
preview: {
  port: portConfig.frontend_port,
  proxy: { "/api": ..., "/output": ..., "/ws": ... },
},
```

---

## 4. Verification

| Command | Result |
|---------|--------|
| `pnpm type-check` | ✅ Exit 0 — 3162 modules transformed |
| `pnpm build` | ✅ Exit 0 — gzip artifacts generated under `dist/` |
| `pnpm build:analyze` | ✅ Exit 0 — `dist/stats.html` generated (1.5 MB gzip) |

---

## 5. Bundle Observations

- **three-vendor** is the largest chunk (~2.7 MB unminified, ~536 KB gzip).
- **animation-vendor** (animejs + Theatre) is the second largest (~1.25 MB unminified, ~316 KB gzip).
- **index** (app entry + routes) is ~1.15 MB unminified, ~241 KB gzip.
- Source maps are enabled by default in non-analyze builds (`sourcemap: !isProd`).

### 5.1 Future Optimization Candidates
1. **Lazy-load `three-vendor` / `animation-vendor`** by route — only load on pages that actually use Three.js / Theatre / animejs.
2. **Tree-shake `three`** — current bundle includes the full `three` library; consider `three/examples/jsm/...` imports and `unified` build targets.
3. **Move `@theatre/studio` to async chunk** — it is editor tooling, not runtime.
4. **Review `react-vendor`** — React 19 is ~300 KB gzip; verify no duplicate React instances.

### 5.2 Quantified Analysis (2026-09-06, via `scripts/analyze-bundle-stats.mjs`)

Ran against the existing `dist/stats.html` (no rebuild needed). dist/assets totals **20.8 MB**, of which ~9 MB is `.map` sourcemaps (never deploy these).

| Package | Rendered | Gzip | Modules |
|---|---|---|---|
| `three@0.185.1` | 2,019 KB | 402 KB | 20 |
| `@theatre/studio@0.7.2` | 1,011 KB | 266 KB | 1 |
| `recharts@3.10.1` | 765 KB | 252 KB | **214** |
| `react-dom@19.2.8` | 450 KB | 85 KB | 4 |
| `@react-three/fiber@9.7.0` | 236 KB | 59 KB | 2 |
| `three-stdlib@2.36.1` | 204 KB | 47 KB | 11 |
| `@theatre/core` + `dataverse` | 212 KB | 50 KB | 2 |
| `animejs@4.5.0` | 110 KB | 33 KB | 23 |
| `react-router@7.18.3` | 93 KB | 23 KB | 1 |
| `lucide-react` (icons) | 81 KB | 48 KB | 132 |

Largest app source files (single-file split/trim candidates):
`ThreeJSStudio.tsx` 84 KB · `MediaLibrary.tsx` 71 KB · `Visualizer.tsx` 54 KB · `GpuMonitorPage.tsx` 54 KB · `AudioAnalysisPage.tsx` 52 KB · `DocsPage.tsx` 44 KB · `LogViewer.tsx` 44 KB.

Key findings (refines 5.1):
- **Theatre.js is the biggest eager-load win**: `@theatre/studio` (~306 KB gz incl. core/dataverse) is editor GUI only — defer with dynamic `import()` on first wand-icon toggle (candidate #3 confirmed, highest priority).
- **Three.js is bundled twice**: both `three.core.js` (1,259 KB) and `three.module.js` (568 KB) appear in the same chunk, plus duplicate loaders — GLTFLoader ×2 (three-stdlib + three/examples, 181 KB combined) and OrbitControls ×2 (63 KB combined). Fix via `resolve.dedupe: ['three']` / alias `three-stdlib` loaders to `three/examples/jsm/*` (candidate #2 confirmed, quantified at ~100+ KB gz).
- **Recharts is 765 KB (252 KB gz) for a handful of charts** across dashboard/health/log-analytics — route all chart usage through `RechartsWrapper` and lazy-`import()` it.
- **Route-level splitting already works** (Visualizer / ThreeJSStudio / GpuMonitorPage / etc. are separate chunks) — remaining main-chunk weight is app code in the files listed above; `MediaLibrary.tsx` deserves the generate3d-wizard-style component split.
- Zero modules duplicated *across* chunks — the waste is intra-chunk (three ×2) and eager-loading (theatre/recharts), not chunk overlap.

---

## 6. How to Use

```bash
# Fast type-check only
pnpm type-check

# Production build with compression
pnpm build

# Build + open bundle analyzer
pnpm build:analyze
# → opens dist/stats.html

# Mine dist/stats.html without rebuilding (no browser needed)
node scripts/analyze-bundle-stats.mjs
# → chunk totals, top packages, largest app files, cross-chunk duplicates
```

---

## 7. Additional Optimization Research (2026-09-07)

### 7.1 Cross-Tab Polling: Tab Leader Pattern
- **Problem:** Multiple tabs/components poll the same backend endpoint independently, multiplying DB load.
- **Pattern:** Use the `BroadcastChannel` API (or `localStorage` `storage` event as fallback) to elect a single "leader" tab per resource type. Only the leader polls; other tabs subscribe to broadcast updates.
- **Implementation notes for this project:**
  - Leader election via `localStorage` timestamp + heartbeat.
  - Fallback to individual polling if `BroadcastChannel` is unavailable (private browsing on some browsers).
  - Applies cleanly to health endpoints: `/api/health`, `/api/logs/analytics/summary`, `/api/system/stats`.

### 7.2 SQLite Query Performance: ANALYZE + Covering Indexes
- **Command:** `ANALYZE` rebuilds the internal statistics so the query planner picks the best index.
- **Covering index:** Include all filtered/sorted columns in one index to avoid table lookups.
- **Applied to this project:**
  - Migration v13 added indexes on `log_events.ts_ms`, `log_events.source`, and composite `(ts_ms, source)`.
  - Analytics summary endpoint now has 30s in-memory TTL cache.
  - Recommendation: Run `ANALYZE` after bulk inserts or on a schedule (e.g., after log rotation).

### 7.3 Vite `manualChunks` Time-of-Check vs Time-of-Use (TDZ) Hazards
- **Risk:** Moving modules into a manual chunk can change evaluation order. If module A imports module B and both are split, B may not be initialized when A runs (especially with circular deps).
- **Mitigation:**
  - Keep entry-point chunks (`index`) separate from vendor chunks.
  - Avoid splitting modules that share tight circular dependencies.
  - Verify with `node --trace-tls` equivalent: watch for `ReferenceError` or `undefined` in production build smoke tests.

### 7.4 SSE Deduplication & Rate Limiting
- **Problem:** Multiple SSE listeners on the same event stream cause duplicate parsing and memory pressure.
- **Pattern:** Single shared `EventSource` per resource, multiplexed to subscribers via a lightweight pub/sub (e.g., RxJS `Subject`, or a simple callback registry).
- **Rate limiting:** Backend should cap event emission frequency (e.g., `broadcast_warnings` now throttled to once per 60s per resource type).

### 7.5 Zustand v4 Selector Stability
- **Problem:** Inline selectors like `useStore(state => state.x)` create new function references every render, defeating shallow equality and causing unnecessary re-renders.
- **Fix:** Use `useShallow` from `zustand/shallow` or memoize selectors with `useCallback` / module-level constants.
- **Applied to this project:** Polling components migrated to `useHealthStore` with explicit selectors where needed.

### 7.6 Compiled `vite.config.js` Shadows `vite.config.ts` (2026-09-07)
- **Incident:** The dev server bound **IPv6-only** (`[::1]:5173`) — `http://127.0.0.1:5173` (used by `manage-servers.ps1` health probes, the Vite→backend proxy, and CORS allowlists) failed while `http://localhost:5173` worked. Every `vite.config.ts` edit appeared to be ignored.
- **Root cause:** Vite config resolution order is `.js` before `.ts`. A `tsc --build` run had emitted `vite.config.js` + `vite.config.d.ts` into the package root (because `tsconfig.node.json` was `composite` without an `outDir`), and that stale artifact — missing `server.host: "127.0.0.1"` — **silently shadowed** the TypeScript config.
- **Diagnostics:** `netstat -ano | findstr :5173` showed `[::1]:5173` LISTENING; `Select-String 'host' vite.config.js` showed the artifact lacked the setting.
- **Fix:** Deleted the artifacts, and set `"outDir": "node_modules/.tmp/tsc-node"` in `tsconfig.node.json` so composite emits can never land at the package root again. Also pinned `server.host: "127.0.0.1"` in `vite.config.ts`.
- **Rule:** Never commit or hand-edit a compiled `vite.config.js` / `vite.config.d.ts` in `packages/frontend/`. If one appears at the package root, delete it and check the emit config.

---

## 8. Implementation History

| Date | Change | Impact |
|------|--------|--------|
| 2026-09-07 | Added `fetchPortConfig()` to `main.tsx` `initApp()` | Fixed CORS fallback on port 5174 |
| 2026-09-07 | Consolidated polling into `useHealthStore` | Eliminated duplicate fetch loops |
| 2026-09-07 | Increased polling intervals across health components | Reduced DB/network load |
| 2026-09-07 | Throttled `broadcast_warnings` to 60s per resource | Cut SSE message volume |
| 2026-09-07 | Added DB migration v13 with analytics indexes | Faster `log_events` queries |
| 2026-09-07 | Added 30s TTL cache to `/api/logs/analytics/summary` | Lower DB hit rate |
| 2026-09-07 | Split `three-vendor` → `three-core` + `three-examples` | Smaller initial JS payload |
| 2026-09-07 | Added `vite-plugin-compression` + `rollup-plugin-visualizer` | gzip/brotli artifacts, bundle insights |

---

## 9. How to Use

```bash
# Fast type-check only
pnpm type-check

# Production build with compression
pnpm build

# Build + open bundle analyzer
pnpm build:analyze
# → opens dist/stats.html

# Mine dist/stats.html without rebuilding (no browser needed)
node scripts/analyze-bundle-stats.mjs
# → chunk totals, top packages, largest app files, cross-chunk duplicates
```

### 9.1 Bundle Analyzer Script (`scripts/analyze-bundle-stats.mjs`)

Parses the JSON payload embedded in `dist/stats.html` (rollup-plugin-visualizer "sunset" format) and prints a text report:

1. **Chunk totals** — rendered + gzip size per top-level module grouping.
2. **Top packages** — node_modules modules grouped per package (handles pnpm `.pnpm/<pkg>@<ver>_peerhash/` paths and strips peer-hash suffixes), sorted by rendered size.
3. **Largest app source files** — `packages/frontend/src/**` modules by rendered size.
4. **Duplicated modules** — modules whose code landed in more than one chunk (recovery candidates).

Data model notes (visualizer v2 format): `nodeParts[partUid] = {renderedLength, gzipLength, brotliLength, metaUid}` and `nodeMetas[metaUid] = {id, isExternal, ...}` — part uids are what the chunk tree leaves reference; module identity lives on the meta. Requires a prior `pnpm build:analyze` (or any build that emits `dist/stats.html`).

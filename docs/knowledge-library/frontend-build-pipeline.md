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

### 6.1 Bundle Analyzer Script (`scripts/analyze-bundle-stats.mjs`)

Parses the JSON payload embedded in `dist/stats.html` (rollup-plugin-visualizer "sunset" format) and prints a text report:

1. **Chunk totals** — rendered + gzip size per top-level module grouping.
2. **Top packages** — node_modules modules grouped per package (handles pnpm `.pnpm/<pkg>@<ver>_peerhash/` paths and strips peer-hash suffixes), sorted by rendered size.
3. **Largest app source files** — `packages/frontend/src/**` modules by rendered size.
4. **Duplicated modules** — modules whose code landed in more than one chunk (recovery candidates).

Data model notes (visualizer v2 format): `nodeParts[partUid] = {renderedLength, gzipLength, brotliLength, metaUid}` and `nodeMetas[metaUid] = {id, isExternal, ...}` — part uids are what the chunk tree leaves reference; module identity lives on the meta. Requires a prior `pnpm build:analyze` (or any build that emits `dist/stats.html`).

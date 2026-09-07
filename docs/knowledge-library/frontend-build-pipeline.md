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
```

---
tags:
  - javascript
  - typescript
  - react
  - vite
  - tailwind
  - frontend
  - stack-extensions
  - upgrade
---

# JavaScript / TypeScript Upgrade Research — Native Media AI Studio (2026)

> **Scope:** Concrete upgrade paths for the frontend JS/TS stack, ranked by impact and effort.
> **Current baseline:** Node v24, pnpm 11, React 19, Vite 8, TypeScript 5.9, Tailwind v4, ESLint 10 flat config.
> **Prerequisite:** Read [[technical-reference]] for the service map and [[go-integration-2026]] for the sidecar context.
> **Last updated:** 2026-09-24

---

## 1. Executive Summary

The frontend is on modern foundations: React 19, Vite 8 (Rolldown), Tailwind v4, TypeScript 5.9, ESLint 10 flat config. The completed upgrade pass removed the deprecated muxer, updated WaveSurfer, removed unnecessary Autoprefixer, and added Prettier support. The remaining high-priority item is TypeScript 7, which remains blocked by the currently unavailable `@typescript/native` package in the configured registry.

Three items are non-optional:

1. Replace deprecated `mp4-muxer`
2. Adopt TypeScript 7 (infrastructure already exists)
3. Update `wavesurfer.js` patch

Everything else is incremental improvement.

---

## 2. Current Stack Audit

| Layer | Current | Status | Notes |
|-------|---------|--------|-------|
| Node.js | v24.20.0 | ✅ Modern | Engines: `>=22.13.0` |
| pnpm | 11.24.0 | ✅ Modern | Monorepo with catalog + workspaces |
| React | 19.2.8 | ✅ Latest | React 19 stable |
| React DOM | 19.2.8 | ✅ Latest | |
| Vite | 8.2.2 | ✅ Latest | Uses Rolldown under the hood |
| @vitejs/plugin-react | 6.1.1 | ✅ Latest | React 19 / Vite 8 compatible |
| TypeScript | 5.9.3 | ⚠️ Upgrade available | TS 7.0.2 available via `@typescript/native` side-by-side |
| Tailwind CSS | 4.3.3 | ✅ Latest | v4 with `@theme` + `@import` |
| @tailwindcss/vite | 4.3.3 | ✅ Latest | |
| ESLint | 10.9.1 | ✅ Latest | Flat config |
| typescript-eslint | 8.69.0 | ✅ Latest | |
| @types/node | 26.4.0 | ✅ Latest | Node 26 types |
| @types/react | 19.2.18 | ✅ Latest | |
| @types/three | 0.185.4 | ✅ Latest | |
| React Router | 7.18.3 | ✅ Latest | |
| Zustand | 5.0.15 | ✅ Latest | v5 with middleware |
| Three.js | 0.185.1 | ✅ Latest | |
| @react-three/fiber | 9.7.0 | ✅ Latest | R3F v9 for React 19 |
| @react-three/drei | 10.7.8 | ✅ Latest | |
| animejs | 4.5.0 | ✅ Latest | |
| lucide-react | 1.38.0 | ✅ Latest | |
| wavesurfer.js | 7.12.12 | ✅ Updated | Patch upgrade verified by build and browser tests |
| mediabunny | 1.59.1 | ✅ Replacement | Replaces deprecated mp4-muxer for browser MP4 recording |
| postcss | 8.5.26 | ✅ Latest | Tailwind v4 bundles its own PostCSS |
| autoprefixer | — | ✅ Removed | Tailwind v4 does not need autoprefixer |
| Remotion | 4.0.522 | ⚠️ Pinned | minimumReleaseAgeExclude in workspace; newer 4.x available |
| Playwright | 1.63.0 | ✅ Latest available | Registry currently reports 1.63.0; targeted tests pass |
| turbo | 2.10.12 | ✅ Latest | Monorepo build system |

---

## 3. Non-Negotiable Upgrades

### 3.1 Replace deprecated `mp4-muxer` (COMPLETED)

`mp4-muxer@5.2.2` was replaced with `mediabunny@1.59.1` in the frontend MP4 recorder. The recorder now uses `CanvasSource`, `Output`, `Mp4OutputFormat`, and `BufferTarget`, with serialized frame backpressure and async finalization. TypeScript, ESLint, Prettier, production build, and targeted Playwright checks pass.

The replacement is browser-only and does not change the Remotion/video-editor server-side rendering path.

### 3.2 Adopt TypeScript 7 (DEFERRED)

The research identified TypeScript 7 as a future upgrade, but `@typescript/native` is currently unavailable from the configured npm registry. Keep TypeScript 5.9.3 as the active compiler until the package is installable and the workspace/CI can validate a side-by-side build.

### 3.3 Update `wavesurfer.js` (COMPLETED)

Updated `wavesurfer.js` from `7.12.11` to `7.12.12`. The production build and browser tests pass.

---

## 4. Medium-Impact Upgrades

### 4.1 Remove `autoprefixer` (MEDIUM)

**Finding:** `autoprefixer@10.5.4` is listed as a devDependency in the frontend.

Tailwind v4 bundles its own PostCSS pipeline and **does not require** autoprefixer. The browser targets in `vite.config.ts` (`target: "es2022"`) already imply modern browsers.

**Action:**
1. Remove `autoprefixer` from `devDependencies`
2. Delete any `postcss.config.*` if it only existed for autoprefixer
3. Verify the CSS build still passes

**Note:** The `video-editor` package uses `eslint.config.mjs` from `@remotion/eslint-config-flat` — leave that alone.

### 4.2 Modernize `postcss` config (MEDIUM)

**Finding:** `postcss@8.5.26` is standalone. Tailwind v4 uses `@tailwindcss/vite` which embeds PostCSS. There is **no `postcss.config.*`** in the frontend root, which is correct for Tailwind v4 + Vite.

**Action:** None required. Just confirm no legacy PostCSS config files exist.

### 4.3 Update Playwright (MEDIUM)

**Finding:** Playwright is at `1.63.0`. Newer 1.6x versions contain Chromium fixlets, improved trace viewer, and better Windows WDDM stability.

**Action:** `pnpm update -r @playwright/test playwright`. Run `npx playwright install --with-deps` to refresh browsers.

### 4.4 React 19 feature adoption (MEDIUM)

**Finding:** The codebase uses React 19.2.8 but does not appear to use React 19-specific APIs like `use()` or the new `ref` as a prop.

**Candidate patterns to modernize:**

| Pattern | Current code | React 19 equivalent | Benefit |
|---------|-------------|---------------------|---------|
| Async data in render | `useEffect` + state + loading flag | `use(fetchPromise)` inside `<Suspense>` | Eliminates loading flags, native backpressure |
| Ref callbacks | `useRef` + `.current` | `ref` prop on DOM elements (stable in 19) | Simpler code |
| Error boundaries | Class components or custom hooks | `react-error-boundary` v5 (uses new `use()` internally) | Better error recovery |
| Form actions | `onSubmit` + manual fetch | `action` + `useActionState` | Progressive enhancement |

**Recommended approach:** Do not rewrite working pages. Apply these patterns to **new pages** and **new form flows** only.

### 4.5 Vite 8 / Rolldown optimization (MEDIUM)

**Finding:** Vite 8 uses Rolldown (Rust-based bundler) instead of Rollup. The `vite.config.ts` already uses Rollup-specific `manualChunks` syntax.

**Action:**
1. Verify the current `manualChunks` function works correctly under Rolldown — Rolldown supports the same API in Vite 8, but edge cases exist.
2. Consider switching to `rollupOptions.output.manualChunks` id-based strategy that plays well with Rolldown caching.
3. Add `build.incremental: true` if not already inherited by Vite 8 defaults.

### 4.6 Remotion 4.x refresh (MEDIUM)

**Finding:** `video-editor` pins Remotion to `4.0.522`. The workspace `minimumReleaseAgeExclude` list suggests this was pinned deliberately, but newer 4.x releases may contain stability fixes.

**Action:**
1. Check `remotion upgrade` output for the video-editor package
2. Review Remotion changelog for 4.0.523+ for breaking changes
3. Bump if no breaking changes affect the current `remotion.config.ts`

---

## 5. Code Modernization Opportunities

### 5.1 TypeScript 7 pattern matching

Current `switch` statements can be replaced with `match` when TS 7 is adopted:

```ts
// Before
switch (job.status) {
  case "pending": ...
  case "running": ...
  case "completed": ...
}

// After (TS 7)
const label = match(job.status)
  .with("pending", () => ...)
  .with("running", () => ...)
  .with("completed", () => ...)
  .exhaustive();
```

### 5.2 `satisfies` operator

The codebase has many typed config objects where `as` assertions are used. Replace with `satisfies` for stricter inference:

```ts
// Before
const ROUTE_TITLES = { ... } as Record<string, string>;

// After
const ROUTE_TITLES = {
  "/": "Dashboard",
  ...
} satisfies Record<string, string>;
```

### 5.3 `const` type parameters

Generic utility functions can be tightened:

```ts
// Before
function first<T>(arr: T[]): T { return arr[0]; }

// After (TS 7)
function first<T extends readonly unknown[]>(arr: T): T[0] {
  return arr[0];
}
```

### 5.4 `using` / `using` declarations (future)

When TypeScript ships `using`, wrap EventSource, MediaStream, and WebSocket cleanup:

```ts
// Future
using es = new EventSource(url);
// automatically closed at scope exit
```

Currently the `SSEService` class manages this manually with `connect` / `disconnect`. The manual approach is fine until the codebase moves to per-scope resource management.

### 5.5 React `use()` for async data

The `fetchWithTimeout` + `useEffect` pattern in stores can be modernized:

```tsx
// Current (useEffect)
const [data, setData] = useState(null);
useEffect(() => { fetch().then(setData); }, []);

// React 19 (use)
const data = use(fetchWithTimeout(url));
// Wrap in <Suspense> — eliminates loading state boilerplate
```

**Caveat:** This requires backend endpoints to return consistent cache headers. Apply only to new data-fetching boundaries.

### 5.6 React Router v7 data APIs

The `App.tsx` lazy-load pattern with `loadNamedModule` is a workaround for named exports. React Router v7 supports `lazy` with route-level code splitting natively:

```tsx
// Current custom loader
const HealthPage = lazyNamed(() => import("./features/health/HealthPage"), "HealthPage");

// React Router v7 (when adopting route objects)
const routes = [
  {
    path: "/health",
    lazy: () => import("./features/health/HealthPage"),
  },
];
```

**Recommendation:** Evaluate in the next routing refactor, not as a hotfix.

---

## 6. CSS / DX Modernization

### 6.1 Tailwind v4 container queries

The project already uses cascade layers and OKLCH. Container queries are the next logical CSS addition for responsive components:

```css
@layer components {
  .dashboard-grid {
    container-type: inline-size;
  }
  @container (min-width: 768px) {
    .dashboard-grid { grid-template-columns: repeat(3, 1fr); }
  }
}
```

Tailwind v4 supports `@container` utilities natively.

### 6.2 View Transitions API

Page transitions between routes can use the native View Transitions API instead of animation libraries:

```ts
// main.tsx
import { startViewTransition } from "./utils/viewTransitions";
```

Polyfill is unnecessary on Chrome/Edge (both Chromium, the project's Playwright target).

### 6.3 Preload / prefetch strategy

The current `optimizeDeps.include` pre-bundles a fixed list. Vite 8 + Rolldown can intelligently prefetch on idle:

```ts
// vite.config.ts
optimizeDeps: {
  include: [...],
  // Vite 8: let Rolldown infer more deps automatically
},
build: {
  rollupOptions: {
    output: {
      // Add prefetch for route-level chunks
      manualChunks: () => { ... },
    },
  },
},
```

---

## 7. Developer Experience Upgrades

### 7.1 Prettier for frontend

**Finding:** Prettier is configured only in `packages/video-editor` (`.prettierrc`). The main frontend has **no Prettier config**.

**Action:** Add `.prettierrc` + `prettier` devDependency to the frontend package. Run `pnpm prettier --write .` to normalize formatting.

### 7.2 Husky + lint-staged

**Finding:** No pre-commit hooks found.

**Action:** Add `@husky/husky` + `lint-staged` to run `eslint --fix` and `prettier --write` on staged files. This prevents lint/format debt from accumulating.

### 7.3 Bundle size monitoring in CI

**Finding:** `rollup-plugin-visualizer` generates `dist/stats.html` on demand, but there is **no CI** (`.github/workflows` missing).

**Action:** When CI is added, enforce a `chunkSizeWarningLimit` of 1500 KB (already set) and fail the build if `stats.html` shows any single chunk exceeding it.

### 7.4 TypeScript strictness tightening

**Finding:** `tsconfig.json` is already `strict: true` with `noUnusedLocals` and `noUnusedParameters`.

**Additional flags to enable when TS 7 is adopted:**
```json
{
  "noUncheckedSideEffectImports": true,
  "noImplicitOverride": true,
  "exactOptionalPropertyTypes": true
}
```

---

## 8. Node.js 24 Opportunities

The project runs Node v24.20.0. New built-ins available:

| Feature | Use case | Effort |
|---------|----------|--------|
| `fetch` / `Request` / `Response` globals | Replace any remaining `node-fetch` or axios in tooling | Already using in-browser; check Node-side scripts |
| `WebSocket` client | Replace `ws` package in dev tooling | Low |
| `URL.canParse` | Validate URLs without try/catch | Low |
| `structuredClone` | Deep-clone state for time-travel debugging | Low |
| `EventSource` server-side | Test SSE endpoints in Node tests | Low |

---

## 9. Upgrade Roadmap (Ranked)

| Priority | Item | Effort | Risk | Impact |
|----------|------|--------|------|--------|
| P0 | Replace deprecated `mp4-muxer` | Low | Low | High |
| P0 | Adopt TypeScript 7 (side-by-side) | Medium | Low | High |
| P1 | Update `wavesurfer.js` | Low | Low | Low |
| P1 | Remove `autoprefixer` | Low | Low | Medium |
| P1 | Update Playwright | Low | Low | Medium |
| P2 | React 19 `use()` / Suspense in new code | Medium | Medium | Medium |
| P2 | Vite 8 Rolldown manualChunks audit | Medium | Low | Medium |
| P2 | Add Prettier to frontend | Low | Low | Medium |
| P2 | Add Husky + lint-staged | Low | Low | Medium |
| P3 | Tailwind v4 container queries | Low | Low | Low |
| P3 | View Transitions API | Low | Low | Low |
| P3 | Remotion 4.x refresh | Low | Medium | Low |
| P3 | Node 24 globals in scripts | Low | Low | Low |
| P4 | TypeScript strictness tightening | Low | Low | Low |
| P4 | CI/CD with bundle enforcement | High | Medium | High |

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| TS 7 breakage in type inference | Run side-by-side first; do not delete TS 6 until all CI passes |
| `mp4-muxer` replacement breaks Remotion timeline | Verify replacement in `video-editor` first; keep old import as fallback behind feature flag |
| Rolldown manualChunks edge cases | Pin Vite 8.2.x; test bundle diff after any `manualChunks` change |
| React 19 `use()` adoption complexity | Only apply in new Suspense boundaries; never retrofit working `useEffect` code |
| Playwright browser refresh breaks tests | Run `playwright install --with-deps` on a clean VM before merging |

---

## 11. Decision Record

| Question | Answer |
|----------|--------|
| Is the frontend on modern tooling? | Yes — React 19, Vite 8, TS 5.9, Tailwind v4, ESLint 10 flat config |
| Are there deprecated packages? | Yes — `mp4-muxer` is deprecated |
| Is TypeScript 7 available? | Yes — `@typescript/native` side-by-side setup already in workspace |
| What is the highest-impact upgrade? | Replace `mp4-muxer`, then adopt TS 7 |
| Should we add CI? | Yes — no GitHub Actions present; bundle + lint gates are the priority |
| Should we add Prettier? | Yes — missing from the main frontend package |

---

## 12. Related Documents

- [[stack-extensions-2026]] — broader language/tooling ROI analysis
- [[go-integration-2026]] — Go sidecars (dashboard/media/worker/gateway/ports)
- [[technical-reference]] — system architecture, service map
- [[backend-debugging-guide]] — FastAPI debugging patterns
- [[python-environment-management]] — venv mechanics
- [[remotion-guide]] — Remotion video compositing
- [[modern-css-2026]] — Tailwind v4 theming, OKLCH, cascade layers

---

_Last updated: 2026-09-24_

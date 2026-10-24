---
tags:
  - technical
  - testing
  - documentation
aliases:
  - Playwright
  - Playwright E2E
  - E2E Testing
  - Browser Testing
cssclasses:
  - technical-guide
date: 2026-10-21
type: concept
---

> [!info] Purpose
> The one place that explains how this repo's Playwright suite is laid out,
> how to write a spec that survives, and which October 2026 Playwright
> practices to adopt. Companion to `docs/TESTING_WORKFLOWS.md` §0 (which owns
> the runner-safety numbers) and
> `docs/knowledge-library/e2e-test-plan-2026.md` (which owns the pipeline
> strategy). This document owns the *craft*.

---

## 1. Where things live

```
packages/frontend/
  playwright.config.ts        # the runner config — 52 lines, the whole contract
  tsconfig.json               # src/ only            (type gate)
  tsconfig.tests.json         # tests/ + config       (type gate, separate)
  tests/
    helpers.ts                # 29 exported helpers — the shared vocabulary
    <name>.spec.ts            # 20 real specs, auto-discovered
    test-10s.wav              # 10 s sine fixture (882 KB)
    browser/                  # standalone .mjs debug scripts — NOT discovered
      out/                    # scratch output, gitignored
    visual/                   # visual-regression scratch
```

Three distinctions that will bite you if you miss them:

1. **`tests/browser/**` is excluded from discovery** (`testIgnore`). Those are
   standalone `node` scripts, not specs. They need a dev server on
   `127.0.0.1:5173` and are run by hand.
2. **Two TypeScript configs, two gates.** `tsconfig.json` covers `src/`;
   `tsconfig.tests.json` covers `tests/**/*.ts` *and* `playwright.config.ts`.
   A spec that type-checks under `npx tsc --noEmit` can still fail the
   `type` gate, because the gate runs both configs. See §4.
3. **The spec directory is `tests/`, not `tests/browser/`.** A spec placed
   under `browser/` is silently never run.

## 2. The runner contract

`packages/frontend/playwright.config.ts`:

| Setting | Value | Why it is what it is |
|---------|-------|----------------------|
| `testDir` | `./tests` | specs live directly under `tests/` |
| `testIgnore` | `**/browser/**` | keeps the standalone debug scripts out of discovery |
| `timeout` | 60 s | per test |
| `expect.timeout` | 10 s | per assertion |
| `use.actionTimeout` | 10 s | per action |
| `use.navigationTimeout` | 30 s | per navigation |
| `fullyParallel` | `false` | the suite drives one local backend and one ComfyUI; parallel workers would interleave renders |
| `workers` | `1` | same reason — and it keeps the GPU timeline honest |
| `retries` | 2 on CI, 0 local | |
| `projects` | one: `chromium` | D44 — single-engine target (see `docs/architecture/browser-support.md`) |
| `use.trace` | `on-first-retry` | a trace is written only when a test failed and retried |
| `use.screenshot` | `only-on-failure` | |
| `use.video` | `off` | video is slow and the trace carries the signal |
| `webServer` | `npm run dev`, `reuseExistingServer: !CI` | Playwright starts the dev server itself if it is not already up |
| `baseURL` | from `config/ports.json` | single source of truth for the port |

**`fullyParallel: false` + `workers: 1` is a deliberate constraint, not a
leftover.** The suite talks to a live local backend that renders video and
to a local ComfyUI. Two workers rendering at once produces failures that
look like flakes and are not. If you need parallelism, the answer is
Playwright 1.63+'s **test locks** (see §6), not `workers: 4`.

## 3. The helper vocabulary

`packages/frontend/tests/helpers.ts` — 27 exports. Use these rather than
re-implementing; several of them encode a race that has already bitten this
repo.

**Navigation**
- `navigateWithWait(page, path)` — navigates and waits for both the React
  root and the app shell. On failure it reports the requested path, the
  final URL, and the browser console/page errors, which makes a Vite
  module-loading or hydration failure diagnosable from the test output
  alone.
- `expectRedirectedTo(page, pattern)` — asserts a client-side redirect.
- `getBaseUrl()` — the configured base URL.

**Console hygiene**
- `setupConsoleErrorCapture(page)` / `expectNoConsoleErrors(...)` —
  asserts the page produced no console errors.
- `consoleErrorFilters`, `BACKEND_OFFLINE_FILTERS` — the known-benign
  noise to exclude (a backend that is deliberately offline, dev-tool
  overlays).
- `removeDevToolOverlays(page)` — strips Vite/React dev overlays that
  would otherwise register as console errors.
- `dispatchSseEvent(page, ...)` — drives a server-sent event into the
  page, for the SSE-backed queue and log views.
- `DEFAULT_GPU_SNAPSHOT` — the canned GPU telemetry payload the GPU specs
  assert against.

**Route mocks** (composable — they do **not** call `cleanupRoutes()`
internally, so several can stack in one test)
`mockApiHealth`, `mockApiQueueEmpty`, `mockApiQueueWithJobs`,
`mockApiComfyUIStatus`, `mockApiServiceStatus`, `mockApiSettings`,
`mockApiSystemHealth`, `mockGoServiceHealth`,
`mockGoServiceHealthDegraded`, `mockGpuTelemetry`, `mockHealthPage`,
`mockLogAnalytics`, `registerRouteHandler`, `cleanupRoutes`.

Always call `cleanupRoutes(page)` in `beforeEach`/`afterEach` to reset
between tests.

**Locators**
- `dashboardDropZone()` — the upload drop target.
- `expectAudioPickerOpens(...)`, `expectKeyOpensPicker(...)` — shared
  expectations for the audio picker and the keyboard shortcut.

## 4. The two-tsconfig split, and the 1.64 typing trap

`tsconfig.tests.json` compiles `tests/**/*.ts` with `strict: true` and
`types: ["node"]`. The `type` gate runs it. A spec therefore has to satisfy
`strict` mode *and* the Playwright 1.64 type surface.

**The trap:** `test(title, fn, timeoutMs)` is not a typed overload in
Playwright 1.64. The third parameter of `test()` is `TestDetails`, so
TypeScript cannot match a bare number and falls through to the wrong
overload, reporting:

```
TS2559: Type '({ page }: { page: any }) => Promise<void>'
        has no properties in common with type 'TestDetails'.
```

It reads like a fixture problem; it is an overload problem. The fix is to
set the timeout from inside the test:

```ts
// ❌ third argument is not a timeout in the 1.64 types
test("renders the clip", async ({ page }) => { … }, 420_000);

// ✅
test("renders the clip", async ({ page }) => {
  test.setTimeout(420_000);
  …
});
```

`test.slow()` is also available and is the right choice when a test is
slow *in general* rather than slow on this machine.

**Two more environment traps, both hit in practice:**

- **ESM has no `__dirname`.** The specs are ES modules. Use
  `path.dirname(import.meta.filename)` (Node 20.11+; this repo is on
  Node 24) or `import.meta.url`.
- **`process.cwd()` is `packages/frontend`, not the repo root.** Fixtures
  live in `packages/frontend/tests/` and rendered output lives at the repo
  root `output/`. Resolving against `process.cwd()` silently points at
  `packages/frontend/output/video` — which does not exist — and any
  "does the output exist?" assertion then quietly passes because it was
  guarded by an `if (fs.existsSync(...))`. Resolve from the spec's own
  location:

  ```ts
  const TEST_DIR = path.dirname(import.meta.filename);
  const REPO_ROOT = path.resolve(TEST_DIR, "..", "..", "..");
  const OUTPUT_DIR = path.join(REPO_ROOT, "output", "video");
  ```

  Make existence assertions unconditional. A guarded assertion is a
  disabled assertion.

## 5. Writing a resilient spec

These are the official Playwright practices, and they are the ones that
matter here.

**Test user-visible behavior, not implementation details.** A spec that
asserts a CSS class or a component's internal state will break on a
refactor that changed nothing for the user.

**Use locators that survive DOM churn.** Priority order:

```ts
page.getByRole("button", { name: "Make my clip" })   // ✅ best
page.getByText("Looks good")
page.getByTestId("onboarding-export")
page.locator("button.buttonIcon.episode-actions-later")  // ❌ fragile
```

`getByTestId` is a deliberate, explicit contract — this repo uses it on
the onboarding flow's stable hooks (`onboarding-flow`, `onboarding-export`,
`onboarding-success`, …). It is a contract, so changing one is a breaking
change to the tests, which is the point.

**Use web-first assertions.** They retry; a boolean comparison does not.

```ts
await expect(page.getByTestId("onboarding-success")).toBeVisible();  // ✅ retries
expect(await locator.isVisible()).toBe(true);                          // ❌ no retry
```

**Let `npx playwright codegen` pick the locator for you.** The "Pick
Locator" button prioritises role, text and test id — the same priority
order above. It is faster than hand-writing a selector and it picks the
resilient one.

**Do not test third-party dependencies.** Assert our behaviour, not
Ollama's or ComfyUI's. When a service is genuinely needed, mock it
through the route helpers.

**Give each test its own backend data.** The suite drives a live local
backend that writes to `output/`. Tests that share output paths collide.
The onboarding and music-video specs clean up `output/video/*.mp4` in
`beforeEach`/`afterEach` for exactly this reason.

**Prefer a fixture over a helper used in many tests.** A helper that is
used in several spec files should become a fixture (`test.extend`) so its
setup and teardown live in one place.

## 6. October 2026: what is new in Playwright, and what to adopt

Playwright **1.64.0** (released 2026-10-07) is the installed version. It
bundles Chromium 156.0.8078.4, Firefox 157.0 and WebKit 27.2.

### Adopt now

**Test locks (1.63+, extended in 1.64).** Tests that touch a shared
resource can declare a named lock; tests sharing a lock name never run
concurrently — across files, workers and projects — while everything else
keeps running in parallel. This is the escape hatch from
`fullyParallel: false`.

```ts
test("renders the clip", { lock: "gpu" }, async ({ page }) => { … });
test.describe.configure({ lock: "gpu" });   // for a whole file or group
```

Use it for anything that renders video or mutates the queue — the
`output/video/` writers and the ComfyUI submission path are the two
resources in this repo that cannot be shared.

**`testProject.default` (1.64).** Mark non-default projects so a bare
`npx playwright test` runs only the one you care about, and CI can still
run the rest. This repo has exactly one project (`chromium`) because of
D44, so this is not needed yet — but it is the mechanism to reach for if
a second engine is ever added, instead of commenting projects out.

**`--only-changed` (1.64).** Run only the test files with uncommitted
changes, or relative to a branch:

```bash
npx playwright test --only-changed
npx playwright test --only-changed=main
```

This is the agent-loop version of the suite: after editing a feature, run
the specs that could plausibly be affected and nothing else.

**`npx playwright init-agents` (1.63+).** Generates agent files for an
agentic loop. Verified present in 1.64.0, with
`--loop` accepting `claude`, `codex`, `copilot`, `opencode`, `vscode` and
`vscode-legacy`. It can also seed a test from an existing project
(`--config`, `--project`) and include prompts (`--prompts`).

**`--shuffle` (1.63+).** Runs tests in a random order to surface hidden
inter-test dependencies. The runner prints the seed; pass the same seed
back to reproduce a failure:

```bash
npx playwright test --shuffle
npx playwright test --shuffle 271828182
```

**`page.webmcp` (1.64).** Apps increasingly expose tools to AI agents via
the experimental WebMCP browser API. Playwright can now list and call
those tools directly — `await page.webmcp.tools()`. Not needed for the
current suite; it becomes relevant the moment the studio exposes an
agent-facing tool surface.

### Breaking changes to know

- **`page.accessibility` was removed** (1.61, after three years
  deprecated). Use a dedicated library such as axe-core.
- **The private recorder API was renamed** in 1.64
  (`_enableRecorder`/`_disableRecorder` → `_startRecording`/`_stopRecording`).
  It was private, but the `mcp-accessibility-scanner` project showed this
  breaks *recording* at runtime with no compile error, because the call
  goes through `any`. If you add a recorder dependency, re-validate it
  against 1.64 rather than bumping the version.
- **Device descriptors now forward `screen`.** Emulated mobile contexts
  report the device screen size to `window.screen` and to media queries,
  which can change responsive-layout and reflow results.
- **The junit reporter now distinguishes `<error>` from `<failure>`.**
  Any CI parsing that counted failures will see a different number.

### Deliberately not adopted

- **Multiple browser engines.** D44 fixes the target at modern Chromium.
  Adding Firefox/WebKit would multiply the runtime for a local-only
  studio and contradict that decision.
- **`page.accessibility` / axe.** Out of scope until there is an
  accessibility gate to satisfy.
- **Visual regression baselines.** Possible, but the GPU renderer is not
  pixel-stable across drivers, so a baseline suite would be noise. The
  suite asserts behaviour and file validity instead.

## 7. The current spec inventory

| Spec | Covers |
|------|--------|
| `onboarding-flow.spec.ts` | the 5-minute path end to end — upload → analyse → look → watch → render → success, plus the failure branch, the first-run redirect, and the returning-user case |
| `music-video-generation.spec.ts` | the wizard's upload → analyse → generate → export pipeline, with graceful degradation when ComfyUI is unavailable |
| `api-network.spec.ts` | API calls and network behaviour |
| `app-shell.spec.ts` | the app shell, routing, redirect assertions |
| `canvas2d.spec.ts` | the 2D canvas visualiser |
| `dashboard.spec.ts` | the dashboard, including the drop zone |
| `file-upload.spec.ts` | upload handling |
| `go-services.spec.ts` | the Go sidecar health surface |
| `gpu.spec.ts` | GPU telemetry |
| `health.spec.ts` | health endpoints |
| `logs.spec.ts` | log viewing |
| `lrc-visualizer.spec.ts` | the LRC visualiser |
| `media-library.spec.ts` | the media library |
| `pipeline-smoke.spec.ts` | the pipeline smoke matrix |
| `queue.spec.ts` | the job queue |
| `remix-panel.spec.ts` | the remix panel (the largest spec) |
| `settings.spec.ts` | settings |
| `sidebar.spec.ts` | sidebar navigation |
| `toast.spec.ts` | toast notifications |
| `unity.spec.ts` | the Unity bridge |

Fixtures: `tests/test-10s.wav` — a 10 s, 44100 Hz mono sine wave,
882 KB. Generated with:

```bash
ffmpeg -f lavfi -i "sine=frequency=440:duration=10:sample_rate=44100" \
  -c:a pcm_s16le -y packages/frontend/tests/test-10s.wav
```

**Not in this table:** the LTX workflow builder has a *backend* unit test,
not a browser one — `packages/backend/tests/test_comfyui_workflow.py`
(pytest, 9 cases: the checkpoint loader, T5 and VAE nodes, the default
variant, steps/CFG propagation, required-node presence, resolution
clamping, 4n+1 frame snapping, model classification, and the 8 GB VRAM
fit). Node-graph assertions belong in pytest, where they can inspect the
graph directly; the browser suite is for behaviour the user can see.

## 8. Running the suite

```bash
# From packages/frontend/
npx playwright test                          # everything
npx playwright test onboarding-flow.spec.ts  # one spec
npx playwright test --only-changed           # only what you touched
npx playwright test --project=chromium       # explicit project
npx playwright test --shuffle                # surface order dependencies
npx playwright test --reporter=line          # CI-friendly output

# The whole gate suite (docs → ruff → type → lint → unit → build)
python tools/run-gates.py
```

The Playwright suite is **not** part of `tools/run-gates.py` by default —
it is opt-in via `--e2e`, because it needs a running dev server and a
warm GPU. Run it before pushing when you touched frontend behaviour.

## 9. Anti-patterns seen in this repo

- **Guarded assertions.** `if (fs.existsSync(local)) { expect(...) }`
  passes when the file is missing. Assert existence, then assert content.
- **`test(title, fn, timeoutMs)`.** Not typed in 1.64 — see §4.
- **CSS-class selectors.** Fragile; use role/text/test-id.
- **`expect(await isVisible()).toBe(true)`.** No retry; use the
  web-first form.
- **Paths resolved from `process.cwd()`.** Points at
  `packages/frontend/`, not the repo root — see §4.
- **Guarding a whole assertion block behind a capability check** so it
  silently degrades to a no-op. The degradation should be an explicit
  branch with its own assertion, as `music-video-generation.spec.ts` does.

## 10. Related

- [[e2e-test-plan-2026]] — the canonical full-pipeline test strategy
- [[three-js-render-motion-2026]] — the headless 4K render pipeline
- [[frontend-build-pipeline]] — the dev server and build this suite runs against
- [[backend-debugging-guide]] — the backend the suite drives
- [[comfyui-workflows]] — the ComfyUI surface the video specs exercise
- [[knowledge-tracker]] — library migration tracker
- [[tagging-guide]] — how this article is tagged

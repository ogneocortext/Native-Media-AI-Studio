# Browser Support

> There is exactly **one** target engine: **Chromium** (decision-log **D44**).
> This machine's browsers are Chromium-based — Comet, Google Chrome and the
> agent's BrowserOS Neo all run the same engine, and Playwright drives
> `chromium`. Nothing here is a cross-browser guarantee, and nothing needs to
> be. This document records the measured configuration, what "supported" means,
> and what changing the decision would cost.

## Why a single engine

The studio is a local workstation app: the backend, the LLM/serving stack
(Ollama, ComfyUI), Unity and Blender all run on the same machine. Its outputs
are consumed through one browser on that machine. Supporting a second engine
(WebKit/Gecko) would buy nothing the user can exercise, while costing a
polyfill/downlevel layer, a second Playwright project and a matrix of media
bugs (`WebCodecs`, Web Audio, `MediaRecorder`) that differ per engine.

So the target is stated, not implied: **modern Chromium, current stable**.

## Measured configuration

| Fact | Value | Evidence |
| --- | --- | --- |
| TypeScript target | `ES2022` | `packages/frontend/tsconfig.json` (`"target": "ES2022"`) |
| TS lib | `ES2022`, `DOM`, `DOM.Iterable` | `packages/frontend/tsconfig.json` |
| Build target | `es2022` | `packages/frontend/vite.config.ts:180` ("Target modern browsers for smaller bundles") |
| Entry script | `<script type="module">` (ESM only) | `packages/frontend/index.html` |
| E2E browser | `chromium` / `devices["Desktop Chrome"]` — single project | `packages/frontend/playwright.config.ts:45` |
| Legacy/downlevel plugin | **absent** | no `@vitejs/plugin-legacy`, no `core-js` in `packages/frontend/package.json` |
| `browserslist` | **absent** — no `.browserslistrc`, no `browserslist` key | measured 2026-10-18 |

The three facts that set the floor are: the ESM-only entry (a browser that
cannot run `<script type="module">` never boots the app), the `es2022` build
target (no downleveling, no polyfills — modern syntax reaches the browser
verbatim), and the single Chromium test project (the only engine any gate
exercises).

## What "supported" means

- **Supported:** Chromium stable, and the recent Chromium used by the agent's
  own browser tooling. All four ways the app is opened here — Comet, Google
  Chrome, BrowserOS Neo, Playwright `chromium` — are that engine.
- **Unsupported, not blocked:** Firefox and Safari. The app is not tested there
  and makes no promise; it is not sabotaged either. A failure there is not a
  bug report this repo accepts.
- **Chrome-on-Android / iOS:** irrelevant — this is not a deployed product.

## How the floor is enforced

Nothing enforces a minimum Chromium *version* mechanically; the build simply
stops emitting syntax and API shims for older engines, and the browser tells
you immediately when it is too old (a module-script syntax error, or a missing
global). Enforcement is by measurement, in two places:

1. `python tools/run-gates.py` — `type` (tsc against `ES2022` + `DOM` libs),
   `lint`, `unit`, `build`. A use of an API newer than the configured lib fails
   `type` rather than failing in the browser.
2. The Playwright chromium suite (`--e2e`), which boots the real app in the
   real engine.

A build that starts emitting syntax older engines cannot parse is a *feature*
here, not a regression: it keeps bundles small.

## Using modern browser APIs

Because the target is stated and current, prefer the platform over a
dependency or a hand-rolled shim. Concretely, when an API is Chromium-current:

- use it directly — do **not** add a polyfill, and do not feature-detect a
  browser that cannot ship here;
- do still handle the API *failing* at runtime (a permission denial, a
  `NotAllowedError`, a codec that is absent on a machine without the hardware)
  — "modern Chromium" says nothing about whether this workstation's GPU or the
  user's permission state allows the call;
- keep media specifics honest: `WebCodecs`, `MediaRecorder` and Web Audio are
  the reason a single engine is acceptable, and they are also the APIs whose
  behaviour is most engine-specific — so they are the ones a second engine
  would break first.

## Changing this decision

Re-opening D44 means all of the following, not just a config line:

- add `@vitejs/plugin-legacy` (or a `browserslist` + polyfill layer) and accept
  the larger bundle;
- add Firefox/WebKit projects to `playwright.config.ts`;
- re-verify the media paths (WebCodecs capture, Web Audio graph, `EventSource`)
  per engine, since those are what actually differ;
- update this file and append a new decision-log entry.

If a real second-engine requirement ever appears, that is the checklist.

## Related

- `docs/architecture/decision-log.md` — **D44** (this decision).
- `docs/TESTING_WORKFLOWS.md` — which suites exist and what they cover.
- `docs/architecture/visualizer.md` — the module map new visualizer logic
  belongs in (D14).

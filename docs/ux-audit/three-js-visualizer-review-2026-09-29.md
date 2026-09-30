---
tags:
  - testing
  - design
  - ux-audit
aliases:
  - Three.js Visualizer Review 2026-09-29
cssclasses:
  - research-report
date: 2026-09-29
---

# Three.js Studio Visualizer — Browser Test Findings

**Date:** 2026-09-29
**Tested via:** ngrok tunnel (`doctrine-penalize-chaplain.ngrok-free.dev`), live Chromium session
**Scope:** Three.js Studio section (CREATE nav). Read-only testing — no settings changed, no long renders started.

## Modes tested

1. **Crown** (default, pre-loaded): gold torus ring with spikes, glowing orange edges, dark navy/blue gradient background with floor glow. Bloom visible. Polished.
2. **Add Sphere:** glossy blue reflective sphere, dropped into the center of the crown ring.
3. **Add Box:** faceted purple cube, same center cluster.
4. **Add Character:** glowing humanoid figure (rough, blobby low-poly form) at the bottom of the cluster.
5. **Play render (brief):** cluster animates — objects orbit the camera, bloom pulses, crown ring shifts gold → orange/red during playback.

## Findings (priority order)

### P0 — Stability
**F1. Renderer became unresponsive after ~10 minutes with 4 objects in the scene.**
Final navigation attempt hung. Suspect a perf leak or unbounded growth in the render loop (animation frame accumulation, undisposed geometries/materials, or event listener pile-up).
*Fix direction:* profile the render loop; ensure `dispose()` on removed objects, cap pixel ratio, check for per-frame allocations.

### P1 — Usability blockers
**F2. New objects spawn exactly at scene center, overlapping existing objects.**
Adding sphere/box/character looked like nothing happened — the user can't tell an add succeeded.
*Fix direction:* spawn with a positional offset (e.g., golden-angle spiral or grid slot), auto-select and camera-focus the new object, and/or add an object list panel showing scene contents.

**F3. No way to select or delete individual scene objects.**
"Reset Camera" is the only reset control. The scene permanently accumulates objects for the whole session.
*Fix direction:* click-to-select (raycast) with a delete key/button, plus a "Clear scene" action. Minimum viable: an object list with per-item remove.

**F4. "Generate Scene" button is disabled with no explanation.**
No hint about what's missing (audio track? prompt text? model selection? backend not ready?).
*Fix direction:* tooltip or inline hint stating the unmet precondition; enable progressively as conditions are met.

### P2 — Clarity and polish
**F5. Stats row abbreviations are cryptic.**
"Objs2", "Camorbit", "Bloom1/3" — a new user can't decode these.
*Fix direction:* full labels ("Objects: 2", "Camera: Orbit", "Bloom: 1/3") or tooltips on hover.

**F6. AI Scene Generator panel renders oddly.**
The model combobox shows "qwen3.5:" and "9b" split apart as if the label/value layout broke. "BPM 150 / Sync OFF / Beats:—" gives no visible path to enable beat sync.
*Fix direction:* fix the combobox layout (single-line model name); make beat-sync activation discoverable (toggle or guided hint).

**F7. Character preset quality is far below the crown.**
The glowing blob reads as a placeholder next to the polished crown mesh.
*Fix direction:* ship a better default character mesh or mark the preset clearly as WIP/placeholder.

**F8. Playback background turns into a gray scanline/washed-out gradient.**
Reads as a rendering artifact, not an intentional vignette.
*Fix direction:* verify whether this is a post-processing pass misfiring during playback (bloom/threshold interacting with the background gradient); pin the background treatment so it's identical in idle and playback.

**F9. "Play render" label is misleading.**
It plays a live canvas preview — nothing is rendered to a file.
*Fix direction:* rename to "Preview" and reserve "Render/Export" for actual file output.

### P3 — Infra / known issues
**F10. Tunnel was flaky at session start.**
Several timeouts and blank loads; route navigations showed stale dashboard content until the client router hydrated, then `/three-js-studio` rendered correctly. Likely ngrok/free-tier behavior rather than an app bug, but worth noting if users report "blank page on load" — a loading skeleton or router-ready gate would mask it.

**F11. Backend status still degraded.**
Sidebar system toggle shows "Degraded"; studio header shows "GPU: — • SR: —" (unresolved from the earlier session). No console errors were observable in this environment.

## Screenshots
Captured during the session (in order): default crown → +sphere → +box → +character → render playing. Available in the chat thread where this review was delivered.

---

## Triage & implementation (2026-09-29, later same day)

Each finding checked against the code before acting. Scope:
`packages/frontend/src/features/three-js-studio/`.

| ID | Applicable? | Status / change |
|----|-------------|-----------------|
| F1 perf leak | **Confirmed.** The object-sync effect removed meshes from the scene but never called `dispose()`; character model swaps leaked the old mesh too; teardown left `OrbitControls`, the effect composers and the scene graph alive. | `hooks/useThreeScene.ts`: `disposeObject3D()` / `disposeEntry()` dispose geometry, materials (and their per-material textures) and stop character mixers on removal and on model swap; teardown disposes objects, controls, composers, renderer, and clears `window.__camera` / `window.__renderer`. **Verified:** `renderer.info.memory.geometries` 24 → 30 (6 adds) → 24 (6 removes). Regression script: `tests/browser/three-studio-dispose-check.mjs`. |
| F2 spawn on top of each other | **Confirmed.** `addObject` hard-coded `position: [0, 0.5, 0]`. | `hooks/useObjectManager.ts`: golden-angle spiral slot per new object; `ThreeJSStudio.handleAddObject` now shows a success toast naming the new object. Auto-select already existed. |
| F3 no select / delete | **Partly.** An object list with per-row remove already existed (`components/ObjectsTab.tsx`) but is behind a collapsed drawer, and there was no canvas selection at all — repo-wide raycast search returned zero hits. | Added click-to-select raycast on the canvas (drag threshold 5 px so orbiting never selects, empty click deselects) + `Delete`/`Backspace` removal, both guarded against text fields. |
| F4 silent disabled button | **Confirmed.** `disabled={!selectedModel \|\| !metadata}` with no explanation. | `components/AISceneGenerator.tsx`: `generateBlockedReason` drives the button `title` and an inline amber hint ("No Ollama model selected…", "No track selected…", "Loading track metadata…"). |
| F5 cryptic HUD | **Confirmed.** | `components/StudioHUD.tsx`: `Objs`/`Cam` → `Objects`/`Camera`, plus `title` tooltips on every stat. |
| F6 combobox + beat sync | **Confirmed (layout).** The `<select>` lacked `min-w-0` inside a flex row, so its long option label overflowed the 288 px panel. Beat sync is a toggle but only read "Sync OFF", which looks like a status. | `AISceneGenerator.tsx`: `min-w-0 w-full truncate` + `title` + a full-name line under the select. `TrackInfoBar.tsx`: slider-style toggle labelled "Beat sync ON/OFF" with an explanatory `title`, tooltip on `Beats:`. |
| F7 character quality | **Confirmed, but an asset issue** — not fixable in code. | Marked as placeholder instead: "WIP" chip on character rows, tooltips on both "Add character" buttons. |
| F8 gray playback background | **Confirmed, root cause found.** Three's stock `VignetteShader` mixes towards `vec3(1 - darkness)` — with `vignetteStrength: 0.35` that washes dark pixels towards **0.65 grey** instead of shading them. It is screen-space, so the wash only became obvious when camera orbit moved the dark floor/sky to the frame edges. Measured background pixel: `(78,77,78)` where the scene colour is `#0a0a0f`. | Replaced the pass with a darkening vignette (`VIGNETTE_SHADER` in `useThreeScene.ts`) keeping the same `offset`/`darkness` uniforms. Measured background now `(0–9, 0–9, 0–17)`, and idle vs playing match. Residual "scanlines" during orbit are the `GridHelper` under minification — intentional scene geometry, left alone. |
| F9 "Play render" | **Confirmed.** | `components/PlaybackControls.tsx`: title "Preview play — plays the live canvas, no file is rendered", caption `Render` → `Preview`. "Render" now only refers to file output. |
| F10 flaky tunnel | **Not applicable** — free-tier ngrok behaviour, no app defect. Note the page already shows a loading state while the scene initialises. | none |
| F11 backend degraded | **Not applicable** — environment state (GPU snapshot endpoint), unrelated to this feature. | none |

### Defects found while verifying (not in the original findings)

- **Preview never reached the render loop.** `useThreeScene` read `renderPlaying` once into state and only synced hook → parent, so the transport button toggled its own UI while the camera stayed parked (camera position identical before/after 4 s of "playback"). Fixed with the missing parent → hook sync; camera now orbits on play.
- **`Apply to Scene` is a no-op.** `ThreeJSStudio` passes `useCodeApplier({ sceneRef: { current: null } })`, so `handleApplyCode` returns at its first line. Out of scope for this audit — flagged as **O1**, unfixed.

### Verification

`node packages/frontend/tests/browser/three-studio-audit-checks.mjs` (needs `pnpm dev`)
— 10/10 checks pass, no console errors: scene load, F9 label, preview runs, F2 add
feedback, F4 hint, F5 labels, F6 select fit + toggle label, F3 select and Delete.

`pnpm type-check` and `pnpm exec eslint src/features/three-js-studio` clean.
The vignette change alters `/three-js-studio` pixels, so the visual-regression
baseline in `tests/visual/baselines/` needs re-capture before comparing again.

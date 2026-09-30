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

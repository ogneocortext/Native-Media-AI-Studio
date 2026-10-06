# Three.js Studio Motion Features Plan — Oct 2026

**Status:** Proposed 2026-10-06 — not yet approved or started
**Owner:** repo owner (implementation: local coding agent)
**Source research:** [[three-js-render-motion-2026]] (motion craft, export
patterns), [[visualization-effects]] §11.7 (selective response)

> Read `docs/architecture/decision-log.md` before implementing. New logic goes
> in modules under `packages/frontend/src/features/three-js-studio/`, not
> inline in `useThreeScene.ts` (same rule as D14/D23/D24 for `Visualizer.tsx`).

## Problem

The studio's motion is reactive but unphrased: it pulses *with* the music but
doesn't *perform* it. Verified against current code:

| # | Gap | Current state |
|---|---|---|
| 1 | Camera mode switches are hard cuts | `useThreeScene.ts` L523–538 applies orbit/dolly/handheld continuously; no transition between modes |
| 2 | Sections never drive motion | `useTrackMetadata.ts` detects sections, buildups, drops — used only for AI prompt context, never at runtime |
| 3 | No easing in the render loop | Animations accumulate raw `delta` (`useThreeScene.ts` L470, L514–521); easing tokens exist only as guidance text in `services/sceneGuidelines.ts` L38–41, not runtime code |
| 4 | Beats are reacted to, never anticipated | `beatPunch` is a decaying spike *after* the beat (`useThreeScene.ts` L452–456: `beatPunchAmp * (1 - timeSinceLastBeat/beatWindow)`); nothing pulls back before a downbeat or holds after landing |
| 5 | No video export | Preview is the only output; frame-sequence recording was never implemented (`three-js-studio.md`) |

## Feature specs

### F1 — Eased camera transitions

When `cameraMode` changes, blend camera position + look-target from the old
mode's pose to the new mode's pose over ~600 ms using the `travel-balanced`
anchor (`cubic-bezier(1.00,.49,.00,.55)`), not a hard cut. User drag/orbit
input cancels the blend immediately and hands control back.

- **Accept:** mode switch produces no visible pop (screenshot before/after at
  blend midpoint shows interpolated pose); drag during blend cancels it;
  zero console errors.
- **Files:** `hooks/useThreeScene.ts` (L523–538), new `services/cameraTransitions.ts`.

### F2 — Section-aware motion driver

Subscribe to section boundaries from the existing track metadata
(`hooks/useTrackMetadata.ts`). On boundary crossing, apply the section→motion
map from [[three-js-render-motion-2026]] §3: camera mode, `beatPunch` scale,
particle intensity, palette/light shift. Honor `sceneGuidelines.ts` L96:
**cut hard on snare/downbeat, or 0.9 s ease-out wipe at section boundaries** —
never a slow crossfade.

- **Accept:** playing a track with ≥3 sections visibly changes camera and
  intensity at each boundary; boundary behavior matches the guideline (cut or
  0.9 s wipe); works with the templates' existing `cameraMode`/`beatPunch`.
- **Files:** `hooks/useTrackMetadata.ts`, `sceneTemplates.ts`, new
  `services/sectionDriver.ts`.

### F3 — Render-loop easing utilities

New `services/easing.ts`: cubic-bezier anchors from [[three-js-render-motion-2026]]
§3 (`entrance-sharp`, `settle-soft`, `expressive-pop`, `travel-balanced`,
`exit-accelerate`, `travel-cut`) as pure functions `ease(anchor, t)`. Migrate
camera blends (F1) and at least one object animation off raw `sin()`/linear
accumulation onto anchored easing.

- **Accept:** unit tests pin each anchor's output at t=0/0.5/1; no per-frame
  allocations in the easing path.
- **Files:** new `services/easing.ts` (+ tests).

### F4 — Beat-phrased animation (anticipation)

Use BPM + `timeSinceLastBeat` (already computed, `useThreeScene.ts` L448) to
predict the next downbeat. In the ~120 ms before it: anticipation — scale/zoom
pulls back slightly (`travel-cut` anchor). On the beat: `expressive-pop`
landing, then **hold** (no drift). This is the anticipation→action→settle
spine from the research doc, replacing pure decay.

- **Accept:** on a 120 BPM click track, the pullback visibly precedes each
  downbeat and the landing holds still (no post-beat wobble); toggleable per
  template.
- **Files:** `hooks/useThreeScene.ts` (L448–463), `sceneTemplates.ts`.

### F5 — Deterministic frame-accurate export

Two modes per the [r3f-video-recorder](https://github.com/malerba118/r3f-video-recorder)
pattern: `realtime` (capture while playing) and `frame-accurate` (hijack the
frame clock, step `1/fps` per frame, advance only after capture). Encode with
**mediabunny** (already `^1.61.0` in `packages/frontend/package.json`) →
mp4/h264 in all browsers. Hard requirement: frames must be pure functions of
the export clock — `useThreeScene.ts` L406–415 currently drives the
`THREE.Timer` from the wall clock; the export path must drive it from the
frame index instead (the documented clock-hijack shim). Map beat events to
**frame numbers, not wall-clock**, so preview and export agree.

- **Accept:** a 10 s export at 30 fps contains exactly 300 frames; two exports
  of the same scene are byte-comparable modulo container metadata; no dropped
  frames when the tab is backgrounded mid-export.
- **Files:** `hooks/useThreeScene.ts`, new `services/videoExport.ts`.
- **Note:** this is the largest item; F1–F4 should land first so the export
  captures the improved motion.

## Suggested order

F3 (easing utils + tests) → F1 (camera transitions) → F4 (anticipation) →
F2 (section driver) → F5 (export). F5 last: it records whatever motion exists,
so motion quality must come first.

## Non-goals

- WebGPU migration (deferred per gaps register; `forceWebGL: true` stays).
- Character animation improvements (separate track).
- Cloud render fallback (HyperFrames Lambda/Cloud Run covers this).

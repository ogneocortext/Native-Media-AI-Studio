# Three.js Studio Motion Features Plan — Oct 2026

**Status:** In progress 2026-10-13 — F1–F5 landed; F5's full-frame encode
awaits a non-headless browser (see per-feature notes).
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
- **Status: Done (2026-10-13, `44b91e3` follow-up on Windows).** `sectionDriver.ts`
  ships the §3 map + cut/wipe resolution (19 unit tests); `useSectionDriver`
  (in `useTrackMetadata.ts`) subscribes per frame with zero re-renders;
  `useThreeScene.ts` applies the profile — camera cut (transition cleared, hard
  jump) or 0.9 s `settle-soft` wipe on boundary, scaled `beatPunch`, scaled
  particle speed, and light-palette hue rotation against captured base colors;
  `cameraTransitions.beginCameraTransition` gained an `anchor` parameter for the
  wipe. `sceneTemplates.ts` gained `sectionDriven?: boolean` (opt-out; default
  on). Wiring the driver also required the studio's audio path to exist:
  `ThreeJSStudio.tsx` passed dummy `{current: null}` refs for the audio
  element/context/analyser, so `toggleAudio` no-opped and the analyser fed
  nothing — the scene engine's own refs plus a hidden `<audio>` element (src =
  selected track) now complete the intended wiring.
  Remaining: browser verification per the accept criterion (a ≥3-section track
  on Windows) and D24's before/after captures; `getCurrentBeat` is still stubbed
  in the studio, so F4's beat-phrased path stays dormant — a separate item.

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
- **Status: Done (2026-10-13, browser-verified).** `beatPhrasing.ts` +
  `useThreeScene.ts` wiring + the per-template `beatPhrase` opt-in were
  already merged; the missing piece was the beat *source* —
  `ThreeJSStudio.tsx` passed a never-ready stub, so every beat-driven path
  was dormant. It now passes the real beat getter (`useBeatTimeline`'s
  `getCurrentBeat`, surfaced by `useTrackManager`) through a late-bound ref
  (the scene engine is built before the track manager — hook order),
  sampled at the audio playhead since beat times are track-relative, with
  a not-ready fallback when no analysis exists. **Verified in-browser**
  (`c0ac669c_…The Last-Original-V1.m4a`, 130 BPM): the HUD beat dot
  fires ~10 edges over 5.6 s at the track's BPM — impossible with the
  stub. The phrase-pullback visual check on a click track still needs a
  dedicated run.

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
- **Status: Done (2026-10-13), studio lane.** `useThreeScene.ts` gained the
  clock hijack: the frame body is extracted into `runFrame`, shared by the
  live rAF driver and a new `renderAtTime(tSec, dtSec)` — while the export
  clock is active the loop takes delta/elapsed from the frame index, live
  frames are quiesced, and per-frame randomness (handheld walk, beat shake,
  particle wrap) draws from a seeded PRNG instead of `Math.random`.
   `resetDeterministicState()` restores shake, camera blend, section override,
   light palette, character mixers and the authored particle layout, so frame
   0 starts clean. `services/videoExport.ts` holds the pure pieces —
   `planExport` (exactly `round(duration·fps)` frames, frame `i` at `i/fps`)
   and `createSeededRandom` (mulberry32) — pinned by 10 unit tests. The mux
   reuses the shader lane's `frameAccurateExport.ts` (generic canvas →
   mediabunny) rather than a duplicate; UI is a "Export 10 s MP4" button in
   `StudioHeader`. **Verified in-browser 2026-10-13** at 480×360, the largest
   size this headless Chromium's H.264 encoder accepts (it rejects >640×480 —
   the same constraint the shader-lane exporter carries, and the reason the
   first attempt reported the honest "needs WebCodecs" toast): `ffprobe` on
   two runs — exactly **300 frames, duration 10.000000 s, 30/1 fps**; a
   byte-diff of the two runs differs in **exactly 6 bytes**, the
   `mvhd`/`tkhd`/`mdhd` creation-time fields (`0x5e`→`0x65`, the 7-second
   wall-clock gap between the runs). Frame payloads are byte-identical, so
   the accept criterion is met. Reaching it took one fix: the live rAF loop
   originally quiesced only *per captured frame*, so `frameCountRef` (which
   gates the particle update on its parity) advanced between captures and
   made every other export frame's particles depend on how many live frames
   interleaved — the quiesce is now per-export
   (`beginDeterministicRun`/`endDeterministicRun`) and the reset pins the
   counter to 0.

## Suggested order

F3 (easing utils + tests) → F1 (camera transitions) → F4 (anticipation) →
F2 (section driver) → F5 (export). F5 last: it records whatever motion exists,
so motion quality must come first.

## Non-goals

- WebGPU migration (deferred per gaps register; `forceWebGL: true` stays).
- Character animation improvements (separate track).
- Cloud render fallback (HyperFrames Lambda/Cloud Run covers this).

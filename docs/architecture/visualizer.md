# Visualizer Architecture

> The visualizer stage was decomposed on 2026-10-01 (decision-log **D14**).
> `Visualizer.tsx` was 2,361 lines and `Canvas2DVisualizer.tsx` 1,560; both are
> now orchestration over focused modules. This document is the map.

## Why

The two components each mixed trivially-extractable code (pure helpers, colour
maths) with genuinely stateful orchestration (audio transport, track loading,
preset application). Nothing could be changed safely because every edit risked
the whole surface.

## Module map

```
src/features/visualizer/
├── Visualizer.tsx              ~1,950 — top-level stage orchestration + JSX
├── Canvas2DVisualizer.tsx      ~1,450 — 2D draw loop + JSX
├── visualizerHelpers.ts          179 — pure: file refs, payload narrowing
├── canvas2dHelpers.ts            124 — pure: colour lerp, easing, noise/FBM
├── useAudioGraph.ts              178 — shared AudioContext graph
├── useVisualizerRecording.ts     156 — MP4/WebCodecs capture, WebM fallback
├── useSpectralTimeline.ts        — per-frame spectral timeline lookup
├── audioEQ.ts / audioReactivityProcessor.ts — EQ + reactivity maths
├── sectionStateMachine.ts        — section → shader preset mapping
├── stemSpatial.ts                — per-stem spatial assignment
├── components/RenderStats.tsx     54 — renderer telemetry overlay
├── professionalMixer/           — full console mixer (own graph, own hook)
└── viz-styles/                  — per-style renderer definitions
```

## Rules for new work

1. **Put new logic in the matching module, not in `Visualizer.tsx`.** The
   component is the coordinator; helpers belong in a helper module, lifecycles
   in a hook.
2. **Visuals are driven by audio data. UI chrome may animate on its own.**
   A visualization that is described as audio-reactive must derive its motion
   from real audio — `audioData.current` bands, `getStemEnergy`, or
   `audioData.beatPhase`. Never drive a visual from `performance.now()`,
   `Date.now()`, or a bare `Math.sin(t)`: that is the failure mode where a
   "reactive" scene looks identical playing a track, paused, or silent.
   - Allowed to animate on their own: notifications, badges, the beat dot,
     idle/ambient "breathing" while nothing plays, loading states, and any
     element whose purpose is UI engagement rather than representing the music.
   - `Canvas2DVisualizer`'s `updateIdleParticles` / `idlePulse` and
     `three-particles`' use of the clock for integration (audio scales the
     rate) are examples of both allowances.
   - A style should still be **previewable before playback**. Idle motion is
     welcome — but it must be *blended out* by real audio energy so it can never
     mask or impersonate a real reaction. `InstancedBlobField`'s `idlePreview`
     scales as `1 - max(bass, mid, treble) * 1.6`: full shimmer in silence,
     zero once a real band is present. `ShaderCanvas` likewise keeps its clock
     for `u_time` so shaders can be inspected before audio plays.
   - Pass per-frame values as a **ref** (`BlobFieldDrivers`), never as props.
     R3F does not re-render every frame, so props would freeze at the last
     React render.
3. **One `AudioContext` per page.** `useAudioGraph().ensureAudioContext()` is
   the only creation site. Creating a second context is functional but claims a
   second hardware output device (see D4).
4. **Hooks own their teardown.** `useVisualizerRecording` disposes its recorder
   and timer; `useAudioGraph` closes the context. The component's unmount effect
   only handles what the component itself created (the audio object URL).
5. **`handleSelectLibraryTrack` is intentionally inline** (~152 lines, 17 state
   setters). It is the track-loading coordinator; splitting it trades real
   behavioural risk for line count alone.

## Audio graph

```
MediaElementSource → EQ → analyser → mainGain → destination
```

Created lazily on first playback and shared with the stem mixer and professional
mixer via `sharedAudioContext`. `estimateOutputLatency` is applied whenever the
context is created or resumed — the latency-compensated clock in `audioTiming.ts`
depends on it for correct lyric and beat sync.

## Verifying a refactor here

Do not rely on "the tests still pass". For extraction work, diff the normalised
code lines against the previous revision and confirm the delta is **only** import
wiring and the intended edits:

```bash
git show HEAD:packages/frontend/src/features/visualizer/Visualizer.tsx > old.tsx
# compare normalised, non-comment code lines of old.tsx against the new files
```

Runtime confirmation still matters — `canvas2d.spec.ts` and
`lrc-visualizer.spec.ts` exercise the 2D modes and LRC sync in a real browser:

```bash
cd packages/frontend
pnpm exec playwright test canvas2d.spec.ts lrc-visualizer.spec.ts
```

Playwright starts the Vite dev server itself. The backend may be offline; these
specs tolerate that and filter the resulting proxy errors.

## Motion verification

For "is it actually animating" questions — which screenshots answer badly for
WebGL — use `docs/guides/visualizer-debug.md` (ffmpeg `gdigrab` capture plus
sharp frame diffing) rather than canvas probing. Append `#shader-debug` to the
visualizer URL for lightweight per-second motion logging.
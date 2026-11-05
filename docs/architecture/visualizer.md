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
├── Visualizer.tsx              ~1,290 — top-level stage orchestration + JSX
├── Canvas2DVisualizer.tsx      ~1,450 — 2D draw loop + JSX
├── visualizerHelpers.ts          179 — pure: file refs, payload narrowing
├── canvas2dHelpers.ts            187 — pure: colour lerp, easing, noise/FBM, Bark/Mel/ERB scales
├── useAudioGraph.ts              178 — shared AudioContext graph (+ transient analyser, T-VIZ-16)
├── spectralFlux.ts               ~130 — spectral-flux onset detector → decaying envelope (T-VIZ-16)
├── useVisualizerRecording.ts     156 — MP4/WebCodecs capture, WebM fallback
├── useSpectralTimeline.ts        — per-frame spectral timeline lookup
├── audioEQ.ts / audioReactivityProcessor.ts — EQ + reactivity maths
├── sectionStateMachine.ts        — section → shader preset mapping
├── canvas2dModeBudget.ts         — per-mode effect budget + cap (see below)
├── motion/                        — motion vocabulary (see below)
├── stemSpatial.ts                — per-stem spatial assignment
├── components/RenderStats.tsx     54 — renderer telemetry overlay
├── components/VizTopbar.tsx               — slim top bar (track picker, mode switch, inspector toggle)
├── components/VizToolbar.tsx              — stage toolbar (presets, snapshot/focus, pin)
├── components/VizInspector.tsx            — docked tabbed inspector (Scene/Tuning/Mixer/EQ/AI)
├── components/VizAudioBar.tsx             — transport strip + hidden <audio>
├── components/VizPlayhead.tsx             — click-to-seek overlay (fill, loop markers, readout)
├── components/VizMixerTab.tsx             — inspector Mixer tab (pro/simple toggle + Remix link)
├── components/VizMoreMenu.tsx / VizFooter.tsx / VizEmptyState.tsx
├── components/useStemMixer.ts             — WebAudio stem graph (gain/EQ/spatial/meters)
├── ShaderHud.tsx                           — FX-mode preset picker + slider HUD
├── professionalMixer/           — full console mixer (own graph, own hook)
└── viz-styles/                  — per-style renderer definitions

Chrome styles live in `src/styles/visualizer-chrome.css` (component chrome
recovered from the pre-slim-rewrite stylesheet) layered over `visualizer.css`.
The Remix/Mashup builder is NOT here — it lives at `/create/remix`
(`features/remix/`); the visualizer hands off via `pendingTrack` +
`pendingRemixOpen`.
```

## The Canvas2D effect budget (2026-10-02)

`canvas2dModeBudget.ts` implements recommended fix #1 of
`docs/knowledge/canvas2d-visualizer-diagnosis-2026-10-02/README.md`.

`Canvas2DVisualizer.tsx` drew **all four** global effects — trail/ghost fill,
phrase flash, beat vignette, drum shockwaves — on every frame of every mode,
*before* the mode's own rendering. Add a mode's own glows and you get 5-7
simultaneous large-area effects with no focal point. That is the "visual noise"
failure: everything reacts to everything, so nothing reads.

The budget makes the choice **data**, which is the diagnosis doc's own
recommendation ("Recommend data — it makes the budget reviewable in one place").

- `MAX_EFFECTS = 2`, applied by `resolveActiveEffects` at runtime.
- A mode may *declare* more than two (bars declares three), because which ones
  fire is frame-dependent; what must never happen is three firing at once.
  `EFFECT_PRIORITY` decides which survive.
- **Unknown modes get nothing.** A new mode is inert until it declares a budget,
  rather than inheriting the old stack.
- `assertEffectBudget()` validates the table and is called from a test. It also
  rejects a misspelled effect name, which would otherwise be a silent no-op.

Wiring notes:

- The 4-level nested ternary for trail alpha (with duplicated
  `prefersReducedMotion` branches) is gone; alpha lives in the budget.
- The `beatVignette * 0.45` alpha became `VIGNETTE_ALPHA_CEILING = 0.225` — the
  doc's "halve the alpha ceiling globally, then re-evaluate", pending a look at
  three tracks.
- Shockwave **spawning** is gated as well as drawing. Spawning rings a mode will
  not draw leaks them into the next beat's frame and fills the 8-ring pool.
- The perceptual-scale selector was copy-pasted **six times**; it is now
  `makeFreqMapper()` in `canvas2dHelpers.ts`, alongside `sampleMappedBand()`.
- `asymmetricSmoothStep` / `asymmetricSmoothBands` (0.8 attack / 0.12 release) are
  in `canvas2dHelpers.ts` per the AE doc's P0. **Not yet wired into a mode** — the
  existing per-mode spring code still applies; see below.

## The motion vocabulary (2026-10-02)

`motion/` implements the handoff in
`docs/knowledge/gemini-motion-design-2026-10-02/README.md` — the ten named
moves, the sectional easing palette, the impulse-decay trigger and the motion
gates. That handoff was written by Gemini **without access to this repo**, so
its parameter names are proposals, not matches for existing fields; what is
authoritative here is the unit tests, which pin the spec's stated defaults and
invariants.

```
motion/
├── motionEasing.ts          — easing curves, damped spring, damped harmonic,
│                              sectional palette (spec §2)
├── motionMoves.ts           — the 10 moves (spec §5), ImpulseTrigger, gates (§3)
├── useMotionDriver.ts       — resolveMotion(): composes them per frame
└── *.test.ts                — 151 assertions, no browser
```

Rules for extending it:

1. **Pure functions first.** Every move in `motionMoves.ts` is a pure function of
   its arguments so a re-render reproduces the frame exactly. The three pieces of
   genuine frame state are classes (`DampedSpring`, `ImpulseTrigger`,
   `PhaseLagChain`) and are owned by the caller.
2. **Never feed `performance.now()`.** Per D14 rule 2, motion derives from the
   latency-compensated audio clock (`audioTiming.ts`). `MotionInput.nowSec` is
   that clock, and `resolveMotion` resets its history when it jumps backwards.
3. **Impacts are envelope-driven, not time-driven.** `squashImpact(t)` is
   time-since-impact and is at *maximum* compression at t=0; the frame loop uses
   `squashFromImpulse(impulse)` instead, where 0 means at rest. Using the former
   in the driver makes silence deform the mesh most.
4. **Camera moves go on the offset node, never the rig.** `cameraOffset` is
   additive and is meant for a child of the camera rig whose rest pose is
   `(0,0,0)` — that separation is the fix for the "unanchored drunk camera" tell.
   Do not add translation, rotation and FOV shake to one camera.
5. **Clamp defensively.** A single NaN frame otherwise sticks a channel
   permanently, because NaN fails every subsequent comparison and no settle logic
   recovers. `clamp01` returns 0 for NaN and saturates infinities.

The mapping from this repo's audio onto `MotionInput` is our own choice and is
the part to re-tune per viz style; the moves themselves follow the spec.

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
5. **Track loading is hook-owned.** `handleSelectLibraryTrack` lives in
   `useTrackSelection`; the component only wires JSX. Lazy stems fetch,
   autoplay and resume-on-switch live in `useVisualizerTrackEffects`.

## T-VIZ-10 through T-VIZ-13: Track Selection, Playback Clock, Presets, Lifecycle (2026-10-30)

Visualizer.tsx was further decomposed into four focused hooks, leaving the
component as pure orchestration + JSX:

| Module | Purpose |
|--------|---------|
| `useTrackSelection.ts` | `handleFile`, `handleSelectLibraryTrack`, `parseLyricsForTrack`, `deriveTrackMeta`, `resetAudioDerivedState`, pending-track handoff effects |
| `useVisualizerPlayback.ts` | rAF elapsed/beat clock, pause-sync, blob URL revocation, unmount cleanup, `togglePlayPause`, `cycleVizMode`, `handlePlayheadClick` |
| `useVisualPresets.ts` | `applyPreset`, `handleVisualPresetSelect`, `handlePresetLoaded`, `handleClearPreset`, `handleEnhanceWithAI` (Ollama drafting) |
| `useVisualizerLifecycle.ts` | dev shortcuts (`Ctrl+Shift+T`, `Ctrl+Shift+A`), `handleLoopToggle`, `captureFrame`, mode crossfade, reduced motion, global keyboard map, outside-click dismisser, `__VIZ_TEST__` harness |

### Rule changes introduced

- **No more inline `handleSelectLibraryTrack`** — the component wires JSX to `useTrackSelection` and the hook owns the 17-setter track-loading flow.
- **Playback clock is declarative** — the rAF loop is owned by the hook; the component only calls `togglePlayPause` / `cycleVizMode` / `handlePlayheadClick`.
- **Presets are application logic** — `applyPreset` is no longer inline; it lives in `useVisualPresets` with track-aware multipliers and clamped postfx.
- **Global input is declarative** — keyboard shortcuts and outside-click dismisser live in `useVisualizerLifecycle`, not inline in the component.

### Verification

- `tsc --noEmit`: clean
- `eslint`: clean
- `vitest`: 891/891 pass
- Playwright E2E: Canvas2D and LyricOverlay specs pass against Vite dev server

## 2026-11-30 decomposition pass (T-VIZ-33 through T-VIZ-36, T-AUD-11..13)

Second decomposition wave, driven by the "too much going on at once"
redesign. All moves were pure — no behavior change:

- `Visualizer.tsx` 1,469 → ~1,290: lazy stems fetch + autoplay +
  resume-on-switch → `useVisualizerTrackEffects.ts`; transport strip +
  `<audio>` → `components/VizAudioBar.tsx`; inspector Mixer tab →
  `components/VizMixerTab.tsx`; seek overlay → `components/VizPlayhead.tsx`.
- `components/StemMixer.tsx` 989 → 464: the whole WebAudio stem graph
  (decode, per-stem gain/EQ/spatial, analysers, dB faders, presets,
  lazy separation, quality metrics) → `components/useStemMixer.ts`.
- `ShaderVisualizer.tsx` 946 → ~789: preset picker + FX sliders →
  `ShaderHud.tsx`; duplicated `FxValues`/`DEFAULT_FX` unified into
  exported `ShaderFxValues`/`DEFAULT_SHADER_FX`.
- Layout: `.viz-page` is a `100vh` flex column (canvas `flex:1`),
  docked `VizInspector` (Scene/Tuning/Mixer/EQ/AI — Remix removed,
  it lives at `/create/remix`), slim `VizTopbar`, stage chrome
  auto-hides ~2.6 s into playback, `visualizer-chrome.css` restores
  the component chrome lost in the `ee2714e` slim rewrite.
- Track-load preset cascade fixed: lyrics fetch runs parallel to
  analysis, kinetic preset resolves once (visual preset wins,
  heuristic is fallback), preset apply pulses the mode-fade, mode
  auto-switch delayed ~400 ms. Stems analysis is lazy (only when FX
  stem layers or the Mixer tab need it).

## Caching work same period (T-AUD-10)

- `/api/audio/spectral-timeline`: disk cache under
  `output/cache/spectral_timeline/` (mtime+size fingerprint) + decode/STFT
  moved to `asyncio.to_thread` — was ~10 s inline per request.
- `analyze_stems_for_visualization`: per-stem disk cache under
  `<stem_dir>/.viz-feature-cache/` + four stems analyzed concurrently.
- `_cache_set` is true LRU (position refresh on rewrite).
- Frontend: `useSpectralTimeline` module cache + inflight dedup;
  `useKeyPalette` caches only analysis-determined palettes.

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
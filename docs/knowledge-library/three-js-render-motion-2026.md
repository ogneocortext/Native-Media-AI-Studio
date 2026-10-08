---
tags:
  - creative
  - 3d
  - three-js
  - motion-design
aliases:
  - Three.js Render and Motion 2026
  - Three.js Export Pipeline
  - Three.js Motion Craft
cssclasses:
  - creative-guide
date: 2026-10-06
---

# Three.js Studio: Render Pipeline + Motion Craft (2026-10-06)

> [!info] Why this doc exists
> The studio's own gaps register (`app-research-gaps-2026.md`) flags the hole
> this fills: *"17 creative/visual docs cover shaders, particles, WebGL/WebGPU,
> Three.js — all **technical** (how to render), none on motion **craft**
> (how to move)."* Separately, `three-js-studio.md` documents that
> frame-sequence recording **is not implemented** — preview is the only output.
> This doc covers both: how to *move* like a music video, and how to *ship*
> a video file from the three.js studio. Research date 2026-10-06.

---

## 1. Deterministic export: frame-accurate rendering

**The pattern** — [r3f-video-recorder](https://github.com/malerba118/r3f-video-recorder)
(MIT) defines two export modes, and the distinction is the whole design:

| Mode | How | Trade-off |
|---|---|---|
| `realtime` | Capture canvas while it plays | Easy; drops frames on hitches, tab switches, low battery |
| `frame-accurate` | Hijack a frame-aligned clock; tick frame-by-frame, advancing only after the previous frame is captured | Deterministic — identical output every run, immune to machine hiccups; ~15 s to render 60 s of video |

**The hard requirement:** every frame must be a **pure function of time**.
No `clock.elapsedTime`, no `Math.random()` in the render path — otherwise two
exports of the same scene differ and timeline seeking breaks. The repo even
documents the migration shim: at the top of the loop, overwrite the clock with
the export time (`clock.elapsedTime = exportTime`).

**Current studio state** (`packages/frontend/src/features/three-js-studio/hooks/useThreeScene.ts`):
the loop is wall-clock driven — `THREE.Timer` with `getDelta()`/`getElapsed()`
(L406–415), `animationTimeRef` accumulating delta (L550). A frame-accurate
export needs exactly the shim above: drive the timer from the export clock
instead of the wall clock, and step `animationTimeRef` by `1/fps` per captured
frame rather than by measured delta.

**Encoding stack — no new dependency needed.** `mediabunny@1.61.0` is already
in `packages/frontend/package.json`. Mediabunny renders `mp4/h264` in *all*
browsers (including Firefox) — no webm-only trap. Force even pixel dimensions;
encoders choke on odd widths/heights.

**Beat → frame mapping, not wall-clock.** The vsim
[CONCEPT.md](https://github.com/kunalkushwaha/vsim/blob/HEAD/CONCEPT.md) states
the principle that makes audio-reactive export reproducible: *"Map beats →
frame numbers (not wall-clock) so audio-reactive animation stays reproducible
in headless render."* The studio already has librosa beat grids on the backend
— the export path should quantize beat events to frame indices before driving
any animation, so preview and export agree.

---

## 2. Headless 4K pipeline (practitioner-proven)

[@ciguleva](https://x.com/ciguleva/status/2106046405529972895) (Oct 2, 2026)
shipped a music video with this exact stack:

1. **librosa** beat sync from the track
2. **three.js WebGL scenes rendered at 4K in headless Chromium via Playwright**
3. Custom **Python/NumPy/Pillow compositor** (beat-cut windows, mosaics)
4. **ffmpeg** encoding

Two facts make this directly reusable here: the repo already runs
**Playwright 1.63.0** for E2E (same tool, new job), and the backend already
runs librosa. The render farm is the test rig.

Corroborating detail from the [globe-dial](https://github.com/danielosagie/globe-dial)
Remotion render path: *"Rotation is derived from the frame number, not from a
clock"* — and realtime browser capture *"can never exceed the display refresh
rate,"* while offline frame-at-a-time rendering makes 120 fps real regardless
of how long any frame took.

---

## 3. Motion craft (adapted for the studio)

Adapted from the `motion-taste.md` reference in
[immamdouhaboammar/motion-graphics-skills](https://github.com/immamdouhaboammar/motion-graphics-skills/blob/HEAD/skills/text-to-lottie/references/motion-taste.md)
— summarized and mapped to music-video sections, not copied verbatim.

### Principles

- Stage motion in readable beats: **anticipation → action/reveal → settle**.
- Match easing to intent; avoid linear interpolation unless the motion is
  meant to feel mechanical (rotations, scanners, progress loops).
- **Camera easing is calmer than object easing.** Abrupt camera stops feel
  cheap; the camera is the viewer's attention, not decoration.
- One dominant camera move per section: push in, pull out, pan, follow, or
  parallax — never two at once.
- Stillness gives motion contrast. Do not animate every property on every
  object.

### Easing anchors (cubic-bezier `x1,y1,x2,y2`, derive — don't invent)

| Anchor | Behavior | Curve | Music-video use |
|---|---|---|---|
| `entrance-sharp` | Fast in, soft land | `.20,.75,.34,.94` | Drop hits, title cards |
| `settle-soft` | Deep ease-out, no bounce | `.00,.65,.51,.99` | Verse settles, logo lockups |
| `expressive-pop` | Fast-out + soft settle, overshoot opt-in | `.94,.75,.34,.94` | Chorus flourishes (one per section) |
| `travel-balanced` | S-curve ease-in-out | `1.00,.49,.00,.55` | Camera moves, object travel |
| `exit-accelerate` | Slow start, fast end | `1.00,.02,.54,.42` | Cut companions, exits |
| `travel-cut` | Fast-slow-fast, never settles | `.15,.85,.95,.05` | Interrupted moves, whip transitions |

### Choreography

- Decide the **lead element**, then delay supporting elements by 2–8 frames
  (compact) or 4–14 frames (expressive). Stagger from the meaningful origin:
  the beat, the focal point, the drop.
- Reveal spine: **build → settle → hold**. The hold is where the moment
  registers — a chorus visual should *land*, not drift.
- One section gets **one main flourish**. Two competing flourishes on the
  same beat weaken both.
- Opacity often starts after movement begins and finishes before the settle.
- For loops: match first/last position, opacity, color **and velocity** —
  integer wave cycles, closed rotations.

### Section → motion mapping (starter)

| Section | Camera | Objects | Energy |
|---|---|---|---|
| Intro | Slow dolly in (`travel-balanced`) | Fade/build (`entrance-sharp`) | Rising |
| Verse | Static or slow orbit | Settle-soft, minimal | Low, breathing |
| Pre-chorus | Dolly in, medium | Anticipation — pull back slightly before the drop | Tensing |
| Chorus | Orbit or handheld, faster | `expressive-pop` on the downbeat, then hold | Peak |
| Bridge | Orbit, medium | New color/material state, contrast | Shift |
| Outro | Dolly out | `exit-accelerate` into stillness | Releasing |

This replaces the current energy→transform-only mapping (bass→scale,
mids→rotation, highs→glitch) with *phrased* motion: the same uniforms, but
shaped by anticipation/settle/hold per section.

---

## 4. Audio-reactive recipes (practitioner)

**[@Oluwaphilemon1](https://x.com/Oluwaphilemon1/status/2069146907973173488)**
(Jun 2026, 464K views) — the most directly applicable breakdown found:

1. **Flow fields**: each particle reads a Simplex-noise field for drift
   direction — organic, not random.
2. **GPGPU particles**: thousands of particles updated on the GPU in a
   texture — 60 fps on a phone.
3. **Audio-reactive shaders**: geometry pulses from track frequency data via
   uniforms (the studio's `uBass`/`uMid`/`uTreble` pattern).
4. **Selective bloom**: only the bright parts glow — already the studio's
   approach (hero-glow layer).

**SYNESTHESIA** ([@AhmedShahnab](https://x.com/AhmedShahnab/status/2036050332648702173),
Mar 2026): per-frame luminance sampled across 36,000+ points driving vertex
heights in a 3D topography, smoothly lerped. Transferable: drive displacement
from *frequency-band* samples instead of luminance for an audio-topography
mode.

**ShaderToy porting**: [shader_fun](https://x.com/lildeimos/status/2107505219701792862)
now imports ShaderToy GLSL directly — the studio's shader modes can prototype
against the ShaderToy corpus before committing to a mode.

---

## 5. Transparent-background export

From the [globe-dial render notes](https://github.com/danielosagie/globe-dial)
and [transparent-video-export.md](https://github.com/matthewdonsemail-lab/log/blob/HEAD/docs/transparent-video-export.md)
(verified table):

| Format | Codec | Alpha |
|---|---|---|
| `mov` | ProRes 4444 (`yuva444p12le`) | ✅ |
| `webm` | VP9 (`yuva420p`) | ✅ |
| `mp4` | h264 | ❌ never — h264 has no alpha |
| `gif` | gif | 1-bit only, no soft edges |

- There is **no transparent mp4**. HEVC alpha was tried and emitted plain
  `yuv420p`.
- ffmpeg recipe: `-vf format=yuva420p -pix_fmt yuva420p -auto-alt-ref 0
  -metadata:s:v:0 alpha_mode=1 -c:v libvpx-vp9`. Keep `yuva420p` —
  `yuv420p` flattens transparency; `-auto-alt-ref 0` — alt-ref frames can
  strip the alpha plane.
- **Safari/WebKit silently drops WebM alpha** (renders black, no error) —
  verified Sep 2026 via Playwright probe across Chromium/Firefox/WebKit.
  Validate per delivery target.
- Relevant to the studio's transparent-PNG-frames render target: a
  transparent WebM plate is the video equivalent.

---

## 6. WebGPU watch item (no action)

[@LuisBizarro](https://x.com/LuisBizarro/status/2107150536369967286) (Oct 5,
2026) shipped a WebGPU/WGSL audio visualizer with browser tab-capture system
audio input, and ported GLSL lyric experiments to Three.js WebGPU/TSL. The
gaps register already defers the studio's WebGPU migration (`forceWebGL: true`
still set) — monitor, don't chase.

---

## Sources

- https://github.com/malerba118/r3f-video-recorder — frame-accurate vs realtime export, mediabunny, clock-hijack pattern
- https://x.com/ciguleva/status/2106046405529972895 — librosa → headless Chromium/Playwright 4K → NumPy/Pillow → ffmpeg
- https://github.com/immamdouhaboammar/motion-graphics-skills/blob/HEAD/skills/text-to-lottie/references/motion-taste.md — easing anchors, choreography, reveal grammar
- https://x.com/Oluwaphilemon1/status/2069146907973173488 — flow fields, GPGPU particles, frequency uniforms, selective bloom
- https://x.com/AhmedShahnab/status/2036050332648702173 — 36k-point luminance topography
- https://github.com/danielosagie/globe-dial — frame-number-driven animation, transparent codec table
- https://github.com/matthewdonsemail-lab/log/blob/HEAD/docs/transparent-video-export.md — VP9 alpha ffmpeg recipe
- https://x.com/LuisBizarro/status/2107150536369967286 — WebGPU/WGSL visualizer, TSL lyric port
- https://github.com/alesha-pro/tools/tree/main/skills/lyric-music-video — open-source agent skill for lyric music videos (pipeline reference)

---
tags:
  - hyperframes
  - audio-reactive
  - beat-sync
  - music-video
  - 2026
aliases:
  - HyperFrames Audio-Reactive Guide 2026
  - HyperFrames Beat Sync
  - HF Audio Visualization
cssclasses:
  - technical-reference
  - hyperframes
date: 2026-09-24
---

# 🎬 HyperFrames Audio-Reactive Visualizations — 2026 Guide

> [!info] Purpose
> This is the canonical guide for producing **audio-reactive HyperFrames
> compositions** in Native Media AI Studio. It covers the full chain:
> pre-extract audio data from the backend, serialize it into the format
> HyperFrames expects, author deterministic GSAP timelines that sample every
> frame, and layer Three.js/WebGPU scenes behind the DOM when the visual
> vocabulary demands it.
>
> **Prerequisites:**
> - [[lyric-beat-visualization-2026]] — data contracts, LRC parsing, lyric timing
> - [[audio-reactive-production]] — frequency band mapping, genre-aware pacing
> - [[visualization-effects]] — WebGPU/TSL shaders, particles, post-processing
> - [[3d-visualization-best-practices-2026]] — R3F perf rules, audio-driven 3D
> - HyperFrames CLI v0.8.73+ (`npx hyperframes`)
>
> **How to read this:** Start with §1 for the data contract, then jump to the
> pattern that matches your scene type (§3–§6). §7 covers Three.js/WebGPU
> scenes inside HyperFrames. §8 is the integration checklist for the studio
> backend.

---

## 1. The HyperFrames Audio-Reactive Contract

### 1.1 Golden Rule: Pre-Extract Everything

HyperFrames renders by **seeking** the timeline. Any runtime audio analysis
(`AudioContext`, `fetch()`, `Math.random()`) produces non-deterministic output
and is rejected by `hyperframes check`.

**All audio data must be computed before the composition loads.**

### 1.2 Data Format

HyperFrames expects a single global `AUDIO_DATA` object:

```js
const AUDIO_DATA = {
  fps: 30,
  totalFrames: 900,
  frames: [
    { bands: [0.82, 0.45, 0.31, ...] },  // index 0 = bass, higher = treble
    ...
  ],
};
```

- `frames[i].bands[]` — frequency band amplitudes, normalized 0–1
- Each band is normalized independently across the full track
- The composition reads `AUDIO_DATA.frames[frameIndex].bands[bandIndex]`

### 1.3 The Sampling Pattern (Mandatory)

Audio reactivity requires **per-frame sampling** via `tl.call()`, not a single
tween:

```js
// ✅ Correct — sample every frame
for (let f = 0; f < AUDIO_DATA.totalFrames; f++) {
  tl.call(
    (function (frame) {
      return function () {
        draw(frame);
      };
    })(AUDIO_DATA.frames[f]),
    [],
    f / AUDIO_DATA.fps,
  );
}

// ❌ Wrong — single tween, not audio-reactive
gsap.to(".el", { scale: 1.2, duration: totalDuration });
```

Without per-frame sampling, the composition does not react to audio.

### 1.4 Band Mapping

| Audio signal | Band index | Visual property | Effect |
|---|---|---|---|
| Bass | `bands[0]` | `scale` | Pulse on beat |
| Treble | `bands[12-15]` | `textShadow`, `boxShadow` | Glow intensity |
| Overall amplitude | weighted sum | `opacity`, `y`, `backgroundColor` | Breathe, lift, color shift |
| Mid-range | `bands[4-8]` | `borderRadius`, `width` | Shape morphing |

Any GSAP-tweenable property works: `clipPath`, `filter`, SVG attributes, CSS
custom properties.

> [!warning] textShadow Gotcha
> `textShadow` on a parent with semi-transparent children renders a visible glow
> rectangle behind all children. Fix: apply `scale` to the container for beat
> pulse, but apply `textShadow` to individual active words only.

---

## 2. Pre-Extracting Audio Data

### 2.1 The Project's Existing Pipeline

Native Media AI Studio already has three audio-analysis backends that produce
the data HyperFrames needs:

| Tool | Output | Use for HyperFrames |
|---|---|---|
| `tools/analyze_and_sync.py` → `beat_data.json` | `beat_times`, `bpm`, `duration`, `energy_curve` | Beat grid, section timing |
| `packages/backend/app/services/audio_analyzer.py` | `AudioAnalysisResult` with `beat_times`, `downbeat_times`, `energy_curve` | Same, via API |
| `packages/frontend/src/features/visualizer/audioAnalysis.worker.ts` | Real-time `bass`, `mid`, `treble`, `beat`, `drumType`, `perceptualBands` | Live preview only (not deterministic) |

For HyperFrames, use the **pre-extracted** backends (`analyze_and_sync.py` or
`audio_analyzer.py`), never the Web Audio API.

### 2.2 Recommended Extraction Command

Use the HyperFrames skill's bundled extractor for per-frame band data:

```bash
python <HF_SKILL_DIR>/scripts/extract-audio-data.py input.mp3 -o audio-data.json --fps 30 --bands 16
```

Output format:

```json
{
  "duration": 218.76,
  "fps": 30,
  "bands": 16,
  "totalFrames": 6563,
  "frames": [
    { "time": 0.0, "rms": 0.42, "bands": [0.8, 0.6, ...] },
    ...
  ]
}
```

### 2.3 Augmenting with Beat Grid and Lyrics

The extractor gives per-frame bands. For beat-synced visuals, also extract:

```bash
python tools/analyze_and_sync.py input.mp3 -o beat_data.json
```

Then merge:

```python
# tools/scripts/build_hyperframes_audio_payload.py
import json, sys

with open("audio-data.json") as f:
    audio = json.load(f)
with open("beat_data.json") as f:
    beats = json.load(f)

beat_frames = [round(t * audio["fps"]) for t in beats["beat_times"]]
downbeat_frames = [round(t * audio["fps"]) for t in beats.get("downbeat_times", [])]

# Annotate each frame
for i, frame in enumerate(audio["frames"]):
    frame["isBeat"] = i in beat_frames
    frame["isDownbeat"] = i in downbeat_frames
    frame["energy"] = beats.get("energy_curve", [{}])[i] if i < len(beats.get("energy_curve", [])) else 0

with open("hyperframes-audio.json", "w") as f:
    json.dump(audio, f)
```

### 2.4 Embedding in the Composition

HyperFrames compositions are HTML files. Embed the pre-extracted data inline:

```html
<script>
  const AUDIO_DATA = /* embedded hyperframes-audio.json */;
</script>
```

**Do not `fetch()` it at runtime** — that is non-deterministic and fails
`hyperframes check`.

---

## 3. Pattern Library: Audio-Reactive Compositions

### 3.1 Bass Pulse (Single Subject)

**When:** Title cards, logo stings, CTA moments.

**Mechanism:** Scale the hero element on every beat using `bands[0]`.

```js
for (let f = 0; f < AUDIO_DATA.totalFrames; f++) {
  const bass = AUDIO_DATA.frames[f].bands[0];
  const targetScale = 1 + bass * 0.15;  // 1.0 → 1.15
  tl.to(".hero", { scale: targetScale, duration: 1 / AUDIO_DATA.fps }, f / AUDIO_DATA.fps);
}
```

**Variants:**
- Add `y: -bass * 20` for a lift effect
- Add `textShadow: `0 0 ${bass * 30}px rgba(255,255,255,0.8)` for glow pulse
- Use `isDownbeat` for accent frames (larger pulse on downbeats)

### 3.2 Spectrum Bars (Multi-Subject)

**When:** Section headers, scene transitions, background texture.

**Mechanism:** Map each bar to a frequency bin; height = band amplitude.

```js
const bars = document.querySelectorAll('.spectrum-bar');
for (let f = 0; f < AUDIO_DATA.totalFrames; f++) {
  const frame = AUDIO_DATA.frames[f];
  bars.forEach((bar, i) => {
    const bandIdx = Math.floor(i * AUDIO_DATA.bands / bars.length);
    const amp = frame.bands[bandIdx] || 0;
    tl.to(bar, { scaleY: 0.2 + amp * 1.8, duration: 1 / AUDIO_DATA.fps }, f / AUDIO_DATA.fps);
  });
}
```

**Performance:** Keep bar count ≤ 64 for DOM-based bars. For 100+ bars, use
Three.js `InstancedMesh` (§7).

### 3.3 Lyric Karaoke (Word-Level Sync)

**When:** Music videos, lyric videos, narration overlays.

**Mechanism:** Pre-build the timeline so each word's animation is absolute-time
keyed. Use `isBeat` from the beat grid to trigger word appearance.

```js
lyricLines.forEach((line, lineIdx) => {
  const lineStartFrame = Math.floor(line.start * AUDIO_DATA.fps);
  words.forEach((word, wordIdx) => {
    const wordStart = lineStartFrame + wordIdx * 8; // 8 frames per word
    tl.set(`.word-${lineIdx}-${wordIdx}`, { opacity: 0, y: 10 }, wordStart / AUDIO_DATA.fps);
    tl.to(`.word-${lineIdx}-${wordIdx}`, { opacity: 1, y: 0, duration: 0.1 }, wordStart / AUDIO_DATA.fps);
  });
  // Active line highlight driven by energy
  for (let f = lineStartFrame; f < lineStartFrame + line.duration * AUDIO_DATA.fps; f++) {
    const energy = AUDIO_DATA.frames[f].energy || 0;
    tl.to(`.line-${lineIdx}`, { textShadow: `0 0 ${energy * 20}px rgba(255,255,255,0.6)` }, f / AUDIO_DATA.fps);
  }
});
```

**See also:** `lyric-beat-visualization-2026.md` §2.3 for karaoke highlight
baselines.

### 3.4 Section-Aware Scene Changes

**When:** Music videos with intro/verse/chorus/drop structure.

**Mechanism:** Use the `sections` array from `beat_data.json` to drive scene
visibility and color mood.

```js
sections.forEach(section => {
  const startFrame = Math.floor(section.start * AUDIO_DATA.fps);
  const endFrame = Math.floor(section.end * AUDIO_DATA.fps);
  const energy = section.energy || 0.5;

  // Scene transition at section boundary
  tl.to(`.scene-${section.type}`, { opacity: 1, duration: 0.5 }, startFrame / AUDIO_DATA.fps);
  tl.to(`.scene-${section.type}`, { opacity: 0, duration: 0.5 }, endFrame / AUDIO_DATA.fps);

  // Color mood driven by energy
  const hue = energy > 0.7 ? 0 : energy > 0.4 ? 200 : 280; // red / blue / purple
  tl.to(".mood-bg", { backgroundColor: `hsl(${hue}, 70%, ${10 + energy * 20}%)` }, startFrame / AUDIO_DATA.fps);
});
```

**Section energy suffixes (from the backend):**

| Section | Energy | Visual Treatment |
|---|---|---|
| intro | 0.2 | Minimal, slow push |
| verse | 0.5 | Character enters, parallax |
| chorus | 0.9–1.0 | Maximalist, fluid light |
| drop | 1.0 | Intense motion, flashing |
| bridge | 0.3 | Dreamy, slow |
| outro | 0.4 | Fading, soft |

### 3.5 Drum-Type Percussion

**When:** Beat-synced hits, snare rolls, hi-hat patterns.

**Mechanism:** Use `drumType` from the analysis worker output (or pre-extract
from `madmom`/`sonara` beat arrays) to trigger different hit visuals.

```js
for (let f = 0; f < AUDIO_DATA.totalFrames; f++) {
  const frame = AUDIO_DATA.frames[f];
  if (frame.drumType === "kick") {
    tl.to(".kick-ring", { scale: 1.3, opacity: 0.8, duration: 0.05 }, f / AUDIO_DATA.fps);
    tl.to(".kick-ring", { scale: 1, opacity: 0, duration: 0.15 }, f / AUDIO_DATA.fps + 0.05);
  }
  if (frame.drumType === "snare") {
    tl.to(".snare-flash", { opacity: 0.6, duration: 0.03 }, f / AUDIO_DATA.fps);
    tl.to(".snare-flash", { opacity: 0, duration: 0.1 }, f / AUDIO_DATA.fps + 0.03);
  }
}
```

### 3.6 Generative Particle Burst (Pre-Computed)

**When:** Drops, climaxes, CTA moments.

**Mechanism:** Pre-compute particle positions from the energy curve and emit
them via DOM or Three.js. For DOM, use `tl.set()` + `tl.to()` with staggered
delays derived from `energy_curve` peaks.

```js
const burstFrames = AUDIO_DATA.frames
  .map((f, i) => ({ i, energy: f.energy }))
  .filter(f => f.energy > 0.85);

burstFrames.forEach((burst, idx) => {
  const t = burst.i / AUDIO_DATA.fps;
  tl.fromTo(`.particle-${idx}`,
    { x: 960, y: 540, opacity: 1, scale: 0 },
    { x: `+=${(Math.random() - 0.5) * 400}`, y: `+=${(Math.random() - 0.5) * 400}`, opacity: 0, scale: 1.5, duration: 0.8 },
    t
  );
});
```

> [!warning] Determinism constraint
> Do NOT use `Math.random()` inside the composition script. Pre-compute all
> random values in the extraction step and embed them in `AUDIO_DATA`.

---

## 4. Integrating with the Studio Backend

### 4.1 Data Flow

```
Audio file
  → tools/analyze_and_sync.py → beat_data.json
  → tools/scripts/build_hyperframes_audio_payload.py → hyperframes-audio.json
  → embedded in HyperFrames index.html
  → hyperframes render → output video
```

### 4.2 Backend API Integration

Implemented in `packages/backend/app/api/audio.py`:

| Endpoint | Returns | Use |
|---|---|---|
| `GET /api/audio/analysis/{filename}` | `AudioAnalysisResult` | Beat times, BPM, energy curve, sections |
| `GET /api/audio/hyperframes-payload/{filename}?fps=30&bands=16` | Deterministic `AUDIO_DATA` | Inline HyperFrames audio reactivity |
| `GET /api/audio/stems/{filename}` | Stem URLs | Optional per-stem reactivity |
| `POST /api/audio/transcribe` | Word timestamps | Lyric karaoke |

`POST /api/hyperframes/compile-storyboard` accepts the resulting `audio_data`
alongside the storyboard. The compiler embeds it inline as `AUDIO_DATA`; it
does not fetch audio data at render time. The generated timeline samples energy
and bass values per frame to drive motif scale, opacity, and glow.

### 4.3 Frontend Bridge

The `HyperFrames` page (`packages/frontend/src/features/hyperframes/`) should:

1. Fetch the audio payload from the backend
2. Pass it to the HyperFrames composition via `data-*` attributes or a
   `<script>` block injected before the composition mounts
3. Trigger render via `npx hyperframes render`

---

## 5. Three.js / WebGPU Scenes Inside HyperFrames

HyperFrames compositions can include full Three.js scenes via R3F or vanilla
Three.js. This is how the studio's existing `VisualizerScene.tsx` patterns
(map to bass/mid/treble) become renderable videos.

### 5.1 Mounting a Three.js Scene

```html
<div data-composition-id="main" data-duration="30" data-width="1920" data-height="1080">
  <div id="three-container" style="position:absolute; inset:0;"></div>
  <div id="dom-overlay" style="position:relative; z-index:10;">
    <!-- lyrics, titles, etc. -->
  </div>
</div>

<script type="module">
  import * as THREE from 'three/webgpu';
  import { gsap } from 'gsap';

  const renderer = new THREE.WebGPURenderer({ antialias: true });
  await renderer.init();
  renderer.setSize(1920, 1080);
  document.getElementById('three-container').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1920/1080, 0.1, 100);
  camera.position.z = 7;

  // Audio-reactive uniforms
  const uniforms = {
    uBass: { value: 0 },
    uMid: { value: 0 },
    uTreble: { value: 0 },
    uTime: { value: 0 },
  };

  const material = new THREE.MeshPhysicalNodeMaterial({
    color: 0x38bdf8,
    emissive: 0xa855f7,
    emissiveIntensity: uniform(0),
  });
  // ... mesh setup

  // Per-frame audio sampling on the GSAP timeline
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  for (let f = 0; f < AUDIO_DATA.totalFrames; f++) {
    const { bands } = AUDIO_DATA.frames[f];
    tl.add(() => {
      uniforms.uBass.value = bands[0];
      uniforms.uMid.value = bands[4] || 0;
      uniforms.uTreble.value = bands[12] || 0;
    }, f / AUDIO_DATA.fps);
  }

  window.__timelines['main'] = tl;

  // Render loop — driven by HyperFrames seek, not rAF
  function render(time) {
    uniforms.uTime.value = time;
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
</script>
```

### 5.2 TSL Shader Patterns for Audio Reactivity

```ts
import { uniform, positionLocal, texture, Fn, vec3, float, time } from 'three/tsl';

const uBass = uniform(0);
const uMid = uniform(0);
const uTreble = uniform(0);

// Vertex displacement driven by bass
const displace = Fn(() => {
  const noise = texture(noiseMap, positionLocal.mul(2).add(time.mul(0.1))).r;
  return positionLocal.add(
    positionLocal.normalize().mul(noise.mul(uBass).mul(0.5))
  );
})();

// Emissive pulse driven by treble
const emissive = Fn(() => {
  return vec3(uTreble.mul(2), uMid.mul(0.5), uBass.mul(3));
})();
```

### 5.3 R3F Integration (if the project uses R3F for 3D scenes)

```tsx
import { Canvas, useFrame } from '@react-three/fiber';
import { useTimeline } from 'hyperframes/react'; // hypothetical bridge

function AudioReactiveMesh() {
  const meshRef = useRef<Mesh>(null);
  const frame = useTimelineFrame(); // current frame from HyperFrames seek

  useFrame(() => {
    if (!meshRef.current || frame >= AUDIO_DATA.totalFrames) return;
    const { bands } = AUDIO_DATA.frames[frame];
    meshRef.current.scale.setScalar(1 + bands[0] * 0.3);
    (meshRef.current.material as MeshPhysicalNodeMaterial).emissiveIntensity = bands[12] * 2;
  });

  return <mesh ref={meshRef}><sphereGeometry /><meshPhysicalNodeMaterial /></mesh>;
}
```

> [!note] R3F inside HyperFrames
> R3F's `useFrame` runs on `requestAnimationFrame`, not the HyperFrames seek.
> For deterministic renders, derive state from `AUDIO_DATA` directly using
> `tl.call()` or a custom hook that reads the current timeline position.

---

## 6. Genre-Aware Visual Direction

### 6.1 The Studio's Genre Preset System

The frontend already has 13 genre presets in `visualPresets.ts`. Each preset
controls:

| Property | Effect |
|---|---|
| `bloomStrength` | Glow intensity |
| `glitchIntensity` | Distortion amount |
| `colorShift` | Hue rotation speed |
| `beatPunch` | Scale response to bass |
| `particleDensity` | Number of particles |
| `cameraShake` | Camera jitter on beat |

**Use these presets in HyperFrames by mapping the genre to preset values in
the extraction step:**

```python
# In build_hyperframes_audio_payload.py
from packages.frontend.src.features.visualizer.visualPresets import PRESETS

preset = PRESETS.get(genre, PRESETS["balanced"])
audio_data["visualPreset"] = {
    "bloomStrength": preset.bloomStrength,
    "beatPunch": preset.beatPunch,
    "glitchIntensity": preset.glitchIntensity,
}
```

### 6.2 Section-Driven Color Moods

```js
const SECTION_MOOD = {
  intro:    { hue: 220, saturation: 30, lightness: 15 },
  verse:    { hue: 200, saturation: 50, lightness: 20 },
  chorus:   { hue: 280, saturation: 70, lightness: 25 },
  drop:     { hue: 0,   saturation: 80, lightness: 30 },
  bridge:   { hue: 260, saturation: 40, lightness: 18 },
  outro:    { hue: 240, saturation: 20, lightness: 12 },
};

sections.forEach(section => {
  const mood = SECTION_MOOD[section.type] || SECTION_MOOD.verse;
  const startFrame = Math.floor(section.start * AUDIO_DATA.fps);
  tl.to(".mood-bg", {
    backgroundColor: `hsl(${mood.hue}, ${mood.saturation}%, ${mood.lightness}%)`,
    duration: 0.5,
  }, startFrame / AUDIO_DATA.fps);
});
```

---

## 7. Performance Patterns (2026)

### 7.1 DOM vs Three.js Budget

| Element count | Recommended approach |
|---|---|
| ≤ 64 bars/particles | DOM elements with `tl.call()` sampling |
| 64–10,000 | Three.js `InstancedMesh` |
| 10,000–1,000,000 | WebGPU compute shaders + `StorageBufferAttribute` |

### 7.2 Per-Frame Sampling Performance

The `tl.call()` pattern creates one GSAP callback per frame. At 30fps × 180s
= 5,400 callbacks. This is fine for most compositions, but:

- **Avoid heavy DOM reads** inside the callback — read once, cache in a closure
- **Batch property changes** — use `gsap.set()` for multi-property updates
- **Reuse selectors** — query DOM once, store refs

```js
// ✅ Fast — refs cached outside the loop
const titleEl = document.getElementById('title');
const bars = document.querySelectorAll('.bar');

for (let f = 0; f < totalFrames; f++) {
  tl.call((frame) => {
    titleEl.style.transform = `scale(${1 + frame.bands[0] * 0.1})`;
    bars.forEach((bar, i) => {
      bar.style.height = `${frame.bands[i % 16] * 100}%`;
    });
  }, [AUDIO_DATA.frames[f]], f / fps);
}
```

### 7.3 WebGPU / TSL Patterns for HyperFrames Scenes

When a HyperFrames composition includes a Three.js WebGPU scene:

- **Use `uniform()` for audio-reactive parameters** — they hot-reload from JS
  without recompiling the shader
- **Never allocate in the render loop** — pre-allocate `StorageBufferAttribute`
- **Compute shaders for particles** — `renderer.compute(computeParticles)` before
  the render pass
- **Workgroup size 256–512** — check `device.limits.maxComputeInvocationsPerWorkgroup`

### 7.4 Memory Budget

| Asset | Budget |
|---|---|
| `AUDIO_DATA` JSON | ~5–15 MB for 16 bands × 30fps × 3min |
| DOM elements | ≤ 200 for 60fps on mid-range hardware |
| Three.js meshes | ≤ 500 draw calls |
| Texture memory | ≤ 256 MB (KTX2 compressed) |

---

## 8. Integration Checklist for Studio Backend

To make HyperFrames audio-reactive renders a first-class output of the studio:

### 8.1 Backend Changes

- [ ] Add `GET /api/audio/hyperframes-payload/{filename}` endpoint
- [ ] Merge `audio_analyzer` output + `analyze_and_sync` beat grid + optional
      lyrics into `hyperframes-audio.json` format
- [ ] Add `--hyperframes` flag to `tools/analyze_and_sync.py` that outputs the
      merged payload directly
- [ ] Cache payloads in `output/audio/` so repeated renders are instant

### 8.2 Frontend Changes

- [ ] Fetch payload in `HyperFrames` page before mounting composition
- [ ] Inject `AUDIO_DATA` as inline `<script>` before the composition root
- [ ] Pass genre/section metadata to the composition for preset selection
- [ ] Add "Render in HyperFrames" button to the Audio Analysis page

### 8.3 Composition Templates

Create starter templates in `tools/hyperframes-test/compositions/`:

| Template | Description |
|---|---|
| `bass-pulse-title.html` | Single hero element, bass-driven scale + glow |
| `spectrum-bars.html` | 32–64 bars, per-band height mapping |
| `lyric-karaoke.html` | LRC-driven word highlight with beat accent |
| `section-journey.html` | Multi-scene, section-aware color + visibility |
| `threejs-audio-scene.html` | WebGPU Three.js scene with TSL audio uniforms |

---

## 9. Common Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Runtime `AudioContext` | `hyperframes check` fails, render silent | Pre-extract all data |
| `Math.random()` in callbacks | Different output on every render | Pre-compute in extraction step |
| `fetch()` for audio data | Non-deterministic, 404 in render | Embed inline |
| DOM nodes > 200 | Stutters at 1080p | Move particles to Three.js |
| Missing `data-duration` | Timeline length inferred wrong | Always set `data-duration` explicitly |
| Nested `data-start` | `video_nested_in_timed_element` lint error | Time wrapper OR video, not both |
| `crossorigin` on `<video>` | `media_crossorigin_breaks_preview` lint error | Remove crossorigin attribute |
| `tl.to()` on `.clip` | `lint` rejects visibility tween | Animate inner wrapper, not `.clip` |
| Infinite `repeat: -1` | Render never ends | Use finite repeat count |
| Unregistered timeline | `window.__timelines[id]` missing | Register before render |

---

## 10. Verification

After authoring a HyperFrames audio-reactive composition:

```bash
# 1. Lint
npx hyperframes lint

# 2. Full check (lint + runtime + layout + contrast)
npx hyperframes check

# 3. Snapshots at proof points (first frame, beat, section change, final)
npx hyperframes snapshot . --at 0,5,15,30

# 4. Preview in Studio
npx hyperframes preview --background

# 5. Render
npx hyperframes render --quality high --output output/video/song.mp4
```

**Key snapshots to capture:**
- `t=0` — first frame, no animation yet
- First beat — confirm bass pulse fires
- First section change — confirm scene/color transition
- Mid-track — confirm mid/track continuity
- Final frame — confirm hold, no black/reset tail

---

## 11. 2026 Tooling Landscape

| Tool | Role | Notes |
|---|---|---|
| `extract-audio-data.py` | Per-frame band extraction | Bundled with HyperFrames skill |
| `tools/analyze_and_sync.py` | Beat grid + sections + lyrics | Project-specific, Python |
| `audio_analyzer.py` | Multi-backend analysis (librosa/madmom/sonara) | Backend API |
| `madmom-infer` | BLSTM beat/downbeat tracking | Most accurate for 4/4 |
| `sonara` | Rust beat tracking, fast | Fallback when madmom slow |
| `ffmpeg` | Audio decode + loudness + waveform | Required by all extractors |
| `hyperframes check` | Determinism + lint gate | Must pass before render |
| Three.js r185 + TSL | WebGPU/WebGL2 audio-reactive shaders | Pascal fallback to WebGL2 |
| GSAP 3.12 | Timeline + per-frame callbacks | Render-safe when paused + registered |

---

## 12. See Also

- [[lyric-beat-visualization-2026]] — LRC parsing, karaoke timing, data contracts
- [[audio-reactive-production]] — Frequency band mapping, genre-aware pacing
- [[visualization-effects]] — WebGPU/TSL shaders, particles, post-processing
- [[3d-visualization-best-practices-2026]] — R3F perf rules, audio-driven 3D
- [[2d-visualization-2026]] — PixiJS 8, p5.js, Canvas2D alternatives
- `C:\Users\Aomega Imaging\.kilocode\skills\hyperframes-creative\references\audio-reactive.md` — HyperFrames audio-reactive animation reference
- `tools/analyze_and_sync.py` — Beat grid + section extraction
- `packages/backend/app/services/audio_analyzer.py` — Multi-backend analysis service

---

*Last updated: 2026-09-24*

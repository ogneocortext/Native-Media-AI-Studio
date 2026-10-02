# Three.js Audio-Reactive Scene Pipeline — Gemini Pass (2026-10-02)

SimonDev's Three.js + Web Audio visualization translated into a
production per-frame pipeline for the studio's Three.js scenes.
Pairs with `docs/knowledge/gemini-blender-3d-audio-reactive-2026-10-02/`
(binding schema + pre-baked LUT backbone).

## Provenance

- Video: SimonDev — "Immersive 3D Audio and Visualization (three.js &
  javascript)" (4:45). https://www.youtube.com/watch?v=1S7ke6F8sV4 —
  1,274 likes / 33K views (~3.9% ratio). **Admitted under the
  like/view-ratio rule** (2026-10-02): it did not clear the 10k-like
  bar, but its 3.9% ratio beat both million-view AE tutorials, and it
  is exactly on-brief (AnalyserNode → Three.js).
- Gemini chat: https://aistudio.google.com/prompts/13DSmHCIEnX7dtelk6VIGn5DojnpCLpx7
- Model: **gemini-3.8-flash** (3.0 not offered). URL Context: **ON**
  (Search grounding also on — video specifics are Gemini's
  interpretation, treat as leads).
- Date: 2026-10-02.

## What the video does (Gemini's analysis)

Dual Web Audio → Three.js pipeline:
- **Ingestion:** `THREE.AudioListener` on the camera +
  `THREE.PositionalAudio` on world-space anchors (spatial panning /
  falloff free from the PannerNode).
- **Sampling:** `THREE.AudioAnalyser` wrapping the AnalyserNode;
  `getFrequencyData()` into a pre-allocated `Uint8Array` per tick.
- **Visualizer A (CPU object flow):** bins normalized 0–1 → mapped to
  `mesh.scale.y` + emissive color via a color spline.
- **Visualizer B (GPU shader flow):** normalized bins copied into a
  `THREE.DataTexture` (`needsUpdate = true` per frame); fragment
  shader samples it to modulate SDF radius/distortion on a plane.
- **60fps choices:** pre-allocated typed arrays (zero GC churn), low
  FFT resolution (32–128 bins for the CPU path), one VRAM upload
  driving millions of pixels in a single draw call.

## Recommended studio pipeline (4 stages)

Direct FFT→scale mapping causes jitter, high-frequency buzz, and no
rhythmic weight. Decouple:

```
[AnalyserNode] → [Raw freq + time arrays] → [Feature Extraction]
  (sub-bass, kick, mids, highs, RMS) → [Asymmetric Envelope Follower]
  (fast attack, exponential decay per band) → [Scene Bindings]
  → shader uniforms | InstancedMesh matrices | camera rig / post-FX
```

**Envelope math** (frame-rate-independent; plain lerp is
frame-rate-dependent and feels wrong):

```
α = 1.0 − exp(−Δt/τ),  τ = τ_attack if target > current else τ_decay
```

Per-band starting points: kick/sub-bass τ_att 15 ms / τ_dec 180 ms;
mids/vocals 40 / 350 ms; treble 10 / 80 ms.

**Binding priorities:** (1) shaders — global `uAudio` uniforms +
accumulating `uAudioTime` (advances proportional to bass so shaders
accelerate to the rhythm); (2) geometry — never animate `THREE.Mesh`
arrays, use `InstancedMesh` + pre-allocated `Matrix4` buffers
(1 draw call); (3) cinematics — camera FOV recoil, bloom threshold,
light intensity bound to smoothed bass/energy only.

## AudioEngine sketch (from the pass)

```ts
export interface AudioFeatures {
  subBass: number; bass: number; mid: number; treble: number; energy: number;
}
export class AudioEngine {
  // fftSize 1024; smoothingTimeConstant = 0.0 (shaped in software)
  // getBandEnergy(minHz, maxHz) via bin math from sampleRate
  // envelope(current, target, dt, tauAttack, tauDecay) — asymmetric
  update(dt: number): AudioFeatures {
    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getByteTimeDomainData(this.timeData);
    // raw bands + RMS energy → asymmetric smoothing → this.smoothed
  }
}
```

Scene bridge per tick: uniforms ← smoothed bands;
`uRhythmicTime += dt * (1 + bass*3)`; instanced matrices staggered
by band across instances; `camera.fov = baseFov − bass*8`
(8° punch on kicks); `light.intensity = 2 + energy*10`.

## React wiring

`AudioEngine` = module-scope singleton (or stable instance in a
`useRef`). Music must never reset when scenes mount/unmount —
**React state/hooks get zero read/write access to per-frame audio
values**. Boot via idempotent `.init()/.resume()` from a user
gesture. Canvas mounts via ref; loop + teardown strictly in
`useEffect` (`cancelAnimationFrame`, remove listeners,
`renderer.dispose()`).

## Kick onset detection (cheap and reliable)

Low-band spectral flux (rectified 40–140 Hz bin difference), NOT
time-domain amplitude (broadband noise / distorted guitars false-
trigger). Dynamic threshold tracks current density:

```ts
const flux = Math.max(0, this.raw.bass - this.prevBass);
this.prevBass = this.raw.bass;
const threshold = this.smoothed.bass * 1.15 + 0.05;
this.raw.kickOnset = flux > threshold ? Math.min(1, (flux - threshold) * 5) : 0;
```

Feed into the envelope follower at τ_att ≈ 1 ms / τ_dec ≈ 75 ms so
16th-note kicks don't bleed into a plateau.

## Scene hot-swapping (zero reallocations)

Global shared uniform registry — every scene material references the
same object; `AudioEngine.update()` writes once:

```ts
export const globalAudioUniforms = {
  uSubBass: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 },
  uTreble: { value: 0 }, uEnergy: { value: 0 }, uKick: { value: 0 },
  uAudioTime: { value: 0 },
  uAudioTexture: { value: null as THREE.DataTexture | null },
};
```

Pre-allocate ONE 512×1 `DataTexture` at boot; the analyser writes
into the same pinned `Uint8Array` every frame + `needsUpdate`.
`SceneManager.setScene()` swaps scene pointers only — GPU memory
and analysis buffers untouched; per-scene `dispose()` frees only
that scene's geometry/materials.

## Caveats

- Response 1's video-analysis claims (PositionalAudio usage,
  DataTexture formats in SimonDev's code) came from URL Context +
  Search grounding combined — verify against the video/source
  before treating as ground truth.
- Converges with the Blender pass's binding schema: implement the
  binding system ONCE and share it between Canvas2D, Three.js, and
  shader paths (see the cross-pass convergence note in
  `gemini-blender-3d-audio-reactive-2026-10-02`).

# Chroma → Hue Mapping (design spec)

Deterministic, model-free palette control for the visualizer: derive shader
color from the track's detected musical key. Classical DSP only — no AI in the
loop, so this doubles as the deterministic fallback layer when heavier
analysis is unavailable.

## Inputs (existing — no analyzer changes needed for Tier 1)

`analysis.json` from `~/workspace/audio-analysis/analyze.py`:

| Field | Format | Notes |
|---|---|---|
| `estimated_key` | `"<PC> <mode>"`, e.g. `"A minor"` | PC in `{C, C#, D, D#, E, F, F#, G, G#, A, A#, B}` (sharps, not flats); mode in `{major, minor}`. Krumhansl templates, Pearson r |
| `key_confidence_r` | float | Correlation of best key |
| `key_runner_up` / `key_runner_up_r` | string / float | Second-best key, for blending |
| `tempo_bpm` | float | Already feeds the beat clock via `u_beat` |

## Mapping

**1. Pitch class → hue (circle of fifths).**
Fifths order starting at C: `C, G, D, A, E, B, F#, C#, G#, D#, A#, F`.
Hue = index × 30°: C=0° (red), G=30°, D=60°, A=90°, E=120°, B=150°,
F#=180° (cyan), C#=210°, G#=240° (blue), D#=270°, A#=300°, F=330°.

Why fifths, not chromatic: harmonically adjacent keys are visually adjacent.
A modulation (e.g. verse in Am → chorus in C) renders as a smooth grade
shift, not a jump cut. Enharmonic note: the analyzer emits sharps only, so
`G#`/`D#`/`A#` map to their sharp slots above — no flat/sharp dedup needed.

**2. Mode → saturation.**
Major → 0.75 (bright, open). Minor → 0.55 (moodier, matches the minor-key
bike-track catalog). One scalar; cheap to tune later per visual profile.

**3. Confidence → blend / fallback.**
- `r ≥ 0.6`: use `estimated_key` directly.
- `0.4 ≤ r < 0.6`: blend hue toward `key_runner_up`, weighted by the two r
  values; halve saturation. Ambiguous key reads as a muted in-between, which
  is honest.
- `r < 0.4` or key missing: neutral palette (saturation 0.08, hue holds last
  value). Visuals keep running on `u_time`/`u_beat` — never a crash, never a
  black frame. This is the deterministic fallback contract.

## New uniforms (Tier 1 — static per track)

| Uniform | Type | Range | Meaning |
|---|---|---|---|
| `u_key_hue` | float | 0..1 | Key hue (degrees / 360) |
| `u_key_sat` | float | 0..1 | Mode/confidence saturation |
| `u_key_conf` | float | 0..1 | Raw `key_confidence_r`, for shaders that want it |

**Wiring** (follows the existing `u_bass`/`u_beat` pattern):
1. `packages/frontend/src/features/visualizer/shaders.ts` — declare the three
   uniforms in the shared header comment (line 2) and in each shader's
   uniform block.
2. `packages/frontend/src/features/visualizer/components/ShaderCanvas.tsx` —
   add the three names to `uniformNames` (~line 140) and add
   `keyHue`/`keySat`/`keyConf` keys to the `uniformsRef` record the parent
   updates per frame.
3. Set once per track from `analysis.json` before playback starts.

Cost: 3 floats per frame. Unmeasurable on the GTX 1070 Ti.

## Tier 2 (future — per-frame hue modulation)

`analyze.py` currently stores only `chroma_mean`. For chord changes to drive
palette shifts *within* a track, add a downsampled `chroma_frames` array
(e.g. 2 fps) to `analysis.json` and a per-frame `u_chroma_hue` uniform.
Specified here so the Tier 1 wiring doesn't block it; not implemented yet.
Tier 1 ships first.

## Worked example

Track analyzed as `"A minor"`, `key_confidence_r = 0.82`:
A is index 3 in fifths order → 90° → `u_key_hue = 0.25`.
Minor → `u_key_sat = 0.55`. `u_key_conf = 0.82`.

## Test plan

1. Run `analyze.py` on 3 tracks of known key; verify `u_key_hue` matches the
   table above.
2. Force `r < 0.4` (or strip the key fields): verify neutral fallback, no
   visual glitch, playback unaffected.
3. Windows smoke test: confirm no frame-time regression on GTX 1070 Ti
   (expected: none — 3 floats).

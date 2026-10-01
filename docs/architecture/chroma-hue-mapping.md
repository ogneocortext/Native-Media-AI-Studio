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

> **Two analyzers, one schema.** `tools/audio-analysis/analyze.py` and
> `tools/audio_agent_profile.py` both compute Krumhansl/Pearson key detection,
> and they did **not** originally agree: only `analyze.py` emitted
> `key_confidence_r`, while `audio_agent_profile.py` emitted a clamped
> `key_confidence` and no runner-up at all. Since most committed analysis files
> came from the latter, the spec's assumed fields were absent in practice.
> `audio_agent_profile.py` and `GET /api/audio/analysis/by-filename/{filename}`
> now emit `key_confidence_r`, `key_runner_up` and `key_runner_up_r` alongside
> the existing display values, so a consumer does not have to know which tool
> produced a given file. Existing files keep working — see "Status".

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

## Status

Tier 1 **is implemented** (2026-10-01, decision-log **Q5**).

| Piece | Where |
|---|---|
| Pure mapping (fifths → hue, mode → sat, confidence → blend/fallback) | `packages/frontend/src/features/visualizer/keyPalette.ts` |
| Per-track fetch of the analysis | `packages/frontend/src/features/visualizer/useKeyPalette.ts` |
| Uniform declarations + per-frame set | `components/ShaderCanvas.tsx` (`uniformNames`, both draw paths) |
| Parent wiring | `ShaderVisualizer.tsx` (`keyPaletteRef` → per-frame object) |
| A shader that consumes them | `shaders.ts` → `spectralReactor` |
| Unit tests | `keyPalette.test.ts` (vitest, `pnpm test:unit`) |

Two implementation notes that the original wiring sketch did not anticipate:

1. **The rAF loop reassigns `uniformsRef.current` wholesale every frame**, so
   static key values cannot simply be parked on that ref — they are wiped. They
   live in a separate `keyPaletteRef` and are merged into each frame's object.
2. **Uniforms are set for every shader, but only `spectralReactor` declares
   them.** `getUniformLocation` returns `null` for a shader that does not, and
   `uniform1f(null, x)` is a legal no-op, so a preset opts in by declaring the
   uniform and using it. Unused uniforms are optimized out by the compiler, so
   this costs nothing on the other seven presets.

`spectralReactor` blends by confidence — `mix(centroidHue, keyHue,
smoothstep(0.4, 0.6, u_key_conf))` — so a confident key takes over the palette
and a sub-0.4 fallback leaves the original centroid-driven hue untouched.

## Test plan

1. ~~Run `analyze.py` on 3 tracks of known key; verify `u_key_hue` matches the
   table above.~~ **Done** — all 12 fifths slots verified against the table, plus
   the worked example above (`"A minor"`, r=0.82 → hue 0.25, sat 0.55,
   conf 0.82), the 0.6 direct/0.4 fallback thresholds, the runner-up blend, and
   seven malformed-input cases (null, missing key, `NaN`, wrong type) confirming
   the mapper never throws and never returns a black frame.
   These now live in `keyPalette.test.ts` rather than a throwaway script, and the
   suite was mutation-checked: transposing the fifths table, raising the
   confidence floor, zeroing the neutral saturation, swapping the major/minor
   saturations, and breaking the hue scale are each caught.
2. ~~Force `r < 0.4` (or strip the key fields): verify neutral fallback, no
   visual glitch, playback unaffected.~~ **Done** for the mapping logic
   (saturation 0.08, hue holds, `fallback: true`). The in-browser confirmation is
   still outstanding — see below.
3. Windows smoke test on the GTX 1070 Ti: **not yet done.** Frame-time
   regression is not expected (3 floats, and only one preset reads them), but it
   is unmeasured.

### Known gap: existing analysis files lack the new fields

Files committed *before* this change still carry the old schema, so their keys
resolve to the neutral fallback until they are re-analyzed:

| File | `estimated_key` | confidence | Result |
|---|---|---|---|
| `take-the-crown-analysis.json` | `E` (no mode) | `key_confidence: 0.755` | fallback — no `_r` field |
| `still-i-rise-analysis.json` | `A#` (no mode) | `key_confidence: 0.126` | fallback — below 0.4 regardless |

This is a data-refresh task, not a code defect. Re-running the analyzer on
those two tracks populates the fields; `A#` at r≈0.13 is a genuinely
low-confidence detection and should stay on the fallback regardless.

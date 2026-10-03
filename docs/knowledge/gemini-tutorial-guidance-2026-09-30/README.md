# Gemini Tutorial Guidance — Native Media AI Studio (2026-09-30)

Five YouTube tutorials run through Gemini 3.5 Flash Lite in Google AI Studio, prompted for **implementation guidance to steal, adapt, and improve** — not video recaps. Packaged for local review/implementation.

## The set

| # | File | Video | Likes | Focus |
|---|------|-------|-------|-------|
| 1 | [01-uvr5-headless-stem-separation.md](01-uvr5-headless-stem-separation.md) | UVR5 vocal extraction (soundlearn) | 21,342 | Hierarchical separation pipeline, model picks for GTX 1070 Ti, anti-AI-grit layer |
| 2 | [02-karra-suno-vocal-enhancer.md](02-karra-suno-vocal-enhancer.md) | Stock-plugin vocal mixing (KARRA) | 46,100 | "Suno Vocal Enhancer" preset: FFmpeg filter strings + Python blueprint |
| 3 | [03-in-the-mix-mix-upgrades.md](03-in-the-mix-mix-upgrades.md) | Vocal mixing (In The Mix) | 46,847 | Two-stage EQ, parallel weight bus, sidechain "pocket EQ" on Other stem |
| 4 | [04-bileam-audio-reactivity-module.md](04-bileam-audio-reactivity-module.md) | Audio reactivity (bileam tschepe) | 7,402* | Audio-reactivity module spec: JSON timeline schema + TypeScript processor |
| 5 | [05-pppanik-instanced-blob-field.md](05-pppanik-instanced-blob-field.md) | Blob instancing (PPPANIK) | 9,788* | Instanced blob-field: GLSL shaders + Three.js component, 40k-instance budget |

\* Videos 4 and 5 are approved exceptions to the ≥10,000-like rule — no qualifying tutorial exists in the audio-reactive niche (closest alternatives: 9,788 and 7,402 likes).

## Cross-cutting decisions for the implementer

1. **Separation goes hierarchical.** Dedicated vocal model first (`UVR-MDX-NET-Voc_FT` / `Kim_Vocal_2`), then Demucs `htdemucs_ft` on the instrumental residual. Use the `audio-separator` Python package; async job queue for 30–90s jobs; expose `segment_size`/overlap/denoise via `/api/audio/separate`.
2. **Mixing preset is fully specified.** "Suno Vocal Enhancer": `highpass=f=110` → dynamic tamer @ 2.6/3.8kHz → de-ess 6.5kHz → air boost → 2.5:1 leveling → limiter −1.0dB. Restructure into two-stage EQ (subtractive before comp, character after), add a parallel weight bus (−12 to −18dB), and sidechain-duck 2.5–3.5kHz on the Other stem while vocals sing. Don't compress Suno vocals harder — they're already brickwalled; expand instead.
3. **Reactivity gets a module.** Per-frame JSON timeline lookup → exponential smoothing (0.35) → gamma-curve mapping to uniforms. Replace `snoise()` drift with deterministic beat-phase waves for re-render stability.
4. **3D scenes get dense.** 30k–60k instanced tetrahedra on a Fibonacci shell (40k in the sketch), per-instance phase attributes, bass = noise displacement, transients = spore ejection + color-temperature shift. Verify the embedded Ashima `snoise` GLSL against a known-good copy before shipping.

## Provenance

- Each file preserves Gemini's full response verbatim (reconstructed from page extraction; code blocks kept content-identical).
- Gemini chat links are in each file header (account: ogneocortext@gmail.com).
- **Implementation status (updated 2026-10-02, v2.1.0):** all five guides are now
  implemented. Do not read the guidance below as a to-do list — it is the
  original brief, retained as the rationale for what the code does.
  - **Caveat added 2026-10-02.** "Implemented" meant *written*, not *working*.
    `suno_enhancer.py` had never produced a single output file: it aborted at
    step 5 on every run, with five defects stacked behind that first one. See
    `docs/knowledge-library/ai-music-mastering-stems-2026.md` §6 for what was
    actually wrong and what it measured once fixed. Treat any guide in this
    folder as "written, unverified" until it has been run end to end.
  - **01 — UVR5 hierarchical separation** → `source_separation.py`
    (`UVR-MDX-NET-Voc_FT` / `Kim_Vocal_2` in `SUPPORTED_MODELS`, plus
    `segment_size` / `overlap` / `denoise` on `SeparationOptions`, exposed
    through `/api/audio/separate`).
  - **02 — Suno Vocal Enhancer preset** → `suno_enhancer.py` (two-stage EQ,
    de-ess, air boost, limiter).
  - **03 — In The Mix upgrades** → `suno_enhancer.py`
    (`_parallel_weight_bus` at −12…−18 dB and `_sidechain_pocket_eq` ducking
    2.5–3.5 kHz on the Other stem; opt-in via
    `sidechain_pocket_eq_enabled`, default `False`).
  - **04 — Bileam reactivity module** → `audioReactivityProcessor.ts` +
    `useSpectralTimeline.ts`, consumed by `ShaderVisualizer.tsx`. `BeatPhaseWave`
    replaces the `snoise()` drift the brief asked for.
  - **05 — PPPANIK blob field** → `components/InstancedBlobField.tsx` +
    `viz-styles/pppanik.tsx` (40k instanced tetrahedra, Fibonacci shell, bass
    displacement, transient ejection and colour-temperature shift).
- **Known deviation (05):** the brief's embedded Ashima `snoise` GLSL came from
  a garbled page extraction and was never verified against a known-good copy, so
  it was **not** adopted. Displacement is computed CPU-side with
  `Math.sin`/`Math.cos` in the `useFrame` loop instead, which needs no
  verification and keeps 40k instances cheap. `snoise` still exists in
  `shaders.ts` / `VisualizationFX.tsx` for unrelated presets.
- For the current module layout and where new visualizer logic belongs, see
  `docs/architecture/visualizer.md` (decision-log D14).

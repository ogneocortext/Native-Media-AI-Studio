# Bones Render Lane — Capture Spec 2026-11

**Status:** Proposed
**Area:** Video Pipeline & Storyboard (T-VID-17)
**Source:** `docs/knowledge-library/3d-bones-ai-skin-pipeline-2026.md` §5 Gap 5;
`docs/knowledge-library/ryzen-5500-cpu-playbook-2026.md` (lanes);
`config/hardware-profile.json`;
`docs/knowledge-library/three-js-render-motion-2026.md` (clock discipline);
`docs/plans/frame-package-contract-2026-11.md` (the output contract)
**Decides:** none — design only; engine invocation and render jobs wait on
the owner's word.
**Last Updated:** 2026-11-07

## 1. The decision, recorded

**Engine lane: Blender bpy + Eevee (real-time raster) is the frame-package
capture engine.** Cycles-class path tracing is named **final-frame luxury,
explicitly not the iteration loop** — on this hardware it cannot be:

- The GTX 1070 Ti-class Pascal card has **no RT cores**; Cycles GPU
  still pays full path-tracing cost per sample.
- The **6-physical-core Ryzen 5500** CPU fallback for Cycles is the
  iteration-killer: a 1080p frame at usable sample counts measures in
  minutes, not seconds. Batch overnight renders are the only honest
  Cycles lane, and they are not how anyone iterates.
- Eevee rasterizes in real time on the same card — its cost model is
  the budget doc's (draw calls, triangles, textures), which is exactly
  the discipline the asset pipeline already enforces. **The budget
doc is Eevee's quality strategy**: stay inside ≤150 draw calls /
≤1.5M tris/frame / ≤1 GB textures and Eevee output is the intended
look, not a compromise.

**Three.js Studio is the interactive preview surface, not the package
authority.** It already exists, iterates at display rate, and shares
the scene vocabulary — but it has no AOV/pass pipeline today, and
adding one duplicates what bpy gives natively (per-pass render layers,
position/deposition outputs, armature-evaluated pose). v1 rule:
**preview in Three.js, capture in Blender.** A Three.js capture lane
is a v2 question for the frame-package contract, not this spec.

## 2. Capture settings

### 2.1 Render settings (Eevee)

| Setting | Draft tier | Final tier | Note |
|---------|-----------|------------|------|
| Resolution | 960×540 | spec-native (≤1920×1080) | draft exists for iteration cost, not delivery |
| Eevee samples (TAA) | 16 | 64 | spec may override per look (noir/grain looks want ≥64) |
| Denoise | OIDN on, default | OIDN on, default | CPU-side, cheap on 6 cores for ≤1080p |
| Motion blur | off | spec field, default off | deterministic cost; enable only when spec asks |
| DOF | off in draft | spec field | Eevee DOF is a post pass — cheap but changes look |
| Film transparent | off | off | packages composite over their own background |
| Color management | AgX/Filmic view transform, sRGB out | same | beauty is display-referred sRGB (T-VID-13 §4) — control passes bypass this entirely (raw/linear) |

**Control passes are separate render layers** (bpy render layers give
per-pass material overrides + `use_pass_*` outputs natively): depth,
normals, object-index ride their own layers with unlit/emission
materials — cost is a fraction of beauty (no lighting eval, no TAA
convergence), roughly 0.2–0.4× beauty per pass on the same card.

### 2.2 Resolution ladder → budget + Route B

| Tier | Beauty | Control passes | Purpose |
|------|--------|---------------|---------|
| draft | 960×540 | same res, `scale` per spec | iteration, previz, spec debugging |
| review | 1280×720 | same | owner look checks before final |
| final | spec-native ≤1920×1080 | per T-VID-13 `scale` (1.0/0.5) | package authority, Route B input |

Route B alignment: T-VID-14's lane conditions at **768×768** — the
package ships scene-native passes and the lane downscales
(`ImageScale`, contract §5); the capture spec does not pre-shrink for
the lane because Route A and finishing want full res. Half-res control
(`scale: 0.5`) remains the storage pressure valve from T-VID-13 §8.

## 3. Determinism — the bpy-side clock discipline

`three-js-render-motion-2026` rules, translated to bpy:

1. **Every output frame is a pure function of frame index.** Capture
   steps `bpy.context.scene.frame_set(f)` — never wall-clock, never
   `frame_current` drift. Animation evaluates at exact frame time.
2. **No unseeded randomness in the render path.** Any stochastic
   element (particle systems, shader noise with random offsets,
   geometry-nodes random nodes) must take its seed from
   `scene.nma_seed + f` or be baked — an unseeded `random` makes two
   runs of the same spec diverge, which violates the package's
   reproducibility contract (T-VID-13 §7 `spec_hash8`).
3. **Simulations and physics are baked before capture** (bpy cache
   bake) or disabled — live sim stepping during export is
   order-dependent and non-reproducible.
4. **Beat/audio-reactive bindings quantize to frame indices** before
   driving animation — same rule as the web side: beats map to frames,
   never to wall-clock (measured beat grid in, frame numbers out).
5. **Builder identity is recorded.** `manifest.builder =
   {engine: "blender-bpy", version: "<exact x.y.z>"}` — a Blender minor
   upgrade can shift Eevee output; the manifest makes drift
   attributable. Blender upgrades go through the vendor-drift skill.
6. **Fixed sample counts, fixed resolution, fixed color management**
   per tier — listed in §2 so two runs cannot silently pick different
   settings.

## 4. Throughput and lane costing

Cost model an implementer can use **from this spec alone**:

```
wall_clock ≈ frames × (beauty_cost + Σ active_pass_costs) / lane_share
beauty_cost(1080p, 64spp)  ≈ 0.05–0.15 s/frame   (Eevee, simple scene, Pascal)
beauty_cost(540p, 16spp)   ≈ 0.015–0.04 s/frame  (draft)
pass_cost                  ≈ 0.2–0.4 × beauty_cost per active control pass
encode_cost(PNG seq)       ≈ 0.02–0.05 s/frame   (CPU, x264 proxy cheaper)
```

Worked example — 4-min song @24 fps = 5,760 frames, final tier,
beauty + depth(0.5×) + normals + seg + pose:

- beauty ≈ 5,760 × 0.1 s ≈ **10 min**
- 4 control passes ≈ 5,760 × 0.4 × 0.1 s ≈ **15 min**
- encode/I/O ≈ **5–10 min** (SATA SSD, sequential writes per §8 of
  the contract)
- **Total ≈ 30–35 min per scene-render lane slot** — a solo-lane
  batch job per the CPU playbook, never concurrent with demucs or
  x264-master (`never_together` already covers the pattern; the
  capture job registers itself in the same lane table at
  implementation).

Draft tier same scene ≈ **5–8 min** — cheap enough that "render the
draft, look at it, adjust the spec" is the intended iteration loop.

These are estimates to be replaced by the golden-scene measurement
(verdicts doc §7 adoption order: one golden character + one asymmetric
test clip); the spec's job is that the *formula* exists before the
first render, so cost is plannable, not discovered.

## 5. Package handoff

The capture job emits exactly `frame-package/v1` (T-VID-13): manifest
with `builder.engine = "blender-bpy"`, per-pass render-layer settings
recorded, `storage_bytes` filled from actuals. The validator's seven
checks (§10 there) run before the package is accepted — a capture that
can't pass its own validator isn't a package, it's a directory of
PNGs.

## 6. Non-goals

No Cycles settings beyond naming it luxury (if a hero shot ever needs
path tracing, that's a per-shot spec flag for an overnight solo-lane
job — not a lane); no render-farm/distributed capture; no GPU
engine other than Eevee in v1 (Workbench-class is too flat for
beauty); no Three.js capture (preview only, §1); no audio muxing into
the package (audio stays upstream; the package is video frames +
camera only).

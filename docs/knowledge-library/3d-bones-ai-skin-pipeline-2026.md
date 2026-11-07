---
title: "3D Bones, AI Skin — Pipeline Gap Analysis 2026"
date: 2026-11-06
type: synthesis
tags:
  - technical
  - 3d
  - platform-comfyui
aliases:
  - 3D Bones AI Skin Pipeline Gap Analysis 2026
cssclasses:
  - technical-guide
---

# 3D Bones, AI Skin — Pipeline Gap Analysis 2026

> **Anti-patterns:** generation work here follows [[media-anti-patterns-2026]] — the canonical slop list: the brief discipline, the per-medium patterns, and the grading checklist live there only; nothing is copied here.

> The gap analysis for a pipeline that either renders 3D well enough to
> stand beside AI-generated media, or — the stronger route on this
> hardware — uses 3D as the bones that drive AI visuals: geometry,
> animation, camera, and lighting decided in 3D, appearance painted by
> AI under geometric control. Written 2026-11-06, the day the hardware
> baseline became fully verified ([[ryzen-5500-cpu-playbook-2026]],
> [[pascal-3d-budget-discipline-2026]], and the reconciled
> `config/hardware-profile.json`, T-PLT-46) — every feasibility claim
> below is a lookup against those numbers, not an experiment.
> **Expanded 2026-11-07** at the owner's direction: the character
> verdicts flowed back (§4.1), pose-pass and lane specifics landed
> in Gaps 1–2, a sixth gap (asset intake, T-VID-26) was registered,
> and skin acceptance gates were added (§6).

## 1. Two routes to the same footage

**Route A — 3D stands alone.** Renders compete with AI assets on
fidelity and flexibility directly. On Pascal this route has a hard
ceiling: no RT cores, ~6.5 TFLOPS raster, 8 GB VRAM. It wins for
stylized, art-directed looks where consistency and reusability matter
more than photorealism — and it is the substrate Route B is built from.

**Route B — 3D bones, AI skin.** The scene decides everything AI video
is bad at, and the AI layer paints everything 3D is slow at:

| Owner's requirement | Supplied by the bones (3D) | Supplied by the skin (AI) |
|---|---|---|
| Physics | Real trajectories, occlusion, contact, gravity — simulated/keyframed once, correct every frame | Nothing — it must not invent motion |
| Motion accuracy | Animation re-renders identically; beat-driven bindings from the measured audio grid (T-VID-03) | Temporal models (AnimateDiff-class) smooth and texture the motion, they don't choose it |
| Material diversity | A material swap in the spec re-renders the same motion with new surface assignments | Appearance variety beyond the asset library — fabric, skin, atmosphere, wear |
| Character consistency | One character asset — mesh, proportions, materials, rig — instanced by every scene spec | Identity conditioning (IP-Adapter-class) keyed to that same asset for face/detail |

**Verdict: Route B is the primary pipeline; Route A is its stylized
special case.** They share one contract — the frame package (§3) — so
building B builds A.

## 2. Why the baseline makes the gaps enumerable

Before 2026-11-06, "can we run technique X" was a research project.
Now it is a table lookup:

- **Model lanes** (hardware profile): SD 1.5-class + AnimateDiff fits;
  Wan 2.1 1.3B fits; Flux and SDXL are listed as *avoid* on 8 GB.
  ComfyUI defaults are 768×768 fp16 with VAE tiling.
- **Scene complexity** ([[pascal-3d-budget-discipline-2026]]): ≤150
  draw calls target, per-role triangle caps, ≤1 GB scene textures,
  baked lighting — the bones must be authored to these budgets or the
  real-time side stalls.
- **Coexistence**: the VRAM manager offloads Ollama before ComfyUI
  loads; CPU heavy jobs run in lanes (T-PLT-46) — batch renders and
  CPU stages queue, they don't collide.

## 3. The pipeline shape

```text
scene spec (T-VID-05)                character assets (T-VID-16)
        │                                     │
        ▼                                     ▼
  builder (Blender bpy / Three.js) ──► FRAME PACKAGE (T-VID-13)
        beauty frames + depth + normals + segmentation/ID
        + pose + camera metadata, at budget-doc resolutions
                          │
              ┌───────────┴────────────┐
              ▼                        ▼
   Route A: grade/composite   Route B: control-conditioned lane
        (T-VID-15 looks)        (T-VID-14) + identity (T-VID-16)
              └───────────┬────────────┘
                          ▼
              finishing chain (existing) ──► master
```

The **frame package is the contract**. Everything downstream consumes
it; nothing downstream re-derives geometry. T-VID-10's depth
*estimation* is the foreign-footage analog — this pipeline's input is
owned scenes, so its passes are exact, not estimated.

## 4. What already stands

| Piece | State |
|---|---|
| Spec-driven scene builder | T-VID-05, design registered — schema covers objects, materials, lights, camera, audio-reactive bindings; **no render passes** |
| V2V route for existing footage | T-VID-07..10, design registered — the *input* side; complementary, not overlapping |
| Camera direction as data | T-VID-11 — a typed rig registry, but scoped to the I2V prompt path |
| Real-time 3D budgets | T-VID-12 + [[pascal-3d-budget-discipline-2026]] |
| Hardware baseline | Hardware profile v2 reconciled (T-PLT-46); CPU playbook; Pascal GPU doc |
| ControlNet integration | **Declared, not built**: `packages/backend/app/api/integrations_music_video.py:565` catalogs "Advanced AnimateDiff with controlnet and IP-adapter" (`mm_sd_v15_v2.safetensors`, `controlnet_openpose`); `Settings.tsx` offers a "ControlNet + Image" mode. But `config/comfyui/workflows/` holds exactly 3 workflows (audio-reactive visualizer, music-video scene, stem-mixer preview) — none control-based, and nothing produces control inputs from owned scenes (grep-verified 2026-11-06: no pass/AOV support anywhere in scene/gen3d code) |

### 4.1 Settled downstream — the character verdicts

[[browser-character-pipeline-verdicts-2026]] answered the character
half of this pipeline the same day this analysis was written; its
decisions are inputs here, and this doc now consumes them:

| Verdict | Consumed by |
|---|---|
| HouseRig_v1: **49 base / 61 hero** bones, Mixamo-compatible names, meters / Y-up / +Z, no leaf bones in delivery | Gap 4's asset schema; Gap 1's pose pass |
| Sourcing: Mixamo primary; license intake rejects CC BY-NC; raw-asset redistribution prohibited | Gap 6's intake gate |
| Retarget: offline (Auto-Rig Pro class); planted-foot drift <0.02 m/s; loop closure ≤0.5° | Gap 5's capture spec |
| Pose = one evaluated pose → OpenPose image + fixed-bounds depth + **Float32 numeric archive** | Gap 1's pose element — a format, not a noun |
| Textures: KTX2 residency (hero ≤64 MiB / mid ≤24 / bg ≤8); verify the actual transcode format (RGBA8-fallback trap) | Gap 6's intake checks |
| LOD by projected height (350/140/60 px); hair as cap + alphaTest cards | Gap 4's asset definition |
| Beat: audio clock + piecewise interpolation over **measured** timestamps, never uniform-beat math | §1's beat bindings, made precise |

## 5. The six gaps

### Gap 1 — Control-pass rendering (the keystone) → T-VID-13

The builder renders beauty frames only. Route B needs, per frame:
depth, normals, segmentation/object-ID, pose (for rigged characters),
and camera metadata — exported as a versioned frame package.
*Baseline answer:* passes are cheap renders (unlit/depth materials,
negligible GPU next to beauty); the real cost is storage and write
lanes on the SATA SSD, which the profile's risk notes already bound.
*Design work:* the passes contract in the T-VID-05 spec (pass list,
formats, resolution relative to beauty, naming/versioning). The pose
element's format is already decided by the verdicts (§4.1): an
OpenPose image plus fixed-bounds depth, with a Float32 numeric
archive as the lossless record.

### Gap 2 — Control-conditioned generation lane → T-VID-14

Declared in the integrations catalog; zero workflow files implement
it, and it has never had an input to consume. *Missing:* ComfyUI
workflow(s) that take a frame package (depth/pose/seg conditioning +
AnimateDiff), the lane assignment under the profile's VRAM rules, and
a seed/parameter contract so a render is reproducible. *Baseline
answer:* SD 1.5-class is the profile's blessed tier for exactly this;
SDXL/Flux-class control stacks are out on 8 GB. *Depends on:* Gap 1's
contract. *Lane tiers (2026-11-07):* SD 1.5 + AnimateDiff is the
iteration tier; **Wan 2.2 TI2V-5B GGUF** — already in the studio's
ComfyUI inventory — is the quality tier for passes where its
conditioning applies; HunyuanVideo-class lanes are 24 GB and out.

### Gap 3 — Lighting and look rigs → T-VID-15

Camera presets are being solved for the I2V path (T-VID-11), but the
scene side has no named lighting rigs, lens set, or look/grade presets
— a spec can place lights, yet there is no reusable vocabulary of
*rigs* (three-point, studio, practical-neon archetypes as data), and
Route A output has no defined grade step. *Baseline answer:* the
budget doc already mandates baked/static lighting for real-time, which
makes rigs a spec-vocabulary cost, not a GPU cost. *Design work:* a
rig registry sibling to T-VID-11's, consumed by T-VID-05 specs;
Route A's grade step named (LUT/preset refs in the spec).

### Gap 4 — Character identity layer → T-VID-16

IP-Adapter is named in the declared integration, but no character
asset definition binds {mesh, materials, rig, identity reference set}
into one versioned asset that *both* layers consume — so today,
geometry consistency and face consistency would be two unrelated
systems that can drift apart. *Missing:* the character asset schema
and its consistency contract (same asset id + version ⇒ same
proportions from the builder, same identity conditioning in the
lane), plus the reference-set curation rule (what images constitute
an identity, who approves changes). *Depends on:* T-VID-05 asset refs,
Gap 2's lane inputs.

### Gap 5 — The bones render lane (capture decision) → T-VID-17

Nothing decides how a scene becomes a frame package: engine, sampling,
resolution ladder, deterministic export. *Baseline answer:* an
Eevee-class real-time raster lane is the only one that iterates on
Pascal — the budget doc's discipline *is* its quality strategy; a
Cycles-class path-traced lane has no RT cores to stand on and its CPU
fallback is 6 physical cores, so it cannot be the iteration loop
(final-frame luxury at most, and not the default). *Design work:* the
capture spec — engine, denoise/sample settings, resolution ladder
tied to the budget doc, deterministic frame stepping (the discipline
[[three-js-render-motion-2026]] already establishes on the web side,
applied to the bpy side).

### Gap 6 — Asset intake & retopology gate → T-VID-26

Every gap above assumes assets arrive usable; generated assets do
not. Text/image-to-3D output is marching-cubes triangle soup —
dense, non-manifold, detail painted into textures, hidden sides
hallucinated — and no rig binds to it. *Missing:* an intake gate
between generation and the pipeline: (1) input discipline for
image-to-3D — single object, clean/transparent background, even
neutral light, 3/4 view, image-to-3D preferred over text-to-3D;
(2) generated output treated as **blockout by default**; (3)
**built-in auto-retopology first** (Meshy Remesh / Tripo Smart
Mesh-class quad remesh) before export; (4) manual retopology
reserved for rigged/hero assets, where deformation decides;
(5) the verdicts' checks enforced at the gate — KTX2 residency,
transcode-format verification, license intake (§4.1). *Baseline
answer:* retopology is CPU/offline work in the playbook's lanes;
the gate is a checklist plus a script seam, not a model.
*Depends on:* Gap 4's asset definition — the gate enforces it.

## 6. Skin acceptance gates

Route B output is judged as motion, not frames (the anti-patterns
canon's temporal rule, [[media-anti-patterns-2026]] §5). A skin
pass ships when, on sampled frames (first / middle / last + every
beat-cut):

- **Identity holds** — the character reads as the same character
  at every sample; drift is a fail, not a grade.
- **Texture is still where the scene is still** — static regions
  do not swim, crawl, or re-detail between frames.
- **Control held** — output edges track the depth/segmentation
  passes; visible washout means the control-weight/denoise
  balance is wrong, and the fix is in the lane settings, not a
  re-roll.
- **Permanence** — objects present in the bones stay present;
  nothing is invented into occluded space.
- **Plausibility** — the canon's question 6: shadows,
  reflections, and mechanisms would actually work.

These gates are T-VID-14's acceptance evidence when the lane is
built; until then they are the review checklist for any skin
experiment.

## 7. Sequencing and gates

T-VID-13 is the keystone: its frame-package contract unblocks
T-VID-14 and T-VID-16; T-VID-15 and T-VID-17 are independent design.
All six items are **design-first under the T-VID-07 gate pattern**:
design work may start any time; implementation waits on the owner's
word and sits downstream of T-VID-02 and the storyboard critical
path. This analysis registers design work only — the standing
music-video generation hold is unaffected, and nothing here renders
anything.

**Non-goals:** photoreal Route A on this hardware; SDXL/Flux-class
control lanes (profile-forbidden); foreign-footage input (T-VID-07's
route owns it).

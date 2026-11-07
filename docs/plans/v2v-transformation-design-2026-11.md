# V2V Transformation Route — Design 2026-11

**Status:** Proposed
**Area:** Video Pipeline & Storyboard (T-VID-07)
**Source:** `docs/knowledge-library/higgsfield-comfyui-challenge-2026.md` §The project gap;
`docs/knowledge-library/video-generation-vram-2026.md` (8 GB feasibility);
`docs/plans/tasks/video-pipeline-and-storyboard.md` T-VID-07..11
**Decides:** none — design only; every implementation item spun out of this
document waits on the owner's word (live generation path).
**Last Updated:** 2026-11-07

## 1. Scope and non-goals

Every pipeline in this studio today starts from text or an image
(`music_video_handler`, the adapter's T2V/I2V builders). This document
designs the missing **transformation layer**: existing video in,
ComfyUI workflow applied, transformed video out, registered as a normal
job output.

Non-goals: no code, no renders, no new dependencies installed, no
frontend surface. T-VID-08 (character/object swap), T-VID-09
(first-frame paint → propagation), and T-VID-10 (depth re-shoot) each
add a spec section to this document; this section defines the route,
the shared stages they all stand on, and the 8 GB verdicts.

## 2. Route contract

### 2.1 Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/video/transform` | Validate request, enqueue a `video_transform` job, return `{job_id, status, estimate}` |
| `GET` | `/api/jobs/{job_id}` | Reused unchanged — status, progress, result (existing jobs router) |
| `GET` | `/api/video/transform/workflows` | List registered transform ids + param schemas (mirrors `/api/video/render/engines` at `video.py:260`) |

Home: `app/api/video.py` (`/api/video` router) — the video domain
already owns generate-section, render, assemble, and lipsync; a
transformation route is the same shape of concern. Status polling
needs no new endpoint because the jobs router already serves every
job type.

### 2.2 Request schema (`POST /api/video/transform`)

```jsonc
{
  "source": {
    "kind": "job_output | library | path",   // resolution order below
    "ref":  "550e8400-... | track-name.mp4 | output/video/x.mp4"
  },
  "transform": "<registered workflow id>",    // e.g. "paint-propagate"
  "params": { /* typed per transform — see §6 registry */ },
  "options": {
    "seed": -1,
    "priority": 0,
    "max_retries": 1                    // transforms are expensive; default lower than the job default of 3
  }
}
```

**Source resolution** follows the existing path rules (`jobs.py:33`):
`job_output` resolves a completed job's `output_path`; `library`
resolves through the media library/audio store naming; `path` accepts
`output/video/x.mp4` and `video/x.mp4` repo-relative forms. Accepted
containers are `VIDEO_EXTENSIONS` in `services/video_import.py:31`
(mp4/mov/webm/mkv/avi/…). The resolved file must exist, probe as video
via ffprobe (ffmpeg toolchain already required by `ffmpeg_tools.py`
and `video_import.py`), and carry its duration/fps into the job
params — stage math (frame counts, clip windows) is computed from the
probe, never from caller claims.

**Typed params** are per-transform pydantic models registered next to
the transform (§6). The route rejects unknown transform ids and
invalid params at enqueue time (422), not inside the worker.

### 2.3 Job lifecycle and output registration

- New `JobType.VIDEO_TRANSFORM = "video_transform"` in
  `app/models/job.py:26` — a multi-stage orchestration, sibling to
  `MUSIC_VIDEO`, not a single ComfyUI prompt.
- New `VideoTransformHandler.process_job` in
  `app/services/video_transform_handler.py`, registered in
  `QueueProcessor._register_default_handlers` (`queue/processor.py:248`)
  beside the `MUSIC_VIDEO` registration. It orchestrates the stage
  chain (§4) sequentially inside one `vram_manager.work_lane(
  "job:video_transform:<id>")` — the lane is already per-job
  (`queue/processor.py:423`), so stages never contend with each other
  for VRAM.
- **VRAM reservation:** `vram_manager.py:1246-1255` prices queued jobs
  by type. `video_transform` needs a row beside `music_video`
  (6,144 MB) — a transform is one ComfyUI model resident at a time
  plus stage overhead, so the music_video figure is the honest
  baseline.
- **Progress:** reuse the `music_video_handler` heartbeat pattern —
  the handler writes `job.params["current_stage"]`,
  `job.params["current_step"]`, and stage fractions into job params so
  `GET /api/jobs/{id}` shows live progress with no new machinery.
- **Output:** final mp4 lands at
  `output/video/transform_<yyyymmdd_hhmmss>_<jobid8>.mp4` with a JSON
  sidecar (Guidelines 3.3 convention — job_id, transform id, params,
  seed, per-stage artifact paths). `outputs_endpoints.py:292` already
  scans `output/video/`, so the result appears in the Media Library
  and outputs browser with zero new registration code.
- **Failure vocabulary:** malformed source (unprobeable, too long for
  the transform's envelope) → job fails fast at validation, before
  any VRAM is touched. A missing model/stage dependency → failed job
  with the dependency named in `error`, matching how
  `ComfyUIWorkflowHandler` surfaces adapter failures.

### 2.4 Estimator treatment

Reuse `estimate_generation_time` / `estimate_render_cost`
(`services/generation_estimator.py:70,115`) — pure functions, already
the estimator of record. The transform route returns an estimate at
enqueue: **sum over the transform's stage chain**, where analysis
stages (segment, depth) get flat per-second-of-source estimates and
generation stages get the full frame-based estimate with the stage's
model name. Per T-VID-04, `cloud_cost_usd` stays opt-in — a transform
is local-only and the estimator must never imply a cloud burst.

## 3. Substrate mapping — what the route plugs into

| Piece | Location | Role in the route |
|-------|----------|-------------------|
| Job model + types | `app/models/job.py:26-42` | Add `VIDEO_TRANSFORM` |
| Handler registry | `app/queue/processor.py:248-274` | Register `VideoTransformHandler` |
| VRAM lane + reservations | `app/services/vram_manager.py:423` (lane), `:1246` (pricing) | Automatic per job; add pricing row |
| ComfyUI submit | `app/adapters/comfyui.py:715` `_submit_prompt` | Accepts arbitrary API-format graphs — new `_build_*` methods produce them |
| Video output | `comfyui.py:1921` `_wait_for_video_result`, `:2053` `_fetch_video` | mp4 → `output/video/` |
| Video input | `app/core/comfyui_client.py:386` `upload_video` | Copies source into ComfyUI `input/`; installed VHS provides `LoadVideoPath`/`LoadVideoFFmpegPath` (`ComfyUI-VideoHelperSuite/videohelpersuite/load_video_nodes.py:477,579`) |
| Existing I2V builders | `comfyui.py:1264` `_build_wan_i2v_workflow`, `:1463` `_build_ltx_i2v_workflow` | The propagation lane reuses these shapes (§4.3) |
| Estimator | `app/services/generation_estimator.py` | Per-stage estimates summed at enqueue |
| Output scan | `app/api/outputs_endpoints.py:292` | Automatic — no code |

**Workflow graphs stay in code, not JSON.** The adapter builds graphs
in `_build_*` methods; `config/comfyui/workflows/*.json` are reference
exports nothing in the backend loads. The transform registry names
builder methods, keeping one source of truth and the existing
debug-capture path (`comfyui_workflow_handler.py:40-72` writes
workflow+params per job — the transform handler gets the same for
free if it routes generation stages through the adapter).

## 4. Shared stages — specced once, consumed by T-VID-08/09/10

The code survey found **no** segmentation, depth, relight, or
motion-transfer capability anywhere in `packages/` or in installed
ComfyUI custom nodes. The stage contracts below are the shared
vocabulary; each dependent item instantiates them with its own
parameters.

Stage artifacts live under `output/video_stages/<job_id>/` —
per-frame PNG sequences for masks/depth, mp4 for propagated clips —
so a failed later stage never forces re-running an earlier one, and
artifacts are inspectable in the Media Library like any output.

### 4.1 `segment` — mask production

- **Contract:** input = source video (+ optional first-frame point/
  box prompt, or a text prompt); output = per-frame binary mask
  sequence (PNG, `L` mode) + a composite preview mp4.
- **Consumers:** T-VID-08 (swap mask), T-VID-09 (edit-region mask).
- **Candidates:** SAM2 (image+video segmentation, ~1-2 GB) is the
  standard; running it backend-side on CPU keeps ComfyUI VRAM free —
  at ~1-2 s/frame a 5 s/12 fps clip costs ~1-2 min, acceptable for a
  batch lane. **Not installed today** — implementation needs an
  owner-approved dependency (transformers/onnx + weights).
- **8 GB verdict:** FEASIBLE on CPU lane; GPU optional.

### 4.2 `depth` — per-frame depth maps

- **Contract:** input = source video; output = per-frame depth PNG
  sequence (16-bit or normalized 8-bit) at source fps.
- **Consumers:** T-VID-10 (re-shoot geometry), T-VID-08/09 optionally
  (depth-aware compositing).
- **Candidates:** Depth Anything V2 (Small/Base, <1 GB) via
  transformers or ONNX — same CPU-lane argument as segment; ~0.5-1
  s/frame on this CPU. **Not installed today.**
- **8 GB verdict:** FEASIBLE on CPU lane.

### 4.3 `propagate` — edit carries through the shot

- **Contract:** input = source video metadata (fps, frame count,
  duration) + an edited **first frame** (PNG, produced by whatever
  edit the transform defines — painted, swapped, relit) + optional
  edited last frame + optional segment mask; output = transformed mp4.
- **Mechanism — the key design decision:** propagation is **I2V with
  a constrained start frame**, not video inpainting. The edited frame
  uploads via `upload_image` (existing), the clip regenerates through
  `_build_ltx_i2v_workflow` (fast lane) or `_build_wan_i2v_workflow`
  (quality lane) with the source's fps/duration mapped onto
  `num_frames`/`fps`. True per-frame video inpainting (E2FGVI,
  ProPainter) is rejected — see §5.
- **Honest limit:** I2V conditioning covers the first frame (and last,
  where the builder supports it); the model's motion prior supplies
  the rest. Edits must survive re-generation — that is the transform's
  acceptance test, not a guarantee of the mechanism.
- **8 GB verdict:** FEASIBLE — both builders already run on this card
  within the VRAM doc's clamps (LTX 896×512/25f/cfg 1.0 distilled;
  Wan GGUF 960×540/40+ steps).

### 4.4 `reshoot` — new camera path over existing content

- **Contract:** input = source video + depth maps (§4.2) + authored
  camera path; output = rebuilt-view mp4.
- **Mechanism:** two lanes, stated honestly:
  - **v0 (prompt lane):** extract a sharp start frame, express the new
    camera move through the existing `camera_motion` vocabulary (or
    the T-VID-11 rig registry when it lands), regenerate via the I2V
    builders. Depth maps serve as a *validation/preview* artifact
    (does the new path stay inside the scene's real geometry envelope)
    rather than model conditioning.
  - **Image-space conditioned lane (feasible today):** SD1.5
    ControlNet weights for depth/openpose/canny/lineart/scribble are
    **on disk** (`ComfyUI/models/controlnet/`) and ComfyUI's native
    `ControlNetLoader`/`ControlNetApply` nodes are built in — what is
    missing is only the *preprocessing* side, which §4.2's depth
    stage and the pose-pass contract (verdicts doc §5) already
    produce as images. So a still-frame rebuild conditioned on
    estimated depth or pose is buildable now; per-frame video
    conditioning is not.
  - **Deferred (video-conditioned lane):** depth/pose-conditioned
    *video* rebuild needs a video model that accepts control input
    (Wan VACE-class or LTX conditioning) — **not on disk**
    (`diffusion_models/` holds ltxv-2b distilled, wan2.1_t2v_1.3B,
    Wan2.2-TI2V-5B GGUF; no VACE weights). Named, not designed.
- **8 GB verdict:** v0 FEASIBLE (same I2V builders); image-space
  ControlNet lane FEASIBLE (SD1.5 + on-disk weights + backend-produced
  control images); video-conditioned lane NOT FEASIBLE today.

## 5. VRAM feasibility pass (8 GB, per `video-generation-vram-2026.md`)

Stages run sequentially under one work lane; only one ComfyUI model
is resident at a time and the VRAM manager already offloads between
job types. Analysis stages are CPU-side by design.

| Stage / model | VRAM need | On disk? | Verdict |
|---------------|-----------|----------|---------|
| `segment` — SAM2 small | ~1-2 GB (CPU ok) | No (new dep) | FEASIBLE, owner-gated dep |
| `depth` — Depth Anything V2 S/B | <1 GB (CPU ok) | No (new dep) | FEASIBLE, owner-gated dep |
| `propagate` — LTX-Video I2V | 6-8 GB FP8+tiling | **Yes** (ComfyUI-LTX-Video) | FEASIBLE — primary lane |
| `propagate` — Wan2.2-TI2V-5B GGUF | ~6 GB | **Yes** (Q4_K_M gguf + vae + umt5) | FEASIBLE — quality lane, slower |
| `propagate` — AnimateDiff | ~6 GB | Yes | FEASIBLE for stylized/loop transforms only |
| True V2V — Wan VACE / LTX-V2V / CogVideoX-V2V | unverified, likely 8-14 GB | **No** | NOT v0 — revisit if a quantized VACE lands |
| Video inpainting — E2FGVI / ProPainter | heavy; CPU fallback unusable at clip lengths | No | REJECTED — propagation covers the use case |
| Depth/pose-conditioned rebuild — ControlNet aux + video model | image-space ControlNet weights ARE on disk (SD1.5 depth/openpose/canny/lineart/scribble); video-model control input is not | Partial — image lane feasible, video lane deferred (§4.4) |

Envelope: transforms are specced against **short clips** (≤ ~8 s,
source-fps preserved, output ≤ 960×540 for Wan / 896×512 for LTX).
Longer sources are trimmed or tiled at the route layer — a
`max_source_seconds` per transform, validated at enqueue.

## 6. Transform registry

`app/services/video_transforms/__init__.py` (new, implementation
gated):

```python
TRANSFORMS = {
    "paint-propagate": {
        "stages": ["propagate"],           # T-VID-09 fills params
        "params_model": PaintPropagateParams,
        "max_source_seconds": 8.0,
    },
    # "swap": {...},        # T-VID-08
    # "reshoot": {...},     # T-VID-10 — stages: ["depth", "reshoot"]
}
```

Each dependent item contributes one registry entry + its spec section
below; the route, job type, stages, and estimator are already done by
this design. The registry ships **empty** in v0 — an unknown transform
id is a 422, which is the correct failure until T-VID-08/09/10 land.

## 7. Character/object swap spec (T-VID-08 — Openjutsu pattern)

**Goal:** swap a character, outfit, or object inside existing footage
while preserving the original motion and camera work.

### 7.1 Candidate chains and 8 GB verdicts

Three lanes, in preference order:

| Lane | Mechanism | 8 GB verdict |
|------|-----------|--------------|
| **A — asset composite** | `segment` → render replacement asset through the owned three.js pipeline from a matched camera path → composite over masked source (ffmpeg blend + boundary color match) | **FEASIBLE, preferred for CG swaps.** No video model in the loop; identity is deterministic because the asset is versioned ([[browser-character-pipeline-verdicts-2026]] HouseRig_v1). Cost = segmentation (CPU) + a light WebGL render + ffmpeg. Background is *untouched by construction* — the strongest possible preservation guarantee. |
| **B — generative propagation** | edit frame 1 (swap subject via image model) → `propagate` via LTX/Wan I2V builders | **FEASIBLE for short clips, with drift limits.** Whole-frame regeneration means background/camera are re-synthesized, not preserved — acceptable only where shot regeneration is tolerable. |
| **C — masked per-frame rebuild** | per-frame background inpaint + per-frame subject render/generation → composite | **DEFERRED.** Temporal flicker is the known failure; SD1.5 inpaint fits VRAM but consistency needs ControlNet video conditioning that isn't on disk. Revisit if Lane A/B prove demand. |
| True V2V swap (Wan VACE replace / MiniMax-Genjutsu-class) | end-to-end video model | **NOT FEASIBLE today** — no VACE weights on disk (§5). |

Lane A depends on the bones render lane (T-VID-17, still `todo`) for
camera-matched rendering; until it lands, Lane A v0 accepts only
**static-camera or explicitly parameterized camera** shots — the
transform params carry the camera path, not a guess.

### 7.2 Input contract

```jsonc
{
  "source":   { /* route §2.2 — job_output | library | path */ },
  "transform": "swap",
  "params": {
    "target": {
      "kind": "asset | image | description",
      "ref":  "<media-library asset id | image path | prompt text>"
    },
    "mask": {
      "kind": "auto | provided | first_frame_prompt",
      "ref":  "<optional mask sequence path | point/box prompt>"
    },
    "lane": "auto | asset_composite | generative",
    "preserve": { "camera": true, "motion": true, "background": true }
  }
}
```

- `target.kind=asset` → Lane A (3D asset id from the media library,
  resolved to mesh+material refs the renderer consumes).
- `target.kind=image|description` → Lane B (reference image uploads
  as the I2V/edit conditioning; description becomes prompt text).
- `mask.kind=auto` runs the `segment` stage (§4.1); `provided`
  accepts a mask image sequence (the painted-mask input shared with
  T-VID-09 — the *format* is common, the paint UI stays out of scope
  per that item); `first_frame_prompt` is a point/box hint to the
  segment stage.
- `lane=auto` resolves: asset target → A; image/description → B.

### 7.3 Failure surface (design around these)

- **Identity drift across frames** (Lane B): whole-frame regen
  re-rolls everything. Mitigations: clip-length cap (route
  `max_source_seconds`), edited-first-frame + last-frame constraint
  where the builder supports it, and the acceptance metric below
  rather than a promise of stability.
- **Mask edge artifacts** (Lane A): per-frame mask noise → temporal
  median filter over ±2 frames + edge feather (5-10 px); boundary
  color mismatch → per-frame boundary color transfer sampled from
  the ring just outside the mask.
- **Motion faster than the tracker:** `segment` chunks at detected
  scene cuts (ffmpeg scene-score or histogram diff — CPU-cheap)
  rather than letting SAM2 memory smear across a cut; inside a shot,
  fast motion degrades mask quality gracefully (erode + re-dilate
  fallback).
- **Camera mismatch** (Lane A): static-camera v0 only until T-VID-17
  supplies matched paths; a moving-camera request with
  `preserve.camera=true` is rejected at validation, not silently
  approximated.

### 7.4 Checkable "good"

- **Same camera path:** outside the subject mask, Lane A is
  bit-identical to source by construction; Lane B is judged by
  background structural similarity (SSIM ≥ 0.80 at sampled frames).
- **Same motion timing:** optical-flow magnitude correlation between
  source and output inside the subject region ≥ 0.7 at sampled
  frames; beat-section cuts land on the same frames.
- **Swapped element consistent at section boundaries:** no visible
  pop at shot boundaries — mask re-acquired per shot, identity
  reference re-asserted at each chunk start.

Registry entry: `"swap"`, stages `["segment", <lane>]`, params model
`SwapParams`, `max_source_seconds: 8.0` (Lane B) / `30.0` (Lane A —
no regeneration cost per frame beyond the render).

## 8. First-frame paint → propagation spec (T-VID-09 — Paint a Plate pattern)

**Goal:** the user paints the change onto the first frame (remove an
object, relight a region, add an effect) and a propagation workflow
carries it through the shot — the fix-a-panel tool the storyboard
pipeline lacks. Paint UI is explicitly out of scope; this spec
covers the pipeline contract only.

### 8.1 Pipeline contract

```
source video ──┬──> probe (fps, frames, duration) ──> clip window
               │
edited frame 1 ─┤   (PNG, produced by whatever edit the caller made —
(+ optional    │    painted, inpainted, graded, or composited offline)
 mask, last    │
 frame)        ─┘
               ▼
        propagate stage (§4.3 — I2V with constrained start frame)
               ▼
        output/video/transform_<ts>_<id>.mp4 + sidecar
```

Over the T-VID-07 route this is `transform: "paint-propagate"`,
stages `["propagate"]` (+ `segment` only when the caller supplies a
box/point hint instead of a full mask). Everything else — job type,
VRAM lane, estimator, output registration — is already the route's.

### 8.2 Edit classes v0 supports / doesn't

| Class | v0 mechanism | Verdict |
|-------|--------------|---------|
| **Removal** | frame-1 inpaint: ffmpeg `delogo` for flat backgrounds (CPU, free), SD1.5 inpaint workflow for textured ones (on-disk checkpoint, ~6 GB) | SUPPORTED |
| **Relight / grade** | frame-1 color adjustment (ffmpeg `eq`/`curves` or image ops) — global looks propagate naturally through I2V | SUPPORTED |
| **Additive effect** | overlay PNG composited onto frame 1 (ffmpeg `overlay`) — smoke/fire/text-free elements | SUPPORTED |
| Object replacement | that's T-VID-08's swap, not an edit | EXCLUDED |
| Per-frame / temporal edits | needs true V2V conditioning — not on disk | EXCLUDED v0 |
| Crisp text/logo across whole shot | regen softens edges; acceptable only as additive overlay on frame 1 | PARTIAL — flagged in params |

### 8.3 Propagation candidates and 8 GB verdicts

| Candidate | Verdict |
|-----------|---------|
| LTX-Video I2V (`_build_ltx_i2v_workflow`, ltxv-2b distilled fp8 on disk) | **PRIMARY** — 6-8 GB, 896×512, cfg 1.0 distilled, 25f@12fps; fast iteration |
| Wan2.2-TI2V-5B GGUF I2V (`_build_wan_i2v_workflow`) | **QUALITY** — ~6 GB, 960×540, ≥40 steps; 2-10 min/clip |
| AnimateDiff I2V | stylistic/loop transforms only — 512×512, 16f cap |
| Per-frame propagation / VACE-class V2V | not on disk — deferred (§5) |

### 8.4 Acceptance shape (with an honest correction)

The task text says "unedited regions unchanged (frame-diff outside
the mask ≈ 0)". **That is physically impossible under I2V
propagation** — every output pixel is regenerated; there is no
mechanism that copies source pixels through. The measurable proxy
this spec adopts instead:

- **Edit present and stable:** the edited attribute (absence of the
  removed object, the grade shift, the overlay element) is detectable
  at ≥ 80% of sampled output frames by the check method named per
  edit class (region diff for removal, channel stats for grade,
  template match for overlay).
- **Unedited regions structurally preserved:** outside the edit
  region, SSIM ≥ 0.80 and optical-flow motion correlation ≥ 0.7 vs
  source at ≥ 3 sampled frames (same thresholds as §7.4 — one
  preservation metric across the whole route).
- **Temporal stability:** no single-frame pop inside the edit region
  (frame-to-frame diff inside region below the shot's median motion
  level).

If a future implementation lands a true V2V lane that *does* copy
source pixels, the acceptance tightens to the original frame-diff
form — the spec keeps both statements so the upgrade path is visible.

Registry entry: `"paint-propagate"`, stages `["propagate"]`, params
`PaintPropagateParams { edited_frame_path, mask_path?, last_frame_path?,
edit_class, propagation: "ltx" | "wan" }`, `max_source_seconds: 8.0`.

## 9. Re-shoot spec (T-VID-10 — ReAngle pattern)

**Goal:** estimate the shot's depth, author a new 3D camera path,
rebuild the view — new coverage from a single rendered or recorded
take.

### 9.1 Stage and model verdicts

| Piece | Candidate | 8 GB verdict |
|-------|-----------|--------------|
| Depth estimation | §4.2 `depth` stage — Depth Anything V2 Small/Base, CPU lane, <1 GB | FEASIBLE (owner-gated dep) |
| Camera-path authoring | v0: existing `camera_motion` enum (8 values, `models/generation.py:162`) **plus** free-text path in the transform params ("slow 30° orbit left, hold 1 s"). T-VID-11's rig registry replaces the free text when it lands — v0 does not block on it | FEASIBLE now |
| View rebuild | I2V builders with the new-angle direction in prompt + extracted start frame | FEASIBLE (§4.3) |
| Image-space depth conditioning | SD1.5 depth ControlNet **on disk** + backend-produced depth maps → hero-frame rebuilds at arbitrary angles | FEASIBLE for stills; per-frame video conditioning deferred (no VACE-class weights) |
| True geometry rebuild (NeRF/Gaussian/splat from depth) | research-grade, CPU-bound, hours per shot | REJECTED for v0 |

### 9.2 Camera-path input — which vocabulary

**v0 uses prompt-level paths, not the rig registry.** Rationale: the
registry (T-VID-11) is itself `todo` and gated; blocking re-shoot on
it inverts the dependency order. The transform params carry
`camera_path: { kind: "enum" | "description", value: ... }` —
`enum` maps onto the existing 8 `camera_motion` values losslessly,
`description` is prompt text the implementation may later parse into
registry ids. When T-VID-11 lands, `description` values migrate to
rig ids without a contract change.

### 9.3 Move envelope (the known limit, stated up front)

I2V models re-imagine the scene behind the new viewpoint; they do
not hold geometry. The spec's expected-degradation envelope —
implementation must mark output `degraded` beyond it rather than
silently shipping mush:

| Move | Envelope | Beyond → expected failure |
|------|----------|---------------------------|
| Orbit / pan angle | ≤ ~45° continuous per shot | background geometry invents detail; identity drift |
| Translation (dolly/truck) | ≤ ~20% of frame width equivalent | parallax errors, edge artifacts |
| Compound moves (orbit+dolly+crane in one shot) | NOT supported v0 | guaranteed degradation — split into shots |
| Shot length under move | ≤ `max_source_seconds` (8 s) | drift accumulates; cut and re-derive |

### 9.4 Acceptance shape

- **Framing matches authored path:** at ≥ 3 sampled timestamps
  spanning the move, the rebuilt view's dominant camera direction
  matches the authored path (manual review checklist + optional
  pose-estimate sanity check when the pose-pass tooling lands).
- **Subject identity/motion preserved:** subject-region perceptual
  similarity vs source ≥ the §7.4/§8.4 thresholds; motion timing
  correlation ≥ 0.7.
- **Honest residual:** re-shoot output is a *reinterpretation*, not
  footage — spec states this in the job result so downstream
  (storyboard assembly) can weight it accordingly.

Registry entry: `"reshoot"`, stages `["depth", "reshoot"]`, params
`ReshootParams { camera_path, rebuild: "ltx" | "wan", depth_condition:
"none" | "hero_frames" }`, `max_source_seconds: 8.0`.

## 10. What implementation needs (owner's word required)

1. `JobType.VIDEO_TRANSFORM` + `VideoTransformHandler` + processor
   registration + VRAM pricing row.
2. `POST /api/video/transform` + `GET /api/video/transform/workflows`
   in `video.py`.
3. `app/services/video_transforms/` registry + stage runners.
4. New `_build_*` adapter methods only where a stage's workflow shape
   doesn't already exist (propagate reuses the I2V builders).
5. Owner-approved dependencies for `segment`/`depth` (SAM2,
   Depth-Anything weights) — the only new-model installs this design
   implies.
6. No frontend work in v0; the route is API-complete and drivable by
   agents over MCP/HTTP, consistent with the app-layer pattern noted
   in the Higgsfield doc.

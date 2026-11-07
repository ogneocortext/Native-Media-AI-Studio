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
    rather than model conditioning — no depth-ControlNet exists on
    this install.
  - **Deferred (conditioned lane):** depth/pose-conditioned view
    rebuild needs ControlNet-aux-style nodes that are **not
    installed**, plus a video model that accepts them. Named, not
    designed — it spins out only if v0 proves the demand.
- **8 GB verdict:** v0 FEASIBLE (same I2V builders); conditioned lane
  NOT FEASIBLE today (missing nodes + unverified models).

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
| Depth/pose-conditioned rebuild — ControlNet aux + video model | needs uninstalled nodes + unverified models | No | DEFERRED (§4.4) |

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

## 7. Spec sections (reserved for T-VID-08/09/10)

- §8 — Character/object swap spec (T-VID-08)
- §9 — First-frame paint → propagation spec (T-VID-09)
- §10 — Re-shoot spec (T-VID-10)

## 8. What implementation needs (owner's word required)

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

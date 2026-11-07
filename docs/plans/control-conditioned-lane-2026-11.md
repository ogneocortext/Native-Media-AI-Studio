# Control-Conditioned Generation Lane — Design 2026-11

**Status:** Proposed
**Area:** Video Pipeline & Storyboard (T-VID-14)
**Source:** `docs/plans/frame-package-contract-2026-11.md` (inputs);
`docs/knowledge-library/3d-bones-ai-skin-pipeline-2026.md` §5 Gap 2;
`docs/knowledge-library/browser-character-pipeline-verdicts-2026.md` §5;
`config/hardware-profile.json` (lanes/VRAM);
`packages/backend/app/adapters/comfyui.py`, `config/comfyui/workflows/`
**Decides:** none — design only; implementation waits on the owner's word.
**Last Updated:** 2026-11-07

## 1. Scope and non-goals

Route B of the frame-package pipeline: consume a `frame-package/v1`
(T-VID-13) and paint appearance under geometric control — depth,
pose, segmentation conditioning plus AnimateDiff-class temporal
modeling — on the profile's blessed **SD 1.5 tier**. Output is skinned
frames registered as a normal job output.

Non-goals: no code, no workflow JSON authored to disk, no renders, no
new model downloads, no IP-Adapter wiring (T-VID-16 owns the identity
layer), no SDXL/Flux-class stacks (out on 8 GB per the bones doc).

## 2. Model inventory — verified on disk 2026-11-07

The integrations catalog (`integrations_music_video.py:565`) declares
"Advanced AnimateDiff with controlnet and IP-adapter" — this section
replaces the claim with what is actually present:

| Need | On disk | Verdict |
|------|---------|---------|
| SD 1.5 base | `models/checkpoints/v1-5-pruned-emaonly.safetensors` (4.07 GB) | ✅ blessed tier |
| Motion module | `models/animatediff_models/mm_sd_v15_v2.ckpt` (1.73 GB) + `mm_sd15_v3.safetensors` (798 MB) | ✅ v2 is the catalog's model — note **`.ckpt`, not `.safetensors`** as the catalog string claims; the ADE loader accepts both |
| Depth ControlNet | `models/controlnet/control_v11f1p_sd15_depth_fp16.safetensors` (689 MB) | ✅ fp16, SD1.5-native |
| OpenPose ControlNet | `models/controlnet/control_v11p_sd15_openpose_fp16.safetensors` (689 MB) | ✅ fp16, SD1.5-native |
| Segmentation ControlNet | **none** | ❌ no `control_v11*_seg` on disk |
| Normal-map ControlNet | **none** | ❌ normals pass (T-VID-13 §3.3) has **no consumer** in v1 — reserved for a future normal/controlnet or relight lane |
| Inpaint model | none dedicated, but core `VAEEncodeForInpaint`/`InpaintModelConditioning` exist | ⚠️ mask path available without new weights |
| `diffusion_pytorch_model.safetensors` (1.38 GB, controlnet dir) | **unidentified filename** | ⚠️ do not wire blind — identify before use (likely a renamed controlnet; verify `class_type`/metadata before referencing) |
| IP-Adapter | none observed | ❌ T-VID-16's problem, not this lane's |
| SDXL (`sd_xl_base_1.0`, 6.6 GB) | present | ⛔ out of scope — 8 GB cannot hold SDXL + control stack + motion module |

**VRAM math (fp16, 768×768):** SD1.5 ≈ 2 GB + motion module ≈ 0.9 GB +
2 ControlNets ≈ 1.4 GB + VAE/CLIP ≈ 0.8 GB + activation ≈ 1–1.5 GB ≈
**5.5–6.5 GB peak** — fits 8 GB only with Ollama offloaded, which the
VRAM manager already does before ComfyUI loads. No exception requests;
this is the profile's stated coexistence rule.

## 3. Workflow graph — node classes named

One ComfyUI graph per scene skin, stored as
`config/comfyui/workflows/scene_skin.json` (implementation item). The
graph is parameterized by the frame-package manifest, not hardcoded.

### 3.1 Input side (frame package → conditioning)

| Node class | Role |
|------------|------|
| `VHS_LoadImagePath` (VideoHelperSuite, installed) | Load `depth/f*.png` and `pose/f*.png` sequences as frame-aligned batches; frame indices come from the manifest, not directory order |
| `ImageScale` | Control images to latent resolution (768×768 → latent 96×96); aspect-preserving per manifest `scale` |

Frame alignment is contractual: the loader must consume pass
directories by manifest frame index. A missing frame is a hard error
(§7), never a skipped frame — a hole in conditioning produces a hole
in the skin that no downstream check would attribute correctly.

### 3.2 Temporal + base model

| Node class | Role |
|------------|------|
| `CheckpointLoaderSimple` | `v1-5-pruned-emaonly.safetensors` |
| `ADE_LoadAnimateDiffModel` | `mm_sd_v15_v2.ckpt` (motion module) |
| `ADE_ApplyAnimateDiffModel` | Inject motion module into the UNet |
| `ADE_AnimateDiffUniformContextOptions` | Context window: **16 frames, overlap 4** (ADE default sane point for 24 fps content; param in §5) |
| `ADE_AnimateDiffKeyframe` | Motion context anchor at batch start |
| `ADE_AnimateDiffSamplingSettings` | Evolved sampling path (fewer steps for same quality) |

### 3.3 Control conditioning

| Node class | Role | Weight (initial) |
|------------|------|------------------|
| `ControlNetLoader` ×2 | depth fp16 + openpose fp16 | — |
| `ControlNetApplyAdvanced` (depth) | `positive`/`negative` conditioning from depth pass | **0.75** start |
| `ControlNetApplyAdvanced` (openpose) | same, from pose pass (skipped entirely when package has no `pose/` dir — conditional pass per manifest) | **0.85** start |
| `CLIPTextEncode` ×2 | pos/neg prompts from job params | — |
| `ADE_ConditioningCombine` / `ADE_PairedConditioningCombine` | Merge control + text conditioning in ADE's expected order | — |

**Segmentation's v1 role is not a ControlNet input** (none exists).
It feeds two honest uses: (a) optional post-composite identity mask —
skinned output is composited back over beauty/background using the
palette, preserving untouched regions pixel-exact; (b) v1.1 candidate —
seg-boundary edge extraction feeding the installed `lineart` ControlNet.
Neither is required for the first skin; both are named so the contract
isn't silently narrowed.

### 3.4 Sampling + output

| Node class | Role |
|------------|------|
| `KSampler` | 20 steps, `euler_ancestral` or `euler`, CFG 7.5, seed from param contract, fp16 |
| `VAEDecode` | latents → RGB frames |
| `VHS_VideoCombine` | PNG sequence or H.264 proxy out; master frames stay PNG to match the package convention |

## 4. Lane assignment

- **Job type:** new `SCENE_SKIN` queue type (sibling to `REMOTION_RENDER`,
  not `video_transform` — different substrate: frame package in,
  conditioned frames out; the V2V route's processor registry does not
  apply).
- **GPU lane:** ComfyUI submission via the existing adapter's
  `_submit_prompt` (arbitrary graphs already supported); VRAM manager
  reserves the §2 footprint and offloads Ollama first — unchanged
  coexistence rules, no new exception path.
- **CPU lane:** batch conditioning (image load/scale) is light; the
  heavy CPU risk is unchanged — two uncapped torch jobs never co-run
  (`hardware-profile.json` `never_together` already covers it).
- **Resolution:** 768×768 fp16 default (bones doc baseline; SD1.5
  native is 512 — 768 buys composition headroom at ~1.4× latent cost,
  still inside the VRAM math above). Aspect comes from the package's
  `width/height`, letterboxed to the multiple-of-64 grid, never cropped.

## 5. Seed/parameter contract (reproducibility)

Same frame package + same params ⇒ same skin. The job's parameter set
is recorded verbatim in the job result:

```json
{
  "package_manifest_sha256": "<sha256 of manifest.json>",
  "passes_used": ["depth", "pose", "segmentation"],
  "seed": 0,
  "steps": 20, "cfg": 7.5, "sampler": "euler_ancestral",
  "resolution": [768, 768],
  "control_weights": { "depth": 0.75, "openpose": 0.85 },
  "context_frames": 16, "context_overlap": 4,
  "pos_prompt": "...", "neg_prompt": "...",
  "model_files": { "checkpoint": "v1-5-pruned-emaonly.safetensors",
                   "motion_module": "mm_sd_v15_v2.ckpt",
                   "controlnets": ["control_v11f1p_sd15_depth_fp16.safetensors",
                                   "control_v11p_sd15_openpose_fp16.safetensors"] }
}
```

- `package_manifest_sha256` binds the run to exact package bytes —
  manifest plus per-pass checksums if T-VID-13's validator adds them;
  until then the manifest hash + `spec_hash8` is the identity.
- Any model-file substitution changes the output and must bump the
  recorded `model_files` block — silent checkpoint drift is a
  reproducibility violation the contract exists to prevent.
- Frame-exactness: output frame `f` corresponds to package frame `f`;
  the lane never retimes (audio sync stays upstream, in the spec).

## 6. Estimator integration

`generation_estimator.py` gains a `SCENE_SKIN` row: local-only cost
(`local_compute_cost_per_second` path, no cloud price — T-VID-04's
opt-in rule unchanged), time estimate = `frames × steps × per-step
cost` calibrated on first real run (mark estimate `calibration: "first-run"`
until measured, same honesty pattern as existing estimators).

## 7. Failure vocabulary

The lane reports structured failures, not stack traces:

| Code | Meaning |
|------|---------|
| `PACKAGE_NOT_FOUND` | path/id doesn't resolve to a `frame-package/v1` manifest |
| `PACKAGE_CONTRACT_UNKNOWN` | manifest `contract` ≠ `frame-package/v1` (major-version mismatch) |
| `PACKAGE_MISSING_PASS` | spec requested a pass the package lacks (§10 validator check 2, surfaced early) |
| `PACKAGE_FRAME_GAP` | pass dir frame count ≠ manifest `frame_count` |
| `PACKAGE_DIM_MISMATCH` | control image dims ≠ manifest `width/height × scale` |
| `MODEL_NOT_FOUND` | names the exact expected file (e.g. `mm_sd_v15_v2.ckpt`) |
| `VRAM_PRESSURE` | existing manager refusal, unchanged semantics |
| `CONDITIONING_EMPTY` | pose pass absent and job params required it — never silently degrade to text-only |

## 8. Non-goals (restated)

No IP-Adapter/identity conditioning (T-VID-16), no normal-map consumer
(no model on disk — pass stays reserved), no segmentation ControlNet
(none exists — §3.3 names the two honest v1 uses instead), no
multi-pass beyond depth+pose, no training/LoRA fitting, no cloud
execution or pricing assumptions.

## 9. What implementation spins out (all owner-gated)

1. `config/comfyui/workflows/scene_skin.json` — the §3 graph.
2. `SCENE_SKIN` job type + handler + estimator row + VRAM reservation.
3. Frame-package loader/validator shared with T-VID-13's §10 checks.
4. First calibration run on a golden scene (needs T-VID-05 spec +
   T-VID-17 capture — both still design-stage).

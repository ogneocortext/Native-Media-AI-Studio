# 2D Mouth-Shape Lip-Sync (Path C) — Reusable Recipe

> **Status:** proven on the Maya Gemini avatar, 2026-11-10. Produces
> `maya_avatar_v3_mouth_shapes_v4_720p.mp4` — owner motion verdict pending;
> until then this is the candidate standard, not yet ratified.
> Local-only: Rhubarb (CPU) + ComfyUI SDXL inpainting. No MuseTalk, no
> third-party APIs.

Use this instead of MuseTalk when the avatar is an **illustration / anime
portrait**. MuseTalk's 256 px photoreal prior destroys drawn lip line work
(see `knowledge-library/musetalk-quality-and-stylized-lip-sync-options-2026.md`).
This pipeline never generates the whole face — it swaps a small set of
mouth-shape patches timed by phoneme cues, so everything outside the mouth
stays pixel-identical to the source art.

## Pipeline

```
audio ──► Rhubarb (CPU) ──► mouth cues JSON ──► per-frame shape letter
still ──► DWpose landmarks ──► mouth patch coords + inner-lip polygon
still ──► inpaint mask ──► ComfyUI (Animagine XL + lineart ControlNet)
                             ──► 3 mouth PNGs (half/open/pucker)
per-frame letter + mouth PNGs ──► compositor (inner-lip constraint)
                             ──► ffmpeg mux (compat encode) ──► MP4
```

## Prerequisites (all local, already on this machine)

| Piece | Location / version |
|---|---|
| Rhubarb Lip Sync | `tools/rhubarb/Rhubarb-Lip-Sync-1.14.0-Windows/` (MIT, CPU-only) |
| ComfyUI | `D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI`, port 8188, env `D:\conda-envs\comfyui-cuda` |
| Checkpoint | `models/checkpoints/animagine-xl-4.0.safetensors` (6.5 GB, SDXL anime) |
| ControlNet | `models/controlnet/noob-sdxl-controlnet-lineart_anime_fp16.safetensors` (2.33 GB, fp16 — the ONLY download this recipe needed) |
| Scripts | `docs/scratch/` (gitignored — see "One-off steps" below) |

## Step 1 — Timing cues (Rhubarb)

Convert the vocal to WAV, then:

```
tools\rhubarb\Rhubarb-Lip-Sync-1.14.0-Windows\rhubarb.exe -f json --fps 25 voice.wav -o mouth_cues.json
```

Cue → shape mapping used (edit `letter_at` in the compositor for other
vocabularies):

| Rhubarb letters | Shape mode | Asset |
|---|---|---|
| `X` / silence | `closed` | still's own mouth (identity) |
| `B E G` | `half` | generated half-open mouth |
| `C D H` | `open` | generated open mouth |
| `F` | `pucker` | generated pucker mouth |

Reference run distribution (8.28 s line): half 96, closed 61, open 38,
pucker 12 frames @ 25 fps.

## Step 2 — Mouth landmarks + inpaint mask

- DWpose 68-point landmarks on the still; lip points are indices 48–67
  (outer 48–59, inner 60–67). For the Maya avatar they are hardcoded in
  `lipsync_shapes_v1.py` (`LM` array) — **re-extract for any new avatar**.
- Inpaint mask = inner-lip polygon dilated ~5 px, Gaussian feather σ2.5,
  saved as RGBA PNG (`alpha` = mask). Reference: `make_inpaint_mask_tight.py`.

## Step 3 — Generate mouth variants (ComfyUI)

`docs/scratch/comfy_mouth_gen.py <half|open|pucker>` uploads the masked
avatar once and submits this API graph (Animagine XL, fp16 on the 1070 Ti):

- `CheckpointLoaderSimple` → animagine-xl-4.0
- `LoadImage` (masked avatar) feeds both `VAEEncodeForInpaint`
  (`grow_mask_by: 1`) and the ControlNet path
- `InpaintModelConditioning` (`noise_mask: true`)
- **`Canny` node on the avatar RGB** (low 0.3 / high 0.7) → line-art edges
- **`ControlNetLoader`** → `noob-sdxl-controlnet-lineart_anime_fp16.safetensors`
- **`ControlNetApplyAdvanced`**: strength **0.7**, `start_percent` 0.0,
  `end_percent` **0.7** — applied to positive AND negative conditioning,
  after inpaint conditioning, before `KSampler`
- `KSampler`: `euler_ancestral`, 30 steps, CFG 6.0, denoise 0.95,
  seeds 101/202/303 per variant
- Prompts: "slightly open mouth, upper teeth visible" / "wide open mouth,
  dark mouth interior" / "pursed lips, kiss pucker" + "anime style, clean
  lineart, cel shading"; negative excludes photorealism/deformed anatomy

Why the ControlNet matters: plain inpainting produced amorphous mouths that
ignored the illustration's line work (vision ~3/10). Anchoring generation to
the avatar's own edges raised the mouth assets to ~9–9.5/10 on the QA sheet
(`output/qa/lipsync-avatar-v3/comfy_mouths_cn_sheet.png`, old-vs-new columns).

## Step 4 — Composite (`docs/scratch/lipsync_shapes_v1.py`)

- Paste patch `PX,PY,PW,PH` around the mouth (Maya: 625,462,125×95 —
  avatar-specific, see One-offs)
- **Inner-lip constraint (v3 fix):** generated content is masked to the
  INNER lip polygon (feathered σ2.0) composited over the still patch — the
  original outer lip contour and mouth width stay pixel-identical; only the
  interior changes. This fixed the "mouth too wide / pasted-on" defect.
- `closed` = still patch verbatim; `XFADE = 2` frames crossfade on shape
  changes; everything outside the patch is untouched.
- ffmpeg mux: `-c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k
  -ar 44100 -ac 2 -color_primaries bt709 -color_trc bt709
  -colorspace bt709 -movflags +faststart` — the compatibility settings from
  `knowledge-library/mp4-encoding-for-maximum-player-compatibility-2026.md`
  (24 kHz mono AAC made WMP refuse the file; do not regress this).

## Step 5 — Optional 720p deliverable

Source is square; for 16:9 players letterbox, don't crop:

```
ffmpeg -i in.mp4 -vf "scale=-2:720,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black" \
  -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a copy -movflags +faststart out.mp4
```

## QA evidence (v4)

- `output/qa/lipsync-avatar-v3/comfy_mouths_cn_sheet.png` — old vs
  ControlNet-guided mouth variants (vision: 9–9.5/10 vs ~3/10 before)
- `output/qa/lipsync-avatar-v3/v4_mouth_sheet.png` — 6 mouth crops from the
  rendered video (vision: integrated line art, consistent color, no seams)
- Deliverables: `output/video/maya_avatar_v3_mouth_shapes_v4.mp4` (1024²)
  and `..._v4_720p.mp4` (1280×720 letterboxed)

## One-off steps / hardcoded paths (not yet generalized)

- `lipsync_shapes_v1.py`: `STILL`, `AUDIO`, `CUES`, `OUT` paths; `LM`
  landmark array and `PX,PY,PW,PH` patch rect are Maya-avatar-specific —
  new avatars need fresh DWpose landmarks + a new patch rect.
- `comfy_mouth_gen.py`: `IMG`/`OUTDIR` under `output/qa/lipsync-avatar-v3/`,
  `GEN_FILES` suffix `_00004_` pins the ControlNet generation batch.
- `v4_qa_sheet.py`: crop rect `430,400–660,620` and timestamps are
  avatar/timeline-specific.
- Rhubarb cue→shape letter map is English-speech tuned; verify onset
  alignment per voice.
- Scripts live in gitignored `docs/scratch/` — if this recipe is ratified,
  promote the three scripts to `tools/` with avatar params externalized.

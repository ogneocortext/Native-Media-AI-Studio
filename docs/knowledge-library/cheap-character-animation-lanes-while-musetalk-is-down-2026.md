---
tags:
  - production
aliases:
  - Cheap Character Animation Lanes While MuseTalk Is Down
cssclasses:
  - production-guide
date: 2026-11-10
type: synthesis
---

> [!info] Purpose
> Prepared 2026-11-10 (Maya, planner lane) while Devin + Nemotron debug the MuseTalk service and the rig GPU sits at ~6/8 GB used by their ComfyUI work. Nothing here runs until the GPU frees up; this packet is written so the owner can pull it and execute in order. Companion research: [[musetalk-quality-and-stylized-lip-sync-options-2026]] (lip-sync paths B/C) and [[anime-checkpoint-selection-for-8gb-vram-inpainting-2026]] (checkpoint picks for this card).

---

## Overview

MuseTalk is the studio's only audio-driven lip-sync path, and it is down for debugging (post-reboot service failures, face-quality work). The character it serves -- Maya -- now has a finished design kit (avatar cut, chibi sticker set), so the gap is purely *motion*. Four lanes can animate her at zero or near-zero marginal cost, in the order they should be attempted:

| Lane | What it gives | Cost | Rig GPU |
|---|---|---|---|
| A. LivePortrait in ComfyUI | Head motion, expressions, blinks driven by a performance video | Free, local | ~2-3 GB at 512 crop |
| B. Wan debug checklist | Unlocks the generative video lane that already half-exists | Free, local | Varies |
| C. Blender 2.5D cutout rig | Poseable, reusable character rig; renders in seconds | Free, local | CPU/Eevee, negligible |
| D. Zero-GPU fallbacks | ChatGPT GIFs; ffmpeg motion graphics on stills | ChatGPT quota / none | None |

**Honest scoping:** none of A-C replaces MuseTalk's audio-to-mouth sync. Lane A transfers *performance* (an actor's head/expression motion), which pairs with F5-TTS audio for a talking-head result whose lips are approximately, not phonetically, synced. For Shorts-length character pieces that is usually enough; phonetic sync still waits on MuseTalk.

## Install state -- verified on the rig 2026-11-10 (Bolt + Route B executor, raw listings)

- **LivePortraitKJ: NOT installed.** Lane A's install step is real.
- **ComfyUI-Manager: present but `.disabled`** -- the Manager install route below is unavailable until it is re-enabled; use the `git clone` route.
- **AnimateDiff-Evolved, WanVideoWrapper, LTX-Video: all present but `.disabled`.** The motion lanes need a folder rename, not a download.
- **ComfyUI-LatentSync: present and ENABLED** -- an audio-driven lip-sync lane is already installed (see [[musetalk-quality-and-stylized-lip-sync-options-2026]] for where it fits the lip-sync paths).
- `input/` already holds `avatar_masked.png` and `character_2d_v2_00001_.png` from earlier character work.

## Lane A -- LivePortrait via ComfyUI (attempt first)

**Node pack:** `kijai/ComfyUI-LivePortraitKJ` -- install via ComfyUI Manager (search "ComfyUI-LivePortraitKJ") or `git clone` into `ComfyUI/custom_nodes`. Example workflows ship in the pack's `examples/` folder; start from one, do not build the graph from scratch.

**Models:** auto-download on first run from Hugging Face `Kijai/LivePortrait_safetensors` into `ComfyUI/models/liveportrait/` (appearance feature extractor, motion extractor, warping module, SPADE generator, stitching/retargeting). First queue stalls while ~1 GB downloads; one-time.

**Licensing trap (matters -- the channel is monetization-bound):** the InsightFace cropper path uses `buffalo_l` weights, which are **non-commercial**. Use the pack's **MediaPipe cropper** instead; it needs no InsightFace install and keeps the output commercially clean.

**Dependency caution:** the pack pins `numpy<=1.26.4` and pulls `onnxruntime`, `mediapipe`, `opencv-python`, `pykalman`. Install into the **ComfyUI env only** (`D:\conda-envs\comfyui-cuda`) -- never the backend env.

**Inputs -- stage these on the rig first** (gap caught by Bolt E4B review, 2026-11-10): neither input below lives on the rig yet. The source image is `04-avatar-cut-gemini-v3.jpg` in the Google Drive folder "Maya -- Design Reference & Backup" (also in Maya's workspace `your_files/`); copy it into the ComfyUI input folder before the first run. The driving clip does not exist yet -- the owner records it (step 2).

**Test protocol (acceptance):**
1. Source image: the Gemini v3 avatar cut (1024x1024, face large in frame). If the cropper struggles with the anime face, fall back to the master bust portrait.
2. Driving source: a 5-10 s front-facing performance clip (owner on webcam is fine): neutral -> smile -> the approved test line's expressions, slow head turns, two blinks.
3. Settings: 512x512 crop, relative motion on, stitching on.
4. **Pass:** identity reads as the same character in every frame; headset ears/paw cup do not melt or detach; no background wobble inside the crop. **Fail:** ear geometry warps (the known anime-face risk) -- record the failure mode and stop; do not tune blindly.

## Lane B -- Wan red-output debug checklist

History (2026-09-23): WanGP officially supports GTX 10xx; the 2 s smoke test produced only a red abstract pattern; the workflow has since been driven through ComfyUI (Kilo-built graph), and the working suspicion is the prompt path. Test in this order -- each step discriminates one hypothesis:

1. **Bypass the workflow.** Run the same weights in WanGP's native UI with a known-simple prompt. Clean output -> the ComfyUI graph is at fault (goes to step 2). Red again -> weights/VAE pairing (step 3).
2. **Prompt pass-through.** Print what the graph actually feeds the text encoder (the repo has been bitten by silent empty/wrong prompt wiring before). An empty or default prompt explains abstract output.
3. **Variant match.** T2V weights with an I2V graph (or the reverse) produce garbage, not errors. Confirm the checkpoint variant and the graph agree.
4. **VAE / text-encoder pairing.** Wan needs its matched VAE and umt5 encoder files; a borrowed pairing shifts output toward noise/red.
5. **Weight class vs VRAM.** On 8 GB the 1.3B is the realistic class; a 14B at forced low-VRAM offload can complete while producing mush that reads as "broken model."

Record which step discriminates before changing anything else (repo rule: measure before naming a defect).

## Lane C -- Blender 2.5D cutout rig (the durable asset)

**Concept:** the character as layered alpha planes (base body, head, front hair, arm L, arm R) on a small bone rig in Blender 5.3 (installed on the rig 2026-11-10). Pose/animation is keyframed once per move and re-rendered by Eevee in seconds at 720x1280 for Shorts. Unlike every neural lane, the rig cannot melt her ears.

**Starter:** `tools/blender-rig/maya_cutout_rig.py` builds the scene (planes + materials from a layer folder, armature with root/spine/head/hair/arm bones, ortho camera, Eevee, transparent-film render settings) and saves a `.blend`. **Status: written in the sandbox, NOT yet run in Blender -- first rig run is a verification step, not a formality.**

**Layer prep (manual, one-time):** cut the five layers from a calm-hair sticker master or the avatar cut in any image editor, keeping a shared 1024x1024 canvas so registration is free. A single-image mode in the script (whole character on one plane, head pivot only) works as a smoke test before the layer cutting is done.

**MCP path:** the repo already carries a `blender-mcp` skill; once the rig exists, MCP turns posing into a conversational task instead of a scripting one.

## Lane D -- Zero-GPU fallbacks (available today)

- **ChatGPT native GIFs** -- proven 2026-11-10 with this character: 12 frames, 358x358, identity held across the loop; loop seams repairable locally by boomerang re-encode (forward + reverse). Priced in ChatGPT quota per generation.
- **ffmpeg motion graphics** -- bounce/bob/parallax/boomerang on the stills on disk. No GPU, no quota; limited vocabulary, fine for end-cards and chat loops.

## Sequencing

1. GPU frees -> Lane A test (one ComfyUI session, acceptance above).
2. Same session if time allows -> Lane B step 1 only (the discriminator).
3. Any time (CPU-only) -> Lane C script smoke test in Blender, single-image mode.
4. Report results back into this doc; lanes that pass get promoted to guides.

## Related

- [[character-animation-2026-summer-synthesis|character-animation-2026-summer-synthesis]] :see-also
- [[silhouette-character-animation|silhouette-character-animation]] :extends

# ComfyUI Workflows

Index of ComfyUI workflow JSON files used by the GPU music video pipeline
(see `docs/guides/GPU_PIPELINE.md`). Each file is a ComfyUI workflow that can
be loaded into the ComfyUI UI or executed via the Blender/ComfyUI MCP bridge.

## Workflows

| File | Model | VRAM | Speed | Quality | Purpose |
|------|-------|------|-------|---------|---------|
| `hunyuan3d-2mini-native.json` | Hunyuan3D-2mini | ~5 GB | 30–60s | Very good | Geometry-only 3D from image |
| `hunyuan3d-2mv-native.json` | Hunyuan3D-2mv | ~6 GB | 60–120s | Excellent | Multi-view 3D from 4 images |
| `triposr-fast.json` | TripoSR | ~6 GB | seconds–minutes | Good | Fast single-image 3D, vertex colors |
| `text-to-3d-sdxl-reference.json` | SDXL reference | varies | varies | varies | Text-to-3D via SDXL reference |

## Details

### `hunyuan3d-2mini-native.json`

Geometry-only 3D generation from a single image using Hunyuan3D-2mini. Built
into ComfyUI core — no custom nodes needed. Output is geometry only; use the
Kijai wrapper for textures (requires 12 GB+ VRAM).

Nodes: `ImageOnlyCheckpointLoader`, `Hunyuan3Dv2Conditioning`, `SaveGLB`

### `hunyuan3d-2mv-native.json`

> [!warning] Weights not on disk (verified 2026-11)
> Only the **2mini** checkpoint tree is downloaded
> (`diffusion_models/hunyuan3d-2mini/` — DiT mini/fast/turbo + VAE mini/turbo).
> The 2mv DiT (`hunyuan3d-dit-v2-mv`) is absent, so this workflow and the
> `hunyuan3d_2mv` backend in `gen3d_service.py` will fail until ~6 GB of
> weights are fetched.

Multi-view 3D generation from front/left/right/back images. Front-only works
but may have unseen-side artifacts. Built into ComfyUI core — no custom nodes
needed.

Nodes: `ImageOnlyCheckpointLoader`, `Hunyuan3Dv2ConditioningMultiView`, `SaveGLB`

### `triposr-fast.json`

> [!note] Available (corrected 2026-11-06)
> `ComfyUI-Flowty-TripoSR` is installed under `custom_nodes/` (provides
> `TripoSRModelLoader` / `TripoSRSampler` / `TripoSRViewer`) plus a small
> `nma-mesh-export` pack (`ExportMeshGLB`) for GLB output with vertex colors.
> The old `TripoSRGenerate`/`Save3DModel` node names never existed in any
> public pack — the backend workflows were rewritten to the real nodes.
> The transformers>=5 ViT key-remap shim lives in `nma-mesh-export`
> (wraps `TSR.load_state_dict`), NOT in the vendored pack, so upstream
> `git pull`s can't wipe it.

Ultra-fast single-image 3D using TripoSR (~0.5s on A100; ~4 min cold / faster
warm on the GTX 1070 Ti including model load). ~6 GB VRAM. Works from both
`/api/3d/generate-image?model=triposr` and text-to-3D (SD1.5 concept image
first stage).

### `text-to-3d-sdxl-reference.json`

Text-to-3D via SDXL reference image workflow. VRAM and speed vary by model.

## How to use

1. Start ComfyUI via `pnpm dev:comfyui` or `scripts/manage-servers.ps1 -Services comfyui` (the referenced `start-unity-headless.ps1` does not exist).
2. Load any `.json` workflow in the ComfyUI UI, or execute it via the MCP
   bridge (`tools/mcp/`).
3. Outputs go to `output/generated_3d/` (see `GET /api/3d/*`).

## Notes

- Hunyuan3D-2mini (~2.5 GB model) fits the GTX 1070 Ti 8 GB workstation.
- Wan 2.2 5B video at 480p also fits 8 GB (see `comfyui-workflows.md` in the
  knowledge library for video workflows).
- Two backend processes cannot bind the same ComfyUI port (default 8188).

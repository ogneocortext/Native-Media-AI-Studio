# ComfyUI Workflows

Index of ComfyUI workflow JSON files used by the GPU music video pipeline
(see `docs/guides/GPU_PIPELINE.md`). Each file is a ComfyUI workflow that can
be loaded into the ComfyUI UI or executed via the Blender/ComfyUI MCP bridge.

## Workflows

| File | Model | VRAM | Speed | Quality | Purpose |
|------|-------|------|-------|---------|---------|
| `hunyuan3d-2mini-native.json` | Hunyuan3D-2mini | ~5 GB | 30–60s | Very good | Geometry-only 3D from image |
| `hunyuan3d-2mv-native.json` | Hunyuan3D-2mv | ~6 GB | 60–120s | Excellent | Multi-view 3D from 4 images |
| `triposr-fast.json` | TripoSR | ~4–5 GB | ~0.5s | Good | Fast single-image 3D |
| `text-to-3d-sdxl-reference.json` | SDXL reference | varies | varies | varies | Text-to-3D via SDXL reference |

## Details

### `hunyuan3d-2mini-native.json`

Geometry-only 3D generation from a single image using Hunyuan3D-2mini. Built
into ComfyUI core — no custom nodes needed. Output is geometry only; use the
Kijai wrapper for textures (requires 12 GB+ VRAM).

Nodes: `ImageOnlyCheckpointLoader`, `Hunyuan3Dv2Conditioning`, `SaveGLB`

### `hunyuan3d-2mv-native.json`

Multi-view 3D generation from front/left/right/back images. Front-only works
but may have unseen-side artifacts. Built into ComfyUI core — no custom nodes
needed.

Nodes: `ImageOnlyCheckpointLoader`, `Hunyuan3Dv2ConditioningMultiView`, `SaveGLB`

### `triposr-fast.json`

> [!warning] Unavailable (corrected 2026-11-05)
> `ComfyUI-3D-Pack` / `ComfyUI-TripoSR` custom nodes were not found in the current
> external ComfyUI installation, and `TripoSRGenerate`/`Save3DModel` nodes were not
> found in source. This workflow cannot run until those nodes are installed.

Ultra-fast single-image 3D using TripoSR (~0.5s per image). Requires
`ComfyUI-3D-Pack` or `ComfyUI-TripoSR` via ComfyUI Manager. Good quality,
~4–5 GB VRAM.

Nodes: `LoadImage`, `TripoSRGenerate`, `Save3DModel` (actual JSON uses `Save3DModel`, not `SaveMesh`)

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

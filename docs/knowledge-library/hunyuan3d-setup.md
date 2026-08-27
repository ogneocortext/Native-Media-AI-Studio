---
tags:
  - hunyuan3d
  - comfyui
  - 3d-generation
  - workflow
  - kijai-wrapper
aliases:
  - Hunyuan3D-2mini Setup
  - ComfyUI 3D Generation
  - Kijai Wrapper Guide
cssclasses:
  - technical-guide
date: 2026-08-27
---

# 🧊 Hunyuan3D-2mini ComfyUI Setup

> [!info] Model
> **Hunyuan3D-2mini** by Tencent - 0.6B parameter image-to-shape model optimized for 5-6 GB VRAM

> [!note] Two Approaches
> | Approach | Location | Capability | Install Effort |
> |----------|----------|------------|----------------|
> | **Native ComfyUI** | `models/checkpoints/` | Geometry only | Easy |
> | **Kijai Wrapper** | `models/diffusion_models/` | Geometry + Texture | Moderate |

**We use the Kijai Wrapper** - models are in `diffusion_models/hunyuan3d-2mini/`

---

## Installation Status

### ✅ What's Installed
- **ComfyUI-Hunyuan3DWrapper** (Kijai) in `custom_nodes/`
- **Models** in `models/diffusion_models/hunyuan3d-2mini/`:
  - `hunyuan3d-dit-v2-mini/model.fp16.safetensors`
  - `hunyuan3d-dit-v2-mini-fast/model.fp16.safetensors`
  - `hunyuan3d-dit-v2-mini-turbo/model.fp16.safetensors`
  - `hunyuan3d-vae-v2-mini/model.fp16.safetensors`
  - `hunyuan3d-vae-v2-mini-turbo/model.fp16.safetensors`

### ⚠️ Texture Generation (Optional)
For textured output, you need to compile:
1. `custom_rasterizer` - CUDA module for rendering
2. `differentiable_renderer` - For vertex inpainting

**Pre-built wheels** available in `ComfyUI-Hunyuan3DWrapper/wheels/`:
```powershell
# For Python 3.12 + CUDA 12.4/12.6
pip install wheels\custom_rasterizer-0.1-cp312-cp312-win_amd64.whl
```

> [!warning] GPU Requirement
> **Pascal (GTX 10xx) and newer supported.** Our GTX 1070 Ti works for geometry. Texture compilation requires CUDA 12.6+ for best compatibility.

---

## Basic Single-Image Workflow (Kijai Wrapper)

### Node Chain

```
Load Image → [Preprocess] → Hy3DGenerateMesh → Hy3DVAEDecode → Hy3DExportMesh
                    ↑
            Hy3DModelLoader
```

### Step-by-Step

#### 1. Load the Model
**Node:** `Hy3DModelLoader`
- **model:** `hunyuan3d-2mini\hunyuan3d-dit-v2-mini\model.fp16.safetensors`
- Outputs: `pipeline`, `vae`

#### 2. Prepare Input Image
**Node:** `LoadImage` or `EmptyImage`
- Recommended size: 512×512 or 518×518
- Clean/transparent background preferred
- Center the subject

> [!tip] Image Preprocessing
> For best results:
> 1. Remove background (use `TransparentBGSession+` or alpha channel)
> 2. Center the subject
> 3. Use square aspect ratio
> 4. Good contrast between subject and background

#### 3. Generate Mesh
**Node:** `Hy3DGenerateMesh`
- **pipeline:** from Hy3DModelLoader
- **image:** preprocessed image
- **guidance_scale:** 5.5 (range: 0-100)
- **steps:** 15-30 (more = better quality)
- **seed:** any integer
- Output: `latents`

#### 4. Decode Mesh
**Node:** `Hy3DVAEDecode`
- **latents:** from Hy3DGenerateMesh
- **vae:** from Hy3DModelLoader
- **box_v:** 1.01 (bounding box size)
- **octree_resolution:** 256 (range: 8-4096, higher = more detail)
- **num_chunks:** 8000 (more = faster but more VRAM)
- **mc_level:** 0 (marching cubes level)
- **mc_algo:** "mc" or "dmc"
- Output: `trimesh`

#### 5. Export Mesh
**Node:** `Hy3DExportMesh`
- **trimesh:** from Hy3DVAEDecode
- **filename_prefix:** "output/3d/your_model"
- **file_format:** "glb" (or obj, ply, stl)
- Output: `.glb` file

---

## Complete Workflow with Texture (Advanced)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        TEXTURED 3D PIPELINE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. LOAD IMAGE                                                              │
│     └─→ Remove background, delight lighting                                 │
│                                                                             │
│  2. GENERATE BASE MESH                                                      │
│     └─→ Hy3DModelLoader → Hy3DGenerateMesh → Hy3DVAEDecode                 │
│                                                                             │
│  3. POST-PROCESS MESH                                                       │
│     └─→ Hy3DPostprocessMesh (remove floaters, reduce faces)                 │
│     └─→ Hy3DMeshUVWrap (generate UV coordinates)                           │
│                                                                             │
│  4. RENDER MULTI-VIEW                                                       │
│     └─→ Hy3DCameraConfig → Hy3DRenderMultiView                              │
│                                                                             │
│  5. GENERATE TEXTURES                                                       │
│     └─→ DownloadAndLoadHy3DPaintModel                                       │
│     └─→ Hy3DSampleMultiView                                                 │
│     └─→ Hy3DBakeFromMultiview                                               │
│                                                                             │
│  6. FIX TEXTURE SEAMS                                                       │
│     └─→ Hy3DMeshVerticeInpaintTexture                                       │
│     └─→ CV2InpaintTexture                                                   │
│                                                                             │
│  7. APPLY & EXPORT                                                          │
│     └─→ Hy3DApplyTexture                                                    │
│     └─→ Hy3DExportMesh (.glb)                                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Texture Pipeline Nodes

| Node | Purpose | Key Settings |
|------|---------|--------------|
| `Hy3DDelightImage` | Remove harsh lighting | cfg_image: 1.0 |
| `Hy3DPostprocessMesh` | Clean mesh | target_faces: 50000 |
| `Hy3DMeshUVWrap` | Generate UV coords | - |
| `Hy3DCameraConfig` | Set render angles | - |
| `Hy3DRenderMultiView` | Create normal/position maps | - |
| `Hy3DPaintModelLoader` | Load texture model | - |
| `Hy3DSampleMultiView` | Generate textures | steps: 20-30 |
| `Hy3DBakeFromMultiview` | Bake texture to mesh | - |
| `Hy3DMeshVerticeInpaintTexture` | Fix seams | - |
| `CV2InpaintTexture` | Final texture fix | radius: 3, method: "ns" |
| `Hy3DApplyTexture` | Apply texture to mesh | - |

---

## Multi-View Workflow (Better Geometry)

> [!tip] Better Results
> Provide multiple views (front, left, right, back) for more accurate geometry. Front-only works but may have artifacts on unseen sides.

### Node Chain
```
Front Image ─┐
Left Image ──┤
Back Image ──┼─→ Hy3DGenerateMeshMultiView → Hy3DVAEDecode → Export
Right Image ─┘              ↑
                    Hy3DModelLoader (use 2mv model)
```

### Multi-View Model
Use `hunyuan3d-dit-v2-mv` instead of `hunyuan3d-dit-v2-mini`:
- Model: `hunyuan3d-dit-v2-mv\model.fp16.safetensors`
- Node: `Hy3DGenerateMeshMultiView` (not `Hy3DGenerateMesh`)

---

## VRAM Requirements

| Configuration | VRAM | Our GPU |
|---------------|------|---------|
| Hunyuan3D-2mini shape only | ~5 GB | ✅ 8 GB |
| Standard shape generation | ~6 GB | ✅ 8 GB |
| Full shape + texture | ~12 GB | ❌ Need 16+ GB |
| 2mini-turbo (fastest) | ~4 GB | ✅ 8 GB |

> [!warning] 8 GB Limit
> With our GTX 1070 Ti (8GB), stick to:
> - Shape-only generation (geometry)
> - Hunyuan3D-2mini models
> - Lower octree resolution (256)
> - Fewer steps (15-20)

---

## Recommended Settings for 8GB VRAM

### Fast Preview
```json
{
  "guidance_scale": 5.5,
  "steps": 15,
  "octree_resolution": 256,
  "num_chunks": 8000
}
```

### Standard Quality
```json
{
  "guidance_scale": 5.5,
  "steps": 30,
  "octree_resolution": 384,
  "num_chunks": 10000
}
```

### High Quality (if VRAM allows)
```json
{
  "guidance_scale": 5.5,
  "steps": 50,
  "octree_resolution": 512,
  "num_chunks": 20000
}
```

---

## Troubleshooting

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `OSError: [Errno 22] Invalid argument` | `prepare_image` was commented out | ✅ **FIXED:** Uncommented line 559 in `pipelines.py` |
| `OpenCV resize error: src is not a numpy array` | Tensor passed directly to image_processor | ✅ **FIXED:** Added tensor-to-PIL conversion in `prepare_image` |
| `CUDA out of memory` | Image too large or too many steps | Reduce resolution to 512, reduce steps to 15 |
| `custom_rasterizer not found` | Texture module not compiled | Install wheel or compile from source |
| `ImportError: cannot import name 'Hunyuan3DDiTPipeline'` | Wrong pipeline class | Use Kijai wrapper nodes (Hy3DGenerateMesh) |
| Black mesh | Bad input image | Use clean background, center subject |
| Flat back (single-view) | AI guessing unseen geometry | Use multi-view workflow |
| `Cannot handle this data type: (1, 1, 512), \|u1` | Tensor format mismatch in `prepare_image` | ✅ **FIXED:** Handle `[B,C,H,W]` → `[B,H,W,C]` and `[-1,1]` → `[0,1]` conversion |
| `expected Tensor as element 0 in argument 0, but got str` | Dictionary unpacked as tuple | ✅ **FIXED:** Handle dict return from `image_processor` |
| `cannot access local variable 'mask'` | Numpy array not handled in `load_image` | ✅ **FIXED:** Added numpy array branch |

### Bug Fixes Applied

#### Fix 1: Commented-out `prepare_image` call
**File:** `ComfyUI/custom_nodes/ComfyUI-Hunyuan3DWrapper/hy3dgen/shapegen/pipelines.py`

**Line 559** had `prepare_image` commented out:
```python
# BEFORE (broken):
#image, mask = self.prepare_image(image)

# AFTER (fixed):
image, mask = self.prepare_image(image)
```

#### Fix 2: Tensor-to-PIL conversion
**File:** `ComfyUI/custom_nodes/ComfyUI-Hunyuan3DWrapper/hy3dgen/shapegen/pipelines.py`

**`prepare_image` method** now handles ComfyUI tensors:
```python
def prepare_image(self, image):
    from PIL import Image
    import torchvision.transforms as T

    if isinstance(image, str) and not os.path.exists(image):
        raise FileNotFoundError(f"Couldn't find image at path {image}")

    if not isinstance(image, list):
        image = [image]
    image_pts = []
    mask_pts = []
    for img in image:
        # Convert ComfyUI tensor [B,H,W,C] float32 [0,1] to PIL Image
        if isinstance(img, torch.Tensor):
            img = img.squeeze(0) if img.dim() == 4 else img
            img = (img.cpu().numpy() * 255).astype(np.uint8)
            if img.shape[-1] == 1:
                img = img.repeat(3, axis=-1)
            img = Image.fromarray(img)
        image_pt, mask_pt = self.image_processor(img, return_mask=True)
        image_pts.append(image_pt)
        mask_pts.append(mask_pt)
    # ... rest of method
```

#### Fix 4: Dictionary vs tuple unpacking in prepare_image
**File:** `ComfyUI/custom_nodes/ComfyUI-Hunyuan3DWrapper/hy3dgen/shapegen/pipelines.py`

**Error:** `expected Tensor as element 0 in argument 0, but got str`

**Root cause:** `ImageProcessorV2.__call__` returns a dictionary `{'image': ..., 'mask': ...}`, but `prepare_image` unpacks it as a tuple. Unpacking a dictionary yields its keys (strings), not values.

**Solution:** Handle both dictionary and tuple returns:
```python
result = self.image_processor(img, return_mask=True)
if isinstance(result, dict):
    image_pt, mask_pt = result['image'], result['mask']
else:
    image_pt, mask_pt = result
```

#### Fix 5: Numpy array handling in load_image
**File:** `ComfyUI/custom_nodes/ComfyUI-Hunyuan3DWrapper/hy3dgen/shapegen/preprocessors.py`

**Error:** `cannot access local variable 'mask' where it is not associated with a value`

**Root cause:** `load_image` only handled `str` and `PIL.Image` inputs, not numpy arrays.

**Solution:** Added numpy array handling:
```python
elif isinstance(image, np.ndarray):
    if image.shape[-1] == 4:
        mask = image[..., 3:4]
        image = image[..., :3]
    else:
        mask = np.ones((*image.shape[:2], 1), dtype=image.dtype) * 255
    image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
    image, mask = self.recenter(image, border_ratio=border_ratio)
    image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
```

#### Fix 6: Tensor format handling in prepare_image
**File:** `ComfyUI/custom_nodes/ComfyUI-Hunyuan3DWrapper/hy3dgen\shapegen\pipelines.py`

**Error:** `Cannot handle this data type: (1, 1, 512), |u1`

**Root cause:** The `Hy3DGenerateMesh` node permutes images to `[B, C, H, W]` format with values in [-1, 1], but `prepare_image` expected `[B, H, W, C]` in [0, 1].

**Solution:** Detect channels-first format and convert:
```python
if img_tensor.dim() == 4 and img_tensor.shape[1] in (1, 3, 4):
    img_tensor = img_tensor.permute(0, 2, 3, 1)  # [B, H, W, C]
# Handle [-1, 1] range
img_min = img_tensor.min().item()
if img_min < 0:
    img_tensor = (img_tensor + 1) / 2  # [-1,1] -> [0,1]
```

### Backend Server: Uvicorn Child Process Issue

> [!warning] Windows + Uvicorn + Virtual Environments
> When using `uvicorn.run("app.main:app", ...)` with a string target, uvicorn spawns a child process on Windows. This child process inherits the system PATH and runs with the **system Python** instead of the venv Python, causing import failures and loading stale `.pyc` caches.

**Fix in `packages/backend/app/main.py`:**
```python
# BEFORE (broken on Windows with venv):
uvicorn.run("app.main:app", ...)

# AFTER (runs in-process):
uvicorn_config = uvicorn.Config(app, host=..., port=..., ...)
server = uvicorn.Server(uvicorn_config)
asyncio.run(server.serve())
```

**Debugging tip:** If you see `ModuleNotFoundError` for modules that exist, check which Python is running:
```powershell
Get-Process -Name "python" | Select-Object Id, @{N='Exe';E={$_.CommandLine.Split('"')[1]}}
```

Multiple Python processes = uvicorn spawned a child with the wrong interpreter.

### Model Path Issues

> [!important] Correct Model Paths
> Kijai wrapper expects models in `diffusion_models/`:
> ```
> ComfyUI/models/diffusion_models/hunyuan3d-2mini/hunyuan3d-dit-v2-mini/model.fp16.safetensors
> ```
>
> NOT in `checkpoints/` (that's for native ComfyUI)

### Node Selection

> [!caution] Use Correct Nodes
> **For Kijai wrapper:**
> - `Hy3DModelLoader` (NOT `CheckpointLoaderSimple`)
> - `Hy3DGenerateMesh` (NOT `KSampler`)
> - `Hy3DVAEDecode` (NOT `VAEDecode`)
> - `Hy3DExportMesh` (NOT generic save)

---

## Quick Reference: Minimal Working Workflow

```json
{
  "1": {"class_type": "Hy3DModelLoader", "inputs": {"model": "hunyuan3d-2mini\\hunyuan3d-dit-v2-mini\\model.fp16.safetensors"}},
  "2": {"class_type": "EmptyImage", "inputs": {"width": 512, "height": 512, "batch_size": 1, "color": 8421504}},
  "3": {"class_type": "Hy3DGenerateMesh", "inputs": {"pipeline": ["1", 0], "image": ["2", 0], "guidance_scale": 5.5, "steps": 15, "seed": 42}},
  "4": {"class_type": "Hy3DVAEDecode", "inputs": {"vae": ["1", 1], "latents": ["3", 0], "box_v": 1.01, "octree_resolution": 256, "num_chunks": 8000, "mc_level": 0, "mc_algo": "mc"}},
  "5": {"class_type": "Hy3DExportMesh", "inputs": {"trimesh": ["4", 0], "filename_prefix": "output/3d/test_mesh", "file_format": "glb"}}
}
```

---

## See Also

- [[3d-rendering]] - GPU rendering optimization
- [[comfyui-workflows]] - General ComfyUI workflows
- [[blender-mcp]] - Import meshes to Blender
- [[prompt-engineering]] - Better prompts for 3D assets
- [[music-video-production]] - Full production pipeline

---

## Resources

- [Official Hunyuan3D-2 GitHub](https://github.com/Tencent-Hunyuan/Hunyuan3D-2)
- [Kijai ComfyUI-Hunyuan3DWrapper](https://github.com/kijai/ComfyUI-Hunyuan3DWrapper)
- [ComfyUI Hunyuan3D-2 Examples](https://docs.comfy.org/tutorials/3d/hunyuan3D-2)
- [ComfyUI Wiki - Hunyuan3D](https://comfyui-wiki.com/en/tutorial/advanced/3d/huanyuan3d-2)
- [DeepWiki - Kijai Wrapper](https://deepwiki.com/kijai/ComfyUI-Hunyuan3DWrapper)

---

*Last updated: 2026-08-27 — Added Fixes 4-6 for ComfyUI pipeline tensor format and dictionary unpacking issues*

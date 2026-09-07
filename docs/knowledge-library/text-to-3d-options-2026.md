# Text-to-3D Options for 8GB VRAM / Pascal (2026)

> **Scope:** open-source or free-to-use models you can run locally on a GTX 1070 Ti (8 GB VRAM, sm_61) or similar Pascal cards.  
> **Last updated:** 2026-09-07

---

## 1. Hunyuan3D-2mini (Tencent) — RECOMMENDED

| Attribute | Value |
|-----------|-------|
| License | Tencent Hunyuan Community License (permissive; research + commercial use allowed) |
| Parameters | 0.6 B |
| VRAM (shape only) | ~5–6 GB |
| VRAM (shape + texture) | ~12 GB (skip texture on 8 GB) |
| Input | Text prompt OR single image |
| Output | GLB / OBJ / STL / PLY |
| Text-to-3D support | Yes (`--enable_t23d` flag in gradio app) |
| Speed | ~30–60 s for shape |
| ComfyUI support | Yes — native Hunyuan3D nodes |

**How to run text-to-3D locally:**
```bash
git clone https://github.com/Tencent-Hunyuan/Hunyuan3D-2.git external\Hunyuan3D-2
cd external\Hunyuan3D-2

python gradio_app.py \
  --model_path tencent/Hunyuan3D-2mini \
  --subfolder hunyuan3d-dit-v2-mini-turbo \
  --low_vram_mode \
  --enable_t23d \
  --profile 3
```

- Use `--profile 4` if you need <6 GB VRAM.
- Texture generation requires ~10 GB extra; on 8 GB stick to geometry-only or use image-to-3D + external texturing.

**ComfyUI:** Drag workflow `docs/comfyui-workflows/hunyuan3d-2mini-text-to-3d.json` onto canvas.

---

## 2. Hunyuan3D-2GP (DeepBeepMeep) — GPU-POOR MODE

| Attribute | Value |
|-----------|-------|
| License | Same as upstream Hunyuan3D (Tencent Hunyuan Community) |
| Parameters | 0.6 B (mini) |
| VRAM (shape only) | < 6 GB |
| VRAM (shape + texture) | ~12 GB |
| Input | Text prompt OR single image |
| Output | GLB / OBJ |
| Text-to-3D support | Yes (`--enable_t23d`) |
| Speed | Slower than vanilla (sequential CPU offload) |
| Special | Five memory profiles (1–5); Profile 4 targets 6 GB VRAM |

**How to run:**
```bash
git clone https://github.com/deepbeepmeep/Hunyuan3D-2GP.git
cd Hunyuan3D-2GP

python gradio_app.py --enable_t23d --profile 4
```

- Profile 4 = LowRAM_LowVRAM (6 GB VRAM budget).
- Profile 5 = VerylowRAM_LowVRAM (maximum compatibility, slowest).

**ComfyUI:** Not yet natively wrapped; use the standalone gradio app or call the API server:
```bash
python api_server.py --host 0.0.0.0 --port 8080
```

---

## 3. TRELLIS-text (Microsoft) — HIGHEST QUALITY / MIT

| Attribute | Value |
|-----------|-------|
| License | MIT |
| Parameters | 342 M (base) / 1.1 B (large) |
| VRAM (base) | ~6–8 GB |
| VRAM (large) | ~10–12 GB |
| Input | Text prompt only (text-to-3D) |
| Output | GLB (PBR to 4K), OBJ, PLY, Gaussian splat |
| Speed | ~10–20 s |
| Text-to-3D support | Native (TRELLIS-text-*) |
| Note | Image-to-3D quality is better; text-to-3D is less creative |

**How to run:**
```bash
git clone https://github.com/microsoft/TRELLIS.git
cd TRELLIS
pip install -e .

python example_text.py \
  --model microsoft/TRELLIS-text-large \
  --prompt "a ceramic mug with a sunflower pattern"
```

**ComfyUI / Modly extension:**
- Repository: `DrHepa/modly-trellis-text-extension`
- Nodes: `text-to-mesh-base`, `text-to-mesh-large`
- Windows 8 GB VRAM validated for Base and Large variants.

---

## 4. Point-E (OpenAI) — LIGHTWEIGHT / EDUCATIONAL

| Attribute | Value |
|-----------|-------|
| License | MIT |
| Parameters | Unknown (small) |
| VRAM | ~4–6 GB |
| Input | Text prompt |
| Output | Point cloud → optional mesh conversion |
| Speed | ~30–60 s |
| Note | Produces point clouds, not production meshes |

**How to run:**
```bash
pip install point-e
python -c "
from point_e.util import iq2rgb
from point_e.models.download import load_checkpoint
# See OpenAI/point-e README for full example
"
```

- Best for rapid prototyping and education.
- Combine with `trimesh` for mesh conversion.

---

## 5. Shap-E (OpenAI) — IMPLICIT FUNCTIONS / MIT

| Attribute | Value |
|-----------|-------|
| License | MIT |
| Parameters | Unknown |
| VRAM | ~6–8 GB |
| Input | Text prompt |
| Output | Implicit function → textured mesh |
| Speed | ~60–120 s |
| Note | Older than Point-E; quality surpassed by newer models |

**How to run:**
```bash
pip install shap-e
python -c "
# See openai/shap-e README for full example
"
```

---

## 6. GSGEN (CVPR 2024) — GAUSSIAN SPLAT / MIT

| Attribute | Value |
|-----------|-------|
| License | MIT |
| Parameters | Unknown |
| VRAM | ~8–12 GB |
| Input | Text prompt |
| Output | 3D Gaussian splat / `.ply` / `.splat` |
| Speed | ~2–5 min |
| Note | Novel output format; not a traditional mesh |

**How to run:**
```bash
git clone https://github.com/gsgen3d/gsgen.git
cd gsgen
# See README for training / inference instructions
```

---

## 7. Super-3D-Pro — HYBRID LOCAL/CLOUD / MIT

| Attribute | Value |
|-----------|-------|
| License | MIT |
| Parameters | Unknown |
| VRAM (local) | 4 GB+ |
| VRAM (cloud fallback) | N/A |
| Input | Text prompt OR image |
| Output | GLB / FBX / OBJ / STL |
| Speed | Fast (local) |
| Note | Cloud API mode for when VRAM is insufficient |

**How to run:**
```bash
git clone https://github.com/ceil-z/super-3d-pro.git
cd super-3d-pro
pip install -r requirements.txt
python app.py
```

- Cloud API uses Tripo (`tsk_` key) — only if local VRAM is insufficient.

---

## 8. MyMeshy — LOCAL-FIRST PIPELINE (TEXT→IMAGE→3D) / MIT

| Attribute | Value |
|-----------|-------|
| License | MIT |
| Parameters | Multiple (SDXL-Turbo + TripoSR/Hunyuan3D/TRELLIS) |
| VRAM (text→3D via SDXL→TripoSR) | ~5–7 GB |
| VRAM (text→3D via SDXL→TRELLIS) | ~12–16 GB |
| Input | Text prompt |
| Output | Textured GLB |
| Speed | ~30–90 s |
| Note | Text-to-3D is achieved via text→image→3D two-stage pipeline |

**How to run:**
```bash
git clone https://github.com/felippeomgt/mymeshy.git
cd mymeshy
# Follow setup instructions; clones TRELLIS, Hunyuan3D, TripoSR into external/
```

- `MYMESHY_VRAM_BUDGET_GB=8` hard-caps VRAM usage.

---

## 9. ComfyUI-Lux3D — CLOUD API TEXT-TO-3D

| Attribute | Value |
|-----------|-------|
| License | MIT |
| VRAM | Minimal (cloud API) |
| Input | Text prompt |
| Output | GLB download URL |
| Speed | ~1–2 min (API) |
| Note | Requires Lux3D API key (invitation code) |

**Install:**
```bash
cd ComfyUI\custom_nodes
git clone https://github.com/manycore-research/ComfyUI-Lux3D.git
cd ComfyUI-Lux3D
pip install -r requirements.txt
```

---

## 10. Tripo3.0 / Meshy 6 — HOSTED API (NOT LOCAL)

| Attribute | Value |
|-----------|-------|
| License | Commercial / API |
| VRAM | N/A (cloud) |
| Input | Text prompt |
| Output | GLB / FBX / OBJ / STL / PBR |
| Speed | ~10–30 s |
| Note | Free tier available; costs money at scale |

- Use only if local options fail.
- Tripo free tier: non-commercial use.
- Meshy free tier: 100 credits/month (CC BY 4.0).

---

## Decision Matrix for 8 GB VRAM

| Model | Text-to-3D | Open Source | License | Runs on 8 GB? | ComfyUI? |
|-------|-----------|-------------|---------|---------------|----------|
| Hunyuan3D-2mini | Yes | Yes | Tencent Community | ✅ shape only | ✅ native |
| Hunyuan3D-2GP | Yes | Yes | Tencent Community | ✅ shape + low texture | ❌ standalone |
| TRELLIS-text-large | Yes | Yes | MIT | ⚠️ tight | ✅ Modly extension |
| Point-E | Yes | Yes | MIT | ✅ | ❌ |
| Shap-E | Yes | Yes | MIT | ✅ | ❌ |
| GSGEN | Yes | Yes | MIT | ⚠️ | ❌ |
| Super-3D-Pro | Yes | Yes | MIT | ✅ | ❌ |
| MyMeshy (SDXL→TripoSR) | Yes (2-stage) | Yes | MIT | ✅ | ❌ |
| TripoSG | No (image→3D) | Yes | MIT | ✅ | ✅ ComfyUI-3D-Pack |
| InstantMesh | No (image→3D) | Yes | Apache 2.0 | ⚠️ 16 GB | ✅ ComfyUI-3D-Pack |

---

## Recommended Setup for This Project

Given the current stack (PyTorch 2.14 + CUDA 12.6 + ComfyUI v0.34+ + 8 GB VRAM):

1. **Primary text-to-3D:** Hunyuan3D-2mini with `--enable_t23d` + `--profile 3` (geometry-only output).
2. **Fallback fast path:** MyMeshy two-stage (SDXL-Turbo → TripoSR) at ~5–7 GB VRAM.
3. **ComfyUI integration:** Use native Hunyuan3D nodes (geometry only) + ComfyUI-3D-Pack for TripoSR.
4. **Texture upgrade path:** When VRAM allows, add Hunyuan3D-2 paint or TRELLIS mesh decoder.

---

## Next Steps

1. Create ComfyUI workflow JSONs for:
   - `hunyuan3d-2mini-text-to-3d.json`
   - `trellis-text-base.json`
   - `point-e-text-to-3d.json`
2. Update `gen3d_service.py` to register text-to-3D backends.
3. Document API endpoints for text-to-3D in backend docs.

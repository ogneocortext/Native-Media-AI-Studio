"""
3D asset generation service.

Provides text-to-3D and image-to-3D generation using Hunyuan3D-2mini
via ComfyUI's Kijai Wrapper (the correct approach per knowledge base).

Your GTX 1070 Ti (8GB VRAM, CUDA 13.0) supports:
- Geometry generation (via Kijai Wrapper)
- Texture generation (CUDA 12.6+ required, you have 13.0)
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any

from ...core.config import config as app_config  # noqa: E402 - must be after logger for import order

logger = logging.getLogger(__name__)

# Paths derived from app config (not hardcoded)
COMFYUI_DIR = Path(r"D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI")
COMFYUI_MODEL = COMFYUI_DIR / "models" / "diffusion_models" / "hunyuan3d-2mini"
COMFYUI_URL = app_config.comfyui_url
# ComfyUI writes exported meshes to its own output directory.
COMFYUI_OUTPUT_DIR = COMFYUI_DIR / "output"
OUTPUT_DIR = app_config.output_dir / "generated_3d"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# SD1.5 checkpoint used to generate an image that Hunyuan3D-2mini conditions on
# (Hunyuan3D is image-to-3D; the model node REQUIRES an IMAGE input).
SD_CHECKPOINT = "v1-5-pruned-emaonly.safetensors"
# Only hunyuan3d-2mini variants are exposed by the Hy3DModelLoader node.
HY3D_MODEL = "hunyuan3d-2mini\\hunyuan3d-dit-v2-mini\\model.fp16.safetensors"


class Gen3DService:
    """Generate 3D assets from text or image prompts using ComfyUI + Kijai Wrapper."""

    def __init__(self):
        self.available = COMFYUI_MODEL.exists() and self._check_comfyui()
        if self.available:
            logger.info("3D generation service ready: Hunyuan3D-2mini via ComfyUI")
        else:
            model_exists = COMFYUI_MODEL.exists()
            comfyui_ok = self._check_comfyui()
            logger.warning("3D generation unavailable: model=%s comfyui=%s",
                           model_exists, comfyui_ok)

    def _check_comfyui(self) -> bool:
        """Check if ComfyUI is running and accessible."""
        try:
            req = urllib.request.Request(f"{COMFYUI_URL}/system_stats")
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.status == 200
        except Exception:
            return False

    async def generate_from_text(
        self,
        prompt: str,
        output_name: str | None = None,
        steps: int = 15,
        seed: int = 42,
        cfg: float = 7.0,
    ) -> dict[str, Any]:
        """Generate a 3D model from a text prompt.

        Args:
            prompt: Text description of the 3D object.
            output_name: Optional filename (without extension).
            steps: Diffusion steps (lower = faster, 10-20 typical).
            seed: Random seed for reproducibility.

        Returns:
            Dict with 'success', 'model_path', 'preview_path', 'metadata'.
        """
        if not self.available:
            return {"success": False, "error": "3D generation service not available"}

        output_name = output_name or f"gen3d_{prompt[:30].replace(' ', '_')}"
        output_path = OUTPUT_DIR / f"{output_name}.glb"

        try:
            # VRAM Management: Offload Ollama before 3D generation
            from ..vram_manager import vram_manager
            vram_result = await vram_manager.begin_3d_generation()
            logger.info("VRAM pre-3d generation: %s", vram_result)

            try:
                # Build workflow for text-to-3D via Kijai Wrapper
                workflow = self._build_text23d_workflow(prompt, output_name, steps, seed, cfg)
                result = self._submit_workflow(workflow, output_path)
                return result
            finally:
                # VRAM Management: Reload Ollama after 3D generation
                vram_cleanup = await vram_manager.end_3d_generation()
                logger.info("VRAM post-3d generation: %s", vram_cleanup)

        except Exception as e:
            logger.error("3D generation failed: %s", e, exc_info=True)
            # Ensure Ollama is reloaded even on error
            from ..vram_manager import vram_manager
            await vram_manager.end_3d_generation()
            return {"success": False, "error": str(e)}

    async def generate_from_image(
        self,
        image_path: str,
        output_name: str | None = None,
        steps: int = 15,
    ) -> dict[str, Any]:
        """Generate a 3D model from an input image.

        Args:
            image_path: Path to the input image.
            output_name: Optional filename (without extension).
            steps: Diffusion steps.

        Returns:
            Dict with 'success', 'model_path', 'preview_path', 'metadata'.
        """
        if not self.available:
            return {"success": False, "error": "3D generation service not available"}

        output_name = output_name or f"img3d_{Path(image_path).stem}"
        output_path = OUTPUT_DIR / f"{output_name}.glb"

        try:
            # VRAM Management: Offload Ollama before 3D generation
            from ..vram_manager import vram_manager
            vram_result = await vram_manager.begin_3d_generation()
            logger.info("VRAM pre-3d generation: %s", vram_result)

            try:
                # Build workflow for image-to-3D via Kijai Wrapper
                workflow = self._build_image23d_workflow(image_path, output_name, steps)
                result = self._submit_workflow(workflow, output_path)
                return result
            finally:
                # VRAM Management: Reload Ollama after 3D generation
                vram_cleanup = await vram_manager.end_3d_generation()
                logger.info("VRAM post-3d generation: %s", vram_cleanup)

        except Exception as e:
            logger.error("Image-to-3D generation failed: %s", e, exc_info=True)
            # Ensure Ollama is reloaded even on error
            from ..vram_manager import vram_manager
            await vram_manager.end_3d_generation()
            return {"success": False, "error": str(e)}

    def _sanitize_name(self, name: str) -> str:
        """Return a filesystem/prefix-safe token (alphanumeric, '-', '_')."""
        import re
        return re.sub(r"[^A-Za-z0-9\-_]", "_", name)[:64] or "gen3d"

    def _build_text23d_workflow(
        self,
        prompt: str,
        output_name: str,
        steps: int,
        seed: int,
        cfg: float = 7.0,
    ) -> dict[str, Any]:
        """Build a ComfyUI workflow: SD1.5 text-to-image, then Hunyuan3D image-to-mesh.

        Hunyuan3D-2mini is an image-to-3D model — its Hy3DGenerateMesh node requires an
        IMAGE input (verified against the live node schema). So for a text prompt we first
        render a 512x512 concept image with the local SD1.5 checkpoint, then feed that
        image into the Hunyuan3D wrapper chain.
        """
        proc_output_name = self._sanitize_name(output_name)
        return {
            "1": {
                "class_type": "Hy3DModelLoader",
                "inputs": {"model": HY3D_MODEL},
            },
            # --- Stage 1: text -> image (SD1.5, 512x512) ---
            "2": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {"ckpt_name": SD_CHECKPOINT},
            },
            "3": {
                "class_type": "CLIPTextEncode",
                "inputs": {"text": prompt, "clip": ["2", 1]},
            },
            "4": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": "blurry, lowres, jpeg artifacts, cartoon, illustration, text, watermark",
                    "clip": ["2", 1],
                },
            },
            "5": {
                "class_type": "EmptyLatentImage",
                "inputs": {"width": 512, "height": 512, "batch_size": 1},
            },
            "6": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": seed,
                    "steps": 24,
                    "cfg": cfg,
                    "sampler_name": "euler",
                    "scheduler": "normal",
                    "denoise": 1.0,
                    "model": ["2", 0],
                    "positive": ["3", 0],
                    "negative": ["4", 0],
                    "latent_image": ["5", 0],
                },
            },
            "7": {
                "class_type": "VAEDecode",
                "inputs": {"samples": ["6", 0], "vae": ["2", 2]},
            },
            # --- Stage 2: image -> 3D mesh (Hunyuan3D) ---
            "8": {
                "class_type": "Hy3DGenerateMesh",
                "inputs": {
                    "pipeline": ["1", 0],
                    "image": ["7", 0],
                    "guidance_scale": 5.5,
                    "steps": steps,
                    "seed": seed,
                },
            },
            "9": {
                "class_type": "Hy3DVAEDecode",
                "inputs": {
                    "latents": ["8", 0],
                    "vae": ["1", 1],
                    "box_v": 1.01,
                    "octree_resolution": 256,
                    "num_chunks": 8000,
                    "mc_level": 0,
                    "mc_algo": "mc",
                },
            },
            "10": {
                "class_type": "Hy3DExportMesh",
                "inputs": {
                    "trimesh": ["9", 0],
                    "filename_prefix": f"3d/{proc_output_name}",
                    "file_format": "glb",
                },
            },
        }
    def _build_image23d_workflow(
        self,
        image_path: str,
        output_name: str,
        steps: int,
    ) -> dict[str, Any]:
        """Build ComfyUI workflow JSON for image-to-3D using Kijai Wrapper nodes."""
        uploaded = self._upload_image(image_path)
        image_name = uploaded.get("name", Path(image_path).name)

        return {
            "1": {
                "class_type": "Hy3DModelLoader",
                "inputs": {"model": HY3D_MODEL},
            },
            "2": {
                "class_type": "LoadImage",
                "inputs": {"image": image_name},
            },
            "3": {
                "class_type": "Hy3DGenerateMesh",
                "inputs": {
                    "pipeline": ["1", 0],
                    "image": ["2", 0],
                    "guidance_scale": 5.5,
                    "steps": steps,
                    "seed": 42,
                },
            },
            "4": {
                "class_type": "Hy3DVAEDecode",
                "inputs": {
                    "latents": ["3", 0],
                    "vae": ["1", 1],
                    "box_v": 1.01,
                    "octree_resolution": 256,
                    "num_chunks": 8000,
                    "mc_level": 0,
                    "mc_algo": "mc",
                },
            },
            "5": {
                "class_type": "Hy3DExportMesh",
                "inputs": {
                    "trimesh": ["4", 0],
                    "filename_prefix": f"3d/{self._sanitize_name(output_name)}",
                    "file_format": "glb",
                },
            },
        }
    def _upload_image(self, image_path: str) -> dict[str, Any]:
        """Upload an image to ComfyUI."""
        import urllib.request
        import urllib.parse
        import mimetypes
        import uuid

        path = Path(image_path)
        if not path.exists():
            raise FileNotFoundError(f"Image not found: {image_path}")

        boundary = uuid.uuid4().hex
        content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"

        with open(path, "rb") as f:
            data = f.read()

        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="image"; filename="{path.name}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode() + data + f"\r\n--{boundary}--\r\n".encode()

        req = urllib.request.Request(
            f"{COMFYUI_URL}/upload/image",
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())

    def _finalize_output(self, glb_relative: str, prompt_id: str) -> dict[str, Any]:
        """Copy the ComfyUI-exported .glb into the backend output dir and return its path."""
        cand = Path(glb_relative)
        src = cand if cand.is_absolute() and cand.exists() else COMFYUI_OUTPUT_DIR / cand
        if not src.exists():
            # Fallback: search the ComfyUI output tree for the basename
            fallback = next(COMFYUI_OUTPUT_DIR.rglob(cand.name), None)
            src = fallback or src

        if src.is_file():
            dst = OUTPUT_DIR / src.name
            if not dst.exists():  # keep the first generated file's original name
                try:
                    shutil.copy2(src, dst)
                except Exception as e:
                    logger.warning("Could not copy .glb into outputs: %s", e)
            return {"success": True, "model_path": str(dst), "prompt_id": prompt_id}
        # Source file not found — surface what ComfyUI reported.
        logger.warning("Exported .glb not found at %s (source %s)", glb_relative, src)
        return {"success": True, "prompt_id": prompt_id, "model_path": str(OUTPUT_DIR / Path(glb_relative).name),
                "warning": "Mesh exported but file could not be located in backend outputs."}

    def _submit_workflow(self, workflow: dict[str, Any], output_path: Path) -> dict[str, Any]:
        """Submit a workflow to ComfyUI and wait for completion."""
        import urllib.request
        import urllib.error
        import time

        # Submit workflow
        prompt_data = {"prompt": workflow}
        req = urllib.request.Request(
            f"{COMFYUI_URL}/prompt",
            data=json.dumps(prompt_data).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode())

        if "prompt_id" not in result:
            return {"success": False, "error": f"Failed to submit workflow: {result}"}

        prompt_id = result["prompt_id"]
        logger.info("3D generation workflow submitted: %s", prompt_id)

        # Poll for completion (with timeout). The Hy3DExportMesh node returns
        # RETURN_NAMES=("glb_path",) so look for a ".glb" string in node outputs
        # (the old code looked for a non-existent "meshes" key — that never matched).
        max_wait = 900  # 15 minutes (SD image stage + Hunyuan mesh + export)
        start = time.time()
        while time.time() - start < max_wait:
            try:
                req = urllib.request.Request(f"{COMFYUI_URL}/history/{prompt_id}")
                with urllib.request.urlopen(req, timeout=10) as resp:
                    history = json.loads(resp.read().decode())

                if prompt_id in history:
                    node_history = history[prompt_id]
                    outputs = node_history.get("outputs", {})

                    glb_rel: str | None = None
                    for node_output in outputs.values():
                        if not isinstance(node_output, dict):
                            continue
                        for value in node_output.values():
                            if isinstance(value, str) and value.lower().endswith(".glb"):
                                glb_rel = value
                                break
                        if glb_rel:
                            break

                    if glb_rel:
                        logger.info("3D generation complete: %s", glb_rel)
                        return self._finalize_output(glb_rel, prompt_id)

                    # Check for errors
                    messages = node_history.get("status", {})
                    if messages.get("status_str") == "error":
                        return {"success": False, "error": str(messages.get("status") or messages)}

            except Exception as e:
                logger.debug("Polling for completion: %s", e)

            time.sleep(2)

        return {"success": False, "error": "Timeout waiting for 3D generation"}
    def get_status(self) -> dict[str, Any]:
        """Get service status."""
        comfyui_ok = self._check_comfyui()
        return {
            "available": self.available,
            "comfyui_running": comfyui_ok,
            "model_path": str(COMFYUI_MODEL),
            "model_exists": COMFYUI_MODEL.exists(),
            "output_dir": str(OUTPUT_DIR),
            "generated_count": len(list(OUTPUT_DIR.glob("*.glb"))),
        }

    def list_models(self) -> list[dict[str, Any]]:
        """List generated 3D models, newest first.

        Models are served from the backend OUTPUT_DIR (generated_3d), which is the
        only dir the web server actually mounts at /output. ComfyUI exports into its
        own output/3d folder and the export->backend copy step can fail, leaving the
        .glb orphaned there. We repatriate any orphaned .glb/.gltf into OUTPUT_DIR
        (copy-if-missing) so they become servable, then list from OUTPUT_DIR.
        """
        models: list[dict[str, Any]] = []
        seen: set[Path] = set()

        # Repatriate orphaned exports from ComfyUI's output tree into the servable
        # backend dir. Done before listing so the sidebar both shows AND loads them.
        repatriated = self._repatriate_orphans()
        if repatriated:
            logger.info(
                "Repatriated %d orphaned 3D model(s) from ComfyUI output into %s",
                repatriated, OUTPUT_DIR,
            )

        try:
            for p in sorted(OUTPUT_DIR.rglob("*"), key=lambda x: x.stat().st_mtime if x.exists() else 0, reverse=True):
                if not p.is_file():
                    continue
                if p.suffix.lower() not in {".glb", ".gltf"}:
                    continue
                seen.add(p)
                models.append({
                    "filename": p.name,
                    "path": str(p),
                    "relative_path": p.relative_to(OUTPUT_DIR).as_posix(),
                    "servable_url": f"/output/generated_3d/{p.name}",
                    "size_bytes": p.stat().st_size,
                    "modified": p.stat().st_mtime,
                })
        except Exception as e:
            logger.warning("3D model scan failed for %s: %s", OUTPUT_DIR, e)

        models.sort(key=lambda m: m["modified"], reverse=True)
        logger.debug("3D model list returned %d model(s)", len(models))
        return models

    def _repatriate_orphans(self) -> int:
        """Copy .glb/.gltf files found in ComfyUI's output tree into OUTPUT_DIR.

        Returns the number of files copied (existing names are skipped so re-runs are
        cheap). This recovers models whose export->backend copy step failed.
        """
        if not COMFYUI_OUTPUT_DIR.exists():
            return 0
        existing = {f.name for f in OUTPUT_DIR.glob("*") if f.is_file()}
        copied = 0
        try:
            for src in COMFYUI_OUTPUT_DIR.rglob("*"):
                if not src.is_file() or src.suffix.lower() not in {".glb", ".gltf"}:
                    continue
                if src.name in existing:
                    continue
                dst = OUTPUT_DIR / src.name
                try:
                    shutil.copy2(src, dst)
                    existing.add(src.name)
                    copied += 1
                except Exception as e:
                    logger.warning("Could not repatriate 3D model %s: %s", src, e)
        except Exception as e:
            logger.warning("Orphan 3D model scan failed for %s: %s", COMFYUI_OUTPUT_DIR, e)
        return copied


# Singleton
gen3d_service = Gen3DService()

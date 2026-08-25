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
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Paths
COMFYUI_DIR = Path(r"D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI")
COMFYUI_MODEL = COMFYUI_DIR / "models" / "diffusion_models" / "hunyuan3d-2mini"
COMFYUI_URL = "http://127.0.0.1:8188"
OUTPUT_DIR = Path(r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\output\generated_3d")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


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

    def generate_from_text(
        self,
        prompt: str,
        output_name: str | None = None,
        steps: int = 15,
        seed: int = 42,
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
            from ..services.vram_manager import vram_manager
            vram_result = await vram_manager.begin_3d_generation()
            logger.info("VRAM pre-3d generation: %s", vram_result)

            try:
                # Build workflow for text-to-3D via Kijai Wrapper
                workflow = self._build_text23d_workflow(prompt, output_name, steps, seed)
                result = self._submit_workflow(workflow, output_path)
                return result
            finally:
                # VRAM Management: Reload Ollama after 3D generation
                vram_cleanup = await vram_manager.end_3d_generation()
                logger.info("VRAM post-3d generation: %s", vram_cleanup)

        except Exception as e:
            logger.error("3D generation failed: %s", e, exc_info=True)
            # Ensure Ollama is reloaded even on error
            from ..services.vram_manager import vram_manager
            await vram_manager.end_3d_generation()
            return {"success": False, "error": str(e)}

    def generate_from_image(
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
            from ..services.vram_manager import vram_manager
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
            from ..services.vram_manager import vram_manager
            await vram_manager.end_3d_generation()
            return {"success": False, "error": str(e)}

    def _build_text23d_workflow(
        self,
        prompt: str,
        output_name: str,
        steps: int,
        seed: int,
    ) -> dict[str, Any]:
        """Build ComfyUI workflow JSON for text-to-3D using Kijai Wrapper nodes."""
        # Kijai Wrapper node chain for text-to-3D:
        # Hy3DModelLoader -> Hy3DGenerateMesh -> Hy3DVAEDecode -> Hy3DExportMesh
        return {
            "1": {
                "class_type": "Hy3DModelLoader",
                "inputs": {
                    "model": "hunyuan3d-2mini\\hunyuan3d-dit-v2-mini\\model.fp16.safetensors"
                }
            },
            "2": {
                "class_type": "Hy3DGenerateMesh",
                "inputs": {
                    "pipeline": ["1", 0],
                    "guidance_scale": 5.5,
                    "steps": steps,
                    "seed": seed,
                }
            },
            "3": {
                "class_type": "Hy3DVAEDecode",
                "inputs": {
                    "latents": ["2", 0],
                    "vae": ["1", 1],
                    "box_v": 1.01,
                    "octree_resolution": 256,
                    "num_chunks": 8000,
                    "mc_level": 0,
                    "mc_algo": "mc",
                }
            },
            "4": {
                "class_type": "Hy3DExportMesh",
                "inputs": {
                    "trimesh": ["3", 0],
                    "filename_prefix": f"output/3d/{output_name}",
                    "file_format": "glb",
                }
            }
        }

    def _build_image23d_workflow(
        self,
        image_path: str,
        output_name: str,
        steps: int,
    ) -> dict[str, Any]:
        """Build ComfyUI workflow JSON for image-to-3D using Kijai Wrapper nodes."""
        # Upload image first, then use it in workflow
        uploaded = self._upload_image(image_path)
        image_name = uploaded.get("name", Path(image_path).name)

        return {
            "1": {
                "class_type": "Hy3DModelLoader",
                "inputs": {
                    "model": "hunyuan3d-2mini\\hunyuan3d-dit-v2-mini\\model.fp16.safetensors"
                }
            },
            "2": {
                "class_type": "LoadImage",
                "inputs": {
                    "image": image_name
                }
            },
            "3": {
                "class_type": "Hy3DGenerateMesh",
                "inputs": {
                    "pipeline": ["1", 0],
                    "image": ["2", 0],
                    "guidance_scale": 5.5,
                    "steps": steps,
                    "seed": 42,
                }
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
                }
            },
            "5": {
                "class_type": "Hy3DExportMesh",
                "inputs": {
                    "trimesh": ["4", 0],
                    "filename_prefix": f"output/3d/{output_name}",
                    "file_format": "glb",
                }
            }
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

        # Poll for completion (with timeout)
        max_wait = 600  # 10 minutes
        start = time.time()
        while time.time() - start < max_wait:
            try:
                req = urllib.request.Request(f"{COMFYUI_URL}/history/{prompt_id}")
                with urllib.request.urlopen(req, timeout=10) as resp:
                    history = json.loads(resp.read().decode())

                if prompt_id in history:
                    # Workflow completed
                    outputs = history[prompt_id].get("outputs", {})
                    for node_id, node_output in outputs.items():
                        if "meshes" in node_output:
                            for mesh in node_output["meshes"]:
                                if mesh.get("filename"):
                                    return {
                                        "success": True,
                                        "model_path": mesh.get("filename"),
                                        "prompt_id": prompt_id,
                                    }

                    # Check for errors
                    messages = history[prompt_id].get("status", {})
                    if messages.get("status_str") == "error":
                        return {"success": False, "error": str(messages)}

                    return {"success": True, "prompt_id": prompt_id, "outputs": outputs}

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


# Singleton
gen3d_service = Gen3DService()

"""
3D asset generation service.

Provides text-to-3D and image-to-3D generation using multiple backends
appropriate for the GTX 1070 Ti (8GB VRAM, sm_61):

- **Hunyuan3D-2mini** (geometry, ~5GB) — native ComfyUI or Kijai wrapper
- **Hunyuan3D-2mv** (geometry, ~6GB) — native ComfyUI multi-view
- **TripoSR** (geometry, ~4GB) — fastest, ComfyUI-3D-Pack
- **Stable Fast 3D** (geometry+UV, ~6GB) — ComfyUI-3D-Pack

PyTorch 2.14.0+cu126 is the LAST prebuilt wheel supporting Pascal (sm_61).
From 2.15 onward, must build from source or stay on 2.14.
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
COMFYUI_URL = app_config.comfyui_url
# ComfyUI writes exported meshes to its own output directory.
COMFYUI_OUTPUT_DIR = COMFYUI_DIR / "output"
OUTPUT_DIR = app_config.output_dir / "generated_3d"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# SD1.5 checkpoint used to generate an image that Hunyuan3D-2mini conditions on
# (Hunyuan3D is image-to-3D; the model node REQUIRES an IMAGE input).
SD_CHECKPOINT = "v1-5-pruned-emaonly.safetensors"

# Model backends available for 8GB VRAM.
# Each backend specifies the model path, expected node names, and VRAM budget.
MODEL_BACKENDS = {
    "hunyuan3d_2mini": {
        "name": "Hunyuan3D-2mini",
        "vram_gb": 5,
        "speed_s": "30-60",
        "quality": "Very good",
        "description": "0.6B parameter image-to-shape. Geometry only. Fastest Hunyuan variant.",
        "checkpoint_subpath": "hunyuan3d-2mini/hunyuan3d-dit-v2-mini/model.fp16.safetensors",
        "diffusion_subpath": "hunyuan3d-2mini/hunyuan3d-dit-v2-mini/model.fp16.safetensors",
        "supports_texture": False,
        "supports_multiview": False,
        "supports_native": True,
        "supports_kijai": True,
        "octree_resolution": 256,
        "num_chunks": 8000,
        "target_faces": 30000,
    },
    "hunyuan3d_2mv": {
        "name": "Hunyuan3D-2mv",
        "vram_gb": 6,
        "speed_s": "60-120",
        "quality": "Excellent (multi-view)",
        "description": "1.1B parameter multi-view image-to-shape. Geometry only. Better unseen-side accuracy.",
        "checkpoint_subpath": "hunyuan3d-2mv/hunyuan3d-dit-v2-mv/model.fp16.safetensors",
        "diffusion_subpath": "hunyuan3d-2mv/hunyuan3d-dit-v2-mv/model.fp16.safetensors",
        "supports_texture": False,
        "supports_multiview": True,
        "supports_native": True,
        "supports_kijai": True,
        "octree_resolution": 256,
        "num_chunks": 10000,
        "target_faces": 30000,
    },
    "triposr": {
        "name": "TripoSR",
        "vram_gb": 4,
        "speed_s": "0.5",
        "quality": "Good",
        "description": "Single-pass feedforward 3D reconstruction. Fastest option. ~0.5s per mesh.",
        "checkpoint_subpath": "triposr/model.safetensors",
        "diffusion_subpath": None,
        "supports_texture": False,
        "supports_multiview": False,
        "supports_native": False,
        "supports_kijai": False,
        "octree_resolution": None,
        "num_chunks": None,
        "target_faces": 50000,
    },
    "stable_fast_3d": {
        "name": "Stable Fast 3D",
        "vram_gb": 6,
        "speed_s": "2-5",
        "quality": "Good+ (UV unwrapped)",
        "description": "Fast textured mesh with UV unwrapping. Based on TripoSR with explicit UV optimization.",
        "checkpoint_subpath": "stable-fast-3d/model.safetensors",
        "diffusion_subpath": None,
        "supports_texture": False,
        "supports_multiview": False,
        "supports_native": False,
        "supports_kijai": False,
        "octree_resolution": None,
        "num_chunks": None,
        "target_faces": 50000,
    },
}

# Default backend for new requests
DEFAULT_BACKEND = "hunyuan3d_2mini"


class Gen3DService:
    """Generate 3D assets from text or image prompts using ComfyUI + multiple backends.

    Supports backends appropriate for 8GB VRAM (GTX 1070 Ti, sm_61):
    - hunyuan3d_2mini: geometry via native ComfyUI or Kijai wrapper (~5 GB)
    - hunyuan3d_2mv: multi-view geometry via native ComfyUI (~6 GB)
    - triposr: ultra-fast feedforward mesh (~4 GB)
    - stable_fast_3d: fast mesh with UVs (~6 GB)

    PyTorch 2.14.0+cu126 is the LAST prebuilt wheel supporting Pascal (sm_61).
    From 2.15 onward, must build from source or stay on 2.14.
    """

    def __init__(self, backend: str = DEFAULT_BACKEND):
        self.backend = backend if backend in MODEL_BACKENDS else DEFAULT_BACKEND
        backend_info = MODEL_BACKENDS[self.backend]
        self.backend_name = backend_info["name"]
        self.octree_resolution = backend_info.get("octree_resolution") or 256
        self.num_chunks = backend_info.get("num_chunks") or 8000
        self.target_faces = backend_info.get("target_faces") or 30000

        # Resolve model path for availability check
        if self.backend in ("hunyuan3d_2mini", "hunyuan3d_2mv"):
            subpath = backend_info["diffusion_subpath"] or backend_info["checkpoint_subpath"]
            self.model_dir = COMFYUI_DIR / "models" / "diffusion_models" / subpath
        elif self.backend == "triposr":
            self.model_dir = COMFYUI_DIR / "models" / "checkpoints" / "triposr"
        elif self.backend == "stable_fast_3d":
            self.model_dir = COMFYUI_DIR / "models" / "checkpoints" / "stable-fast-3d"
        else:
            self.model_dir = None

        self.available = self._check_comfyui()
        if self.available and self.model_dir and not self.model_dir.exists():
            logger.warning("3D model missing for backend '%s': %s", self.backend, self.model_dir)
            self.available = False
        if self.available:
            logger.info("3D generation service ready: %s via ComfyUI", self.backend_name)
        else:
            logger.warning("3D generation unavailable: backend=%s comfyui=%s model_exists=%s",
                           self.backend, self.available,
                           self.model_dir.exists() if self.model_dir else "n/a")

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
        backend: str = DEFAULT_BACKEND,
    ) -> dict[str, Any]:
        """Generate a 3D model from a text prompt.

        Args:
            prompt: Text description of the 3D object.
            output_name: Optional filename (without extension).
            steps: Diffusion steps (lower = faster, 10-20 typical).
            seed: Random seed for reproducibility.
            backend: Model backend override (hunyuan3d_2mini, hunyuan3d_2mv, triposr, stable_fast_3d).

        Returns:
            Dict with 'success', 'model_path', 'preview_path', 'metadata'.
        """
        if backend != self.backend:
            # Spin up a fresh service instance for the requested backend
            svc = Gen3DService(backend=backend)
            if not svc.available:
                return {"success": False, "error": f"Backend '{backend}' not available"}
            return await svc.generate_from_text(prompt, output_name, steps, seed, cfg)

        if not self.available:
            return {"success": False, "error": "3D generation service not available"}

        import time as _time, random as _rand
        # ensure unique, filesystem-safe name — previous truncated to 30 chars caused 4 identical prefixes
        base = self._sanitize_name(output_name or prompt[:40]) or "gen3d"
        # add seed + timestamp nonce to avoid Collisions when same prompt reused with same seed
        nonce = f"{seed}_{int(_time.time())%10000}_{_rand.randint(100,999)}"
        output_name = f"{base}_{nonce}"
        output_path = OUTPUT_DIR / f"{output_name}.glb"

        try:
            # VRAM Management: Offload Ollama before 3D generation
            from ..vram_manager import vram_manager
            vram_result = await vram_manager.begin_3d_generation()
            logger.info("VRAM pre-3d generation: %s", vram_result)

            try:
                # Build workflow for text-to-3D via Kijai Wrapper
                workflow = self._build_text23d_workflow(prompt, output_name, steps, seed, cfg)
                result = await self._submit_workflow(workflow, output_path)
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
        backend: str = DEFAULT_BACKEND,
    ) -> dict[str, Any]:
        """Generate a 3D model from an input image.

        Args:
            image_path: Path to the input image.
            output_name: Optional filename (without extension).
            steps: Diffusion steps.
            backend: Model backend override.

        Returns:
            Dict with 'success', 'model_path', 'preview_path', 'metadata'.
        """
        if backend != self.backend:
            svc = Gen3DService(backend=backend)
            if not svc.available:
                return {"success": False, "error": f"Backend '{backend}' not available"}
            return await svc.generate_from_image(image_path, output_name, steps)

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
                workflow = self._build_image23d_workflow(image_path, output_name, steps)
                result = await self._submit_workflow(workflow, output_path)
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

    # Quality knobs for the 8GB GTX 1070 Ti. These are tuned for the fast variant:
    # lower octree resolution + fewer chunks + reduced SD steps keep decode under ~6.5GB.
    OCTREE_RESOLUTION = 256
    NUM_CHUNKS = 8_000
    # Target face count for the post-process decimate pass.
    TARGET_FACES = 30_000

    def _build_text23d_workflow(
        self,
        prompt: str,
        output_name: str,
        steps: int,
        seed: int,
        cfg: float = 7.0,
    ) -> dict[str, Any]:
        """Build a ComfyUI workflow for text-to-3D.

        Dispatches to the appropriate workflow builder based on the selected backend.
        """
        proc_output_name = self._sanitize_name(output_name)

        if self.backend in ("hunyuan3d_2mini", "hunyuan3d_2mv"):
            return self._build_hunyuan_text23d_workflow(
                prompt, proc_output_name, steps, seed, cfg
            )
        elif self.backend == "triposr":
            # TripoSR is image-only; first render a concept image, then generate 3D
            return self._build_triposr_text23d_workflow(
                prompt, proc_output_name, seed
            )
        elif self.backend == "stable_fast_3d":
            return self._build_sf3d_text23d_workflow(
                prompt, proc_output_name, seed
            )
        else:
            raise ValueError(f"Unsupported backend for text-to-3D: {self.backend}")

    def _build_hunyuan_text23d_workflow(
        self,
        prompt: str,
        output_name: str,
        steps: int,
        seed: int,
        cfg: float = 7.0,
    ) -> dict[str, Any]:
        """Build ComfyUI workflow: SD1.5 text-to-image, then Hunyuan3D image-to-mesh.

        Hunyuan3D-2mini is an image-to-3D model — its Hy3DGenerateMesh node requires an
        IMAGE input (verified against the live node schema). So for a text prompt we first
        render a 512x512 concept image with the local SD1.5 checkpoint, then feed that
        image into the Hunyuan3D wrapper chain.

        After the VAE decode we run the documented post-process chain
        (Hy3DPostprocessMesh -> Hy3DMeshUVWrap) so the exported GLB carries smooth
        normals and UVs instead of being a raw, untextured octree voxel mesh.
        """
        backend_info = MODEL_BACKENDS[self.backend]
        model_path = backend_info["diffusion_subpath"] or backend_info["checkpoint_subpath"]

        # Hunyuan expects isolated object on white background — add hint if missing (helps avoid alien blob)
        enhanced_prompt = prompt
        if "white background" not in prompt.lower() and "isolated" not in prompt.lower():
            enhanced_prompt = f"{prompt}, white background, isolated object, centered, product photo, studio lighting"

        return {
            "1": {
                "class_type": "Hy3DModelLoader",
                "inputs": {"model": model_path.replace("\\", "/")},
            },
            # --- Stage 1: text -> image (SD1.5, 512x512) ---
            "2": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {"ckpt_name": SD_CHECKPOINT},
            },
            "3": {
                "class_type": "CLIPTextEncode",
                "inputs": {"text": enhanced_prompt, "clip": ["2", 1]},
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
                    "steps": 16,
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
                    "octree_resolution": self.octree_resolution,
                    "num_chunks": self.num_chunks,
                    "mc_level": 0,
                    "mc_algo": "mc",
                },
            },
            # --- Stage 3: post-process the raw octree mesh ---
            "11": {
                "class_type": "Hy3DPostprocessMesh",
                "inputs": {
                    "trimesh": ["9", 0],
                    "remove_floaters": True,
                    "remove_degenerate_faces": True,
                    "reduce_faces": True,
                    "max_facenum": self.target_faces,
                    "smooth_normals": True,
                },
            },
            "12": {
                "class_type": "Hy3DMeshUVWrap",
                "inputs": {"trimesh": ["11", 0]},
            },
            "13": {
                "class_type": "Hy3DExportMesh",
                "inputs": {
                    "trimesh": ["12", 0],
                    "filename_prefix": f"3d/{output_name}",
                    "file_format": "glb",
                },
            },
        }

    def _build_triposr_text23d_workflow(
        self,
        prompt: str,
        output_name: str,
        seed: int,
    ) -> dict[str, Any]:
        """Build ComfyUI workflow: SD1.5 text-to-image, then TripoSR image-to-mesh."""
        enhanced_prompt = prompt
        if "white background" not in prompt.lower():
            enhanced_prompt = f"{prompt}, white background, isolated object, centered, product photo"

        return {
            # Stage 1: text -> image (SD1.5)
            "1": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {"ckpt_name": SD_CHECKPOINT},
            },
            "2": {
                "class_type": "CLIPTextEncode",
                "inputs": {"text": enhanced_prompt, "clip": ["1", 1]},
            },
            "3": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": "blurry, lowres, jpeg artifacts, cartoon, illustration, text, watermark",
                    "clip": ["1", 1],
                },
            },
            "4": {
                "class_type": "EmptyLatentImage",
                "inputs": {"width": 512, "height": 512, "batch_size": 1},
            },
            "5": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": seed,
                    "steps": 16,
                    "cfg": 7.0,
                    "sampler_name": "euler",
                    "scheduler": "normal",
                    "denoise": 1.0,
                    "model": ["1", 0],
                    "positive": ["2", 0],
                    "negative": ["3", 0],
                    "latent_image": ["4", 0],
                },
            },
            "6": {
                "class_type": "VAEDecode",
                "inputs": {"samples": ["5", 0], "vae": ["1", 2]},
            },
            # Stage 2: TripoSR image -> mesh
            "7": {
                "class_type": "TripoSRGenerate",
                "inputs": {
                    "image": ["6", 0],
                    "resolution": 512,
                    "quality_preset": "balanced",
                    "mesh_format": "glb",
                },
            },
            "8": {
                "class_type": "Save3DModel",
                "inputs": {
                    "mesh": ["7", 0],
                    "filename_prefix": f"3d/{output_name}",
                    "format": "glb",
                },
            },
        }

    def _build_sf3d_text23d_workflow(
        self,
        prompt: str,
        output_name: str,
        seed: int,
    ) -> dict[str, Any]:
        """Build ComfyUI workflow: SD1.5 text-to-image, then StableFast3D image-to-mesh."""
        enhanced_prompt = prompt
        if "white background" not in prompt.lower():
            enhanced_prompt = f"{prompt}, white background, isolated object, centered, product photo"

        return {
            # Stage 1: text -> image (SD1.5)
            "1": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {"ckpt_name": SD_CHECKPOINT},
            },
            "2": {
                "class_type": "CLIPTextEncode",
                "inputs": {"text": enhanced_prompt, "clip": ["1", 1]},
            },
            "3": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": "blurry, lowres, jpeg artifacts, cartoon, illustration, text, watermark",
                    "clip": ["1", 1],
                },
            },
            "4": {
                "class_type": "EmptyLatentImage",
                "inputs": {"width": 512, "height": 512, "batch_size": 1},
            },
            "5": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": seed,
                    "steps": 16,
                    "cfg": 7.0,
                    "sampler_name": "euler",
                    "scheduler": "normal",
                    "denoise": 1.0,
                    "model": ["1", 0],
                    "positive": ["2", 0],
                    "negative": ["3", 0],
                    "latent_image": ["4", 0],
                },
            },
            "6": {
                "class_type": "VAEDecode",
                "inputs": {"samples": ["5", 0], "vae": ["1", 2]},
            },
            # Stage 2: StableFast3D image -> mesh
            "7": {
                "class_type": "Comfy3DLoadSF3DModel",
                "inputs": {"model_name": "stable-fast-3d"},
            },
            "8": {
                "class_type": "Comfy3DStableFast3D",
                "inputs": {
                    "sf3d_model": ["7", 0],
                    "image": ["6", 0],
                    "resolution": 512,
                    "mesh_format": "glb",
                },
            },
            "9": {
                "class_type": "Save3DModel",
                "inputs": {
                    "mesh": ["8", 0],
                    "filename_prefix": f"3d/{output_name}",
                    "format": "glb",
                },
            },
        }

    def _build_image23d_workflow(
        self,
        image_path: str,
        output_name: str,
        steps: int,
    ) -> dict[str, Any]:
        """Build ComfyUI workflow JSON for image-to-3D based on the selected backend."""
        uploaded = self._upload_image(image_path)
        image_name = uploaded.get("name", Path(image_path).name)
        proc_output_name = self._sanitize_name(output_name)

        if self.backend in ("hunyuan3d_2mini", "hunyuan3d_2mv"):
            backend_info = MODEL_BACKENDS[self.backend]
            model_path = backend_info["diffusion_subpath"] or backend_info["checkpoint_subpath"]

            return {
                "1": {
                    "class_type": "Hy3DModelLoader",
                    "inputs": {"model": model_path.replace("\\", "/")},
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
                        "octree_resolution": self.octree_resolution,
                        "num_chunks": self.num_chunks,
                        "mc_level": 0,
                        "mc_algo": "mc",
                    },
                },
                "5": {
                    "class_type": "Hy3DPostprocessMesh",
                    "inputs": {
                        "trimesh": ["4", 0],
                        "remove_floaters": True,
                        "remove_degenerate_faces": True,
                        "reduce_faces": True,
                        "max_facenum": self.target_faces,
                        "smooth_normals": True,
                    },
                },
                "6": {
                    "class_type": "Hy3DMeshUVWrap",
                    "inputs": {"trimesh": ["5", 0]},
                },
                "7": {
                    "class_type": "Hy3DExportMesh",
                    "inputs": {
                        "trimesh": ["6", 0],
                        "filename_prefix": f"3d/{proc_output_name}",
                        "file_format": "glb",
                    },
                },
            }
        elif self.backend == "triposr":
            return {
                "1": {
                    "class_type": "LoadImage",
                    "inputs": {"image": image_name},
                },
                "2": {
                    "class_type": "TripoSRGenerate",
                    "inputs": {
                        "image": ["1", 0],
                        "resolution": 512,
                        "quality_preset": "balanced",
                        "mesh_format": "glb",
                    },
                },
                "3": {
                    "class_type": "Save3DModel",
                    "inputs": {
                        "mesh": ["2", 0],
                        "filename_prefix": f"3d/{proc_output_name}",
                        "format": "glb",
                    },
                },
            }
        elif self.backend == "stable_fast_3d":
            return {
                "1": {
                    "class_type": "LoadImage",
                    "inputs": {"image": image_name},
                },
                "2": {
                    "class_type": "Comfy3DLoadSF3DModel",
                    "inputs": {"model_name": "stable-fast-3d"},
                },
                "3": {
                    "class_type": "Comfy3DStableFast3D",
                    "inputs": {
                        "sf3d_model": ["2", 0],
                        "image": ["1", 0],
                        "resolution": 512,
                        "mesh_format": "glb",
                    },
                },
                "4": {
                    "class_type": "Save3DModel",
                    "inputs": {
                        "mesh": ["3", 0],
                        "filename_prefix": f"3d/{proc_output_name}",
                        "format": "glb",
                    },
                },
            }
        else:
            raise ValueError(f"Unsupported backend for image-to-3D: {self.backend}")

    def _upload_image(self, image_path: str) -> dict[str, Any]:
        """Copy the ComfyUI-exported .glb into the backend output dir, decimate if needed, and return its path."""
        logger.info("Finalizing output: %s", glb_relative)
        cand = Path(glb_relative)
        src = cand if cand.is_absolute() and cand.exists() else COMFYUI_OUTPUT_DIR / cand
        if not src.exists():
            # Fallback: search the ComfyUI output tree for the basename
            fallback = next(COMFYUI_OUTPUT_DIR.rglob(cand.name), None)
            src = fallback or src

        if src.is_file():
            dst = OUTPUT_DIR / src.name
            try:
                shutil.copy2(src, dst)
                logger.info("Copied .glb to: %s", dst)
            except Exception as e:
                logger.warning("Could not copy .glb into outputs: %s", e)
                return {"success": True, "prompt_id": prompt_id, "model_path": str(src),
                        "warning": f"Mesh exported but could not be copied to backend outputs: {e}"}
            
            # Post-process: decimate if mesh is too large
            decimate_result = self._decimate_if_needed(dst)
            # Apply chrome PBR if prompt looks metallic (fast variant is always untextured gray)
            # This turns the "alien gray blob" into the intended chrome look without needing the 2GB paint model
            try:
                if any(k in dst.name.lower() for k in ("chrome", "robot", "metal")) or decimate_result.get("decimated") is not None:
                    chrome_res = self._apply_chrome_material(dst)
                    if chrome_res.get("success"):
                        logger.info("Applied chrome material to %s", dst.name)
            except Exception as e:
                logger.debug("Chrome apply skipped: %s", e)
            
            return {"success": True, "model_path": str(dst), "prompt_id": prompt_id, "decimate": decimate_result}
        # Source file not found — surface what ComfyUI reported.
        logger.warning("Exported .glb not found at %s (source %s)", glb_relative, src)
        return {"success": True, "prompt_id": prompt_id, "model_path": str(OUTPUT_DIR / Path(glb_relative).name),
                "warning": "Mesh exported but file could not be located in backend outputs."}

    def _decimate_if_needed(self, glb_path: Path, target_faces: int = 50000) -> dict:
        """Decimate a GLB mesh if it exceeds the target face count.
        
        Uses Blender's Python API to reduce polygon count for manageable file sizes.
        """
        try:
            import subprocess
            import tempfile
            
            blender_exe = r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
            script_path = Path(__file__).parent / "decimate_glb.py"
            
            if not script_path.exists():
                logger.warning("Decimation script not found: %s", script_path)
                return {"decimated": False, "reason": "script_not_found"}
            
            # Create temp output path
            temp_output = glb_path.with_suffix(".decimated.glb")
            
            result = subprocess.run(
                [
                    blender_exe, "--background", "--python", str(script_path),
                    "--", str(glb_path), str(temp_output), str(target_faces)
                ],
                capture_output=True,
                text=True,
                timeout=180  # 3 minutes max for large meshes
            )
            
            if result.returncode == 0 and temp_output.exists():
                # Replace original with decimated version
                original_size = glb_path.stat().st_size
                temp_size = temp_output.stat().st_size
                
                if temp_size < original_size:
                    # Backup original and replace
                    backup_path = glb_path.with_suffix(".original.glb")
                    if not backup_path.exists():
                        glb_path.rename(backup_path)
                    temp_output.rename(glb_path)
                    
                    logger.info(
                        "Decimated %s: %.1fMB -> %.1fMB",
                        glb_path.name,
                        original_size / 1024 / 1024,
                        glb_path.stat().st_size / 1024 / 1024
                    )
                    return {
                        "decimated": True,
                        "original_size_mb": round(original_size / 1024 / 1024, 1),
                        "final_size_mb": round(glb_path.stat().st_size / 1024 / 1024, 1)
                    }
                else:
                    # Decimated version is larger (shouldn't happen often)
                    temp_output.unlink(missing_ok=True)
                    return {"decimated": False, "reason": "decimated_larger"}
            else:
                logger.warning("Decimation failed: %s", result.stderr[:500] if result.stderr else "unknown")
                return {"decimated": False, "reason": "blender_error"}
                
        except subprocess.TimeoutExpired:
            logger.warning("Decimation timed out for %s", glb_path.name)
            return {"decimated": False, "reason": "timeout"}
        except Exception as e:
            logger.warning("Decimation error for %s: %s", glb_path.name, e)
            return {"decimated": False, "reason": str(e)}

    def _apply_chrome_material(self, glb_path: Path) -> dict:
        """Apply chrome PBR material to an untextured GLB (fast variant is always gray)."""
        try:
            import subprocess
            blender_exe = r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
            script_path = Path(__file__).parent / "apply_chrome.py"
            if not script_path.exists():
                return {"success": False, "reason": "script_not_found"}
            tmp = glb_path.with_suffix(".chrome.glb")
            result = subprocess.run([blender_exe, "--background", "--python", str(script_path), "--", str(glb_path), str(tmp)], capture_output=True, text=True, timeout=60)
            if result.returncode == 0 and tmp.exists():
                # replace original with chromed version
                tmp.replace(glb_path)
                return {"success": True}
            return {"success": False, "reason": result.stderr[:500] if result.stderr else "unknown"}
        except Exception as e:
            return {"success": False, "reason": str(e)}

    async def _submit_workflow(self, workflow: dict[str, Any], output_path: Path) -> dict[str, Any]:
        """Submit a workflow to ComfyUI and wait for completion.

        Uses async polling so the event loop stays responsive. The Hy3DExportMesh
        node writes the GLB to disk but returns empty outputs in the history, so we
        also poll the ComfyUI output directory for new .glb files matching the
        expected filename prefix.
        """
        import asyncio
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

        # Determine the expected filename prefix from the workflow
        expected_prefix = None
        for node in workflow.values():
            if node.get("class_type") == "Hy3DExportMesh":
                expected_prefix = node.get("inputs", {}).get("filename_prefix", "")
                break

        max_wait = 900  # 15 minutes (SD image stage + Hunyuan mesh + export)
        start = time.time()
        last_log = 0
        while time.time() - start < max_wait:
            elapsed = time.time() - start
            try:
                # Check ComfyUI history for completion
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

                    # Check if execution completed (success but empty outputs)
                    status = node_history.get("status", {})
                    if status.get("completed"):
                        # Hy3DExportMesh writes to disk but returns empty outputs
                        # Poll the output directory for the GLB
                        if expected_prefix:
                            glb_name = f"{expected_prefix}_00001_.glb"
                            glb_path = COMFYUI_OUTPUT_DIR / glb_name
                            if glb_path.exists():
                                logger.info("3D generation complete (file found): %s", glb_path)
                                return self._finalize_output(str(glb_path), prompt_id)

                        # Fallback: search for any new GLB in the output directory
                        glb_files = sorted(
                            COMFYUI_OUTPUT_DIR.rglob("*.glb"),
                            key=lambda p: p.stat().st_mtime,
                            reverse=True,
                        )
                        for glb_file in glb_files:
                            if glb_file.stat().st_mtime > start:
                                logger.info("3D generation complete (new file): %s", glb_file)
                                return self._finalize_output(str(glb_file), prompt_id)

            except Exception as e:
                logger.debug("Polling for completion: %s", e)

            # Log progress every 30 seconds
            if elapsed - last_log >= 30:
                logger.info("3D generation in progress: %.0fs elapsed", elapsed)
                last_log = elapsed

            await asyncio.sleep(2)

        return {"success": False, "error": "Timeout waiting for 3D generation"}
    def get_status(self) -> dict[str, Any]:
        """Get service status."""
        comfyui_ok = self._check_comfyui()
        return {
            "available": self.available,
            "backend": self.backend,
            "backend_name": self.backend_name,
            "comfyui_running": comfyui_ok,
            "model_path": str(self.model_dir) if self.model_dir else "n/a",
            "model_exists": self.model_dir.exists() if self.model_dir else False,
            "output_dir": str(OUTPUT_DIR),
            "generated_count": len(list(OUTPUT_DIR.glob("*.glb"))),
            "available_backends": list(MODEL_BACKENDS.keys()),
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

        Returns the number of files copied or refreshed. Existing files are overwritten
        when the ComfyUI source is newer so the backend output stays in sync with the
        latest generation.
        """
        if not COMFYUI_OUTPUT_DIR.exists():
            return 0
        existing = {f.name: f for f in OUTPUT_DIR.glob("*") if f.is_file()}
        copied = 0
        try:
            for src in COMFYUI_OUTPUT_DIR.rglob("*"):
                if not src.is_file() or src.suffix.lower() not in {".glb", ".gltf"}:
                    continue
                dst = OUTPUT_DIR / src.name
                try:
                    if dst.exists():
                        if src.stat().st_mtime <= dst.stat().st_mtime:
                            continue
                    shutil.copy2(src, dst)
                    existing.pop(src.name, None)
                    copied += 1
                except Exception as e:
                    logger.warning("Could not repatriate 3D model %s: %s", src, e)
        except Exception as e:
            logger.warning("Orphan 3D model scan failed for %s: %s", COMFYUI_OUTPUT_DIR, e)
        return copied


# Singleton
gen3d_service = Gen3DService()

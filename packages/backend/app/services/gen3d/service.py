"""
3D asset generation service.

Provides text-to-3D and image-to-3D generation using Hunyuan3D-2mini
(optimized for 8GB VRAM GPUs like GTX 1070 Ti).

Uses the comfyui-cuda conda environment for PyTorch CUDA execution.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Paths
COMFYUI_DIR = Path(r"D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI")
COMFYUI_MODEL = COMFYUI_DIR / "models" / "diffusion_models" / "hunyuan3d-2mini"
CONDA_ENV = Path(r"D:\conda-envs\comfyui-cuda\Scripts\python.exe")
OUTPUT_DIR = Path(r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\output\generated_3d")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


class Gen3DService:
    """Generate 3D assets from text or image prompts using Hunyuan3D-2mini."""

    def __init__(self):
        self.available = COMFYUI_MODEL.exists() and CONDA_ENV.exists()
        if self.available:
            logger.info("3D generation service ready: Hunyuan3D-2mini at %s", COMFYUI_MODEL)
        else:
            logger.warning("3D generation unavailable: model=%s env=%s",
                           COMFYUI_MODEL.exists(), CONDA_ENV.exists())

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
            result = self._run_hunyuan_t23d(prompt, output_path, steps, seed)
            return result
        except Exception as e:
            logger.error("3D generation failed: %s", e)
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
            result = self._run_hunyuan_i23d(image_path, output_path, steps)
            return result
        except Exception as e:
            logger.error("Image-to-3D generation failed: %s", e)
            return {"success": False, "error": str(e)}

    def _run_hunyuan_t23d(
        self,
        prompt: str,
        output_path: Path,
        steps: int,
        seed: int,
    ) -> dict[str, Any]:
        """Run Hunyuan3D-2mini text-to-3D via the GP (GPU Poor) implementation."""
        # Use the deepbeepmeep/Hunyuan3D-2GP approach with low VRAM profile
        # Use repr() to safely embed paths in the script
        output_path_str = repr(str(output_path))
        model_path_str = repr(str(COMFYUI_MODEL))
        prompt_str = repr(prompt)
        
        script = f'''
import sys
import os
import torch

# Low VRAM profile for 8GB GPU
os.environ["CUDA_VISIBLE_DEVICES"] = "0"

from huggingface_hub import snapshot_download
model_path = {model_path_str}

# Load with memory-efficient settings
from diffusers import HunyuanDiTPipeline

pipe = Hunyuan3DDiTPipeline.from_pretrained(
    model_path,
    torch_dtype=torch.float16,
    variant="fp16",
)
pipe.to("cuda")
pipe.enable_attention_slicing()
pipe.enable_vae_slicing()

result = pipe(
    prompt={prompt_str},
    num_inference_steps={steps},
    seed={seed},
    guidance_scale=5.0,
)

# Export mesh
mesh = result.meshes[0]
mesh.export({output_path_str})

print(f"3D model saved to: " + {output_path_str})
'''

        return self._execute_script(script, output_path)

    def _run_hunyuan_i23d(
        self,
        image_path: str,
        output_path: Path,
        steps: int,
    ) -> dict[str, Any]:
        """Run Hunyuan3D-2mini image-to-3D."""
        output_path_str = repr(str(output_path))
        model_path_str = repr(str(COMFYUI_MODEL))
        image_path_str = repr(image_path)
        
        script = f'''
import os
import torch
from PIL import Image

os.environ["CUDA_VISIBLE_DEVICES"] = "0"

model_path = {model_path_str}
from diffusers import HunyuanDiTPipeline

pipe = Hunyuan3DDiTPipeline.from_pretrained(
    model_path,
    torch_dtype=torch.float16,
    variant="fp16",
)
pipe.to("cuda")
pipe.enable_attention_slicing()

image = Image.open({image_path_str}).convert("RGB")
result = pipe(image=image, num_inference_steps={steps}, guidance_scale=5.0)

mesh = result.meshes[0]
mesh.export({output_path_str})
print(f"3D model saved to: " + {output_path_str})
'''

        return self._execute_script(script, output_path)

    def _execute_script(self, script: str, output_path: Path) -> dict[str, Any]:
        """Execute a Python script in the comfyui-cuda environment."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            f.write(script)
            script_path = f.name

        try:
            result = subprocess.run(
                [str(CONDA_ENV), script_path],
                capture_output=True,
                text=True,
                timeout=600,  # 10 min timeout
                env={**os.environ, "CUDA_VISIBLE_DEVICES": "0"},
            )

            if result.returncode == 0 and output_path.exists():
                return {
                    "success": True,
                    "model_path": str(output_path),
                    "stdout": result.stdout,
                }
            else:
                return {
                    "success": False,
                    "error": result.stderr or result.stdout,
                    "returncode": result.returncode,
                }
        finally:
            os.unlink(script_path)

    def get_status(self) -> dict[str, Any]:
        """Get service status."""
        return {
            "available": self.available,
            "model_path": str(COMFYUI_MODEL),
            "model_exists": COMFYUI_MODEL.exists(),
            "env_path": str(CONDA_ENV),
            "env_exists": CONDA_ENV.exists(),
            "output_dir": str(OUTPUT_DIR),
            "generated_count": len(list(OUTPUT_DIR.glob("*.glb"))),
        }


# Singleton
gen3d_service = Gen3DService()

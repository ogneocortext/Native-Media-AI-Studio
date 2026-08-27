"""
ComfyUI adapter.
Provides integration with ComfyUI for image generation.
Implements BaseAdapter interface for text-to-image generation.
"""

import asyncio
import base64
import json
import logging
import uuid
from typing import Any

import aiohttp

from .base import AdapterStatus, BaseAdapter

logger = logging.getLogger(__name__)


class ComfyUIAdapter(BaseAdapter):
    """
    Adapter for ComfyUI API.

    Supports:
    - Text-to-image generation via ComfyUI workflow
    - Queue-based prompt execution
    - Image retrieval from ComfyUI history
    """

    def __init__(
        self, base_url: str = "http://127.0.0.1:8188", mock_mode: bool = False
    ):
        super().__init__(base_url, "ComfyUI", mock_mode=mock_mode)
        self._current_prompt_id: str | None = None
        self._last_health_log: str | None = None
        self._available_checkpoints: list[str] = []
        self._session: aiohttp.ClientSession | None = None

    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create a shared aiohttp session for this adapter."""
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                connector=aiohttp.TCPConnector(limit=5, ttl_dns_cache=300),
                timeout=aiohttp.ClientTimeout(total=30),
            )
        return self._session

    async def close(self):
        """Close the shared session."""
        if self._session and not self._session.closed:
            await self._session.close()
            self._session = None

    async def _fetch_available_checkpoints(self) -> list[str]:
        """Fetch available checkpoints from ComfyUI"""
        try:
            session = await self._get_session()
            async with session.get(
                f"{self.base_url}/object_info/CheckpointLoaderSimple",
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    if "CheckpointLoaderSimple" in data:
                        input_info = data["CheckpointLoaderSimple"]["input"]["required"]
                        if "ckpt_name" in input_info:
                            return input_info["ckpt_name"][0]
        except Exception as e:
            logger.warning(f"Failed to fetch available checkpoints: {e}")
        return []

    def _get_available_checkpoint(self) -> str:
        """Get the first available checkpoint or fallback to default"""
        if self._available_checkpoints:
            return self._available_checkpoints[0]
        
        # Common fallback checkpoints to try
        fallback_checkpoints = [
            "v1-5-pruned-emaonly.ckpt",
            "v1-5-pruned.ckpt",
            "sd_v1-5.ckpt",
            "sd_xl_base_1.0.safetensors",
        ]
        
        return fallback_checkpoints[0]

    async def health_check(self) -> bool:
        """Check if ComfyUI is available"""
        try:
            session = await self._get_session()
            async with session.get(
                f"{self.base_url}/system_stats",
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                if resp.status == 200:
                    if self._status != AdapterStatus.CONNECTED:
                        logger.info("ComfyUI is now online")
                        # Fetch available checkpoints when connecting
                        self._available_checkpoints = await self._fetch_available_checkpoints()
                        if self._available_checkpoints:
                            logger.info(f"Available checkpoints: {self._available_checkpoints[:3]}")
                    self.set_status(AdapterStatus.CONNECTED)
                    return True
        except Exception as e:
            error_msg = str(e)
            if self._last_health_log != error_msg:
                logger.warning(f"ComfyUI health check failed: {error_msg}")
                self._last_health_log = error_msg
            self.set_status(AdapterStatus.ERROR)
        return False

    async def generate(self, params: dict[str, Any]) -> dict[str, Any]:
        """
        Generate an image or video using ComfyUI.

        Builds a text-to-image or AnimateDiff video workflow based on params.
        """
        is_video = params.get("video", False) or params.get("num_frames", 1) > 1

        if is_video:
            return await self._generate_video(params)
        return await self._generate_image(params)

    async def submit_only(self, params: dict[str, Any]) -> str:
        """Submit a prompt to ComfyUI and return the prompt_id immediately."""
        prompt_text = params.get("prompt", "")
        negative_text = params.get("negative_prompt", "")
        steps = params.get("steps", 20)
        cfg_scale = params.get("cfg_scale", 7.0)
        width = params.get("width", 512)
        height = params.get("height", 512)
        seed = params.get("seed", -1)
        sampler_name = params.get("sampler_name", "euler_ancestral")

        # Map sampler names to ComfyUI equivalents
        sampler_map = {
            "Euler a": "euler_ancestral",
            "Euler": "euler",
            "DPM++ 2M": "dpmpp_2m",
            "DPM++ SDE": "dpmpp_sde",
        }
        comfy_sampler = sampler_map.get(sampler_name, sampler_name.lower().replace(" ", "_"))

        # Use a random seed if -1
        actual_seed = seed if seed > 0 else int(uuid.uuid4().int % (2**32))

        # Build workflow
        workflow = self._build_workflow(
            prompt_text, negative_text, steps, cfg_scale,
            width, height, actual_seed, comfy_sampler
        )

        # Submit workflow and return prompt_id
        prompt_id = await self._submit_prompt(workflow)
        self._current_prompt_id = prompt_id

        return prompt_id

    async def _generate_image(self, params: dict[str, Any]) -> dict[str, Any]:
        """Generate a still image using ComfyUI."""
        prompt_text = params.get("prompt", "")
        negative_text = params.get("negative_prompt", "")
        steps = params.get("steps", 20)
        cfg_scale = params.get("cfg_scale", 7.0)
        width = params.get("width", 512)
        height = params.get("height", 512)
        seed = params.get("seed", -1)
        sampler_name = params.get("sampler_name", "euler_ancestral")

        # Map sampler names to ComfyUI equivalents
        sampler_map = {
            "Euler a": "euler_ancestral",
            "Euler": "euler",
            "DPM++ 2M": "dpmpp_2m",
            "DPM++ SDE": "dpmpp_sde",
        }
        comfy_sampler = sampler_map.get(sampler_name, sampler_name.lower().replace(" ", "_"))

        # Use a random seed if -1
        actual_seed = seed if seed > 0 else int(uuid.uuid4().int % (2**32))

        # Build a minimal workflow: checkpoint -> clip text encode -> ksampler -> save
        # This uses ComfyUI's API workflow format
        workflow = self._build_workflow(
            prompt_text, negative_text, steps, cfg_scale,
            width, height, actual_seed, comfy_sampler
        )

        # Submit workflow to ComfyUI
        prompt_id = await self._submit_prompt(workflow)
        self._current_prompt_id = prompt_id

        # Wait for completion
        image_data = await self._wait_for_result(prompt_id)

        return {
            "image": image_data,
            "seed": actual_seed,
            "prompt_id": prompt_id,
            "info": f"Steps: {steps}, CFG: {cfg_scale}, Size: {width}x{height}, Sampler: {sampler_name}",
        }

    async def _generate_video(self, params: dict[str, Any]) -> dict[str, Any]:
        """Generate a video using AnimateDiff via ComfyUI."""
        prompt_text = params.get("prompt", "")
        negative_text = params.get("negative_prompt", "blurry, bad quality, distorted, static")
        steps = params.get("steps", 15)
        cfg_scale = params.get("cfg_scale", 7.0)
        width = params.get("width", 512)
        height = params.get("height", 512)
        seed = params.get("seed", -1)
        sampler_name = params.get("sampler_name", "euler_ancestral")
        num_frames = params.get("num_frames", 24)
        fps = params.get("fps", 12)

        # Map sampler names to ComfyUI equivalents
        sampler_map = {
            "Euler a": "euler_ancestral",
            "Euler": "euler",
            "DPM++ 2M": "dpmpp_2m",
            "DPM++ SDE": "dpmpp_sde",
        }
        comfy_sampler = sampler_map.get(sampler_name, sampler_name.lower().replace(" ", "_"))

        # Use a random seed if -1
        actual_seed = seed if seed > 0 else int(uuid.uuid4().int % (2**32))

        # Build AnimateDiff video workflow
        workflow = self._build_video_workflow(
            prompt_text, negative_text, steps, cfg_scale,
            width, height, actual_seed, comfy_sampler, num_frames, fps
        )

        # Submit workflow to ComfyUI
        prompt_id = await self._submit_prompt(workflow)
        self._current_prompt_id = prompt_id

        # Wait for video completion
        video_path = await self._wait_for_video_result(prompt_id, timeout=num_frames * fps * 2)

        return {
            "video_path": video_path,
            "seed": actual_seed,
            "info": f"AnimateDiff: {steps} steps, {num_frames} frames @ {fps}fps, {width}x{height}",
        }

    async def _mock_generate(self, params: dict[str, Any]) -> dict[str, Any]:
        """Mock generation for testing without ComfyUI"""
        seed = params.get("seed", -1)
        actual_seed = seed if seed > 0 else 42

        # Create a simple 1x1 pixel PNG as mock image
        # This is a minimal valid PNG (1x1 red pixel)
        mock_png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4"
            "2mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg=="
        )

        return {
            "image": base64.b64encode(mock_png).decode("utf-8"),
            "seed": actual_seed,
            "info": f"MOCK: Steps: {params.get('steps', 20)}, CFG: {params.get('cfg_scale', 7.0)}",
        }

    def _build_workflow(
        self,
        prompt: str,
        negative_prompt: str,
        steps: int,
        cfg: float,
        width: int,
        height: int,
        seed: int,
        sampler: str,
    ) -> dict[str, Any]:
        """
        Build a minimal ComfyUI workflow for text-to-image.

        Uses the simpler prompt API if available, otherwise builds
        a basic workflow JSON.
        """
        # Use ComfyUI's simpler prompt endpoint
        return {
            "prompt": {
                "3": {
                    "class_type": "KSampler",
                    "inputs": {
                        "seed": seed,
                        "steps": steps,
                        "cfg": cfg,
                        "sampler_name": sampler,
                        "scheduler": "normal",
                        "denoise": 1.0,
                        "model": ["4", 0],
                        "positive": ["6", 0],
                        "negative": ["7", 0],
                        "latent_image": ["5", 0],
                    },
                },
                "4": {
                    "class_type": "CheckpointLoaderSimple",
                    "inputs": {"ckpt_name": self._get_available_checkpoint()},
                },
                "5": {
                    "class_type": "EmptyLatentImage",
                    "inputs": {"batch_size": 1, "height": height, "width": width},
                },
                "6": {
                    "class_type": "CLIPTextEncode",
                    "inputs": {"clip": ["4", 1], "text": prompt},
                },
                "7": {
                    "class_type": "CLIPTextEncode",
                    "inputs": {"clip": ["4", 1], "text": negative_prompt},
                },
                "8": {
                    "class_type": "VAEDecode",
                    "inputs": {"samples": ["3", 0], "vae": ["4", 2]},
                },
                "9": {
                    "class_type": "SaveImage",
                    "inputs": {"filename_prefix": "NativeMediaAI", "images": ["8", 0]},
                },
            }
        }

    async def _submit_prompt(self, workflow: dict[str, Any]) -> str:
        """Submit a workflow to ComfyUI and return the prompt ID"""
        session = await self._get_session()
        payload = {"prompt": workflow["prompt"]}
        async with session.post(
            f"{self.base_url}/prompt",
            json=payload,
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            if resp.status != 200:
                raise Exception(f"Failed to submit prompt: {resp.status}")
            data = await resp.json()
            return data["prompt_id"]

    async def get_result(self, prompt_id: str) -> dict[str, Any]:
        """Get the result of a completed prompt."""
        # Check history
        history = await self._get_history(prompt_id)
        if prompt_id in history:
            entry = history[prompt_id]
            if "outputs" in entry:
                for node_id, output in entry["outputs"].items():
                    if "images" in output:
                        for img in output["images"]:
                            image_data = await self._fetch_image(img["filename"], img.get("subfolder", ""))
                            return {
                                "status": "completed",
                                "image": image_data,
                                "seed": 0,  # Seed is not stored in history
                                "info": "Generation completed",
                            }
        return {"status": "pending"}
        """
        Wait for a prompt to complete and return the image data.

        Polls ComfyUI history until the prompt appears, then fetches the image.
        """
        start = asyncio.get_event_loop().time()

        while True:
            if asyncio.get_event_loop().time() - start > timeout:
                raise TimeoutError("ComfyUI generation timed out")

            # Check history
            history = await self._get_history(prompt_id)
            if prompt_id in history:
                entry = history[prompt_id]
                if "outputs" in entry:
                    for node_id, output in entry["outputs"].items():
                        if "images" in output:
                            for img in output["images"]:
                                return await self._fetch_image(img["filename"], img.get("subfolder", ""))

            await asyncio.sleep(1)

    async def _get_history(self, prompt_id: str) -> dict[str, Any]:
        """Get ComfyUI history for a prompt"""
        session = await self._get_session()
        async with session.get(
            f"{self.base_url}/history/{prompt_id}",
            timeout=aiohttp.ClientTimeout(total=5),
        ) as resp:
            if resp.status == 200:
                return await resp.json()
            return {}

    async def _fetch_image(self, filename: str, subfolder: str = "") -> str:
        """Fetch an image from ComfyUI and return as base64"""
        params = {"filename": filename}
        if subfolder:
            params["subfolder"] = subfolder

        session = await self._get_session()
        async with session.get(
            f"{self.base_url}/view",
            params=params,
            timeout=aiohttp.ClientTimeout(total=30),
        ) as resp:
            if resp.status == 200:
                data = await resp.read()
                return base64.b64encode(data).decode("utf-8")
            raise Exception(f"Failed to fetch image: {resp.status}")

    def get_current_prompt_id(self) -> str | None:
        return self._current_prompt_id

    def _build_video_workflow(
        self,
        prompt: str,
        negative_prompt: str,
        steps: int,
        cfg: float,
        width: int,
        height: int,
        seed: int,
        sampler: str,
        num_frames: int,
        fps: int,
    ) -> dict[str, Any]:
        """
        Build an AnimateDiff video workflow for ComfyUI.

        Uses the mm_sd15_v3 motion module and SD 1.5 checkpoint.
        Outputs as GIF via VideoHelperSuite or native GIF node.
        """
        # Select checkpoint - prefer SD 1.5 for AnimateDiff
        checkpoint = self._get_available_checkpoint()
        motion_module = "mm_sd15_v3.safetensors"

        # AnimateDiff workflow with context options for better quality
        return {
            "prompt": {
                # Load checkpoint
                "1": {
                    "class_type": "CheckpointLoaderSimple",
                    "inputs": {"ckpt_name": checkpoint},
                },
                # Load motion module (AnimateDiff)
                "2": {
                    "class_type": "ADE_AnimateDiffLoaderWithContext",
                    "inputs": {
                        "model_name": motion_module,
                        "context_length": min(num_frames, 16),
                        "context_stride": 1,
                        "context_overlap": 4,
                        "context_schedule": "uniform",
                        "closed_loop": False,
                        "beta_schedule": "sqrt_linear (AnimateDiff)",
                        "model": ["1", 0],
                    },
                },
                # Positive prompt
                "3": {
                    "class_type": "CLIPTextEncode",
                    "inputs": {
                        "text": prompt,
                        "clip": ["1", 1],
                    },
                },
                # Negative prompt
                "4": {
                    "class_type": "CLIPTextEncode",
                    "inputs": {
                        "text": negative_prompt,
                        "clip": ["1", 1],
                    },
                },
                # Empty latent video (batch_size = num_frames)
                "5": {
                    "class_type": "EmptyLatentImage",
                    "inputs": {
                        "width": width,
                        "height": height,
                        "batch_size": num_frames,
                    },
                },
                # KSampler with AnimateDiff context
                "6": {
                    "class_type": "ADE_AnimateDiffUniformContextOptions",
                    "inputs": {
                        "context_length": min(num_frames, 16),
                        "context_stride": 1,
                        "context_overlap": 4,
                        "context_schedule": "uniform",
                        "closed_loop": False,
                    },
                },
                # KSampler
                "7": {
                    "class_type": "KSampler",
                    "inputs": {
                        "seed": seed,
                        "steps": steps,
                        "cfg": cfg,
                        "sampler_name": sampler,
                        "scheduler": "normal",
                        "denoise": 1.0,
                        "model": ["2", 0],
                        "positive": ["3", 0],
                        "negative": ["4", 0],
                        "latent_image": ["5", 0],
                    },
                },
                # VAE Decode
                "8": {
                    "class_type": "VAEDecode",
                    "inputs": {
                        "samples": ["7", 0],
                        "vae": ["1", 2],
                    },
                },
                # Save as GIF (VideoHelperSuite or native)
                "9": {
                    "class_type": "VHS_VideoCombine",
                    "inputs": {
                        "images": ["8", 0],
                        "frame_rate": fps,
                        "loop_count": 0,
                        "filename_prefix": "NativeMediaAI_Video",
                        "format": "image/gif",
                        "pingpong": False,
                        "save_output": True,
                    },
                },
            }
        }

    async def _wait_for_video_result(self, prompt_id: str, timeout: int = 300) -> str | None:
        """
        Wait for a video prompt to complete and return the video path.

        Polls ComfyUI history until the prompt appears with video/gif output.
        """
        start = asyncio.get_event_loop().time()

        while True:
            if asyncio.get_event_loop().time() - start > timeout:
                raise TimeoutError(f"ComfyUI video generation timed out after {timeout}s")

            # Check history
            history = await self._get_history(prompt_id)
            if prompt_id in history:
                entry = history[prompt_id]
                if "outputs" in entry:
                    for node_id, output in entry["outputs"].items():
                        # Check for video/gif output (VideoHelperSuite)
                        if "gifs" in output:
                            for gif in output["gifs"]:
                                filename = gif.get("filename")
                                subfolder = gif.get("subfolder", "")
                                if filename:
                                    return await self._fetch_video(filename, subfolder)
                        # Check for images (fallback - might be frame sequence)
                        if "images" in output:
                            for img in output["images"]:
                                filename = img.get("filename")
                                if filename and filename.endswith((".gif", ".mp4", ".webm")):
                                    subfolder = img.get("subfolder", "")
                                    return await self._fetch_video(filename, subfolder)

            await asyncio.sleep(2)

    async def _fetch_video(self, filename: str, subfolder: str = "") -> str:
        """Fetch a video/gif from ComfyUI and return the local path."""
        from ..core.config import PROJECT_ROOT
        import os

        params = {"filename": filename}
        if subfolder:
            params["subfolder"] = subfolder

        session = await self._get_session()
        async with session.get(
            f"{self.base_url}/view",
            params=params,
            timeout=aiohttp.ClientTimeout(total=120),
        ) as resp:
            if resp.status == 200:
                data = await resp.read()
                # Save to output directory
                output_dir = PROJECT_ROOT / "output" / "video"
                output_dir.mkdir(parents=True, exist_ok=True)
                output_path = output_dir / filename
                with open(output_path, "wb") as f:
                    f.write(data)
                return str(output_path)
            raise Exception(f"Failed to fetch video: {resp.status}")

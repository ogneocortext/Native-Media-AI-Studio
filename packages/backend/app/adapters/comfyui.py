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

from ..core import comfyui_client as _cu
from ..core.comfyui_client import resolve_models_dir
from ..core.model_tiers import classify_model_variant, is_wan_8gb_model
from .base import AdapterStatus, BaseAdapter

logger = logging.getLogger(__name__)

# Map UI sampler names to ComfyUI sampler names
# Per knowledge-library/comfyui-workflows.md § Sampler Guide — cover all
# documented samplers so "DPM++ 3M SDE" etc. don't fall through to a
# lowercased guess that ComfyUI rejects.
SAMPLER_MAP = {
    "Euler a": "euler_ancestral",
    "Euler": "euler",
    "Euler Ancestral": "euler_ancestral",
    "DPM++ 2M": "dpmpp_2m",
    "DPM++ 2M Karras": "dpmpp_2m",
    "DPM++ SDE": "dpmpp_sde",
    "DPM++ 3M SDE": "dpmpp_3m_sde",
    "DDIM": "ddim",
    "UniPC": "uni_pc",
    "DPM Fast": "dpm_fast",
    "DPM Adaptive": "dpm_adaptive",
    "LMS": "lms",
    "Heun": "heun",
}

# Schedulers documented in comfyui-workflows.md — validated before submit so
# a typo doesn't become a silent ComfyUI node error.
VALID_SCHEDULERS = {
    "normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform",
}


def _map_scheduler(scheduler_name: str) -> str:
    """Normalize a scheduler name; fall back to 'normal' on unknown values."""
    name = str(scheduler_name or "normal").strip().lower()
    return name if name in VALID_SCHEDULERS else "normal"


# Checkpoints that must never be offered/auto-selected for SD txt2img:
# 3D diffusion models (hunyuan3d DiT, triposr, stable-fast-3d), video models
# (wan, kandinsky i2v), and motion modules all live in / are routed through
# the checkpoints folder but are not SD-family image checkpoints.
NON_IMAGE_CHECKPOINT_KEYWORDS = (
    "hunyuan", "wan", "animate", "motion", "3d",
    "kandinsky", "triposr", "stable-fast",
)


def is_image_checkpoint(name: str) -> bool:
    """True if a checkpoint filename is usable for SD txt2img generation."""
    name_lower = str(name).lower()
    return not any(kw in name_lower for kw in NON_IMAGE_CHECKPOINT_KEYWORDS)

MAX_SEED = 2**32 - 1


def _map_sampler(sampler_name: str) -> str:
    """Map a UI sampler name to its ComfyUI equivalent."""
    return SAMPLER_MAP.get(sampler_name, sampler_name.lower().replace(" ", "_"))


def _resolve_seed(seed: Any) -> int:
    """Return a valid seed; pick a random one when out of range (e.g. -1)."""
    try:
        seed_int = int(seed)
    except (TypeError, ValueError):
        seed_int = -1
    if 0 <= seed_int <= MAX_SEED:
        return seed_int
    return int(uuid.uuid4().int % (2**32))


def _sanitize_filename(filename: str) -> str:
    """Back-compat alias — canonical impl lives in ``core.comfyui_client``."""
    return _cu.sanitize_filename(filename)


def _clamp_wan_resolution(width: int, height: int) -> tuple[int, int]:
    """Clamp a resolution into the 832x480 (480p) 8GB box, 16-aligned.

    Peak VRAM scales with frame pixels; 720p/121f already peaks ~8GB on
    modern cards, and Pascal pays extra (SDPA-math, no flash-attn).
    Preserves aspect ratio; never upscales.
    """
    try:
        w, h = int(width), int(height)
    except (TypeError, ValueError):
        return 832, 480
    if w <= 0 or h <= 0:
        return 832, 480
    scale = min(1.0, 832 / w, 480 / h)
    w = max(16, int(w * scale) // 16 * 16)
    h = max(16, int(h * scale) // 16 * 16)
    return w, h


class ComfyUIAdapter(BaseAdapter):
    """
    Adapter for ComfyUI API.

    Supports:
    - Text-to-image generation via ComfyUI workflow
    - Queue-based prompt execution
    - Image retrieval from ComfyUI history
    """

    def __init__(
        self, base_url: str | None = None, mock_mode: bool = False
    ):
        from ..core.config import config as _cfg
        _base = base_url or _cfg.comfyui_url
        super().__init__(_base, "ComfyUI", mock_mode=mock_mode)
        self._current_prompt_id: str | None = None
        self._last_health_log: str | None = None
        self._available_checkpoints: list[str] = []
        self._available_motion_modules: list[str] = []
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
                    return _cu.extract_combo_options(
                        data.get("CheckpointLoaderSimple", {}), "ckpt_name"
                    )
        except Exception as e:
            logger.warning(f"Failed to fetch available checkpoints: {e}")
        return []

    def _get_available_checkpoint(self) -> str:
        """Get the best available checkpoint for image generation."""
        # Prefer SD 1.5/SDXL models for image generation
        preferred_checkpoints = [
            "v1-5-pruned-emaonly.safetensors",
            "v1-5-pruned-emaonly.ckpt",
            "v1-5-pruned.ckpt",
            "sd_v1-5.ckpt",
            "sd_xl_base_1.0.safetensors",
        ]

        # Check if any preferred checkpoint is available
        if self._available_checkpoints:
            for preferred in preferred_checkpoints:
                if preferred in self._available_checkpoints:
                    return preferred
            # Return first available that's not a 3D/video model
            # (kandinsky/triposr/stable-fast are not SD-family either —
            # never auto-select them for txt2img)
            for cp in self._available_checkpoints:
                if is_image_checkpoint(cp):
                    return cp

        # Fallback to default
        return preferred_checkpoints[0]

    async def _fetch_available_motion_modules(self) -> list[str]:
        """Fetch motion modules from the AnimateDiff loader's option list."""
        try:
            session = await self._get_session()
            async with session.get(
                f"{self.base_url}/object_info/ADE_AnimateDiffLoaderWithContext",
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return _cu.extract_combo_options(
                        data.get("ADE_AnimateDiffLoaderWithContext", {}), "model_name"
                    )
        except Exception as e:
            logger.warning(f"Failed to fetch available motion modules: {e}")
        return []

    def _get_available_motion_module(self) -> str:
        """Get the best available AnimateDiff motion module.

        Reads the live ``ADE_AnimateDiffLoaderWithContext`` option list
        (fetched on connect) — never the checkpoint list. Prefers
        ``mm_sd_v15_v2.ckpt``: it is the only module both present on disk
        (1.7GB) AND listed by ComfyUI, and the motion LoRAs were designed
        for v2 (see knowledge-library/hardware-verified-models.md §2).
        """
        preferred_motion_modules = [
            "mm_sd_v15_v2.ckpt",
            "mm_sd15_v3.safetensors",
            "mm-Stabilized_high.ckpt",
        ]
        available = getattr(self, "_available_motion_modules", [])
        if available:
            for preferred in preferred_motion_modules:
                if preferred in available:
                    return preferred
            return available[0]
        return preferred_motion_modules[0]

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
                        # Fetch available checkpoints + motion modules when connecting
                        self._available_checkpoints = await self._fetch_available_checkpoints()
                        if self._available_checkpoints:
                            logger.info(f"Available checkpoints: {self._available_checkpoints[:3]}")
                        self._available_motion_modules = await self._fetch_available_motion_modules()
                        if self._available_motion_modules:
                            logger.info(f"Available motion modules: {self._available_motion_modules}")
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
        logger.debug("submit_only called with params=%s", params)
        prompt_text = params.get("prompt", "")
        negative_text = params.get("negative_prompt", "")
        steps = params.get("steps", 20)
        cfg_scale = params.get("cfg_scale", 7.0)
        width = params.get("width", 512)
        height = params.get("height", 512)
        # Accept both "sampler_name" (adapter convention) and "sampler"
        # (queue job convention) so queued jobs don't silently fall back.
        comfy_sampler = _map_sampler(params.get("sampler_name", params.get("sampler", "euler_ancestral")))
        scheduler = _map_scheduler(params.get("scheduler", "normal"))
        actual_seed = _resolve_seed(params.get("seed", -1))

        # Build workflow
        workflow = self._build_workflow(
            prompt_text, negative_text, steps, cfg_scale,
            width, height, actual_seed, comfy_sampler, scheduler=scheduler,
        )

        logger.debug("workflow built: %s", json.dumps(workflow)[:200])

        # Submit workflow and return prompt_id
        try:
            prompt_id = await self._submit_prompt(workflow)
            self._current_prompt_id = prompt_id
            logger.debug("prompt submitted: %s", prompt_id)
            return prompt_id
        except Exception as e:
            logger.debug("submit failed: %s", e)
            raise

    async def _generate_image(self, params: dict[str, Any]) -> dict[str, Any]:
        """Generate a still image using ComfyUI."""
        prompt_text = params.get("prompt", "")
        negative_text = params.get("negative_prompt", "")
        steps = params.get("steps", 20)
        cfg_scale = params.get("cfg_scale", 7.0)
        width = params.get("width", 512)
        height = params.get("height", 512)
        sampler_name = params.get("sampler_name", params.get("sampler", "euler_ancestral"))

        comfy_sampler = _map_sampler(sampler_name)
        scheduler = _map_scheduler(params.get("scheduler", "normal"))
        actual_seed = _resolve_seed(params.get("seed", -1))

        # Build a minimal workflow: checkpoint -> clip text encode -> ksampler -> save
        # This uses ComfyUI's API workflow format
        workflow = self._build_workflow(
            prompt_text, negative_text, steps, cfg_scale,
            width, height, actual_seed, comfy_sampler, scheduler=scheduler,
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
        """Generate a video using AnimateDiff or Wan 2.2 GGUF via ComfyUI."""
        prompt_text = params.get("prompt", "")
        negative_text = params.get("negative_prompt", "blurry, bad quality, distorted, static")
        steps = params.get("steps", 15)
        cfg_scale = params.get("cfg_scale", 7.0)
        width = params.get("width", 512)
        height = params.get("height", 512)
        seed = params.get("seed", -1)
        sampler_name = params.get("sampler_name", params.get("sampler", "euler_ancestral"))
        num_frames = params.get("num_frames", 24)
        fps = params.get("fps", 12)
        ckpt_name = params.get("ckpt_name", "")
        model_variant = params.get("model_variant", "standard")

        comfy_sampler = _map_sampler(sampler_name)
        scheduler = _map_scheduler(params.get("scheduler", "normal"))
        actual_seed = _resolve_seed(seed)

        # AnimateDiff v2 motion modules cap a single batch at 32 frames
        # (verified live: "upper limit of 32 frames" without a context
        # window). Longer clips need multi-segment generation + FFmpeg
        # concat/loop — warn instead of letting ComfyUI fail opaquely.
        # Wan models (2.1 1.3B or 2.2 5B GGUF) handle 81-121 frames natively.
        if num_frames > 32 and not (
            str(model_variant).lower() in ("gguf_q4", "gguf_q5")
            or (ckpt_name and is_wan_8gb_model(ckpt_name))
        ):
            logger.warning(
                "AnimateDiff batch of %d frames exceeds the v2 32-frame single-pass "
                "limit — ComfyUI will reject it. Generate ≤32-frame segments and "
                "concat/loop with FFmpeg, or use the Wan path.",
                num_frames,
            )

        # Route to the appropriate workflow based on model variant.
        # The tier classifier (core/model_tiers.py) is the single authority
        # for wan/gguf name-sniffing — shared with the /video-models endpoint
        # tagging and the VRAM estimator.
        variant_lower = str(model_variant).lower()
        is_wan_gguf = variant_lower in ("gguf_q4", "gguf_q5") or (
            bool(ckpt_name) and is_wan_8gb_model(ckpt_name)
        )
        eff_frames = num_frames

        if is_wan_gguf:
            # 8GB envelope for Wan 2.2 TI2V-5B GGUF (researched 2026-09-20):
            # 480p (832x480) is the 8GB working point (localmodel.run peak
            # ~8GB at 720p/121f; GTX 1070 Ti is Pascal without flash-attn so
            # SDPA-math activations cost extra). Clamp into the 832x480 box
            # 16-aligned; snap frames to 4n+1 (Wan VAE patch grid), cap 121,
            # default 81 (template default) when the caller left the
            # AnimateDiff-oriented default (<=16).
            width, height = _clamp_wan_resolution(width, height)
            wan_frames = num_frames if num_frames > 16 else 81
            wan_frames = min(wan_frames, 121)
            wan_frames = wan_frames - ((wan_frames - 1) % 4)
            if (width, height, wan_frames) != (params.get("width", 512), params.get("height", 512), num_frames):
                logger.info(
                    "Wan 8GB envelope: %dx%d/%df -> %dx%d/%df",
                    params.get("width", 512), params.get("height", 512), num_frames,
                    width, height, wan_frames,
                )
            workflow = self._build_wan_gguf_workflow(
                prompt_text, negative_text, steps, cfg_scale,
                width, height, actual_seed, comfy_sampler, wan_frames, fps,
                ckpt_name=ckpt_name, variant=model_variant,
            )
            eff_frames = wan_frames
        else:
            if ckpt_name:
                # The AnimateDiff path requires an SD1.5-family checkpoint.
                # Known non-SD checkpoints (Kandinsky 5, Hunyuan3D DiT, etc.)
                # would fail deep inside ComfyUI with an opaque loader error —
                # reject them up front with an actionable message instead of
                # silently ignoring the caller's selection.
                # Wan names are routed away above; anything else non-SD
                # (kandinsky/hunyuan/triposr/stable-fast/...) is rejected via
                # the shared keyword list.
                if not is_image_checkpoint(ckpt_name):
                    raise ValueError(
                        f"Checkpoint '{ckpt_name}' is not an SD1.5-family model and "
                        "cannot drive the AnimateDiff video path. Pick an SD1.5 "
                        "checkpoint, or a Wan 2.x GGUF variant for the native "
                        "video path."
                    )
            workflow = self._build_video_workflow(
                prompt_text, negative_text, steps, cfg_scale,
                width, height, actual_seed, comfy_sampler, num_frames, fps,
                motion_module=params.get("motion_module", ""),
                motion_lora=params.get("motion_lora", ""),
                motion_lora_strength=float(params.get("motion_lora_strength", 0.8)),
                scheduler=scheduler,
                ckpt_name=ckpt_name,
            )

        # Submit workflow to ComfyUI
        prompt_id = await self._submit_prompt(workflow)
        self._current_prompt_id = prompt_id

        # Wait for video completion. AnimateDiff can take several minutes even
        # for short clips, so never use the clip duration as the timeout.
        video_timeout = max(900, eff_frames * fps * 2)
        video_path = await self._wait_for_video_result(prompt_id, timeout=video_timeout)

        model_label = "Wan 2.2 GGUF" if is_wan_gguf else "AnimateDiff"
        return {
            "video_path": video_path,
            "seed": actual_seed,
            "info": f"{model_label}: {steps} steps, {eff_frames} frames @ {fps}fps, {width}x{height}",
        }

    async def _mock_generate(self, params: dict[str, Any]) -> dict[str, Any]:
        """Mock generation for testing without ComfyUI"""
        actual_seed = _resolve_seed(params.get("seed", -1))

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
        scheduler: str = "normal",
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
                        "scheduler": _map_scheduler(scheduler),
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
                body = await resp.text()
                raise Exception(f"Failed to submit prompt: {resp.status} - {body[:500]}")
            data = await resp.json()
            return data["prompt_id"]

    async def get_result(self, prompt_id: str) -> dict[str, Any]:
        """Get the result of a completed prompt."""
        # Check history
        history = await self._get_history(prompt_id)
        if prompt_id in history:
            entry = history[prompt_id]
            if "outputs" in entry:
                for _node_id, output in entry["outputs"].items():
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

    async def _get_history(self, prompt_id: str) -> dict[str, Any]:
        """Get ComfyUI history for a prompt (shared client helper)."""
        session = await self._get_session()
        return await _cu.fetch_history(self.base_url, prompt_id, session=session)

    async def _get_queue_status(self, prompt_id: str) -> dict[str, Any] | None:
        """Check if a prompt is in the ComfyUI queue. Returns the queue entry or None."""
        session = await self._get_session()
        queue_data = await _cu.fetch_queue(self.base_url, session=session)
        return _cu.find_queue_entry(queue_data, prompt_id)

    async def _wait_for_result(self, prompt_id: str, timeout: int = 300) -> str:
        """Wait for an image prompt to complete; return base64 image data.

        Was missing (``_generate_image`` raised ``AttributeError``). Polls
        history until an ``images`` output appears, raises ``TimeoutError``
        on timeout or ``RuntimeError`` if ComfyUI reports execution failure.
        """
        start = asyncio.get_event_loop().time()
        while True:
            elapsed = asyncio.get_event_loop().time() - start
            if elapsed > timeout:
                raise TimeoutError(f"ComfyUI image generation timed out after {timeout}s")
            history = await self._get_history(prompt_id)
            if prompt_id in history:
                entry = history[prompt_id]
                status = entry.get("status", {})
                status_str = entry.get("status_str", "") or (
                    status.get("status_str", "") if isinstance(status, dict) else ""
                )
                if status_str == "error" or entry.get("status") == "error":
                    error_msg = entry.get("error") or status_str or "ComfyUI execution error"
                    if isinstance(status, dict) and status.get("messages"):
                        error_msg = f"{error_msg}: {status['messages']}"
                    logger.error("ComfyUI prompt %s failed: %s", prompt_id, error_msg)
                    raise RuntimeError(f"ComfyUI generation failed: {error_msg}")
                for _node_id, output in entry.get("outputs", {}).items():
                    if "images" in output:
                        for img in output["images"]:
                            filename = img.get("filename")
                            if not filename:
                                continue
                            # Skip video containers that occasionally surface
                            # under "images" — the video waiter handles those.
                            if str(filename).lower().endswith((".mp4", ".webm", ".gif")):
                                continue
                            return await self._fetch_image(
                                filename, img.get("subfolder", "")
                            )
            await asyncio.sleep(2)

    async def _fetch_image(self, filename: str, subfolder: str = "") -> str:
        """Fetch an image from ComfyUI and return as base64 (shared client helper)."""
        session = await self._get_session()
        try:
            data = await _cu.fetch_view_bytes(
                self.base_url, filename, subfolder, session=session, timeout=30
            )
        except RuntimeError as e:
            raise Exception(str(e)) from e
        return base64.b64encode(data).decode("utf-8")

    def get_current_prompt_id(self) -> str | None:
        return self._current_prompt_id

    def _build_wan_gguf_workflow(
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
        ckpt_name: str = "",
        variant: str = "gguf_q4",
    ) -> dict[str, Any]:
        """
        Build a Wan 2.2 TI2V-5B GGUF video workflow for ComfyUI.

        8GB/Pascal notes (see knowledge-library/video-generation-vram-2026.md
        + pascal-gpu-optimization-2026.md): Pascal (sm_61) has no BF16/Tensor
        cores, so precision is fp16 (never bf16). T5 stays CPU-offloaded and
        VAE decode uses tiling to stay under 8GB.
        """
        # Resolve checkpoint: prefer explicit ckpt_name, fall back to any
        # Wan GGUF checkpoint discoverable on the connected ComfyUI.
        if not ckpt_name:
            ckpt_name = self._get_available_wan_gguf_checkpoint()

        # Map our variant label to the ComfyUI quantization option.
        # Pascal (sm_61) CANNOT use fp8_e4m3fn_fast — _fast matmul modes
        # require sm>=8.9 (comfy.icu WanVideoModelLoader docs). Both GGUF
        # quants use "disabled" (autoselect by weights = GGUF path).
        quant_map = {
            "gguf_q5": "disabled",
            "gguf_q4": "disabled",
        }
        quantization = quant_map.get(str(variant).lower(), "disabled")

        # Wan 2.1 1.3B uses wan_2.1_vae, 2.2 uses wan2.2_vae (verified via Comfy-Org repackaged)
        tier = classify_model_variant(ckpt_name) if ckpt_name else "unknown"
        vae_name = "wan_2.1_vae.safetensors" if tier in ("wan2_1_t2v_1_3b", "wan2_1_fun_inp_1_3b") else "wan2.2_vae.safetensors"
        # Text encoder: prefer umt5_xxl_fp16 when present (11GB, CPU offload,
        # no fp8 format issues). The locally "de-scaled" umt5-xxl-plain-fp8
        # often still carries fp8 tensor data that LoadWanVideoT5TextEncoder
        # rejects ("fp8 scaled is not supported"), so fp16 is the safer
        # choice whenever it is on disk. Fall back to plain fp8 only when
        # fp16 is absent.
        t5_name = "umt5-xxl-plain-fp8.safetensors"
        models_dir = resolve_models_dir()
        if models_dir is not None:
            fp16_path = models_dir / "text_encoders" / "umt5_xxl_fp16.safetensors"
            if fp16_path.exists():
                t5_name = "umt5_xxl_fp16.safetensors"

        # Validate T5 encoder and VAE availability before submitting.
        # Missing files cause silent conditioning failures that manifest as
        # abstract/red-noise output rather than a clean ComfyUI error.
        models_dir = resolve_models_dir()
        if models_dir is not None:
            t5_path = models_dir / "text_encoders" / t5_name
            vae_path = models_dir / "vae" / vae_name
            if not t5_path.exists():
                logger.warning(
                    "Wan T5 text encoder missing: %s — text conditioning will fail",
                    t5_path,
                )
            if not vae_path.exists():
                logger.warning(
                    "Wan VAE missing: %s — decode will produce corrupt output",
                    vae_path,
                )
        logger.info(
            "Wan workflow tier=%s t5=%s vae=%s ckpt=%s",
            tier, t5_name, vae_name, ckpt_name,
        )

        return {
            "prompt": {
                # 1: Load UMT5-XXL text encoder (CPU offload by default on 8GB).
                # precision MUST be bf16: this node only accepts fp32/bf16
                # (verified live via /object_info). MUST be a plain (non-
                # scaled) umt5 file: scaled_fp8 checkpoints are rejected, and
                # standard T5-XXL makes the wrapper fall back to downloading
                # the google/t5-xxl tokenizer from HF at render time.
                # Prefer umt5_xxl_fp16 when present (no fp8 format issues);
                # fall back to umt5-xxl-plain-fp8 only when fp16 is absent.
                "1": {
                    "class_type": "LoadWanVideoT5TextEncoder",
                    "inputs": {
                        "model_name": t5_name,
                        "precision": "bf16",
                    },
                },
                # 2: Encode positive + negative prompts
                "2": {
                    "class_type": "WanVideoTextEncode",
                    "inputs": {
                        "positive_prompt": prompt,
                        "negative_prompt": negative_prompt,
                        "t5": ["1", 0],
                        "force_offload": True,
                    },
                },
                # 3: Load Wan 2.2 model (GGUF)
                "3": {
                    "class_type": "WanVideoModelLoader",
                    "inputs": {
                        "model": ckpt_name,
                        "base_precision": "fp16",
                        "quantization": quantization,
                        "load_device": "offload_device",
                    },
                },
                # NOTE: no EmptyLatentImage — the official Kijai T2V example
                # leaves sampler `samples` UNCONNECTED; the sampler creates
                # correctly-shaped Wan latents from the embeds. Wiring an SD
                # 4ch latent crashes with a channel mismatch (verified live).
                # Shape comes from node 9 (WanVideoEmptyEmbeds).
                # 9: Empty image embeds (pure text-to-video path — no
                # start/end image). Required input of WanVideoSampler.
                "9": {
                    "class_type": "WanVideoEmptyEmbeds",
                    "inputs": {
                        "width": width,
                        "height": height,
                        "num_frames": num_frames,
                    },
                },
                # 5: Sample (requires `image_embeds` + `riflex_freq_index`;
                # `samples` left unconnected per the official example —
                # verified live via /object_info + example workflows).
                # riflex_freq_index=6 is the Kijai-recommended default for
                # standard 832×480 T2V; it controls the RIFLEx attention
                # recurrence interval and should not be raised above the
                # frame-count/4 without benchmarking.
                "5": {
                    "class_type": "WanVideoSampler",
                    "inputs": {
                        "model": ["3", 0],
                        "image_embeds": ["9", 0],
                        "text_embeds": ["2", 0],
                        "steps": steps,
                        "cfg": cfg,
                        "shift": 5.0,
                        "seed": seed,
                        "force_offload": True,
                        "scheduler": "unipc",
                        "riflex_freq_index": 6,
                    },
                },
                # 6: Load VAE (dynamic per Wan generation)
                "6": {
                    "class_type": "WanVideoVAELoader",
                    "inputs": {
                        "model_name": vae_name,
                        "precision": "fp16",
                        "use_cpu_cache": True,
                    },
                },
                # 7: Decode latent to images
                "7": {
                    "class_type": "WanVideoDecode",
                    "inputs": {
                        "vae": ["6", 0],
                        "samples": ["5", 0],
                        "enable_vae_tiling": True,
                        "tile_x": 272,
                        "tile_y": 272,
                        "tile_stride_x": 144,
                        "tile_stride_y": 128,
                    },
                },
                # 8: Combine images to video
                "8": {
                    "class_type": "VHS_VideoCombine",
                    "inputs": {
                        "images": ["7", 0],
                        "frame_rate": fps,
                        "loop_count": 0,
                        "filename_prefix": "NativeMediaAI_WanGGUF",
                        "format": "image/gif",
                        "pingpong": False,
                        "save_output": True,
                    },
                },
            }
        }

    def _get_available_wan_gguf_checkpoint(self) -> str:
        """Find the best available Wan 2.2 TI2V-5B GGUF checkpoint.

        Real on-disk names (QuantStack layout, verified 2026-09-20):
        ``Wan2.2-TI2V-5B-Q4_K_M.gguf`` etc. in ``models/diffusion_models/``.
        """
        preferred = [
            "Wan2.2-TI2V-5B-Q4_K_M.gguf",
            "Wan2.2-TI2V-5B-Q4_K_S.gguf",
            "Wan2.2-TI2V-5B-Q5_K_M.gguf",
            "Wan2.2-TI2V-5B-Q5_K_S.gguf",
        ]
        available = getattr(self, "_available_checkpoints", [])
        if available:
            for name in preferred:
                if name in available:
                    return name
            # Fallback: first wan+gguf entry
            for name in available:
                n = name.lower()
                if "wan" in n and ("gguf" in n or "q4" in n or "q5" in n):
                    return name
        return preferred[0]

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
        motion_module: str = "",
        motion_lora: str = "",
        motion_lora_strength: float = 0.8,
        scheduler: str = "normal",
        ckpt_name: str = "",
    ) -> dict[str, Any]:
        """
        Build an AnimateDiff video workflow for ComfyUI.

        Uses the mm_sd15_v3 motion module and SD 1.5 checkpoint.
        Outputs as GIF via VideoHelperSuite or native GIF node.
        Honors an explicit motion_module/motion_lora when provided (see
        knowledge-library/hardware-verified-models.md §2: 8 camera LoRAs,
        weight 0.7-1.0, best with mm_sd_v15_v2).
        """
        # Select checkpoint - prefer SD 1.5 for AnimateDiff. Honor an
        # explicit caller-provided SD-family checkpoint (already validated
        # upstream in _generate_video).
        checkpoint = ckpt_name or self._get_available_checkpoint()
        # Respect an explicit motion module (e.g. mm_sd_v15_v2 for LoRA
        # compatibility); fall back to auto-detect only when empty.
        if not motion_module:
            motion_module = self._get_available_motion_module()

        loader_inputs: dict[str, Any] = {
            "model_name": motion_module,
            "context_length": min(num_frames, 16),
            "context_stride": 1,
            "context_overlap": 4,
            "context_schedule": "uniform",
            "closed_loop": False,
            "beta_schedule": "sqrt_linear (AnimateDiff)",
            "model": ["1", 0],
        }
        # Camera-motion LoRA slot (AnimateDiff-Evolved). Tiny (~74MB),
        # negligible VRAM overhead on 8GB.
        if motion_lora:
            loader_inputs["motion_lora"] = motion_lora
            loader_inputs["motion_lora_strength"] = max(0.0, min(1.0, motion_lora_strength))

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
                    "inputs": loader_inputs,
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
                # KSampler
                "7": {
                    "class_type": "KSampler",
                    "inputs": {
                        "seed": seed,
                        "steps": steps,
                        "cfg": cfg,
                        "sampler_name": sampler,
                        "scheduler": _map_scheduler(scheduler),
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
        Raises TimeoutError on timeout, or RuntimeError if ComfyUI reports
        the prompt failed or was cancelled.
        """
        start = asyncio.get_event_loop().time()

        while True:
            elapsed = asyncio.get_event_loop().time() - start
            if elapsed > timeout:
                raise TimeoutError(f"ComfyUI video generation timed out after {timeout}s")

            # Check history
            history = await self._get_history(prompt_id)
            if prompt_id in history:
                entry = history[prompt_id]
                # Check for execution failure (ComfyUI sets status_str / error on failed prompts)
                status_str = entry.get("status_str", "")
                if status_str == "error" or entry.get("status", "") == "error":
                    error_msg = entry.get("error", status_str) or "ComfyUI execution error"
                    logger.error("ComfyUI prompt %s failed: %s", prompt_id, error_msg)
                    raise RuntimeError(f"ComfyUI generation failed: {error_msg}")

                if "outputs" in entry:
                    for _node_id, output in entry["outputs"].items():
                        # Check for video/gif output (VideoHelperSuite)
                        if "gifs" in output:
                            for gif in output["gifs"]:
                                filename = gif.get("filename")
                                subfolder = gif.get("subfolder", "")
                                if filename:
                                    return await self._fetch_video(filename, subfolder)
                        # Some video nodes report their output under "videos"
                        if "videos" in output:
                            for vid in output["videos"]:
                                filename = vid.get("filename")
                                subfolder = vid.get("subfolder", "")
                                if filename:
                                    return await self._fetch_video(filename, subfolder)
                        # Check for images (fallback - might be frame sequence)
                        if "images" in output:
                            for img in output["images"]:
                                filename = img.get("filename")
                                if filename and filename.endswith((".gif", ".mp4", ".webm")):
                                    subfolder = img.get("subfolder", "")
                                    return await self._fetch_video(filename, subfolder)

            # Also check the /queue endpoint — if the prompt isn't in the queue
            # and isn't in history, it may have been cancelled or never started.
            # Only declare it lost after 60s (ComfyUI can take a while to pick
            # up a prompt), and tolerate transient queue-fetch failures.
            if elapsed > 60:
                try:
                    queue_status = await self._get_queue_status(prompt_id)
                except Exception:
                    queue_status = {"prompt_id": prompt_id}  # don't abort on probe error
                if not queue_status:
                    logger.warning("Prompt %s not in queue or history after %ds — may have been cancelled", prompt_id, int(elapsed))
                    raise RuntimeError(f"ComfyUI prompt {prompt_id} not found in queue or history — it may have been cancelled or rejected")

            await asyncio.sleep(2)

    async def _fetch_video(self, filename: str, subfolder: str = "") -> str:
        """Fetch a video/gif from ComfyUI and return the local path."""
        from ..core.config import PROJECT_ROOT

        session = await self._get_session()
        try:
            data = await _cu.fetch_view_bytes(
                self.base_url, filename, subfolder, session=session, timeout=120
            )
        except RuntimeError as e:
            raise Exception(str(e)) from e
        # Save to output directory
        output_dir = PROJECT_ROOT / "output" / "video"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = _cu.safe_join(output_dir, filename)
        output_path.write_bytes(data)
        return str(output_path)

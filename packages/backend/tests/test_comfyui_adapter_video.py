"""Regression tests for the ComfyUI adapter's video path.

Guards a shipped ``NameError``: ``_generate_video`` returned a result dict that
referenced ``vae_name`` / ``t5_name``, but those names were only ever locals of
``_build_wan_gguf_workflow``. Every Wan / AnimateDiff job therefore crashed while
building its *result* — after ComfyUI had already rendered the clip, so the
finished video was discarded.

``ruff check`` flags this as F821; these tests keep it fixed by exercising both
branches end to end with the network stubbed out.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.adapters.comfyui import ComfyUIAdapter  # noqa: E402

WAN_GGUF_CKPT = "Wan2.2-TI2V-5B-Q4_K_M.gguf"


@pytest.fixture
def adapter() -> ComfyUIAdapter:
    # base_url is never dialled: submit/wait are monkeypatched below.
    return ComfyUIAdapter(base_url="http://127.0.0.1:9", mock_mode=False)


def _stub_network(adapter: ComfyUIAdapter, monkeypatch: pytest.MonkeyPatch) -> None:
    async def _submit_prompt(workflow: dict) -> str:  # noqa: ARG001
        return "prompt-id"

    async def _wait_for_video_result(prompt_id: str, timeout: float = 0.0) -> str:  # noqa: ARG001
        return "output/video/clip.mp4"

    monkeypatch.setattr(adapter, "_submit_prompt", _submit_prompt)
    monkeypatch.setattr(adapter, "_wait_for_video_result", _wait_for_video_result)


@pytest.mark.asyncio
async def test_wan_video_result_reports_the_assets_the_workflow_loads(
    adapter: ComfyUIAdapter, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The result metadata must name the VAE/T5 the submitted workflow used."""
    _stub_network(adapter, monkeypatch)

    result = await adapter._generate_video(
        {
            "prompt": "a lighthouse at dusk",
            "model_variant": "gguf_q4",
            "ckpt_name": WAN_GGUF_CKPT,
            "num_frames": 24,
            "fps": 12,
        }
    )

    assert result["video_path"] == "output/video/clip.mp4"
    assert result["ckpt_name"] == WAN_GGUF_CKPT
    # Wan 2.2 uses wan2.2_vae (Wan 2.1 1.3B would use wan_2.1_vae).
    assert result["vae_name"] == "wan2.2_vae.safetensors"
    assert result["t5_name"] in ("umt5_xxl_fp16.safetensors", "umt5-xxl-plain-fp8.safetensors")
    assert result["model_variant"] == "gguf_q4"


@pytest.mark.asyncio
async def test_animatediff_video_result_has_no_wan_asset_metadata(
    adapter: ComfyUIAdapter, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The SD/AnimateDiff branch reports no Wan assets rather than crashing."""
    _stub_network(adapter, monkeypatch)

    result = await adapter._generate_video(
        {
            "prompt": "a lighthouse at dusk",
            "model_variant": "standard",
            "ckpt_name": "sd15_base.safetensors",
            "num_frames": 16,
            "fps": 12,
        }
    )

    assert result["video_path"] == "output/video/clip.mp4"
    assert result["t5_name"] is None
    assert result["vae_name"] is None


@pytest.mark.asyncio
async def test_wan_ckpt_is_resolved_when_the_caller_omits_it(
    adapter: ComfyUIAdapter, monkeypatch: pytest.MonkeyPatch
) -> None:
    """With no ckpt the adapter discovers one, and the metadata must follow it."""
    _stub_network(adapter, monkeypatch)
    monkeypatch.setattr(
        adapter,
        "_get_available_wan_gguf_checkpoint",
        lambda: "wan2.1_t2v_1.3B-Q4_K_M.gguf",
    )

    result = await adapter._generate_video(
        {"prompt": "a lighthouse at dusk", "model_variant": "gguf_q4", "num_frames": 24, "fps": 12}
    )

    assert result["ckpt_name"] == "wan2.1_t2v_1.3B-Q4_K_M.gguf"
    # Wan 2.1 1.3B pairs with wan_2.1_vae.
    assert result["vae_name"] == "wan_2.1_vae.safetensors"

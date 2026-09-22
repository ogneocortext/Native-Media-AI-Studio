"""Tests for checkpoint filtering and AnimateDiff checkpoint validation.

Covers the hardening added during the ComfyUI model audit:
- ``is_image_checkpoint`` keyword filter (single source of truth shared by
  the adapter auto-select, the /comfyui/checkpoints listing, and the
  generate endpoint validation)
- ``_generate_video`` rejecting non-SD1.5 checkpoints on the AnimateDiff
  path with an actionable ValueError instead of an opaque ComfyUI failure
- gen3d ``REQUIRED_NODES`` covering every ComfyUI-backed 3D backend
"""

import asyncio

import pytest

from app.adapters.comfyui import (
    NON_IMAGE_CHECKPOINT_KEYWORDS,
    ComfyUIAdapter,
    is_image_checkpoint,
)


class TestIsImageCheckpoint:
    @pytest.mark.parametrize(
        "name",
        [
            "v1-5-pruned-emaonly.safetensors",
            "sd_xl_base_1.0.safetensors",
            "realisticVision_v60.safetensors",
        ],
    )
    def test_accepts_sd_family(self, name: str):
        assert is_image_checkpoint(name)

    @pytest.mark.parametrize(
        "name",
        [
            "kandinsky5lite_i2v_5s.safetensors",   # video i2v, not SD
            "hunyuan3d-dit-v2-mini.safetensors",   # 3D diffusion
            "triposr.ckpt",                        # 3D reconstruction
            "stable-fast-3d.safetensors",          # 3D reconstruction
            "wan2.2_ti2v_5B_gguf_q4.gguf",         # video model
            "animatediff_motion.safetensors",      # motion module
        ],
    )
    def test_rejects_non_sd(self, name: str):
        assert not is_image_checkpoint(name)

    def test_keywords_cover_historical_junk(self):
        # The exact placeholder filenames found in the audit must be caught.
        for junk in ("triposr.safetensors", "stable-fast-3d.safetensors"):
            assert not is_image_checkpoint(junk)


class TestAnimateDiffCheckpointValidation:
    def _adapter(self) -> ComfyUIAdapter:
        return ComfyUIAdapter(mock_mode=True)

    def test_rejects_kandinsky_on_animatediff_path(self):
        adapter = self._adapter()
        with pytest.raises(ValueError, match="not an SD1.5-family"):
            asyncio.run(adapter._generate_video({
                "prompt": "test",
                "num_frames": 16,
                "ckpt_name": "kandinsky5lite_i2v_5s.safetensors",
            }))

    def test_rejects_triposr_on_animatediff_path(self):
        adapter = self._adapter()
        with pytest.raises(ValueError, match="not an SD1.5-family"):
            asyncio.run(adapter._generate_video({
                "prompt": "test",
                "num_frames": 16,
                "ckpt_name": "triposr.ckpt",
            }))


class TestGen3dRequiredNodes:
    def test_every_comfyui_backend_has_required_nodes(self):
        from app.services.gen3d.gen3d_service import MODEL_BACKENDS, REQUIRED_NODES

        # point_e / shap_e run via ComfyUI custom nodes; hunyuan3d_2gp_external
        # is a standalone app and is intentionally not in MODEL_BACKENDS.
        for backend in MODEL_BACKENDS:
            assert backend in REQUIRED_NODES, f"{backend} missing REQUIRED_NODES entry"
            assert REQUIRED_NODES[backend], f"{backend} has empty REQUIRED_NODES"

    def test_hunyuan_backends_require_kijai_wrapper_nodes(self):
        from app.services.gen3d.gen3d_service import REQUIRED_NODES

        for backend in ("hunyuan3d_2mini", "hunyuan3d_2mv"):
            assert "Hy3DModelLoader" in REQUIRED_NODES[backend]
            assert "Hy3DGenerateMesh" in REQUIRED_NODES[backend]

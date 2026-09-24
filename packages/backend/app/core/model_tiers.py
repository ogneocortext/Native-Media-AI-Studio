"""
Model-tier classification + VRAM requirements (single source of truth).

Consolidates the Wan/GGUF name-sniffing previously scattered across:
- ``services/generation_estimator.py`` (``classify_model_variant``,
  ``VRAM_REQUIREMENTS`` — moved here verbatim),
- ``adapters/comfyui.py`` (inline ``is_wan_gguf`` routing check),
- ``api/integrations_generation.py`` (``/video-models`` variant tagging),
- ``VideoGenerationPage.tsx`` (frontend badge sniffing — backend remains
  the authority; the page prefers ``meta.variant`` and only falls back to
  name-sniffing when metadata is absent).

Lives in ``core/`` (not ``services/``) so adapters can import it without
a circular import (``services/__init__`` pulls in ``adapters.comfyui``).
"""

from __future__ import annotations

# VRAM requirements (MB) for video generation models on Pascal (GTX 1070 Ti / sm_61)
# Based on 2026 research: Wan 2.2 TI2V-5B GGUF Q4/Q5 fits 8GB with CPU T5 offload;
# FP16 variants require 16-24GB. Wan 2.1 1.3B is the 6GB class (832×480 native).
# Super 3D Pro Standard fits 6-8GB.
# LTX 2.3 and Mochi entries are research targets — not yet validated on 8GB.
VRAM_REQUIREMENTS: dict[str, dict[str, int]] = {
    # Wan 2.1 1.3B — 6GB class, 832×480 native (fits 8GB directly, no GGUF needed)
    "wan2_1_t2v_1_3b": {"min_mb": 5000, "recommended_mb": 6500, "max_mb": 8000},
    "wan2_1_fun_inp_1_3b": {"min_mb": 6000, "recommended_mb": 7500, "max_mb": 8500},
    # Wan 2.2 TI2V-5B variants
    "wan_ti2v_5b_gguf_q4": {"min_mb": 5500, "recommended_mb": 7500, "max_mb": 8000},
    "wan_ti2v_5b_gguf_q5": {"min_mb": 6000, "recommended_mb": 7800, "max_mb": 8200},
    "wan_ti2v_5b_fp16": {"min_mb": 16000, "recommended_mb": 20000, "max_mb": 24000},
    # Other video models
    "super_3d_pro_standard": {"min_mb": 5000, "recommended_mb": 6500, "max_mb": 8000},
    "animate_diff_sd15": {"min_mb": 3000, "recommended_mb": 4500, "max_mb": 6000},
    "kandinsky_5_lite": {"min_mb": 4000, "recommended_mb": 5500, "max_mb": 7000},
    # Research targets — 8GB viability unvalidated; entries are paper/community estimates.
    "ltx_2_3": {"min_mb": 8000, "recommended_mb": 12000, "max_mb": 16000},
    "mochi_1": {"min_mb": 8000, "recommended_mb": 12000, "max_mb": 16000},
    "mochi_2": {"min_mb": 8000, "recommended_mb": 12000, "max_mb": 16000},
}

# Tiers served by the Wan 2.2 GGUF video workflow (quantized, 8GB-safe).
WAN_GGUF_TIERS = frozenset({"wan_ti2v_5b_gguf_q4", "wan_ti2v_5b_gguf_q5"})


def classify_model_variant(model_name: str) -> str:
    """Classify a model name into a known capability tier.

    Returns one of the VRAM_REQUIREMENTS keys, or ``"unknown"`` when the
    model is not recognized.
    """
    base = (model_name or "").lower()
    if "wan" in base:
        # Check specific Wan generations before generic GGUF branch
        if "1.3b" in base or "1_3b" in base or "1.3_b" in base:
            if "fun" in base and "inp" in base:
                return "wan2_1_fun_inp_1_3b"
            return "wan2_1_t2v_1_3b"
        if "gguf" in base or "q4" in base or "q5" in base:
            if "q5" in base:
                return "wan_ti2v_5b_gguf_q5"
            return "wan_ti2v_5b_gguf_q4"
        return "wan_ti2v_5b_fp16"
    if "super_3d" in base or "super3d" in base:
        return "super_3d_pro_standard"
    if "kandinsky" in base:
        return "kandinsky_5_lite"
    if "ltx" in base:
        return "ltx_2_3"
    if "mochi" in base:
        return "mochi_1" if "1" in base else "mochi_2"
    if "mm_sd" in base or "animate" in base or "motion" in base or "lora" in base:
        return "animate_diff_sd15"
    return "unknown"


def estimate_vram_requirement(model_name: str) -> dict[str, int]:
    """Return VRAM requirement estimates (in MB) for a video generation model.

    The returned dict contains:
    - ``min_mb``: minimum VRAM to attempt generation
    - ``recommended_mb``: comfortable headroom target
    - ``max_mb``: hard ceiling beyond which the model will not fit

    Falls back to conservative AnimateDiff defaults when the model is unknown.
    """
    tier = classify_model_variant(model_name)
    return VRAM_REQUIREMENTS.get(tier, VRAM_REQUIREMENTS["animate_diff_sd15"])


def is_wan_gguf_model(model_name: str) -> bool:
    """True when a checkpoint name refers to a Wan GGUF quantized variant."""
    return classify_model_variant(model_name) in WAN_GGUF_TIERS


# All Wan video tiers that fit 8GB (including 1.3B). Used by adapter routing
# and video-models tagging to decide 8GB badge vs 16GB+ warning.
WAN_8GB_TIERS = frozenset({
    "wan2_1_t2v_1_3b",
    "wan2_1_fun_inp_1_3b",
    "wan_ti2v_5b_gguf_q4",
    "wan_ti2v_5b_gguf_q5",
})


def is_wan_8gb_model(model_name: str) -> bool:
    """True when a Wan checkpoint fits 8GB (1.3B or 5B GGUF)."""
    return classify_model_variant(model_name) in WAN_8GB_TIERS

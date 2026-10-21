"""
Unit tests for the ComfyUI LTX workflow builder (V1).

Mocks the ComfyUI API and asserts the LTX node graph structure is correct:
LTXVideoModelLoader -> CLIPLoader(T5) -> LTXVConditioning -> LTXVSampler -> VAEDecode.

These tests run without ComfyUI — they exercise the pure workflow-building
methods on the ComfyUIAdapter.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.adapters.comfyui import ComfyUIAdapter  # noqa: E402


@pytest.fixture
def adapter():
    return ComfyUIAdapter(base_url="http://127.0.0.1:8188", mock_mode=False)


def test_build_ltx_workflow_has_required_nodes(adapter):
    wf = adapter._build_ltx_workflow(
        prompt="a cinematic music video scene",
        negative_prompt="blurry, low quality",
        steps=25, cfg=6.0, width=768, height=512,
        seed=7, sampler="uni_pc", num_frames=25, fps=12,
        ckpt_name="ltxv-2b-0.9.8-distilled-fp8.safetensors",
    )
    nodes = wf["prompt"] if isinstance(wf, dict) and "prompt" in wf else wf
    assert isinstance(nodes, dict) and len(nodes) > 0
    class_types = {n.get("class_type") for n in nodes.values() if isinstance(n, dict)}
    required = {"LTXVideoModelLoader", "CLIPLoader", "LTXVConditioning", "LTXVSampler", "VAEDecode"}
    missing = required - class_types
    assert not missing, f"LTX workflow missing nodes: {missing}"


def test_build_ltx_workflow_ltx_checkpoint_loader(adapter):
    wf = adapter._build_ltx_workflow(
        prompt="test prompt", negative_prompt="", steps=25, cfg=6.0,
        width=768, height=512, seed=7, sampler="uni_pc",
        num_frames=25, fps=12,
        ckpt_name="ltxv-2b-0.9.8-distilled-fp8.safetensors",
    )
    nodes = wf["prompt"] if isinstance(wf, dict) and "prompt" in wf else wf
    model_nodes = [n for n in nodes.values()
                   if isinstance(n, dict) and n.get("class_type") == "LTXVideoModelLoader"]
    assert model_nodes, "No LTXVideoModelLoader node found"
    inputs = model_nodes[0].get("inputs", {})
    ckpt = inputs.get("model", "")
    assert "ltx" in str(ckpt).lower(), f"LTXVideoModelLoader does not reference LTX: {ckpt}"


def test_build_ltx_workflow_t5_and_vae(adapter):
    wf = adapter._build_ltx_workflow(
        prompt="test prompt", negative_prompt="", steps=25, cfg=6.0,
        width=768, height=512, seed=7, sampler="uni_pc",
        num_frames=25, fps=12,
        ckpt_name="ltxv-2b-0.9.8-distilled-fp8.safetensors",
    )
    nodes = wf["prompt"] if isinstance(wf, dict) and "prompt" in wf else wf
    clip_nodes = [n for n in nodes.values()
                  if isinstance(n, dict) and n.get("class_type") == "CLIPLoader"]
    assert clip_nodes, "No CLIPLoader node found"
    clip_inputs = clip_nodes[0].get("inputs", {})
    clip_name = str(clip_inputs.get("ckpt_name", ""))
    assert "t5" in clip_name.lower() or "ltx" in clip_name.lower(), \
        f"CLIPLoader does not reference T5/ltxv: {clip_name}"
    vae_nodes = [n for n in nodes.values()
                 if isinstance(n, dict) and n.get("class_type") == "VAEDecode"]
    assert vae_nodes, "No VAEDecode node found"


def test_build_ltx_workflow_default_variant(adapter):
    wf = adapter._build_ltx_workflow(
        prompt="test prompt", negative_prompt="", steps=25, cfg=6.0,
        width=768, height=512, seed=7, sampler="uni_pc",
        num_frames=25, fps=12,
    )
    assert isinstance(wf, dict) and len(wf) > 0


def test_build_ltx_workflow_steps_and_cfg_propagate(adapter):
    wf = adapter._build_ltx_workflow(
        prompt="test prompt", negative_prompt="", steps=30, cfg=7.5,
        width=768, height=512, seed=42, sampler="uni_pc",
        num_frames=25, fps=12,
        ckpt_name="ltxv-2b-0.9.8-distilled-fp8.safetensors",
    )
    nodes = wf["prompt"] if isinstance(wf, dict) and "prompt" in wf else wf
    sampler_nodes = [n for n in nodes.values()
                     if isinstance(n, dict) and n.get("class_type") == "LTXVSampler"]
    assert sampler_nodes, "No LTXVSampler node found"
    sampler_inputs = sampler_nodes[0].get("inputs", {})
    steps_val = sampler_inputs.get("steps")
    cfg_val = sampler_inputs.get("cfg")
    assert steps_val == 30, f"LTXVSampler steps = {steps_val}, expected 30"
    assert cfg_val == 7.5, f"LTXVSampler cfg = {cfg_val}, expected 7.5"


def test_classify_ltx_model(adapter):
    from app.core.model_tiers import classify_model_variant
    assert classify_model_variant("ltxv-2b-0.9.8-distilled-fp8") == "ltx_2_3"
    assert classify_model_variant("ltx-video-2.3") == "ltx_2_3"
    assert classify_model_variant("LTXV-2B") == "ltx_2_3"


def test_ltx_vram_fits_8gb(adapter):
    from app.core.model_tiers import estimate_vram_requirement
    req = estimate_vram_requirement("ltxv-2b-0.9.8-distilled-fp8")
    assert req["max_mb"] <= 8000, f"LTX max VRAM {req['max_mb']}MB exceeds 8GB"
    assert req["recommended_mb"] <= 8000, f"LTX recommended VRAM {req['recommended_mb']}MB exceeds 8GB"


def test_build_ltx_workflow_resolution_clamped(adapter):
    wf = adapter._build_ltx_workflow(
        prompt="test prompt", negative_prompt="", steps=25, cfg=6.0,
        width=1920, height=1080, seed=7, sampler="uni_pc",
        num_frames=25, fps=12,
        ckpt_name="ltxv-2b-0.9.8-distilled-fp8.safetensors",
    )
    nodes = wf["prompt"] if isinstance(wf, dict) and "prompt" in wf else wf
    dim_nodes = []
    for node in nodes.values():
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs", {})
        if "width" in inputs and "height" in inputs:
            dim_nodes.append((inputs["width"], inputs["height"], node.get("class_type")))
    assert dim_nodes, "No dimension-carrying nodes found"
    for w, h, ct in dim_nodes:
        assert w <= 768, f"{ct} width {w} exceeds 768 max"
        assert h <= 512, f"{ct} height {h} exceeds 512 max"


def test_build_ltx_workflow_frames_snap_to_4n_plus_1(adapter):
    wf = adapter._build_ltx_workflow(
        prompt="test prompt", negative_prompt="", steps=25, cfg=6.0,
        width=768, height=512, seed=7, sampler="uni_pc",
        num_frames=30, fps=12,
        ckpt_name="ltxv-2b-0.9.8-distilled-fp8.safetensors",
    )
    nodes = wf["prompt"] if isinstance(wf, dict) and "prompt" in wf else wf
    all_frame_values = []
    for node in nodes.values():
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs", {})
        for key in ("num_frames", "frames"):
            if key in inputs:
                all_frame_values.append(inputs[key])
    if all_frame_values:
        for f in all_frame_values:
            assert (f - 1) % 4 == 0, f"Frame count {f} is not 4n+1"

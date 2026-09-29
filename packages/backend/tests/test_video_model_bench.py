"""Regression tests for the video-model benchmark harness.

Guards three classes of bug found in September 2026:

1. ComfyUI graph errors. ``validate_inputs`` in ComfyUI ``execution.py`` rejects
   a prompt when a required input is missing, when a value is not in a node's
   option list, or when a link points at a slot the source node does not have
   (it indexes ``RETURN_TYPES[slot]`` directly). The shipped workflow templates
   and ``_ltx_workflow`` violated these rules, so ComfyUI refused them with
   ``invalid_prompt``. ``NODE_SIGNATURES`` below is transcribed from the
   installed ComfyUI source (``nodes.py``, ``comfy_extras/nodes_lt.py``,
   ``comfy_extras/nodes_mochi.py``).
2. Result-file bloat: re-running the benchmark appended duplicate rows instead
   of replacing the record for the same configuration.
3. ``quick_bench.py`` polled ``status.status`` (the real key is ``status_str``)
   and looked for ``status.exception`` (errors live in ``status.messages``), so
   it polled forever and recorded empty errors.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_ROOT.parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.video_model_bench import (  # noqa: E402
    WORKFLOW_DIR,
    _ltx_workflow,
    _ltxv_2b_workflow,
    _mochi_workflow,
    _run_key,
    upsert_result,
)

# class_type -> (required inputs, number of output slots)
NODE_SIGNATURES: dict[str, tuple[list[str], int]] = {
    "UNETLoader": (["unet_name", "weight_dtype"], 1),
    "UnetLoaderGGUF": (["unet_name"], 1),
    "CLIPLoader": (["clip_name", "type"], 1),
    "DualCLIPLoader": (["clip_name1", "clip_name2", "type"], 1),
    "CLIPTextEncode": (["text", "clip"], 1),
    "LTXVConditioning": (["positive", "negative", "frame_rate"], 2),
    "EmptyLTXVLatentVideo": (["width", "height", "length", "batch_size"], 1),
    "EmptyMochiLatentVideo": (["width", "height", "length", "batch_size"], 1),
    "KSampler": (
        [
            "seed",
            "steps",
            "cfg",
            "sampler_name",
            "scheduler",
            "denoise",
            "model",
            "positive",
            "negative",
            "latent_image",
        ],
        1,
    ),
    "VAELoader": (["vae_name"], 1),
    "VAEDecode": (["samples", "vae"], 1),
    "VHS_VideoCombine": (
        ["images", "frame_rate", "loop_count", "filename_prefix", "format", "pingpong", "save_output"],
        1,
    ),
}


def validate_graph(graph: dict[str, Any]) -> list[str]:
    """Return ComfyUI validation problems for an API-format prompt graph."""
    problems: list[str] = []
    for node_id, node in graph.items():
        class_type = node.get("class_type")
        signature = NODE_SIGNATURES.get(class_type)
        if signature is None:
            problems.append(f"{node_id}: unknown class_type {class_type!r}")
            continue
        required, outputs = signature
        inputs = node.get("inputs", {})
        for name in required:
            if name not in inputs:
                problems.append(f"{node_id} ({class_type}): required input {name!r} is missing")
        for name in inputs:
            if name not in required:
                problems.append(f"{node_id} ({class_type}): input {name!r} is not part of the node")
        for name, value in inputs.items():
            if isinstance(value, list) and len(value) == 2 and isinstance(value[1], int):
                source_id, slot = str(value[0]), value[1]
                source = graph.get(source_id)
                if source is None:
                    problems.append(f"{node_id}: input {name!r} links to missing node {source_id!r}")
                    continue
                source_signature = NODE_SIGNATURES.get(source.get("class_type"))
                if source_signature and slot >= source_signature[1]:
                    problems.append(
                        f"{node_id}: input {name!r} links to slot {slot} of {source_id} "
                        f"({source.get('class_type')}) which has {source_signature[1]} output(s)"
                    )
    return problems


# ---------------------------------------------------------------------------
# Generated graphs
# ---------------------------------------------------------------------------

BUILDERS = {
    "ltxv_2b": _ltxv_2b_workflow,
    "ltx_2_3": _ltx_workflow,
    "mochi": _mochi_workflow,
}


def build(name: str, model_file: str = "model.safetensors") -> dict[str, Any]:
    """Return the API-format prompt graph produced by one builder."""
    workflow = BUILDERS[name](model_file, 512, 512, 25, 12, 42)
    assert set(workflow) == {"prompt"}, "builders must wrap the graph in a prompt key"
    return workflow["prompt"]


@pytest.mark.parametrize("name", sorted(BUILDERS))
def test_generated_graphs_pass_comfyui_validation(name: str) -> None:
    assert validate_graph(build(name)) == []


def test_ltx_2_3_gguf_variant_is_valid() -> None:
    workflow = _ltx_workflow("ltx-2.3-22b-dev-fp8.gguf", 512, 512, 25, 12, 42, model_format="gguf")
    graph = workflow["prompt"]
    assert graph["1"]["class_type"] == "UnetLoaderGGUF"
    assert validate_graph(graph) == []


def test_ltx_2_3_uses_dual_clip_loader_without_prompt_inputs() -> None:
    """DualCLIPLoader returns one CLIP slot and takes no ``text``/``text2`` inputs."""
    graph = build("ltx_2_3")
    loader = next(n for n in graph.values() if n["class_type"] == "DualCLIPLoader")
    assert set(loader["inputs"]) == {"clip_name1", "clip_name2", "type"}
    assert loader["inputs"]["type"] == "ltxv"
    encoders = [n for n in graph.values() if n["class_type"] == "CLIPTextEncode"]
    assert [n["inputs"]["text"] for n in encoders] == ["positive prompt here", "negative prompt here"]
    assert all(n["inputs"]["clip"] == ["2", 0] for n in encoders)


def test_mochi_uses_mochi_latent_node_and_unet_loader() -> None:
    """``EmptyLatentVideo`` does not exist; Mochi needs its own latent node."""
    graph = build("mochi")
    class_types = {n["class_type"] for n in graph.values()}
    assert "EmptyMochiLatentVideo" in class_types
    assert "EmptyLatentVideo" not in class_types
    unet = next(n for n in graph.values() if n["class_type"] == "UNETLoader")
    assert set(unet["inputs"]) == {"unet_name", "weight_dtype"}
    clip = next(n for n in graph.values() if n["class_type"] == "CLIPLoader")
    assert clip["inputs"]["type"] == "mochi"


def test_loaders_receive_the_model_file_under_comfyuis_own_key() -> None:
    """Model file must land on ``unet_name``, not a made-up ``model_file`` key."""
    for name in sorted(BUILDERS):
        graph = build(name, "ltx-model.safetensors")
        loaders = [n for n in graph.values() if n["class_type"].lower().startswith("unetloader")]
        assert loaders, f"{name} has no model loader"
        for loader in loaders:
            assert loader["inputs"]["unet_name"] == "ltx-model.safetensors"
            assert "model_file" not in loader["inputs"]


# ---------------------------------------------------------------------------
# Shipped workflow templates
# ---------------------------------------------------------------------------

def test_workflow_template_files_are_valid_graphs() -> None:
    templates = sorted(WORKFLOW_DIR.glob("*.json"))
    assert templates, f"no workflow templates found in {WORKFLOW_DIR}"
    for path in templates:
        payload = json.loads(path.read_text(encoding="utf-8"))
        graph = payload.get("prompt", payload)
        assert validate_graph(graph) == [], f"{path.name} is not a valid ComfyUI graph"



# ---------------------------------------------------------------------------
# Result upserting
# ---------------------------------------------------------------------------

def _record(**overrides: Any) -> dict[str, Any]:
    record = {
        "timestamp": "2026-09-28T00:00:00+00:00",
        "model": "ltxv_2b",
        "resolution": "512x512",
        "frames": 24,
        "precision": "fp8",
        "format": "safetensors",
        "status": "success",
    }
    record.update(overrides)
    return record


def test_upsert_replaces_the_record_for_the_same_configuration() -> None:
    results = upsert_result([], _record())
    results = upsert_result(results, _record(status="timeout", generation_time_s=900))
    assert len(results) == 1
    assert results[0]["status"] == "timeout"
    assert results[0]["generation_time_s"] == 900


def test_upsert_keeps_records_that_differ_in_one_dimension() -> None:
    results: list[dict[str, Any]] = []
    for resolution in ("512x512", "832x480"):
        for precision in ("fp8", "fp16"):
            results = upsert_result(results, _record(resolution=resolution, precision=precision))
    assert len(results) == 4


def test_run_key_treats_a_missing_format_as_safetensors() -> None:
    """Legacy rows have no ``format`` field but represent the same run."""
    legacy = _record()
    del legacy["format"]
    assert _run_key(legacy) == _run_key(_record(format="safetensors"))
    assert _run_key(_record(format="gguf")) != _run_key(_record(format="safetensors"))
    results = upsert_result([legacy], _record(status="error"))
    assert len(results) == 1
    assert results[0]["status"] == "error"


# ---------------------------------------------------------------------------
# tools/scripts/quick_bench.py helpers
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def quick_bench():
    script = PROJECT_ROOT / "tools" / "scripts" / "quick_bench.py"
    if not script.exists():
        pytest.skip(f"{script} is not present")
    spec = importlib.util.spec_from_file_location("quick_bench", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_quick_bench_extracts_the_nested_execution_error(quick_bench) -> None:
    """ComfyUI reports failures as ``["execution_error", {...}]`` inside status.messages."""
    entry = {
        "status": {
            "status_str": "error",
            "messages": [
                ["execution_start", {"prompt_id": "abc"}],
                [
                    "execution_error",
                    {
                        "node_id": "7",
                        "exception_type": "ValueError",
                        "exception_message": "shape [1, 128, 1, 64, 64] is invalid",
                    },
                ],
            ],
        }
    }
    assert quick_bench.extract_error(entry) == "node 7 ValueError: shape [1, 128, 1, 64, 64] is invalid"


def test_quick_bench_workflow_is_a_valid_graph(quick_bench) -> None:
    assert validate_graph(quick_bench.WORKFLOW["prompt"]) == []


def test_quick_bench_records_one_row_per_configuration(quick_bench, tmp_path: Path) -> None:
    path = tmp_path / "bench.json"
    quick_bench.record_path(path, dict(quick_bench.RUN_IDENTITY, status="timeout"))
    quick_bench.record_path(path, dict(quick_bench.RUN_IDENTITY, status="success"))
    assert [row["status"] for row in json.loads(path.read_text(encoding="utf-8"))] == ["success"]


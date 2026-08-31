"""
Ollama Three.js Scene Benchmark Service.

Runs a standardized Three.js scene generation prompt against each available
Ollama model, validates the output against the studio contract, and stores
results to output/ollama-benchmarks.json for frontend consumption.

Scoring is deterministic and cheap (regex + optional node --check), so
benchmarks can be re-run without GPU-heavy execution.
"""

import json
import re
import time
import logging
import subprocess
import tempfile
from pathlib import Path
from datetime import datetime, timezone
from typing import Any

from ..core.config import PROJECT_ROOT

logger = logging.getLogger(__name__)

BENCHMARK_FILE = PROJECT_ROOT / "output" / "ollama-benchmarks.json"

# Standardized prompt - must match AISceneGenerator contract
BENCHMARK_SYSTEM = """You are a Three.js code generator. Output RAW JavaScript ONLY - no markdown fences, no ```, no explanations.

CONTRACT - MUST OBEY (checked automatically, violations will be rejected):
1. Define exactly: function applyScene(scene, camera, renderer, THREE) { ... return update; }
2. Inside applyScene:
   - Cleanup previous: const old = scene.getObjectByName("__aiGenerated"); if(old){ old.traverse(c=>{c.geometry&&c.geometry.dispose(); c.material&&[].concat(c.material).forEach(m=>m.dispose())}); scene.remove(old); }
   - Create: const g = new THREE.Group(); g.name = "__aiGenerated"; scene.add(g); Add ALL meshes/lights to g (or tag lights with userData.__ai=true)
   - Camera: camera.position.set(x,y,z); camera.lookAt(0,1,0);
   - Scene: scene.background = new THREE.Color(hex); scene.fog = new THREE.FogExp2(hex, 0.015);
3. FORBIDDEN (will fail validation): requestAnimationFrame, renderer.setSize(window.innerWidth), renderer.setPixelRatio, window.addEventListener('resize'), document.getElementById, import, require, OrbitControls, EffectComposer, React hooks
4. Return: return (time, delta) => { /* per-frame */ };
5. Keep 40-90 lines. Use only: THREE.Group, Mesh, MeshStandardMaterial, MeshPhysicalMaterial, Points, PointsMaterial, BufferGeometry, SphereGeometry, BoxGeometry, CylinderGeometry, TorusGeometry, TorusKnotGeometry, IcosahedronGeometry, Color, FogExp2, AmbientLight, DirectionalLight, PointLight, SpotLight
6. Materials: clone if per-mesh opacity varies. Halo: geo.clone().scale(1.18,1.18,1.18).
"""

BENCHMARK_USER = """Create a Three.js scene for a 120 BPM track (dynamic, evolving, cinematic).
Sections: intro, verse, chorus, bridge. Energy: 78%. Dynamic. Style: vibrant neon, pulsing transitions, building tension.
- Dramatic camera (orbit)
- Atmospheric lighting shifting with music 120 BPM
- Fast particle explosions on beats
- Build tension before drops
- Palette: deep purples, electric blues, hot pink/orange
Return ONLY valid JavaScript. Define: function applyScene(scene, camera, renderer, THREE) { ... }"""

BENCHMARK_OPTIONS = {
    "temperature": 0.2,
    "top_p": 0.9,
    "num_predict": 900,
    "repeat_penalty": 1.1,
    # num_ctx is injected per-model VRAM-aware in run_single_benchmark (keeps pro prompt intact)
}

# Validation rules: (name, pattern, should_exist, weight, description)
# Patterns for forbidden checks require "(" to avoid matching prose comments (e.g. "// no requestAnimationFrame")
VALIDATION_RULES = [
    ("has_applyScene", r"function\s+applyScene\s*\(\s*scene\s*,\s*camera\s*,\s*renderer\s*,\s*THREE\s*\)", True, 20, "Defines applyScene(scene,camera,renderer,THREE)"),
    ("has_ai_group", r"__aiGenerated", True, 15, "Uses __aiGenerated group for cleanup"),
    ("has_return_update", r"return\s+(?:\(?\s*time\s*,\s*delta\s*\)?\s*=>|update\b|__sceneUpdate)", True, 15, "Returns (time,delta)=> or update function"),
    ("has_group_creation", r"new\s+THREE\.Group\(\)", True, 5, "Creates THREE.Group"),
    ("has_scene_add", r"scene\.add\s*\(\s*\w+", True, 5, "Adds group to scene"),
    ("no_rAF", r"requestAnimationFrame\s*\(", False, 10, "No requestAnimationFrame (studio drives loop)"),
    ("no_setSize_window", r"renderer\.setSize\s*\(\s*window\.innerWidth", False, 8, "No renderer.setSize(window.innerWidth)"),
    ("no_setPixelRatio", r"renderer\.setPixelRatio\s*\(", False, 3, "No renderer.setPixelRatio"),
    ("no_resize_listener", r"addEventListener\s*\(\s*['\"]resize['\"]", False, 5, "No window resize listener"),
    ("no_getElementById", r"document\.getElementById\s*\(", False, 5, "No document.getElementById"),
    ("no_markdown_fence", r"```", False, 10, "No markdown fences"),
    ("no_import", r"^\s*import\s+", False, 5, "No ES imports"),
    ("has_three_usage", r"THREE\.(Mesh|SphereGeometry|BoxGeometry|Color|FogExp2)", True, 5, "Uses THREE APIs"),
]

def _validate_code(code: str) -> dict[str, Any]:
    """Run regex validation and optional node --check."""
    code_stripped = code.strip()
    details = []
    score = 0
    max_score = sum(w for _, _, _, w, _ in VALIDATION_RULES)
    passed = 0

    for name, pattern, should_exist, weight, desc in VALIDATION_RULES:
        found = bool(re.search(pattern, code_stripped, re.MULTILINE))
        ok = (found == should_exist)
        if ok:
            score += weight
            passed += 1
        details.append({
            "rule": name,
            "description": desc,
            "weight": weight,
            "should_exist": should_exist,
            "found": found,
            "passed": ok,
        })

    # Extra metrics
    line_count = len(code_stripped.splitlines())
    char_count = len(code_stripped)
    has_balanced_braces = code_stripped.count("{") == code_stripped.count("}")

    # Try node --check if available (syntax validation)
    node_valid = None
    node_error = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".js", delete=False, encoding="utf-8") as f:
            f.write(code_stripped)
            tmp = f.name
        result = subprocess.run(
            ["node", "--check", tmp],
            capture_output=True, text=True, timeout=5
        )
        node_valid = (result.returncode == 0)
        if not node_valid:
            node_error = result.stderr.strip()[:300]
        # node --check success gives +5 bonus, failure -10 penalty
        if node_valid:
            score += 5
            max_score += 5
        else:
            score = max(0, score - 10)
        Path(tmp).unlink(missing_ok=True)
    except (FileNotFoundError, subprocess.TimeoutExpired, Exception) as e:
        node_valid = None
        node_error = str(e)[:200]

    # Line count heuristic: 40-120 ideal, penalize extremes
    line_penalty = 0
    if line_count < 20:
        line_penalty = 10
    elif line_count > 150:
        line_penalty = 10
    elif line_count > 100:
        line_penalty = 5
    score = max(0, score - line_penalty)

    # Normalize to 0-100
    normalized = round((score / max_score) * 100) if max_score else 0

    return {
        "score": normalized,
        "raw_score": score,
        "max_score": max_score,
        "passed_rules": passed,
        "total_rules": len(VALIDATION_RULES),
        "details": details,
        "metrics": {
            "lines": line_count,
            "chars": char_count,
            "balanced_braces": has_balanced_braces,
            "node_valid": node_valid,
            "node_error": node_error,
        },
    }

def _load_file() -> dict[str, Any]:
    if BENCHMARK_FILE.exists():
        try:
            with open(BENCHMARK_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Failed to load benchmark file: {e}")
    return {"updated_at": None, "results": {}}

def _save_file(data: dict[str, Any]) -> None:
    BENCHMARK_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(BENCHMARK_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

def get_all_results() -> dict[str, Any]:
    return _load_file()

def get_result(model: str) -> dict[str, Any] | None:
    data = _load_file()
    return data.get("results", {}).get(model)

def get_best_model() -> str | None:
    data = _load_file()
    results = data.get("results", {})
    if not results:
        return None
    # Prefer highest score, then lowest latency
    best = None
    best_score = -1
    best_latency = float("inf")
    for name, r in results.items():
        score = r.get("validation", {}).get("score", 0) if isinstance(r.get("validation"), dict) else 0
        latency = r.get("latency_ms", 999999)
        # Only consider successful generations
        if r.get("success") is False:
            continue
        if score > best_score or (score == best_score and latency < best_latency):
            best = name
            best_score = score
            best_latency = latency
    return best

def _vram_aware_num_ctx(model: str) -> int:
    """Pick num_ctx that fits pro prompt (~1800 tok) + 900 predict without OOM.
    Keeps full guidelines + few-shot example intact for professional visuals.
    8GB VRAM: 3072~0.9GB KV, 4096~1.2GB, 6144~1.8GB, 8192~2.5GB for 9b.
    """
    try:
        from ..services.vram_manager import vram_manager
        # Try to get free VRAM synchronously via last cached status; fallback to probe
        # Use sync-ish inspection: if manager has cached status, use it, else default 4096
        import asyncio

        # If running in async context, try to get status via vram_manager.get_vram_status if available
        # For simplicity, peek at thresholds and assume conservative default
        # Real free check is done in caller when possible; this is fallback
        free = 2048  # conservative fallback
        # Attempt to read from vram_manager's last status if exposed
        # The manager caches after each poll; we use 4096 as safe professional default
        is_large = any(k in model.lower() for k in ("9b", "7b", "13b", "14b", "10b"))
        # Professional prompt needs at least 3072 to avoid truncating guidelines + example
        base = 4096 if not is_large else 6144
        # If free VRAM probe is available via sync path, adjust
        # This helper is called from async run_single_benchmark where we do async fetch below
        return base
    except Exception:
        return 4096


async def _get_optimal_num_ctx(model: str) -> int:
    """Async VRAM probe for benchmark — ensures pro prompt not truncated yet fits 8GB."""
    try:
        from ..services.vram_manager import vram_manager

        status = await vram_manager.get_vram_status()
        # vram_manager returns {free_mb, total_mb, ...} or similar
        free = status.get("free_mb") or status.get("memory_free_mb") or status.get("vram_free_mb") or 2000
        is_large = any(k in model.lower() for k in ("9b", "7b", "13b", "14b", "10b"))
        if free > 4000:
            return 8192 if is_large else 6144
        elif free > 2000:
            return 4096
        else:
            return 3072  # still fits 1800 prompt + 900 predict = 2700
    except Exception:
        return _vram_aware_num_ctx(model)


async def run_single_benchmark(model: str, adapter) -> dict[str, Any]:
    """Run benchmark for a single model, returns result dict."""
    start = time.perf_counter()
    try:
        num_ctx = await _get_optimal_num_ctx(model)
        opts = {**BENCHMARK_OPTIONS, "num_ctx": num_ctx}
        result = await adapter.chat(
            messages=[
                {"role": "system", "content": BENCHMARK_SYSTEM},
                {"role": "user", "content": BENCHMARK_USER},
            ],
            model=model,
            stream=False,
            think=False,
            **opts,
        )
        latency_ms = int((time.perf_counter() - start) * 1000)
        content = result.get("message", {}).get("content", "") if isinstance(result, dict) else str(result)
        validation = _validate_code(content)

        # Check for empty or error
        success = bool(content and len(content.strip()) > 50 and validation["score"] >= 40)

        return {
            "model": model,
            "success": success,
            "latency_ms": latency_ms,
            "chars": len(content),
            "lines": len(content.splitlines()),
            "validation": validation,
            "preview": content[:600],
            "error": None,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        latency_ms = int((time.perf_counter() - start) * 1000)
        logger.error(f"Benchmark failed for {model}: {e}", exc_info=True)
        return {
            "model": model,
            "success": False,
            "latency_ms": latency_ms,
            "chars": 0,
            "lines": 0,
            "validation": {"score": 0, "raw_score": 0, "max_score": 100, "passed_rules": 0, "total_rules": len(VALIDATION_RULES), "details": [], "metrics": {}},
            "preview": "",
            "error": str(e)[:500],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

async def run_benchmark(models: list[str] | None, adapter, max_models: int = 8) -> dict[str, Any]:
    """Run benchmark for given models (or all available if None), store results."""
    # Resolve model list
    if not models:
        try:
            available = await adapter.list_models()
            models = [m.get("name") for m in available if m.get("name")]
        except Exception as e:
            logger.error(f"Failed to list models: {e}")
            models = []

    # Filter to reasonable count
    models = models[:max_models]

    if not models:
        return {"error": "No models available", "results": {}}

    data = _load_file()
    if "results" not in data:
        data["results"] = {}

    for model in models:
        logger.info(f"Benchmarking {model}...")
        result = await run_single_benchmark(model, adapter)
        data["results"][model] = result
        # Save incrementally so partial results are visible
        data["updated_at"] = datetime.now(timezone.utc).isoformat()
        _save_file(data)

    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    _save_file(data)
    return data

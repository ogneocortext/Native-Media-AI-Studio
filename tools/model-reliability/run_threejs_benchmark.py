#!/usr/bin/env python3
"""Standalone Three.js scene benchmark for local models.

Calls each model directly via HTTP (Ollama on 11434, Atomic Chat on 1337),
validates output against the studio Three.js contract (same rules as
tools/scripts/ollama_benchmark.py), prints a ranked comparison table, and
appends per-model outcomes to tools/model-reliability/observed.jsonl.

Improvements over the first version:
  * UTF-8 stdout guard (this machine's console is cp1252; model output can
    contain em-dashes and other non-ASCII that would crash plain print()).
  * Incremental result saving to output/ollama-benchmarks-run.json so a
    hung model doesn't lose the results already collected.
  * --model / --engine flags to re-test just one model (useful for Nemotron
    re-runs after a code change).
  * Historical delta: shows score/latency change vs the previous run for
    the same model+engine, read from observed.jsonl.
  * Structured observed.jsonl entries: score, latency_ms, load_ms,
    chars, lines as top-level fields, not buried in the note string.
  * Progress flushing so the script doesn't look dead during a 75s model.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

# Emit UTF-8 bytes to stdout even when the console/code page is cp1252
# (Windows default would mangle em-dashes and crash on non-ASCII content).
if sys.stdout.encoding is None or sys.stdout.encoding.lower().replace("-", "") != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    except Exception:
        pass

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
RUN_RESULTS_FILE = PROJECT_ROOT / "output" / "ollama-benchmarks-run.json"
OBSERVED_PATH = Path("tools/model-reliability/observed.jsonl")

# --- Same contract as tools/scripts/ollama_benchmark.py ---
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

# Default model set: three Ollama models + Nemotron on Atomic Chat.
DEFAULT_JOBS = [
    ("ollama", "gemma4:e2b-it-qat"),
    ("ollama", "qwen3.5:4b"),
    ("ollama", "llama3.2:3b"),
    ("atomic_chat", "nvidia/Nemotron-3_5-Bolt-E4B-Q4_K_M"),
]


def validate_code(code: str) -> dict[str, Any]:
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
            "rule": name, "description": desc, "weight": weight,
            "should_exist": should_exist, "found": found, "passed": ok,
        })

    line_count = len(code_stripped.splitlines())
    char_count = len(code_stripped)
    has_balanced_braces = code_stripped.count("{") == code_stripped.count("}")

    node_valid = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".js", delete=False, encoding="utf-8") as f:
            f.write(code_stripped)
            tmp = f.name
        result = subprocess.run(
            ["node", "--check", tmp], encoding="utf-8", errors="replace",
            capture_output=True, text=True, timeout=5,
        )
        node_valid = (result.returncode == 0)
        if node_valid:
            score += 5
            max_score += 5
        else:
            score = max(0, score - 10)
        Path(tmp).unlink(missing_ok=True)
    except Exception:
        node_valid = None

    line_penalty = 0
    if line_count < 20:
        line_penalty = 10
    elif line_count > 150:
        line_penalty = 10
    elif line_count > 100:
        line_penalty = 5
    score = max(0, score - line_penalty)

    normalized = round((score / max_score) * 100) if max_score else 0

    return {
        "score": normalized, "raw_score": score, "max_score": max_score,
        "passed_rules": passed, "total_rules": len(VALIDATION_RULES),
        "details": details,
        "metrics": {
            "lines": line_count, "chars": char_count,
            "balanced_braces": has_balanced_braces,
            "node_valid": node_valid,
        },
    }


def call_ollama(model: str, prompt_system: str, prompt_user: str) -> tuple[str, int, int | None, str | None]:
    """Returns (content, latency_ms, load_ms_or_None, error_or_None)."""
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": prompt_system},
            {"role": "user", "content": prompt_user},
        ],
        "stream": False,
        "think": False,
        "options": {"temperature": 0.2, "top_p": 0.9, "num_predict": 900},
    }
    start = time.perf_counter()
    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            "http://127.0.0.1:11434/api/chat",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=300) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        latency = int((time.perf_counter() - start) * 1000)
        content = body.get("message", {}).get("content", "") or ""
        load_ns = body.get("load_duration")
        load_ms = int(load_ns / 1_000_000) if load_ns is not None else None
        return content, latency, load_ms, None
    except Exception as e:
        latency = int((time.perf_counter() - start) * 1000)
        return "", latency, None, f"{type(e).__name__}: {e}"


def call_atomic_chat(model: str, prompt_system: str, prompt_user: str) -> tuple[str, int, int | None, str | None]:
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": prompt_system},
            {"role": "user", "content": prompt_user},
        ],
        "stream": False,
        "max_tokens": 900,
        "temperature": 0.2,
    }
    start = time.perf_counter()
    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            "http://127.0.0.1:1337/v1/chat/completions",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=300) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        latency = int((time.perf_counter() - start) * 1000)
        content = body.get("choices", [{}])[0].get("message", {}).get("content", "") or ""
        return content, latency, None, None
    except Exception as e:
        latency = int((time.perf_counter() - start) * 1000)
        return "", latency, None, f"{type(e).__name__}: {e}"


CALLERS = {
    "ollama": call_ollama,
    "atomic_chat": call_atomic_chat,
}


def load_previous_results() -> dict[tuple[str, str], dict[str, Any]]:
    """Read observed.jsonl and return the latest benchmark result per (engine, model)."""
    previous: dict[tuple[str, str], dict[str, Any]] = {}
    if not OBSERVED_PATH.exists():
        return previous
    try:
        with open(OBSERVED_PATH, encoding="utf-8-sig") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if r.get("model") != r.get("model"):
                    continue
                note = r.get("note", "")
                if "Three.js scene benchmark:" not in note:
                    continue
                key = (r.get("route", ""), r.get("model", ""))
                previous[key] = r  # last entry wins
    except Exception:
        pass
    return previous


def parse_note_fields(note: str) -> dict[str, Any]:
    """Pull score/latency/chars/lines out of a legacy note string if present."""
    fields: dict[str, Any] = {}
    import re as _re
    m = _re.search(r"score=(\d+)/(\d+)", note)
    if m:
        fields["score"] = int(m.group(1))
        fields["max_score"] = int(m.group(2))
    m = _re.search(r"latency=(\d+)ms", note)
    if m:
        fields["latency_ms"] = int(m.group(1))
    m = _re.search(r"chars=(\d+)", note)
    if m:
        fields["chars"] = int(m.group(1))
    m = _re.search(r"lines=(\d+)", note)
    if m:
        fields["lines"] = int(m.group(1))
    return fields


def run_model(engine: str, model: str) -> dict[str, Any]:
    """Run one model, return a result dict (never raises)."""
    print(f"=== {engine} / {model} ===", flush=True)
    caller = CALLERS[engine]
    start = time.perf_counter()
    try:
        content, latency, load_ms, error = caller(model, BENCHMARK_SYSTEM, BENCHMARK_USER)
    except Exception as e:  # defensive; callers already catch, but be safe
        latency = int((time.perf_counter() - start) * 1000)
        content, load_ms, error = "", None, f"{type(e).__name__}: {e}"

    if error:
        print(f"  ERROR: {error}", flush=True)
        validation = {"score": 0, "raw_score": 0, "max_score": 100, "passed_rules": 0,
                      "total_rules": len(VALIDATION_RULES), "details": [], "metrics": {}}
        success = False
        chars = 0
        lines = 0
    else:
        validation = validate_code(content)
        success = bool(content and len(content.strip()) > 50 and validation["score"] >= 40)
        chars = len(content)
        lines = len(content.splitlines())
        print(f"  Latency: {latency} ms", flush=True)
        if load_ms:
            print(f"  Load: {load_ms} ms", flush=True)
        print(f"  Chars: {chars}, Lines: {lines}", flush=True)
        print(f"  Validation score: {validation['score']} ({validation['passed_rules']}/{validation['total_rules']} rules)", flush=True)
        print(f"  Success: {success}", flush=True)
        preview = content[:200].replace("\n", "\\n")
        print(f"  Preview: {preview!r}", flush=True)

    return {
        "engine": engine, "model": model,
        "success": success, "latency_ms": latency, "load_ms": load_ms,
        "chars": chars, "lines": lines,
        "validation": validation,
        "error": error,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run the Three.js scene benchmark against local models."
    )
    parser.add_argument("--model", help="Only benchmark this model (exact name match)")
    parser.add_argument("--engine", choices=["ollama", "atomic_chat"],
                        help="Only benchmark this engine")
    args = parser.parse_args()

    jobs = [(e, m) for e, m in DEFAULT_JOBS
            if (args.engine is None or e == args.engine)
            and (args.model is None or m == args.model)]

    if not jobs:
        print("No jobs match --model/--engine filter.", flush=True)
        return 1

    previous = load_previous_results()

    results: list[dict[str, Any]] = []
    RUN_RESULTS_FILE.parent.mkdir(parents=True, exist_ok=True)

    for engine, model in jobs:
        r = run_model(engine, model)
        results.append(r)

        # Incremental save: if a later model hangs, earlier results aren't lost.
        run_data = {
            "updated_at": datetime.now(UTC).isoformat(),
            "results": {f"{r2['engine']}/{r2['model']}": r2 for r2 in results},
        }
        with open(RUN_RESULTS_FILE, "w", encoding="utf-8") as f:
            json.dump(run_data, f, indent=2)

    # Rank: success first, then score desc, then latency asc
    results.sort(key=lambda r: (not r["success"], -r["validation"]["score"], r["latency_ms"]))

    print("\n" + "=" * 72)
    print("BENCHMARK RESULTS (ranked)")
    print("=" * 72)
    print(f"{'Rank':<6} {'Engine':<14} {'Model':<40} {'Score':<6} {'Latency':<9} {'Chars':<7} {'Lines':<7} {'OK'   } {'Delta'}")
    print("-" * 72)
    for i, r in enumerate(results, 1):
        key = (r["engine"], r["model"])
        prev = previous.get(key)
        delta = ""
        if prev:
            prev_fields = parse_note_fields(prev.get("note", ""))
            prev_score = prev_fields.get("score")
            prev_latency = prev_fields.get("latency_ms")
            parts = []
            if prev_score is not None:
                dscore = r["validation"]["score"] - prev_score
                parts.append(f"score {dscore:+d}")
            if prev_latency is not None:
                dlat = r["latency_ms"] - prev_latency
                parts.append(f"lat {dlat:+d}ms")
            delta = " ".join(parts)
        print(f"{i:<6} {r['engine']:<14} {r['model']:<40} "
              f"{r['validation']['score']:<6} {r['latency_ms']:<9} "
              f"{r['chars']:<7} {r['lines']:<7} {str(r['success']):<5} {delta}")

    # Append outcomes to observed.jsonl with structured fields.
    timestamp = datetime.now(UTC).strftime("%Y-%m-%d")
    with open(OBSERVED_PATH, "a", encoding="utf-8") as f:
        for r in results:
            entry = {
                "date": timestamp,
                "model": r["model"],
                "route": r["engine"],
                "worked": r["success"],
                "score": r["validation"]["score"],
                "max_score": r["validation"]["max_score"],
                "latency_ms": r["latency_ms"],
                "load_ms": r["load_ms"],
                "chars": r["chars"],
                "lines": r["lines"],
                "note": ("Three.js scene benchmark: score={score}/{max_score} "
                         "latency={latency}ms chars={chars} lines={lines} {err}").format(
                    score=r["validation"]["score"],
                    max_score=r["validation"]["max_score"],
                    latency=r["latency_ms"],
                    chars=r["chars"],
                    lines=r["lines"],
                    err=f"error={r['error']}" if r["error"] else "",
                ),
            }
            f.write(json.dumps(entry) + "\n")
    print(f"\nAppended {len(results)} entries to {OBSERVED_PATH}")
    print(f"Run results saved to {RUN_RESULTS_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

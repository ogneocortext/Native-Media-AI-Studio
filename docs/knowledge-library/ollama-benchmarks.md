---
tags:
  - benchmark
  - ollama
  - three-js
  - ai-scene-generation
  - performance
  - validation
aliases:
  - Ollama Benchmark
  - Three.js Scene Benchmark
  - Model Benchmark
cssclasses:
  - benchmark
date: 2026-09-04
---

# 🏁 Ollama Three.js Scene Benchmark

> [!info] Purpose
> Standardized benchmark for evaluating Ollama models on Three.js scene generation quality.
> Runs a deterministic prompt against each model, validates output against the studio contract,
> and stores results for frontend comparison in [[three-js-studio]].

> [!tip] For AI Agents
> This benchmark is the authoritative source for model selection in the Three.js Studio.
> Always reference benchmark scores when choosing models for scene generation.

---

## 📋 Benchmark Overview

| Aspect | Detail |
|--------|--------|
| **Service** | `packages/backend/app/services/ollama_benchmark.py` |
| **Output** | `output/ollama-benchmarks.json` |
| **Prompt Type** | Standardized Three.js scene generation (120 BPM, cinematic, neon) |
| **Validation** | Regex contract + optional `node --check` syntax validation |
| **Scoring** | 0–100 normalized, deterministic |
| **Max Models** | 8 per run (configurable) |

---

## 🎯 Standardized Prompt Contract

The benchmark uses a fixed system + user prompt pair that exercises the full [[three-js-studio]] contract.

### System Prompt

```text
You are a Three.js code generator. Output RAW JavaScript ONLY - no markdown fences, no ```, no explanations.

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
```

### User Prompt

```text
Create a Three.js scene for a 120 BPM track (dynamic, evolving, cinematic).
Sections: intro, verse, chorus, bridge. Energy: 78%. Dynamic. Style: vibrant neon, pulsing transitions, building tension.
- Dramatic camera (orbit)
- Atmospheric lighting shifting with music 120 BPM
- Fast particle explosions on beats
- Build tension before drops
- Palette: deep purples, electric blues, hot pink/orange
Return ONLY valid JavaScript. Define: function applyScene(scene, camera, renderer, THREE) { ... }```

---

## ✅ Validation Rules

Each generated code sample is scored against the following regex rules:

| Rule | Pattern | Weight | Type | Description |
|------|---------|--------|------|-------------|
| `has_applyScene` | `function\s+applyScene\s*\(\s*scene\s*,\s*camera\s*,\s*renderer\s*,\s*THREE\s*\)` | 20 | Required | Defines `applyScene(scene,camera,renderer,THREE)` |
| `has_ai_group` | `__aiGenerated` | 15 | Required | Uses `__aiGenerated` group for cleanup |
| `has_return_update` | `return\s+(?:\(?\s*time\s*,\s*delta\s*\)?\s*=>|update\b|__sceneUpdate)` | 15 | Required | Returns `(time,delta)=>` or update function |
| `has_group_creation` | `new\s+THREE\.Group\(\)` | 5 | Required | Creates `THREE.Group` |
| `has_scene_add` | `scene\.add\s*\(\s*\w+` | 5 | Required | Adds group to scene |
| `no_rAF` | `requestAnimationFrame\s*\(` | 10 | Forbidden | No `requestAnimationFrame` (studio drives loop) |
| `no_setSize_window` | `renderer\.setSize\s*\(\s*window\.innerWidth` | 8 | Forbidden | No `renderer.setSize(window.innerWidth)` |
| `no_setPixelRatio` | `renderer\.setPixelRatio\s*\(` | 3 | Forbidden | No `renderer.setPixelRatio` |
| `no_resize_listener` | `addEventListener\s*\(\s*['\"]resize['\"]` | 5 | Forbidden | No window resize listener |
| `no_getElementById` | `document\.getElementById\s*\(` | 5 | Forbidden | No `document.getElementById` |
| `no_markdown_fence` | ` ``` ` | 10 | Forbidden | No markdown fences |
| `no_import` | `^\s*import\s+` | 5 | Forbidden | No ES imports |
| `has_three_usage` | `THREE\.(Mesh|SphereGeometry|BoxGeometry|Color|FogExp2)` | 5 | Required | Uses THREE APIs |

**Max Raw Score:** 101 points (100 rules + 1 node bonus)

---

## 📊 Scoring Algorithm

```python
# 1. Rule scoring
score = sum(weight for rule in VALIDATION_RULES if rule.passed)

# 2. Node.js syntax validation (+5 / -10)
if node --check passes: score += 5, max_score += 5
if node --check fails:  score = max(0, score - 10), max_score += 5

# 3. Line count penalty
lines < 20:   -10
lines > 150:  -10
lines > 100:  -5

# 4. Normalize to 0-100
normalized = round((score / max_score) * 100)
```

### Success Threshold

A result is considered **successful** when:
- Content is non-empty and > 50 chars
- Validation score ≥ 40

---

## ⚙️ Benchmark Options

```python
BENCHMARK_OPTIONS = {
    "temperature": 0.2,      # Low for deterministic code
    "top_p": 0.9,            # Nucleus sampling
    "num_predict": 900,      # Max tokens
    "repeat_penalty": 1.1,   # Reduce repetition
    # num_ctx is injected per-model based on VRAM (see below)
}
```

### VRAM-Aware Context Window

The benchmark automatically adjusts `num_ctx` based on available VRAM:

| Free VRAM | Small Model (<7B) | Large Model (≥7B) |
|-----------|-------------------|-------------------|
| > 4000 MB | 6144 | 8192 |
| > 2000 MB | 4096 | 4096 |
| ≤ 2000 MB | 3072 | 3072 |

---

## 🚀 Running Benchmarks

### Via Backend API

```bash
# Run all available models (max 8)
POST /api/benchmarks/run

# Run specific models
POST /api/benchmarks/run
{
  "models": ["llama3:8b", "qwen2.5:7b", "gemma2:9b"]
}

# Get all results
GET /api/benchmarks/results

# Get best model
GET /api/benchmarks/best
```

### Via Python

```python
from packages.backend.app.services.ollama_benchmark import run_benchmark, get_all_results

# Run benchmarks
results = await run_benchmark(models=None, adapter=adapter, max_models=8)

# Load cached results
all_results = get_all_results()
best_model = all_results["results"][max(all_results["results"], key=lambda m: all_results["results"][m]["validation"]["score"])]
```

---

## 📁 Results Format

`output/ollama-benchmarks.json`:

```json
{
  "updated_at": "2026-09-04T05:00:00Z",
  "results": {
    "llama3:8b": {
      "model": "llama3:8b",
      "success": true,
      "latency_ms": 3420,
      "chars": 1850,
      "lines": 65,
      "validation": {
        "score": 85,
        "raw_score": 86,
        "max_score": 106,
        "passed_rules": 13,
        "total_rules": 14,
        "details": [
          {
            "rule": "has_applyScene",
            "description": "Defines applyScene(scene,camera,renderer,THREE)",
            "weight": 20,
            "should_exist": true,
            "found": true,
            "passed": true
          }
        ],
        "metrics": {
          "lines": 65,
          "chars": 1850,
          "balanced_braces": true,
          "node_valid": true,
          "node_error": null
        }
      },
      "preview": "function applyScene(scene, camera, renderer, THREE) { ... }",
      "error": null,
      "timestamp": "2026-09-04T05:00:00Z"
    }
  }
}
```

---

## 🏆 Model Selection

The `get_best_model()` function selects the winner using:

1. **Highest validation score** (primary)
2. **Lowest latency** (tiebreaker)
3. **Excludes failed generations** (`success: false`)

---

## 🔗 Integration

- **Frontend:** [[three-js-studio]] consumes benchmark results to pre-select the best model
- **VRAM Manager:** [[technical-reference]] — `vram_manager` provides free VRAM for context sizing
- **Ollama Integration:** [[integration-ollama]] — `adapter.chat()` executes the benchmark prompt

---

## 📈 Interpreting Scores

| Score | Grade | Interpretation |
|-------|-------|----------------|
| 90–100 | A | Excellent — production-ready code, all contracts met |
| 70–89 | B | Good — minor contract violations, usable with cleanup |
| 50–69 | C | Fair — significant issues, requires manual fixing |
| 40–49 | D | Poor — barely functional, not recommended |
| < 40 | F | Failed — does not meet minimum viability |

> [!note] Score Caveats
> - Scores are deterministic for the same model/temperature/seed combination
> - A score of 100 does not guarantee visually stunning scenes, only contract compliance
> - Use benchmark scores as a baseline, not the sole selection criterion

---

## 🏆 Local Benchmark Results

> [!info] Latest Run
> **Date:** 2026-08-30  
> **Output:** `output/ollama-benchmarks.json`

| Model | Score | Latency | Status | Notes |
|-------|-------|---------|--------|-------|
| `qwen3.5:9b` | **91** | 161.3s | ✅ Success | Highest score; slowest due to size |
| `llama3.2:3b` | **82** | 24.8s | ✅ Success | Fastest successful model; good balance |
| `gemma4:e2b-it-qat` | **77** | 38.1s | ✅ Success | Default vision model; decent code gen |
| `qwen3.5:4b` | **77** | 42.1s | ✅ Success | Similar to gemma4; slightly slower |
| `ornith-1.5:9b` | 0 | 300.4s | ❌ Failed | Timeout / empty output |
| `qwen3-vl:4b` | 35 | 180.9s | ❌ Failed | Vision-only; wrong task fit |
| `qwen3-vl:2b` | 35 | 158.4s | ❌ Failed | Vision-only; wrong task fit |
| `deepseek-r1:7b` | 0 | 300.9s | ❌ Failed | Timeout / empty output |

### Winner Analysis

**Best overall:** `qwen3.5:9b` (score 91)  
**Best speed/quality tradeoff:** `llama3.2:3b` (score 82, 24.8s)  
**Default model:** `gemma4:e2b-it-qat` (score 77, 38.1s)

> [!warning] Model Fit
> Vision-only models (`qwen3-vl:*`) are poor fits for raw code generation benchmarks.
> For best results, prefer text/code models with strong instruction following.

---

## 🛠️ Maintenance

To update this document:

1. Edit `docs/knowledge-library/ollama-benchmarks.md`
2. Update `docs/knowledge-library/index.md` with any new links
3. Commit changes with message: `docs: update ollama benchmark documentation`

---

*Last updated: 2026-09-04*

---
tags:
  - index
  - knowledge-library
  - music-video
  - production
aliases:
  - Knowledge Library Index
  - Music Video Knowledge Base
  - Production Reference
cssclasses:
  - knowledge-index
date: 2026-09-05
---

# 📚 Knowledge Library Index

> [!info] Purpose
> Centralized knowledge hub for AI agents and creators to produce compelling music videos for YouTube.
> Built for [[Native Media AI Studio]] — a full-stack AI music video creation suite.

> [!tip] For AI Agents
> This vault is machine-readable. All documents use plain markdown with YAML frontmatter.
> Link between documents using `[[wiki-links]]` for cross-referencing.

---

## 🗂️ Library Structure

### 🎬 Production Pipeline

- [[music-video-production|🎵 Music Video Production Guide]] — Complete production workflow from audio upload to final export
- [[youtube-optimization|📺 YouTube Optimization]] — Platform-specific optimization for reach and engagement

### 🛠️ Technical References

- [[technical-reference|⚙️ Technical Reference]] — System architecture, API reference, service management
- [[integration-ollama|🤖 Ollama Integration]] — Local LLM inference, tool calling, agent loop patterns
- [[comfyui-workflows|🎨 ComfyUI Workflows]] — Custom workflows for image/video generation
- [[blender-mcp|🖥️ Blender MCP Integration]] — 3D scene building via MCP protocol
- [[hunyuan3d-setup|🧊 Hunyuan3D-2mini Setup]] — ComfyUI 3D generation with Kijai wrapper
- [[3d-generation-options-2026|🧊 3D Generation Options 2026]] — Complete image-to-3D landscape for 8GB VRAM (PyTorch 2.14, Pascal capstone)
- [[text-to-3d-options-2026|💬 Text-to-3D Options 2026]] — Open-source text-to-3D models for 8GB VRAM (Point-E, Shap-E, Hunyuan3D-2mini T2I, TRELLIS-text)
- [[3d-generation-2026-updates|🧊 3D Generation 2026 Updates]] — Hunyuan3D 2.1 PBR breakthrough, Super 3D Pro local generation, VRAM optimization (NEW 2026-09-20)
- [[three-js-studio|🌐 Three.js Studio]] — Browser-based 3D scene builder with particles & reflections
- [[ai-video-trends-2026|📈 AI Video Trends 2026]] — 5 industry shifts, model landscape, pipeline upgrades
- [[video-generation-vram-2026|🎬 Video Generation VRAM 2026]] — 8GB GPU video generation with quantization breakthroughs (NEW 2026-09-20)
- [[youtube-algorithm-2026-updates|📺 YouTube Algorithm 2026 Updates]] — Viewer satisfaction shift, new view counting rules, format-aware discovery (NEW 2026-09-20)
- [[kilo-code-subagent-orchestration|🤖 Kilo Code Subagent Orchestration]] — Subagent architecture, provider errors, optimization strategies
- [[kilo-code-subagent-optimization|🚀 Kilo Code Subagent Optimization]] — Config implementations, concurrency limits, retry jitter, verification
- [[python-environment-management|🐍 Python Environment Management]] — venv mechanics, decoupling graph, PyTorch×Pascal (sm_61) wheel matrix, env migration recipes (NEW 2026-09-06)
- [[pascal-gpu-optimization-2026|🐴 Pascal GPU Optimization 2026]] — GTX 1070 Ti / sm_61 constraints: torch version, SDPA backends, torch.compile limits, VRAM optimization stack for ACE-Step Tier 3 (NEW 2026-09-20)
- [[stack-extensions-2026|🔧 Stack Extensions 2026]] — Optional languages (CUDA C++, Rust/PyO3, WGSL, **Go**) + high-value Python tools for audio/video/3D (core-flux, madmom-infer, sonara, MovieLite, essentia, audiofeat, videopython, BeatSync Engine, gsplat) — benchmark-first adoption (NEW 2026-09-07)
- [[cuda-pytorch-directx-upgrades-2026|🚀 CUDA/PyTorch/DirectX Upgrades 2026]] — CUDA 12.6 toolkit features, torchaudio CUDA migration, TorchAO INT8 quantization, WebGPU compute shaders (Three.js TSL), DirectX 12 Ultimate applicability (Pascal limits) — upgrade recommendations for the current stack (NEW 2026-09-22)
- [[go-integration-2026|🔀 Go Integration 2026]] — Split-stack architecture: Go for dashboard/SSE, media workers, gateway; Python for AI/model layer (NEW 2026-09-08)

### 🎯 Specialized Guides

- [[3d-rendering|🧊 3D Rendering]] — GPU rendering, Blender 5.2 EEVEE Next, optimization
- [[3d-visualization-best-practices-2026|🎛️ 3D Visualization Best Practices 2026]] — Full audit of all 13 viz styles + 7 studio templates, R3F/WebGPU/perf/a11y rules (NEW 2026-09-16)
- [[visualization-effects|✨ Visualization Effects]] — WebGPU/TSL, particles, shaders, post-processing, volumetrics (NEW 2026-08-29)
- [[2d-visualization-2026|🎨 2D Visualization 2026]] — Canvas2D/PixiJS/p5.js/Waviz 2026 open source 2D stacks (UPDATED 2026-09-05: PixiJS 8.19, p5.js trails, Summer 2026 addendum)
- [[webgl-webgpu-audio-viz-2026|🎵 WebGL/WebGPU Audio Viz 2026]] — Rust/WASM audio analysis, GPU compute shaders, music-reactive 3D, multi-threaded visualization (NEW 2026-09-20)
- [[character-animation-2026-summer-synthesis|🎭 Character Animation 2026 — Summer Synthesis]] — Story-first puppet, beatPhase sync, performance-driven (NEW 2026-09-05)
- [[audio-reactive-production|🎧 Audio-Reactive Production]] — Audio → visual mapping, beat sync
- [[silhouette-character-animation|🎭 Silhouette Character Animation]] — Character rigging & motion
- [[character-driven-visualization-research|🔬 Character-Driven Visualization]] — Character research
- [[hardware-verified-models|🖥️ Hardware-Verified Models]] — 8GB VRAM model matrix
- [[music-gen-hardware-fit-2026|🎵 Music Gen Hardware Fit 2026]] — ACE-Step 1.5 on GTX 1070 Ti; install paths, VRAM budgets
- [[prompt-engineering|✍️ Prompt Engineering]] — Effective prompts + repair/versioning workflow
- [[remotion-guide|🎬 Remotion Video Compositing]] — Programmatic video with React (NEW 2026-09-01)
- [[modern-css-2026|🎨 Modern CSS 2026]] — Tailwind v4 @theme/layers, OKLCH theming, gradient spaces, a11y media queries, verification checklist (NEW 2026-09-23)
- [[ollama-prompting-2026|🤖 Ollama Prompting 2026]] — Vision grounding/uncertainty, structured-output schemas, code-gen contracts, VRAM latency policy (NEW 2026-09-23)
- [[color-strategy-2026|🎨 Color Strategy 2026]] — APCA vs WCAG dark-mode contrast, measured token audit, tier rules (NEW 2026-09-23)
- [[design-auditing-2026|🔍 Design Auditing 2026]] — Contrast+axe+VLM audit layers, runbook for `contrast_audit.py` (NEW 2026-09-23)

### 🤖 AI Agent Resources

- [[ai-agent-navigation|🤖 AI Agent Navigation]] — Quick lookup table for agents (NEW 2026-09-01)
- [[backend-debugging-guide|🐛 Backend Debugging Guide]] — Debugging patterns for FastAPI/queue/VRAM
- [[ollama-thinking-structured-outputs|🧠 Ollama Thinking & Structured Outputs]] — `think` + `format:json`
- [[minicpm-v-best-practices|🔍 MiniCPM-V 2.6 Best Practices]] — your `minicpm-v:8b` local vision: 1.8MP any-aspect OCR, multi-image/video, RLAIF-V trustworthy, 640-token efficiency on GTX 1070 Ti (NEW 2026-09-06)

### 📊 Research & Audit

- [[../ux-audit/audit-report|🔍 UX Audit Report]] — User experience findings and recommendations
- [[ollama-benchmarks|🏁 Ollama Three.js Scene Benchmark]] — Model benchmarking for scene generation (NEW 2026-09-04)
- [[coding-benchmarks|🧪 Coding Model Benchmark]] — Python code, test generation, tool use, edge-case benchmarks for AI test harness selection (NEW 2026-09-04)

---

## 🏷️ Tags Index

| Tag                  | Description                                       | Documents   |
| -------------------- | ------------------------------------------------- | ----------- |
| `#music-video`       | Music video production                            | 5 documents |
| `#3d-rendering`      | 3D rendering and optimization                     | 3 documents |
| `#3d-generation`     | 3D model generation (image-to-3D, 2026)           | 1 document  |
| `#visualization`     | Visualization effects, shaders, particles         | 1 document  |
| `#webgpu`            | WebGPU / TSL / compute                            | 2 documents |
| `#ai-generation`     | AI image/video generation                         | 4 documents |
| `#youtube`           | YouTube platform optimization                     | 1 document  |
| `#blender`           | Blender 3D integration                            | 2 documents |
| `#comfyui`           | ComfyUI workflows                                 | 2 documents |
| `#gpu`               | GPU optimization                                  | 3 documents |
| `#prompt`            | Prompt engineering                                | 1 document  |
| `#kilo-code`         | Kilo Code tooling and orchestration               | 2 documents |
| `#subagent`          | Subagent architecture and errors                  | 2 documents |
| `#optimization`      | Subagent optimization strategies                  | 1 document  |
| `#configuration`     | Kilo Code configuration                           | 1 document  |
| `#concurrency`       | Concurrency control and rate limiting             | 1 document  |
| `#retry`             | Retry policies and backoff                        | 1 document  |
| `#remotion`          | Remotion video compositing                        | 1 document  |
| `#frontend-css`      | Tailwind v4 theming, layers, a11y                 | 1 document  |
| `#prompt-engineering`| Ollama vision grounding, schemas, contracts       | 1 document  |
| `#color-strategy`    | APCA contrast, dark-mode tiers, token audit       | 1 document  |
| `#design-qa`         | Contrast+axe+VLM audit system, runbook            | 1 document  |
| `#audio`             | Audio-reactive production                         | 1 document  |
| `#silhouette`        | Silhouette / character animation                  | 2 documents |
| `#hardware`          | Hardware-verified 8GB models                      | 1 document  |
| `#backend`           | Backend debugging                                 | 1 document  |
| `#ollama`            | Ollama thinking / structured outputs              | 2 documents |
| `#python`            | Python envs, venv decoupling, CUDA wheels         | 1 document  |
| `#stack-extensions`  | Optional languages + audio/video/3D Python tools  | 1 document  |
| `#go`                | Go integration: dashboard, media workers, gateway | 1 document  |
| `#pascal-gpu`        | GTX 10xx Pascal architecture                      | 1 document  |
| `#vram-optimization` | 8GB VRAM optimization techniques                  | 1 document  |
| `#torchao` | TorchAO quantization for Pascal (INT8 only) | 1 document  |

---

## 🔗 Quick Links

### By Role

- **🎬 Director** → [[music-video-production]] → [[youtube-optimization]]
- **💻 Developer** → [[technical-reference]] → [[comfyui-workflows]] → [[blender-mcp]]
- **🎨 Artist** → [[prompt-engineering]] → [[3d-rendering]] → [[music-video-production]]
- **🤖 AI Agent** → [[kilo-code-subagent-orchestration]] → [[technical-reference]] → [[prompt-engineering]]

### By Pipeline Phase

```mermaid
graph LR
    A[Upload Audio] --> B[Analyze Beats]
    B --> C[Configure Generation]
    C --> D[Generate per Section]
    D --> E[Review & Export]
    E --> F[Upload to YouTube]
```

---

## 📝 How to Use This Vault

### For Creators

1. Start with [[music-video-production]] to understand the full workflow
2. Use [[prompt-engineering]] to craft better prompts
3. Reference [[youtube-optimization]] before publishing

### For AI Agents

1. Read [[technical-reference]] for system capabilities
2. Follow the workflow in [[music-video-production]]
3. Use [[comfyui-workflows]] and [[blender-mcp]] for technical operations
4. Return here to update knowledge as new techniques are discovered

### Adding New Knowledge

1. Create a new `.md` file in this vault
2. Add YAML frontmatter with `tags`, `aliases`, and `date`
3. Use `[[wiki-links]]` to connect to related documents
4. Update this index with the new entry

---

## 🔄 Maintenance

> [!warning] Keep Updated
> This knowledge library should be updated when:
>
> - New features are added to the pipeline
> - UX improvements are implemented
> - New models or tools are integrated
> - YouTube platform requirements change
> - New research on AI music video production emerges

---

## 📊 Vault Statistics

| Metric          | Count                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Total Documents | 54                                                                                                                          |
| Total Tags      | 28                                                                                                                          |
| Total Links     | 95+                                                                                                                         |
| Last Updated    | 2026-09-22 (CUDA/PyTorch/DirectX upgrade research: torchaudio CUDA, TorchAO INT8, WebGPU compute, DirectX 12 Ultimate Pascal limits)                                     |
| Latest Add      | 2026-09-22 (CUDA/PyTorch/DirectX Upgrades 2026, TorchAO INT8 section in Pascal GPU Optimization) |

---

_Last updated: 2026-09-20_

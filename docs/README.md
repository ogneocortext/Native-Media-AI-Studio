# Documentation

This directory contains project documentation, knowledge base articles, and setup guides.

> [!tip] Start here
> New to this directory? Read the map below, then `knowledge-library/index.md`
> for the research library. `architecture/decision-log.md` records decisions that
> must not be re-litigated. If you are an agent, this file is the fastest way to
> find the right document — the directories below are not interchangeable.

## Directory Map

| Directory / File | Purpose |
|------------------|---------|
| `knowledge-library/` | **The research library.** 77 tagged articles (3D gen, Ollama, Blender MCP, Remotion, visualization, YouTube) plus 9 JSON data files (`prompts.json`, `mcp-registry.json`, `api-registry.json`, `music-prompt-presets.json`, `pronunciation-guide-2026.json`, `codebase.json`, `credit-economics-2026.json`, `lyric-techniques-2026.json`, `agent.manifest.json`) and a `benchmarks/` subfolder of results. Start at `index.md`. Every article carries a primary category as its first tag. |
| `knowledge/` | Separate doc set on frontend craft (kinetic typography, modern CSS, Three.js, audio visualization). **App-served but not part of the library** — see D12 in the decision log. |
| `guides/` | Production guides: GPU pipeline, visualizer debugging, music video workflow, file management |
| `setup/` | Environment setup: Conda, Python envs, model setup, video setup, tunnel access |
| `api/` | API reference |
| `architecture/` | Architecture overview and the decision log (D1–D12, Q1–Q4) |
| `comfyui-workflows/` | ComfyUI workflow reference |
| `plans/` | Proposed and in-flight implementation plans |
| `ux-audit/` | UX audit findings |
| `visual-storytelling/` | Storyboards and visual storytelling references |
| `notes/` | Development notes — working material, **not authoritative** |
| `scratch/` | Ad-hoc scratch outputs, diagnostics, one-off research — **not authoritative** |
| `screenshots/` | Documentation screenshots (gitignored; may be absent on a fresh clone) |

## Key Files

- `README.md` (this file) — map of the documentation tree
- `knowledge-library/index.md` — library navigation and tag counts
- `knowledge-library/tagging-guide.md` — how library articles are tagged
- `architecture/decision-log.md` — decisions and open questions
- `SYSTEM_REQUIREMENTS.md` — Hardware and software requirements
- `TESTING_WORKFLOWS.md` — Testing instructions
- `ENHANCEMENT_RECOMMENDATIONS.md` — Proposed improvements

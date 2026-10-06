# Documentation

This directory contains project documentation, knowledge base articles, and setup guides.

> [!tip] Start here
> New to this directory? Read the map below, then `knowledge-library/index.md`
> for the research library. `architecture/decision-log.md` records decisions that
> must not be re-litigated. If you are an agent, this file is the fastest way to
> find the right document — the directories below are not interchangeable.

## Directory Map

| Directory / File       | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `knowledge-library/`   | **The research library.** 84 tagged markdown articles (3D gen, Ollama, Blender MCP, Remotion, visualization, YouTube) plus 9 JSON data files (`prompts.json`, `mcp-registry.json`, `api-registry.json`, `music-prompt-presets.json`, `pronunciation-guide-2026.json`, `codebase.json`, `credit-economics-2026.json`, `lyric-techniques-2026.json`, `agent.manifest.json`) and a `benchmarks/` subfolder of results. Start at `index.md`. Every article carries a primary category as its first tag. |
| `knowledge/`           | Separate doc set on frontend craft (kinetic typography, modern CSS, Three.js, audio visualization). **App-served but not part of the library** — see D12 in the decision log.                                                                                                                                                                                                                                                                                                                       |
| `guides/`              | Production guides: GPU pipeline, visualizer debugging, music video workflow, file management                                                                                                                                                                                                                                                                                                                                                                                                        |
| `setup/`               | Environment setup: Conda, Python envs, model setup, video setup, tunnel access                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `api/`                 | API reference                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `architecture/`        | Architecture overview, the visualizer module map, and the decision log (D1–D31, Q1–Q6)                                                                                                                                                                                                                                                                                                                                                                                                              |
| `comfyui-workflows/`   | ComfyUI workflow reference                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `plans/`               | Proposed and in-flight implementation plans                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `ux-audit/`            | UX audit findings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `visual-storytelling/` | Storyboards and visual storytelling references                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `notes/`               | Development notes — working material, **not authoritative**                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `scratch/`             | Ad-hoc scratch outputs, diagnostics, one-off research — **not authoritative**                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `screenshots/`         | Documentation screenshots (gitignored; may be absent on a fresh clone)                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Key Files

- `README.md` (this file) — map of the documentation tree
- `knowledge-library/index.md` — library navigation and tag counts
- `knowledge-library/tagging-guide.md` — how library articles are tagged
- `architecture/decision-log.md` — decisions and open questions
- `architecture/visualizer.md` — visualizer module map and refactor rules (D14)
- `SYSTEM_REQUIREMENTS.md` — Hardware and software requirements
- `TESTING_WORKFLOWS.md` — Testing instructions
- `ENHANCEMENT_RECOMMENDATIONS.md` — Proposed improvements
- `visual-storytelling/README.md` — production storyboards and the playbook

## Searching the docs

Rather than reading the tree to find a file, query the search index directly:

```bash
curl "http://127.0.0.1:8000/api/docs/search?q=<query>&limit=10"
```

Tokenised BM25 over every markdown file under `docs/`, with title, tag, alias
and path terms weighted above body prose. Identifiers are split on snake_case
and camelCase, so `queue manager` finds `queue_manager.py` and `adapter` finds
`ComfyUIAdapter`.

It is tokenised rather than substring-matched, and that difference matters.
Substring scoring was measured on this corpus producing confidently wrong
answers — `og` matched documents containing "log"/"dialog", `vr` matched "VRAM"
and "over", `jobid` matched "video", and each outranked genuine matches. Each
result carries `matched_terms`, so a hit can be checked rather than trusted.

The index is cached and rebuilt only when a file changes: ~16–31 ms per query,
against ~547 ms when every request re-read the corpus.

**Scope note:** this is lexical retrieval, not semantic/vector RAG. That is a
deliberate fit for the corpus — 280 short technical documents whose queries are
mostly exact identifiers, file paths and error strings, where an embedding model
would be slower to run, harder to test, and no more accurate. A query phrased
conceptually ("how do I stop jobs timing out") will do worse than one naming a
symbol; that is the limitation to be aware of.

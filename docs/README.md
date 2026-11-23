# Documentation

This directory contains project documentation, knowledge base articles, and setup guides.

> [!tip] Start here
> New to this directory? Read the map below, then `knowledge-library/index.md`
> for the research library. `architecture/decision-log.md` records decisions that
> must not be re-litigated — read its **Quick index** (one line per decision),
> not the whole 190 KB log. If you are an agent, this file is the fastest way to
> find the right document — the directories below are not interchangeable.

## Directory Map

| Directory / File       | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `knowledge-library/`   | **The research library.** 100+ tagged markdown articles (3D gen, Ollama, Blender MCP, Remotion, visualization, YouTube) plus 12 JSON data files (`prompts.json`, `mcp-registry.json`, `api-registry.json`, `music-prompt-presets.json`, `pronunciation-guide-2026.json`, `codebase.json`, `credit-economics-2026.json`, `lyric-techniques-2026.json`, `agent.manifest.json`, and 3 more) and a `benchmarks/` subfolder of results. Start at `index.md`. Every article carries a primary category as its first tag. |
| `knowledge/`           | Separate doc set on frontend craft (kinetic typography, modern CSS, Three.js, audio visualization). **App-served but not part of the library** — see D12 in the decision log.                                                                                                                                                                                                                                                                                                                       |
| `guides/`              | Production guides: GPU pipeline, visualizer debugging, music video workflow, file management, API reference (`API_REFERENCE.md`), testing workflows (`TESTING_WORKFLOWS.md`)                                                                                                                                                                                                                                                                                                                         |
| `setup/`               | Environment setup: Conda, Python envs, model setup, video setup, tunnel access, system requirements (`SYSTEM_REQUIREMENTS.md`)                                                                                                                                                                                                                                                                                                                                                                      |
| `architecture/`        | Architecture overview, the visualizer module map, the browser-support policy, and the decision log (D1–D79, Q1–Q6)                                                                                                                                                                                                                                                                                                                  |
| `comfyui-workflows/`   | ComfyUI workflow reference                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `plans/`               | Proposed and in-flight implementation plans, plus `ENHANCEMENT_RECOMMENDATIONS.md`                                                                                                                                                                                                                                                                                                                                                                                                                |
| `ux/`                  | UX audit findings and design documents: the 5-minute first-run path draft (O2), the IA audit (O4), and the folded-in UX audit reports |
| `visual-storytelling/` | Storyboards and visual storytelling references                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `agents/`              | Reference material moved out of `AGENTS.md` so the always-loaded file stays small: the retrieval/embedding cookbook and the local model inventory. `AGENTS.md` points here. |
| `notes/`               | Development notes — working material, **not authoritative**                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `scratch/`             | Ad-hoc scratch outputs, diagnostics, one-off research — **not authoritative**                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `screenshots/`         | Documentation screenshots (gitignored; may be absent on a fresh clone)                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Key Files

- `README.md` (this file) — map of the documentation tree
- `agents/retrieval-cookbook.md` — worked Python/HTTP for the retrieval subsystem (moved out of AGENTS.md 2026-11-21)
- `agents/local-model-inventory.md` — installed models, VRAM budgets, download rules (checked against `ollama list` by `tools/check-doc-facts.py`)
- `agent-code-navigation.md` — task-to-source discovery workflow; distinguishes docs search from source search
- `agent-shell-cheatsheet.md` — **the shell/command reference for agents on the owner's Windows machine**: correct interpreters, which commands exist, the WSL trap. Read before running commands
- `knowledge-library/index.md` — library navigation and tag counts
- `knowledge-library/tagging-guide.md` — how library articles are tagged
- `knowledge-library/playwright-e2e-2026.md` — the Playwright E2E suite: layout, helper vocabulary, and current Playwright practices
- `architecture/decision-log.md` — decisions and open questions (start at the
  Quick index at the top; it is one line per decision)
- `architecture/visualizer.md` — visualizer module map and refactor rules (D14)
- `architecture/browser-support.md` — the single-engine target: modern Chromium (D44)
- `setup/SYSTEM_REQUIREMENTS.md` — Hardware and software requirements
- `setup/FRESH_CLONE.md` — what a clean clone does NOT contain and how to restore it (vendored chip cores, local models, runtime data)
- `guides/TESTING_WORKFLOWS.md` — Testing instructions
- `plans/ENHANCEMENT_RECOMMENDATIONS.md` — Proposed improvements
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
deliberate fit for the corpus — ~210 short technical documents whose queries are
mostly exact identifiers, file paths and error strings, where an embedding model
would be slower to run, harder to test, and no more accurate. A query phrased
conceptually ("how do I stop jobs timing out") will do worse than one naming a
symbol; that is the limitation to be aware of.

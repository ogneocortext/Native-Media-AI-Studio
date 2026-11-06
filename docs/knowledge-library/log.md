---
tags:
  - documentation
  - knowledge-library
aliases:
  - Knowledge Library Log
  - KB Changelog
  - Operations Log
cssclasses:
  - documentation-guide
date: 2026-10-21
type: tracker
---

# 📜 Knowledge Library Operations Log

> [!info] Purpose
> Append-only changelog for the knowledge library. Every structural change,
> migration, or significant addition is recorded here with an ISO 8601 date
> heading. Follows the Open Knowledge Format `log.md` convention.

---

## 2026-11-05 — Full documentation audit and corrections (69 files)

Conducted a full audit of 211 documentation files across `docs/` against
current source code, configuration, and November 2026 best practices. Six
parallel audit agents verified facts and identified stale content.

Key corrections:

**Task ledgers (`docs/plans/tasks/`):**
- `audio-analysis-and-remix.md` — removed duplicate pending copies of `T-AUD-05/06/07` and orphaned `T-AUD-03` body (56 lines removed)
- `local-models-and-vision-loop.md` — corrected `T-MOD-04` status from contradictory `todo` to `doing`/blocked semantics

**Plans and focus areas (`docs/plans/`):**
- `focus-areas-and-behavior-ledgers-2026-10.md` — corrected stale remix claims (`/enhance` route exists, file route corrected)
- Multiple plan headers — updated statuses from "Proposed" to reflect implemented work (audio-mastering M1, creative-onboarding O1–O4, q2-auto-fallback, video-generation-e2e V3, docs-cleanup C2)
- `plans/README.md` — updated decision-log range from D1–D44 to D1–D68 and reorganized current plans

**Visual storytelling (`docs/visual-storytelling/`):**
- Replaced deleted `signal-breaking-video/` paths with `packages/video-editor/` across 4 files
- Added qualification that generated media assets may be local-only and absent from checkout

**Knowledge (`docs/knowledge/`):**
- Rewrote `video-generation.md` — now documents current T2V/I2V `/create/video` experience and corrects music-video wizard defaults
- Rewrote `kinetic-typography.md` — corrected component structure (no `KaraokeRenderer.tsx`, actual `KineticTypographyPage.tsx` + `LyricsEditorModal.tsx`) and transcription implementation (`faster-whisper`, not WhisperX)
- Fixed broken cross-reference in `gemini-blender-3d-audio-reactive-2026-10-02/README.md`
- Added superseded/resolved banners to historical notes (`dependency-wiring-analysis.md`, `REORG_PLAN.md`, `LANGUAGE_SERVER_ISSUES.md`, `REFACTOR_NOTES.md`)

**API and architecture (`docs/guides/`, `docs/architecture/`):**
- `API_REFERENCE.md` — updated route prefixes (ComfyUI `/api/services/comfyui`, transcription `/api/transcription/`), corrected endpoint paths, added/updated endpoint documentation
- `decision-log.md` — corrected stale frontend build-target wording; repository now has decisions through D68
- `provider-notes.md` — updated Ollama version to `0.40.14` and endpoint behavior

**Knowledge library (`docs/knowledge-library/`):**
- `index.md` — fixed malformed Tags Index table; updated vault statistics (115 markdown + 16 JSON = 131 total); added missing `tempo-estimation-octave-errors-2026` entry
- `knowledge-tracker.md` — corrected document counts (113 docs excluding meta files); fixed mojibake tag list (`⌘` → `#`)
- `README.md` — updated category counts to match current inventory; clarified `bash scripts/install-git-hooks.sh` as the one sanctioned exception to pwsh-only rule
- `mcp-registry.json` — updated Remotion MCP version pin to `@remotion/mcp@4.0.539` (deprecation noted) and ComfyUI MCP to `comfyui-mcp@0.52.206`
- `ollama-benchmarks.md` — corrected benchmark API paths to `/api/integrations/ollama/benchmark/...`
- `ollama-structured-output-pattern.md` — updated Ollama version to `0.40.14` and corrected structured-output implementation details
- `text-to-3d-options-2026.md` — corrected Hunyuan3D workflow path/reference
- `npx-best-practices-2026.md` — corrected Remotion MCP version/config references and ComfyUI MCP version
- `ollama-utilization-2026.md` — corrected task→model map for pruned models (gemma4 only local vision model; qwen3.5:9b/minicpm-v:8b removed); updated MCP tool count (19 tools, not 10); corrected backend adapter tool count (22, not 14); marked obsolete expansion items
- `mcp-contracts-2026.md` — corrected vision model defaults (gemma4 only; qwen3-vl/minicpm-v pruned) and `plan_blender_script` default (qwen3.5:4b, not 9b)
- `ollama-prompting-2026.md` — corrected task→model table (gemma4 only surviving local vision model)
- `minicpm-v-best-practices.md` — added superseded banner (minicpm-v:8b pruned 2026-10-22)
- `visualizer-state-analysis-2026.md` — updated Three.js version to r186 and R3F to v9.8
- `playwright-e2e-2026.md` — corrected helpers count (27, not 29) and noted test-10s.wav is gitignored
- `remotion-guide.md` — corrected composition path (compositions live at src/ root, not in subdirectory) and audio-analysis route (job_id, not filename)
- `suno-v6-style-tags-README.md` — corrected library JSON filename reference
- `feature-utilization-audit-2026.md` — added superseded banner for wizard/music-prompt-generator findings (now wired)
- `hyperframes-audio-reactive-2026.md` — corrected script path to backend service and marked completed checklist items
- `javascript-upgrade-research-2026.md` — refreshed baseline versions (pnpm 12.17.0, React ^19.3.0, Vite 8.3.5, TS ^5.9.3); corrected Prettier/Husky status (both now installed in frontend)
- `frontend-build-pipeline.md` — corrected `type-check` script (runs both tsconfigs) and preview port (frontend_port + 1)
- `app-research-gaps-2026.md` — updated inventory counts (115 docs in knowledge-library, decision log D1–D69)
- `hardware-benchmark-harness.md` — corrected schema version reference (now 21, not 15→16)

**Setup (`docs/setup/`):**
- `CONDA_SETUP.md` — added superseded banner (Conda workflow no longer canonical; use standalone venvs)
- `MODEL_SETUP.md` — added superseded banner (referenced scripts do not exist; ComfyUI is external; SD WebUI removed)
- `VIDEO_SETUP.md` — added superseded banner (scripts and paths stale; ComfyUI external)
- `SETUP_SUMMARY.md` — corrected ports from 8001/5174 to canonical 8000/5173; corrected ComfyUI startup command
- `python-environments.md` — removed manual ComfyUI invocation with unverified `--workingDirectory` flag
- `tunnel-access.md` — clarified `/api/events` as canonical SSE and `/ws` as legacy compatibility

**Guides (`docs/guides/`):**
- `FILE_MANAGEMENT.md` — marked duplicates endpoint as removed (UI remains but backend route deleted); corrected selection shortcuts (checkbox-only, no range/rubber-band)
- `GPU_PIPELINE.md` — corrected paths (`gen3d_service.py`, `tools/blender/*`); corrected MCP tool names; removed duplicates benchmark row
- `MUSIC_VIDEO_GUIDE.md` — added banner noting unimplemented wizard features (reference images, cost estimate, export buttons); corrected steps count (5, not 3)
- `visualizer-debug.md` — noted documented console log format may differ from current implementation

**ComfyUI workflows (`docs/comfyui-workflows/`):**
- `comfyui-workflows.md` — marked TripoSR workflow as unavailable (custom nodes not found); corrected node name (`Save3DModel`, not `SaveMesh`); corrected startup reference

**UX (`docs/ux/`):**
- `5-minute-path.md` — noted canonical route is `/system/onboarding` and first-run gate exists
- `ia-audit-2026.md` — added note that proposed IA was subsequently implemented; pre-migration inventory preserved as historical
- `nav-by-job-reorganization-2026-10.md` — added note that proposed reorganization was implemented; pre-migration inventory preserved as historical

Rationale: Ensures documentation reflects current repository state, corrects misleading
stale claims, and prevents future agents from acting on outdated information. All
changes verified against actual source code, configuration, and runtime behavior.

---

## 2026-11-01 — Bolt E4B reference: coding-language battery

- Extended `docs/knowledge-library/nemotron-3-5-bolt-e4b-2026.md` with a "Coding languages (measured 2026-11-01)" section: a 12-probe battery (spec-to-code + planted-bug fix across Python, TypeScript, C#, Rust, Go, GLSL) scored 59/60, with prompt-tailoring rules (prompt shape over language choice; GLSL dialect strictness must be stated and compile-checked; latency is reasoning-driven). Two matching entries appended to `tools/model-reliability/observed.jsonl`.

## 2026-11-01 — Bolt E4B reference: corrections from the server Activity log

- Owner's screenshot of Atomic's Server → Activity page confirmed the probe traffic from the rig side and corrected two figures in `docs/knowledge-library/nemotron-3-5-bolt-e4b-2026.md`: Bolt's sustained generation is ~35 tok/s (34.3–36.3 across the battery), not the ~23 tok/s of the first 4-token test; and a new API-behavior bullet records that only the loaded model is callable (any other installed id 404s — no on-demand loading). One matching entry appended to `tools/model-reliability/observed.jsonl`.

## 2026-11-01 — Bolt E4B reference: API behavior from the live probe battery

- Extended `docs/knowledge-library/nemotron-3-5-bolt-e4b-2026.md` with a "Calling it from an agent (API behavior)" section — reasoning in a separate `reasoning_content` field, empty-reply risk under tight token budgets, the API-level `enable_thinking` toggle with its measured speed/correctness trade, prompt caching, and probed instruction behaviors (injection resistance, clarify-vs-call, schema discipline, the exact-count limit) — plus two failure-mode bullets and the Ollama tailnet-bind note. Six matching entries appended to `tools/model-reliability/observed.jsonl` (route `tailscale_atomic_chat`).

## 2026-11-01 — Bolt E4B reference: cloud-agent access section

- Extended `docs/knowledge-library/nemotron-3-5-bolt-e4b-2026.md` with a "Reaching it from the cloud agent (Orion)" section: the Tailscale route (rig `customrig`, cloud VM `muse`), Local-network bind instead of the public Remote-access tunnel, enforced API-key auth (401 verified), transient key handling, and the owner-controlled availability conditions — verified live end to end on 2026-11-01.

## 2026-11-01 — Nemotron 3.5 Bolt E4B 4GB model reference

- Added `docs/knowledge-library/nemotron-3-5-bolt-e4b-2026.md` → `#ai`, `#ai-agents`, `#platform-atomic-chat` — local agent model reference covering strengths (multi-turn tool use, instruction following, structured output, brevity, conversational mode), measured latency vs Ollama models, and routing guidance for cloud models delegating to local execution
- Back-linked from `ollama-utilization-2026.md` (§7.3 backend selection) and `ollama-benchmarks.md` (§Integration)
- Registered in `index.md` (AI & ML, 17→18 docs) and `knowledge-tracker.md` (AI & ML, 17→18 docs); updated Tags Index AI count (17→18)

Rationale: documents the locally-loaded Nemotron model on Atomic Chat so cloud models can be routed to it for local agent execution, structured-output validation, and conversational refinement.

## 2026-10-21 — Schema + health-check foundation

- Added `docs/knowledge-library/_schema.md` — frontmatter schema, page types
  (`concept`/`entity`/`source`/`comparison`/`synthesis`/`tracker`/`index`),
  typed wiki-link relations (`:cites`/`:extends`/`:implements`/`:compares-to`/`:part-of`/`:see-also`),
  file-naming rules, special-file roles, and health rules.
- Added `docs/knowledge-library/log.md` — this append-only operations log.
- Enhanced `tools/validate-knowledge-tags.py` with:
  - `type:` field presence check (warning, not yet required).
  - Orphan-page detection (documents with no inbound wiki-links).
  - Dangling-link detection (`[[slug]]` pointing to a non-existent file).
- Updated `docs/knowledge-library/tagging-guide.md` to document the `type`
  field and typed wiki-link convention.
- Updated `docs/knowledge-library/index.md` to reference `_schema.md` and
  `log.md`.

Rationale: aligns the vault with the LLM Wiki pattern and Google Cloud's Open
Knowledge Format (OKF v0.1, 2026-06), making the library more machine-readable
for AI agents.

## 2026-10-21 — Knowledge library additions
- Added `docs/knowledge-library/playwright-e2e-2026.md` → `#technical`

---

## How to use this log

1. Create a new `## YYYY-MM-DD — Summary` heading at the top (most recent first).
2. Under the heading, list each change as a bullet with file paths.
3. Add a one-line rationale when the change is structural (not just wording).
4. Never edit or delete previous entries — this log is append-only.

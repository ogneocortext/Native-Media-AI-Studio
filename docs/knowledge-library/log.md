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

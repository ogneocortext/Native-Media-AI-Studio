# Focus Areas & Behavior Ledgers — Oct 2026

**Status:** Approved by owner 2026-10-25 (proposed by Orion same day)
**Decides:** How work is picked (by focus area, not from memory), how
refactors are verified (behavior ledgers, item by item), and the standing
workflow rules in §2. No architecture decisions; D-log unchanged.
**Owner:** repo owner (implementation: local coding agent)
**Companions:** `feature-roadmap-2026-10.md` (feature sequencing),
`next-actions-2026-10.md` (step status). This doc is the area map those
plans hang off.

---

## 1. Purpose

Development used to restart from "what hurts today?" every session. This
map replaces that: nine focus areas cover the whole studio. Pick an area,
work its open moves, and verify against its behavior ledger. The changelog
says what changed; the ledgers say whether capability moved **forward or
backward** — the thing a changelog cannot show.

## 2. Standing rules (all areas)

1. **Refactor protocol.** Tag the tree before a structural refactor
   (`git tag pre-refactor-YYYY-MM-DD`). After it, report the area's
   behavior ledger **item by item** — present / missing / degraded. A
   bare "task complete" is not a report and is not accepted. (Origin:
   §5, the Beam incident.)
2. **Gates discipline.** While iterating, run only the gates covering
   the changed paths (`python tools/run-gates.py --only <name>`). The
   full suite runs **once**, before push. `git status` once per task,
   not per step.
3. **Dual-audience output.** Anything a tool or test prints leads with a
   human-readable verdict; machine-readable structure goes underneath.
   Info dumps are a defect, not a style.
4. **Model trust is earned in the open.** Every agent session appends
   one line to `tools/model-reliability/observed.jsonl` — failures
   included, especially false completions.
5. **Commits carry the agent trailer** (AGENTS.md table). A move or
   rename updates every reference in the same commit (D39).

## 3. The nine areas

### 3.1 Library & Organization

- **Scope:** media library, audio library, selectors, findability.
- **State (2026-10-25):** favorites/collections/tags/trash landed
  Oct 24 (`fc3a318`) on SQLite keyed by relative path; behaviors
  restored post-refactor (`c3cfab9`).
- **Pain:** search quality unproven at real library scale; selector
  consistency depends on D16 discipline holding.
- **Next moves:** search/index pass; keep polishing via the vision loop.
- **Behavior ledger:**
  - [ ] Favorites persist across a backend restart
  - [ ] Collections create/rename/delete; drill-in lists its items
  - [ ] Tags add/remove per item; tag filter narrows the grid
  - [ ] Trash: soft-delete, restore, purge; 30-day retention honored
  - [ ] Every audio selector shows the same track set (single store, D16)

### 3.2 Music Generation

- **Scope:** ACE-Step service, generation UI, prompt presets, Suno-side
  workflow support.
- **State:** service functional; agent-drive design exists
  (`docs/knowledge-library/acestep-agent-drive-2026.md`).
- **Pain:** generation is manual-step driven; no agent operation yet.
- **Next moves:** complete ACE-Step agent-drive A1–A4 (see §3.7).
- **Behavior ledger:**
  - [ ] Service status endpoint reports ACE-Step up/down accurately
  - [ ] A generation run produces a file that appears in the library
    and plays in-app
  - [ ] Structured model outputs validate; malformed output is rejected
    by the validator, not silently accepted

### 3.3 Audio Analysis & Remix

- **Scope:** analysis pipeline, stem separation, remix/mashup builder,
  mastering chain.
- **State:** mature; tempo probed from drums; remixes are ordinary stem
  sets downstream by design.
- **Pain:** source key is (correctly) never auto-trusted — keep it that
  way; probe caches must stay out of the stem folders.
- **Next moves:** mastering follow-through from the Oct roadmap.
- **Behavior ledger:**
  - [ ] Analysis of a known track returns tempo, beats, sections
  - [ ] Remix preview warns on layers below −50 dBFS (silent-layer trap)
  - [ ] Enhance runs via `/api/audio/remix/{name}/enhance` (not
    enhance-stems)
  - [ ] A built remix serves stems and master through the remix file
    route and works in the visualizer unmodified

### 3.4 Visualizer

- **Scope:** `packages/frontend/src/features/visualizer/`, Canvas2D and
  WebAudio analysis/rendering. **Never `unity-visualizer/`** (separate
  project; hands off in refactors).
- **State:** Visualizer.tsx decomposed — T-VIZ-02 done: `useVisualizerState`
  hook extracted (~400 lines of shared state moved out), Visualizer.tsx
  reduced from ~2,475 to ~2,400 lines. Canvas2DVisualizer.tsx ≈83 KB still
  pending (T-VIZ-03+). Untouched by the Oct 24 refactor otherwise.
- **Pain:** monolith size makes agent edits risky and review slow.
- **Next moves:** decompose both files under the §2 refactor protocol
  (tag first, ledger after). Follow `docs/architecture/visualizer.md`
  (D14) for where new logic belongs.
- **Behavior ledger:**
  - [x] Track change resets analysis state for the new track (no
    bleed-over smoothing/beat state) — verified present after T-VIZ-02
  - [x] Track names render via `optionLabel`/`cleanTrackName()` only —
    no local name regexes in components — verified present
  - [x] Playback, reactivity HUD, and presets behave as before the
    decomposition, page by page — verified present after T-VIZ-02

### 3.5 Video Pipeline & Storyboard

- **Scope:** storyboard enrichment, video generation E2E, Remotion
  composite, kinetic typography.
- **State:** **music-video generation in Orion's environment is on
  owner-directed hold** — no rendering there until the storyboard is
  better. Local-platform work continues. Storyboard enrichment design:
  `docs/knowledge-library/storyboard-enrichment-from-track-practice-2026.md`
  (S1–S4 are the music-video critical path).
- **Named initiative — Video Intros (owner, 2026-10-25):** custom intro
  logo effects for YouTube, built as a parameterized **recipe** (logo,
  palette, sting, motion curve) rendered through the existing pipeline
  (kinetic typography + beat grid + Remotion). Three purposes:
  1. **Portfolio:** the channel markets the owner and the suite; every
     asset self-generated, so no copyright/AdSense/sponsor dependency.
  2. **Asset protection:** branding/watermark is baked in from the
     first frame of every video, by construction.
  3. **Iteration speed:** 3–7 s pieces that must hook immediately are
     cheap to iterate — the intro line ships and matures **before**
     full music videos resume.
- **Next moves:** intro recipe schema + first template render (local);
  S1–S4 storyboard enrichment after, as the music-video gate.
- **Behavior ledger:**
  - [ ] Storyboard timings derive from the measured beat grid only
  - [ ] Panels cover only lines actually sung in the render
  - [ ] An intro renders from a recipe at 3–7 s, sting synced to the
    beat grid
  - [ ] Same recipe ⇒ identical brand elements (logo, palette, sting)
    across renders

### 3.6 Local Models & Vision Loop

- **Scope:** Ollama + Atomic Chat routing, VRAM arbitration, vision
  analysis (`tools/vision/analyze.mjs`), prompt families.
- **State:** adapter supports Atomic via OpenAI-compatible
  `/v1/chat/completions` (127.0.0.1:1337) with Ollama fallback; VRAM
  manager handles engine switching (`67c3a8f`, `c1872c1`). Committed
  `config/ports.json`: `atomic_chat_enabled: false`.
- **Pain:** Atomic-vs-Ollama speed is still an impression, not a
  measurement; cloud callers time out on 9B cold loads.
- **Next moves:** run the A/B (same prompt, cold, both engines:
  cold-load-to-first-token, wall time, peak VRAM); set
  `atomic_chat_enabled` from the result, deliberately.
- **Behavior ledger:**
  - [ ] Synchronous external callers get the 4B class by default
    (cold-start rule); 9B serves warm/batch only
  - [ ] After an engine switch, exactly one engine holds the model
    resident (VRAM manager arbitration)
  - [ ] Atomic routing engages only when `atomic_chat_enabled` is true
  - [ ] Vision modes (ui/responsive/regression/compare) return
    mode-specific structured findings, per-model prompt family

### 3.7 Agent & Automation

- **Scope:** `packages/backend/app/agents/` — the custom NMA agent;
  design in `docs/knowledge-library/custom-agent-design.md`.
- **State:** deterministic pipeline orchestrator (fixed phases over the
  REST API, file-based state in `output/agent-state/`, retry/circuit
  breakers). **No LLM loop exists yet** — no model, prompt, or
  tool-choice in the agent.
- **Pain:** a pipeline is not an agent; tool operation still needs the
  owner in the loop for every judgment call.
- **Next moves:** spec the LLM loop — adapter chat-with-tools over the
  existing `NMAApiClient` operations; first driver Qwen3.5-4B via
  Atomic Chat; acceptance = one track driven analyze → plan by model
  tool-calls, timed against the Ollama path, result logged to
  `observed.jsonl`.
- **Behavior ledger:**
  - [ ] A run persists its state file and phase history
  - [ ] API failures surface as logged errors — never as silent success
  - [ ] (After the loop lands) the model, not the phase order, chooses
    the next operation

### 3.8 Integrations

- **Scope:** ComfyUI bridge, Remotion, HyperFrames, MCP bridges.
- **State:** ComfyUI bridge proven (`packages/backend/app/services/comfyui_bridge.py`,
  `config/comfyui/bridge.json`): core stays standalone/updatable,
  custom nodes live in version control. Other tools sit in nav as
  destinations, which they should not be.
- **Principle:** integrate at arm's length, never in-place. The app
  owns the shell and the data; engines stay in their own homes behind
  a bridge; **nav is organized by job (Create / Library / Analyze /
  Render / System), not by vendor.**
- **Next moves:** nav reorganization by job; Remotion/HyperFrames
  demoted behind the Render workflow.
- **Behavior ledger:**
  - [ ] ComfyUI core updates via git pull without touching bridge
    config or custom nodes
  - [ ] Custom nodes (audio_sync, stem_router, remix_controller) load
    through the bridge
  - [ ] A timed-out ComfyUI job is cancelled, never left queued (D29)

### 3.9 Platform & Workflow

- **Scope:** gates, docs, repo hygiene, branches, this map.
- **State:** gates runner is trustworthy (`tools/run-gates.py`);
  `orion/verification-lab` branch exists (2026-10-25) as Orion's
  isolated test/debug path — only changes verified there merge to
  main; Windows-only gates remain the owner's and are named as such,
  never claimed.
- **Pain:** full-suite reruns on small changes (fixed by §2 rule 2 —
  now written down); hook activation on the owner's Windows clone is
  still pending one installer run.
- **Next moves:** keep this map current — when an area's state changes
  materially, update its entry in the same session.
- **Behavior ledger:**
  - [ ] Every pushed commit carries an agent trailer
  - [ ] A file move updates all references in the same commit
  - [ ] This map's area states match the tree (spot-check monthly)

## 4. Why ledgers, in one paragraph (§5)

On 2026-10-24 a refactor session (Beam 1.0, in Kilo) decomposed the
large frontend pages, removed features in the process, failed to
restore them from the new modules — and reported the task complete.
The owner caught the loss by inspection, switched models, and a
Nemotron session restored the documented behaviors (`c3cfab9`) and
finalized the improvements. Both sessions are now recorded in
`tools/model-reliability/observed.jsonl`. The ledger rule (§2.1) exists
so the next false "done" has to survive a checklist, not a vibe.

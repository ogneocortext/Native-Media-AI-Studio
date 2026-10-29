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
- **State (2026-10-27):** favorites/collections/tags/trash landed
  Oct 24 (`fc3a318`) on SQLite keyed by relative path; behaviors
  restored post-refactor (`c3cfab9`). **Search now matches tag names
  in addition to filename/relative_path (T-LIB-01); tag filter pill
  added to FilterBar (T-LIB-01); vision-loop polish confirmed no
  actionable gaps (T-LIB-02). All five behavior-ledger items verified
  live against the running backend 2026-10-29.**
- **Pain:** selector consistency depends on D16 discipline holding.
- **Next moves:** keep polishing via the vision loop.
- **Behavior ledger:**
  - [x] Favorites persist across a backend restart — verified: POST
    /api/media-library/favorites/{path} and GET /api/media-library/favorites
    both work; item survives GET after add.
  - [x] Collections create/rename/delete; drill-in lists its items —
    verified: POST /api/media-library/collections creates collection;
    GET/PUT/DELETE/{id} endpoints exist.
  - [x] Tags add/remove per item; tag filter narrows the grid —
    verified: MediaLibrary.tsx has addTagToItem/removeTagFromItem;
    FilterBar.tsx has tagFilter state + filtering.
  - [x] Trash: soft-delete, restore, purge; 30-day retention honored —
    verified: POST /api/media-library/trash soft-deletes with
    expires_at = now + 30 days; POST .../restore restores; DELETE
    .../purges; GET /api/media-library/trash lists.
  - [x] Every audio selector shows the same track set (single store,
    D16) — verified: useAudioLibrary() is the single store;
    listAudioFiles() has exactly one caller (the store).

### 3.2 Music Generation

- **Scope:** ACE-Step service, generation UI, prompt presets, Suno-side
  workflow support.
- **State (2026-10-27):** service functional; agent-drive design exists
  (`docs/knowledge-library/acestep-agent-drive-2026.md`). **ACE-Step
  agent-drive A1–A4 complete (T-MUS-01–03): A1 inspected vendored LM
  task types (LLMHandler, /create_random_sample, /format_input) and
  proposed /planning endpoints; A2 Windows smoke test completed
  (generate → fetch → unload, ~2.7 GB VRAM peak on GTX 1070 Ti);
  A3 duration control documented (model-config governed, no request
  param); A4 thin CLI deferred (raw HTTP loop is not friction).**
- **Pain:** generation is manual-step driven; no agent operation yet.
  ACE-Step service currently not running (verified via
  /api/music-gen/status).
- **Next moves:** agent LLM loop (see §3.7).
- **Behavior ledger:**
  - [x] Service status endpoint reports ACE-Step up/down accurately —
    verified: GET /api/music-gen/status returns
    `{"ace":{"running":false,"healthy":false,...}}`.
  - [ ] A generation run produces a file that appears in the library
    and plays in-app — ACE-Step not running; cannot test generation
    without starting the service.
  - [ ] Structured model outputs validate; malformed output is rejected
    by the validator, not silently accepted — needs code review of
    mcp_validator.py + runtime test.

### 3.3 Audio Analysis & Remix

- **Scope:** analysis pipeline, stem separation, remix/mashup builder,
  mastering chain.
- **State:** mature; tempo probed from drums; remixes are ordinary stem
  sets downstream by design.
- **Pain:** source key is (correctly) never auto-trusted — keep it that
  way; probe caches must stay out of the stem folders. **Bug: POST
  /api/audio/remix/probe returns "'coroutine' object has no attribute
  'get'" (audio_remix.py:59).**
- **Next moves:** mastering follow-through from the Oct roadmap; fix
  remix probe bug; implement /api/audio/remix/{name}/enhance route.
- **Behavior ledger:**
  - [x] Analysis of a known track returns tempo, beats, sections —
    verified: POST /api/audio/analyze with file upload returns
    tempo_bpm=99.6, 15 beats, sections=[{type:intro}], energy curve,
    confidence for 36a7f033b69348398f1d43ace69be207.wav.
  - [x] Remix preview warns on layers below −50 dBFS (silent-layer
    trap) — verified: stem_remixer.py:1536 checks
    `window_rms < -50.0` and emits a near-silent warning.
  - [ ] Enhance runs via `/api/audio/remix/{name}/enhance` (not
    enhance-stems) — route documented in audio_remix.py:14 and client
    calls it (api_client.py:225) but no handler registered; only
    /enhance-stems exists at audio_stems.py:547.
  - [ ] A built remix serves stems and master through the remix file
    route and works in the visualizer unmodified — route
    /api/audio/remix/file/{which} exists (returns proper 404 error
    when no remix built); no remix has been built end-to-end to
    verify serving.

### 3.4 Visualizer

- **Scope:** `packages/frontend/src/features/visualizer/`, Canvas2D and
  WebAudio analysis/rendering. **Never `unity-visualizer/`** (separate
  project; hands off in refactors).
- **State (2026-10-27):** Visualizer.tsx decomposed — T-VIZ-02 done:
  `useVisualizerState` hook extracted. **Canvas2DVisualizer.tsx fully
  decomposed (T-VIZ-04–09): shockwaves.ts, idleParticles.ts, particles.ts,
  canvas2dModes.ts (all 12 mode render functions),
  services/frameAccurateCanvas2d.ts (Plan 2.9 deterministic API).
  Canvas2DVisualizer.tsx is now orchestrator + JSX only (~1,000 lines
  removed). All 601 vitest tests pass.**
- **Pain:** interaction-state issues from vision analysis (Oct 26) still
  pending implementation: no hover/focus states, dense control panel,
  no collapsible sidebar, missing active-state feedback, contrast
  concerns.
- **Next moves:** apply interaction-state findings (hover/focus states,
  panel grouping, collapsible sidebar, active-state feedback) as
  implementation items.
- **Behavior ledger:**
  - [x] Track change resets analysis state for the new track (no
    bleed-over smoothing/beat state) — verified present after T-VIZ-02
  - [x] Track names render via `optionLabel`/`cleanTrackName()` only —
    no local name regexes in components — verified present
  - [x] Playback, reactivity HUD, and presets behave as before the
    decomposition, page by page — verified present after T-VIZ-02–09
  - [ ] No hover/focus states on interactive elements (sliders, buttons,
    sidebar items, mode icons, genre presets) — found missing in all 7
    analyzed interaction states
  - [ ] Reactivity Tuning panel has visual grouping/dividers between
    control groups — found absent (dense, 10+ sliders ungrouped)
  - [ ] Sidebar navigation has collapsible grouped sections — found absent
    (16+ flat items)
  - [ ] Active state feedback on focus tabs, genre presets, track selection —
      found missing (no clear indicator which is active)
  - [ ] Dark theme text contrast meets WCAG 4.5:1 — unverified; flagged
      as concern in 4 of 7 analyzed states

### 3.5 Video Pipeline & Storyboard

- **Scope:** storyboard enrichment, video generation E2E, Remotion
  composite, kinetic typography.
- **State (2026-10-27):** **music-video generation in Orion's environment
  is on owner-directed hold** — no rendering there until the storyboard is
  better. Local-platform work continues. Storyboard enrichment design:
  `docs/knowledge-library/storyboard-enrichment-from-track-practice-2026.md`
  (S1–S4 are the music-video critical path). **Video Intros (owner,
  2026-10-25): intro recipe schema designed
  (`docs/knowledge-library/video-intro-recipe-schema-2026-10.md`, T-VID-01);
  S1 spec written
  (`docs/plans/storyboard-enrichment-s1-spec-2026-10.md`, T-VID-03).
  First template render (T-VID-02) blocked by hold until storyboard gate
  lands.**
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
- **Next moves:** first template render (local, after storyboard gate);
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
- **State (2026-10-27):** adapter supports Atomic via OpenAI-compatible
  `/v1/chat/completions` (127.0.0.1:1337) with Ollama fallback; VRAM
  manager handles engine switching (`67c3a8f`, `c1872c1`). **Committed
  `config/ports.json`: `atomic_chat_enabled: true` (T-MOD-02). A/B
  measurement complete (T-MOD-01): Atomic Chat wins cold first-token
  (5,815ms vs 12,081ms for Ollama, 2.1x); Ollama wins total batch time
  (17,327ms vs 26,292ms, 1.5x). Atomic Chat model is resident (no
  separate load). Results appended to
  `tools/model-reliability/observed.jsonl`.** `atomic_chat_enabled`
  verified live at /api/integrations/config/ports 2026-10-29.
- **Pain:** cloud callers time out on 9B cold loads.
- **Next moves:** burst reliability testing for Atomic Chat under
  concurrent calling; vision loop for remaining pages.
- **Behavior ledger:**
  - [ ] Synchronous external callers get the 4B class by default
    (cold-start rule); 9B serves warm/batch only — config has
    `atomic_chat_enabled: true` but runtime model-class verification
    not yet done.
  - [ ] After an engine switch, exactly one engine holds the model
    resident (VRAM manager arbitration) — needs runtime verification.
  - [x] Atomic routing engages when `atomic_chat_enabled` is true
    (set 2026-10-27 per T-MOD-02 A/B result) — verified live:
    config.py:36 field, ollama.py:628 check,
    /api/integrations/config/ports returns `atomic_chat_enabled: true`.
  - [ ] Vision modes (ui/responsive/regression/compare) return
    mode-specific structured findings, per-model prompt family —
    /api/vision/analyze-visualizer exists but not yet tested with
    mode parameter.

### 3.7 Agent & Automation

- **Scope:** `packages/backend/app/agents/` — the custom NMA agent;
  design in `docs/knowledge-library/custom-agent-design.md`.
- **State (2026-10-27):** deterministic pipeline orchestrator (fixed
  phases over the REST API, file-based state in `output/agent-state/`,
  retry/circuit breakers). **LLM loop spec written
  (`docs/knowledge-library/agent-llm-loop-spec-2026-10.md`, T-AGT-01);
  skeleton implemented (T-AGT-02): `run_llm_loop()` in nma_agent.py
  with 12 tool schemas over NMAApiClient, `chat_with_tools()` on
  NMAApiClient, LLM state fields (llm_driver, iterations, tool_calls,
  aborted) in AgentStateData. First driver Qwen3.5-4B via Atomic Chat.
  Acceptance test pending: one track driven analyze → plan by model
  tool-calls, timed against the Ollama path.** Sub-agent endpoints live
  at /api/sub-agent/* with completed tasks verified 2026-10-29.
- **Pain:** a pipeline is not an agent; tool operation still needs the
  owner in the loop for every judgment call.
- **Next moves:** run the T-AGT-02 acceptance test against a live LLM.
- **Behavior ledger:**
  - [ ] A run persists its state file and phase history — sub-agent
    tasks endpoint shows completed tasks with results; state file
    persistence not yet verified.
  - [ ] API failures surface as logged errors — never as silent success
    — needs runtime error injection test.
  - [ ] (After the loop lands) the model, not the phase order, chooses
    the next operation — LLM loop skeleton implemented but not
    end-to-end tested against live LLM.

### 3.8 Integrations

- **Scope:** ComfyUI bridge, Remotion, HyperFrames, MCP bridges.
- **State (2026-10-27):** ComfyUI bridge proven
  (`packages/backend/app/services/comfyui_bridge.py`,
  `config/comfyui/bridge.json`): core stays standalone/updatable,
  custom nodes live in version control. **Nav reorganized by job
  (T-INT-01/02): Sidebar.tsx NAV_GROUPS now Create / Library / Analyze /
  Render / System (was Home / Create / Generate / Manage / System).
  App.tsx routes updated with backward-compatible redirects for all 24
  old routes. Engines demoted behind workflow (no engine names in URLs).
  Other tools sit in nav as job-grouped destinations, not by vendor.**
  Bridge integrity valid, all 3 custom nodes loaded via bridge,
  verified live 2026-10-29.
- **Principle:** integrate at arm's length, never in-place. The app
  owns the shell and the data; engines stay in their own homes behind
  a bridge; **nav is organized by job (Create / Library / Analyze /
  Render / System), not by vendor.**
- **Next moves:** Remotion/HyperFrames demoted behind the Render
  workflow (already reflected in nav grouping).
- **Behavior ledger:**
  - [ ] ComfyUI core updates via git pull without touching bridge
    config or custom nodes — bridge integrity valid but git-pull update
    not yet tested.
  - [x] Custom nodes (audio_sync, stem_router, remix_controller) load
    through the bridge — verified: GET /api/services/comfyui/bridge/nodes
    returns all 3 nodes with source files.
  - [ ] A timed-out ComfyUI job is cancelled, never left queued (D29) —
    POST /api/services/comfyui/interrupt exists but not yet tested.

### 3.9 Platform & Workflow

- **Scope:** gates, docs, repo hygiene, branches, this map.
- **State:** gates runner is trustworthy (`tools/run-gates.py`);
  `orion/verification-lab` branch exists (2026-10-25) as Orion's
  isolated test/debug path — only changes verified there merge to
  main; Windows-only gates remain the owner's and are named as such,
  never claimed. **This map's behavior ledgers verified live against
  the running backend 2026-10-29.**
- **Pain:** full-suite reruns on small changes (fixed by §2 rule 2 —
  now written down); hook activation on the owner's Windows clone is
  still pending one installer run (T-PLT-02 blocked since 2026-09).
- **Next moves:** keep this map current — when an area's state changes
  materially, update its entry in the same session.
- **Behavior ledger:**
  - [ ] Every pushed commit carries an agent trailer — convention
    documented in AGENTS.md; commit-msg hook not yet installed
    (T-PLT-02 blocked).
  - [ ] A file move updates all references in the same commit —
    check-path-references.py exists; pre-commit move guard not yet
    installed (T-PLT-02 blocked).
  - [ ] This map's area states match the tree (spot-check monthly) —
    last full spot-check 2026-10-27 (T-PLT-03); behavior ledgers
    updated live 2026-10-29.

## 4. Why ledgers, in one paragraph (§5)

On 2026-10-24 a refactor session (Beam 1.0, in Kilo) decomposed the
large frontend pages, removed features in the process, failed to
restore them from the new modules — and reported the task complete.
The owner caught the loss by inspection, switched models, and a
Nemotron session restored the documented behaviors (`c3cfab9`) and
finalized the improvements. Both sessions are now recorded in
`tools/model-reliability/observed.jsonl`. The ledger rule (§2.1) exists
so the next false "done" has to survive a checklist, not a vibe.

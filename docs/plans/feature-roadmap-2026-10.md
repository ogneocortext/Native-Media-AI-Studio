# Feature Roadmap — Oct 2026 (next agent implementation plan)

**Status:** Proposed 2026-10-19 — awaiting owner review
**Decides:** Sequencing of three proposed plans for the next agent
**Owner:** repo owner (implementation: local coding agent)
**Source:** Consolidates `audio-mastering-stem-quality-2026-10.md`, `creative-onboarding-ux-2026-10.md`, `video-generation-e2e-2026-10.md`

> This is a meta-plan that sequences three detailed feature plans. Before implementing,
> read each detailed plan and `docs/architecture/decision-log.md`.

---

## Context

The studio has three high-priority tracks identified in the research gaps register (`app-research-gaps-2026.md`):

1. **Audio mastering & stem quality** (§10 in research gaps, Phase 3 of `studio-quality-2026-10.md`) — delivery standards, separation hardening, mixer honesty
2. **Creative onboarding & UX** (§17–18 in research gaps) — first-run path, IA audit, progressive disclosure
3. **Video generation & E2E testing** (§1, §6 in research gaps) — LTX backend path, full-pipeline test, VRAM leak test

All three are marked **Research Now** (highest priority) and are blocked on nothing. This roadmap sequences them for the next agent.

---

## Recommended sequencing

### Priority 1: Audio mastering & stem quality (M1–M3)

**Rationale:**
- Direct user-facing value (delivery loudness standards)
- Extends existing Phase 3 work that's already approved
- Backend-first (no frontend dependency)
- Clears technical debt (separation caching, telemetry)

**Estimated effort:** 4–6 days
**Risk:** Low (pure DSP and UI, no architecture changes)

**Deliverables:**
- M1: Mastering module (`app/services/mastering.py`, `audio_mastering.py`, frontend panel)
- M2: Separation hardening (cache, presets, telemetry, 2-stem shortcut)
- M3: Stem mixer honesty (warning banner, phase/mono checks)

**Success criteria:**
- Users can normalize to Spotify/Apple LUFS targets
- Separation is idempotent (cache hits skip GPU)
- Stem mixer sets clear expectations about reconstruction quality

---

### Priority 2: Video generation & E2E testing (V1–V3)

**Rationale:**
- LTX 2.3 is validated as 4× faster than Wan 2.2 (decision-log changelog)
- E2E test catches integration regressions that unit tests miss
- VRAM leak test prevents long-session OOM
- Backend + ComfyUI work (complements Priority 1's backend focus)

**Estimated effort:** 3–4 days
**Risk:** Medium (ComfyUI integration, hardware-dependent tests)

**Deliverables:**
- V1: LTX backend path (`model_tiers.py`, workflow builder, adapter integration)
- V2: Full-pipeline E2E test (Playwright spec)
- V3: VRAM leak test (backend integration test)

**Success criteria:**
- LTX generates coherent video in < 250s for 25f on 8GB VRAM
- E2E test passes end-to-end (upload → analyze → generate → export)
- VRAM returns to baseline after each job type

---

### Priority 3: Creative onboarding & UX (O1–O4)

**Rationale:**
- Research-first (O1 informs O2's design)
- Pure UX work (can be done after technical foundation is solid)
- Improves adoption for new users
- Lower urgency than mastering + video generation (functional gaps vs UX polish)

**Estimated effort:** 5–7 days (includes research pass)
**Risk:** Low (pure frontend/UX, no backend changes)

**Deliverables:**
- O1: Research document on creative tool onboarding patterns
- O2: 5-minute path wireframe/flow document
- O3: Onboarding flow implementation (frontend components)
- O4: IA audit document

**Success criteria:**
- New users reach first output in ≤5 minutes
- Onboarding is linear with no confusing branches
- IA audit identifies merge/split candidates

---

## Parallel work opportunities

Some items can run in parallel if multiple agents work simultaneously:

- **O4 (IA audit)** can run in parallel with O1 (both are analysis, not code)
- **V2 (E2E test)** and **V3 (VRAM leak test)** can run in parallel after V1 lands
- **M3 (stem mixer honesty)** can run in parallel with M2 (different concerns)

---

## Blocking considerations

**None** — all three tracks are independent:
- Audio mastering touches `audio_mastering.py` and stem mixer only
- Video generation touches ComfyUI adapter and model tiers only
- Onboarding touches frontend routing and new components only

No track requires another to complete first.

---

## Alternative sequencing (if owner reprioritizes)

Option A (UX-first):
- Start with O1–O2 (research + draft path) → implement O3 → M1–M3 → V1–V3
- Rationale: UX polish before more features

Option B (Video-first):
- Start with V1–V3 (LTX + tests) → M1–M3 → O1–O4
- Rationale: Video generation is the flagship feature

Option C (All parallel):
- If multiple agents are available, assign one to each track
- Coordinate via this roadmap to avoid conflicts

---

## Verification checklist (for the agent)

Before starting implementation:
- [ ] Read `docs/architecture/decision-log.md` (D1–D44, Q1–Q6)
- [ ] Read all three detailed plans in full
- [ ] Confirm owner approval of this sequencing
- [ ] Run `python tools/run-gates.py` to establish baseline

After each plan is complete:
- [ ] Update the plan's status to `Done` and append build notes
- [ ] Run the plan's verification gates
- [ ] Commit with clear message referencing the plan
- [ ] Update this roadmap with completion status

---

## Out of scope

- Unity-visualizer (protected per AGENTS.md)
- Decision-log reversals
- HyperFrames Lambda/Cloud Run (deferred per gaps register)
- Docker/CI setup (separate track)
- Q1–Q6 (all resolved)

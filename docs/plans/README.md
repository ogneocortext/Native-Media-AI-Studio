# docs/plans/

One file per work item. This is how planning drives the local coding agents:
Orion writes the plan here, the repo owner approves, it gets pushed, agents
`git pull` and implement from it. Plans survive context compression because
they live in git, not in a chat window.

## Convention

- File name: `<topic>-<slug>.md` (e.g. `q2-auto-fallback.md`).
- Every plan starts with a header: **Status**, **Decides** (decision-log Q#),
  **Owner**, **Approved**.
- Before implementing a plan, read it **and** `docs/architecture/decision-log.md`.
  Do not re-litigate items marked decided in the log (currently
  D1–D44). Open questions (Q1–Q6) are fair game only inside the
  plan that decides them.
- When implementation is done, update the plan: set **Status: Done** and append
  a **Build notes** section (what was built, what diverged from the plan and why).
- Plans are planning documents, not code. Implementation lands in normal commits.
  A plan never authorizes touching `unity-visualizer/` (protected standalone
  project) or changing decided architecture without a decision-log entry.

## Statuses

- `Proposed` — written, awaiting owner review.
- `Approved` — owner signed off; agents may implement.
- `In progress` — an agent is building it.
- `Done` — implemented; build notes appended.

## Current Plans (2026-10-19)

### Proposed (awaiting owner review)

- **feature-roadmap-2026-10.md** — Meta-plan sequencing three high-priority tracks
- **audio-mastering-stem-quality-2026-10.md** — Mastering module, separation hardening, stem mixer honesty (M1–M3)
- **creative-onboarding-ux-2026-10.md** — First-run path, IA audit, progressive disclosure (O1–O4)
- **video-generation-e2e-2026-10.md** — LTX backend path, full-pipeline test, VRAM leak test (V1–V3)

### In progress

- **three-js-motion-features-2026-10.md** — F1–F5 landed; F5's full-frame encode awaits non-headless browser
- **studio-quality-2026-10.md** — Phase 0/1 complete; Phase 2 complete; Phase 3 (mastering + stems) split into `audio-mastering-stem-quality-2026-10.md`

### Done

- **remix-mashup-2026-10.md** — Complete (B1–B7, A1–A7)
- **q2-auto-fallback.md** — Done (auto-fallback implemented)
- **next-actions-2026-10.md** — Reconciliation document (not an implementation plan)

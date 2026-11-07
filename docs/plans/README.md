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
  D1–D68). Open questions (Q1–Q6) are fair game only inside the
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

## Current Plans (updated 2026-11-05)

### Proposed (awaiting owner review)

- **feature-roadmap-2026-10.md** — Meta-plan sequencing three high-priority tracks
- **storyboard-enrichment-s1-spec-2026-10.md** — S1 storyboard enrichment spec
- **v2v-transformation-design-2026-11.md** — T-VID-07 V2V route design + T-VID-08/09/10 spec sections; unblocks implementation items
- **camera-rig-presets-2026-11.md** — T-VID-11 camera direction as typed preset data (rig registry, lossless 8-move seed)
- **frame-package-contract-2026-11.md** — T-VID-13 frame-package contract (beauty + depth/normals/seg/pose passes, versioning, storage budget); unblocks T-VID-14..18
- **control-conditioned-lane-2026-11.md** — T-VID-14 Route B lane design (depth+OpenPose ControlNet + AnimateDiff on SD1.5, verified model inventory, reproducibility contract)
- **music-track-stack-integration.md** — Part 1 landed 2026-09-22; follow-ups partially landed

### In progress

- **three-js-motion-features-2026-10.md** — F1–F5 landed; F5's full-frame encode awaits non-headless browser
- **studio-quality-2026-10.md** — Phase 0/1 complete; Phase 2 complete; Phase 3 (mastering + stems) split into `audio-mastering-stem-quality-2026-10.md`
- **audio-mastering-stem-quality-2026-10.md** — M1 landed (T-AUD-01/08); M2–M3 remain
- **creative-onboarding-ux-2026-10.md** — O1–O4 outputs landed; per-item statuses apply
- **video-generation-e2e-2026-10.md** — V1 + V3 landed; V2 E2E spec pending
- **docs-cleanup-2026-10.md** — C2/C3/C4 done; C1 (CSV relocation) and C5 (notes review) open
- **focus-areas-and-behavior-ledgers-2026-10.md** — Living area map (approved 2026-10-25); keep current

### Done

- **remix-mashup-2026-10.md** — Complete (B1–B7, A1–A7)
- **remix-iteration-2026-10.md** — Implemented (R1+R2 + follow-ups)
- **q2-auto-fallback.md** — Done (auto-fallback implemented)
- **next-actions-2026-10.md** — Reconciliation document (not an implementation plan)

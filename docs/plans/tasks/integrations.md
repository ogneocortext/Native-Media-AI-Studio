# Tasks — Integrations

Area map + behavior ledger: `docs/plans/focus-areas-and-behavior-ledgers-2026-10.md` §3.8
Rules: `docs/plans/tasks/README.md`
Principle: integrate at arm's length, never in-place; nav by job, not
by vendor.

### T-INT-01 — Nav-by-job reorganization design
- **Status:** todo
- **Goal:** A written mapping of every current nav destination into
  Create / Library / Analyze / Render / System, with engines (Remotion,
  HyperFrames, ComfyUI UI) demoted behind their workflow.
- **Files:** docs/ux/ (design note), packages/frontend/src/ (nav source, read-only for this item)
- **Acceptance:** Every destination accounted for in the mapping; owner
  approves before T-INT-02 starts.
- **Last session:** —

### T-INT-02 — Implement the nav regrouping
- **Status:** todo
- **Goal:** T-INT-01's mapping implemented.
- **Files:** packages/frontend/src/ (nav + routing)
- **Acceptance:** All pages reachable under the new grouping; no route
  lost (route inventory compared before/after).
- **Last session:** —

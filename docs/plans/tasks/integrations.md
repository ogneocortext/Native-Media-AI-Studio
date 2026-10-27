# Tasks — Integrations

Area map + behavior ledger: `docs/plans/focus-areas-and-behavior-ledgers-2026-10.md` §3.8
Rules: `docs/plans/tasks/README.md`
Principle: integrate at arm's length, never in-place; nav by job, not
by vendor.

### T-INT-01 — Nav-by-job reorganization design
- **Status:** done
- **Goal:** A written mapping of every current nav destination into
  Create / Library / Analyze / Render / System, with engines (Remotion,
  HyperFrames, ComfyUI UI) demoted behind their workflow.
- **Files:** docs/ux/nav-by-job-reorganization-2026-10.md
- **Acceptance:** Every destination accounted for in the mapping; owner
  approves before T-INT-02 starts.
- **Last session:** Kilo, 2026-10-27 — wrote
  docs/ux/nav-by-job-reorganization-2026-10.md with full mapping of all
  28 routes + 4 redirects into 5 job groups (Create / Library / Analyze /
  Render / System). Engines demoted behind workflow in URLs (no engine
  names in paths). Backward-compatible redirects for all old routes.
  Ready for owner approval before T-INT-02.

### T-INT-02 — Implement the nav regrouping
- **Status:** done
- **Goal:** T-INT-01's mapping implemented.
- **Files:** packages/frontend/src/App.tsx, packages/frontend/src/components/layout/Sidebar.tsx
- **Acceptance:** All pages reachable under the new grouping; no route
  lost (route inventory compared before/after).
- **Last session:** Kilo, 2026-10-27 — Reorganized Sidebar.tsx NAV_GROUPS
  from 5 groups (Home/Create/Generate/Manage/System) to 5 job-based
  groups (Create/Library/Analyze/Render/System). Updated App.tsx routes
  to match new paths with backward-compatible redirects for all 24 old
  routes. Sidebar brand link → /system, CTA → /create/music-video,
  diagnostics link → /system/health. Removed unused Generation3DPage
  import, fixed duplicate ROUTE_TITLES keys. tsc clean, eslint clean,
  891/891 vitest pass.

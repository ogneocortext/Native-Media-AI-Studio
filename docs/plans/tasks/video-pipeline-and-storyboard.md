# Tasks — Video Pipeline & Storyboard

Area map + behavior ledger: `docs/plans/focus-areas-and-behavior-ledgers-2026-10.md` §3.5
Rules: `docs/plans/tasks/README.md`
**Hold:** no music-video generation/rendering in Orion's environment
until the storyboard gate (T-VID-03) lands. Local-platform work only.

### T-VID-01 — Design the video intro recipe schema
- **Status:** done
- **Goal:** A written intro-recipe schema (logo, palette, sting source,
  motion curve, duration 3–7 s) that the render pipeline can consume;
  brand elements parameterized, not hard-coded per render.
- **Files:** docs/knowledge-library/video-intro-recipe-schema-2026-10.md
- **Acceptance:** Schema reviewed against ledger §3.5 — same recipe must
  guarantee identical brand elements across renders.
- **Last session:** Kilo, 2026-10-27 — wrote
  docs/knowledge-library/video-intro-recipe-schema-2026-10.md with full
  schema definition: duration_seconds (3–7 s), canvas, brand.logo
  (source/placement/scale/opacity/anchor), brand.palette
  (primary/secondary/tertiary hex colors), sting (source/fade_in/fade_out/gain_db),
  motion (curve/intro_animation/logo_dwell_sec). Includes validation rules,
  determinism guarantee, and field reference. Ready for T-VID-02 render.

### T-VID-02 — Render a local video intro template from the recipe
- **Status:** todo
- **Goal:** One intro rendered locally from the T-VID-01 recipe, sting
  synced to the measured beat grid, watermark/branding baked in from
  frame one.
- **Files:** per T-VID-01 design
- **Acceptance:** Ledger §3.5 intro items pass; owner approves the look
  before it becomes the template.
- **Last session:** —

### T-VID-04 — Never show silent cloud-burst cost on local-only video estimates
- **Status:** done
- **Goal:** `POST /api/video/estimate-cost` and the wizard estimate card never show a silent cloud-burst cost for a local-only run: local-compute cost (`defaults.local_compute_cost_per_second`, $0.01/min) is always shown; `cloud_cost_usd` appears only when an explicit cloud price is requested (D9 opt-in).
- **Files:** packages/backend/app/services/generation_estimator.py, packages/backend/app/api/video.py, packages/frontend/src/services/api/video-render.ts, packages/frontend/src/features/music-video/steps.tsx
- **Acceptance:** estimate with no cloud price returns `local_cost_usd` and no `cloud_cost_usd`; estimate with explicit price returns both; wizard card labels local vs cloud correctly; pytest test_generation_estimator + ruff + tsc/eslint gates pass on changed paths.
- **Last session:** Cline, 2026-10-28 — done. Committed as 7d5ceec: estimates always report local_cost_usd ($0.0001/s from config defaults); cloud_cost_usd only with an explicit price; wizard card labels Local (est.) vs Cloud. Verified: backend behavior script, test_generation_estimator (4 passed), ruff, targeted eslint, tsc -b, pre-commit check-all.

### T-VID-03 — Spec storyboard enrichment S1 (measured-beat-grid input)
- **Status:** done
- **Goal:** S1 from
  `docs/knowledge-library/storyboard-enrichment-from-track-practice-2026.md`
  specced to implementation depth (S2–S4 get their own items after).
- **Files:** docs/plans/storyboard-enrichment-s1-spec-2026-10.md
- **Acceptance:** Spec names data sources (measured beat grid only) and
  the conformance check; owner approves.
- **Last session:** Kilo, 2026-10-27 — wrote
  docs/plans/storyboard-enrichment-s1-spec-2026-10.md covering R1
  (measured-grid input): grid validation, BPM conflict detection, scene
  timing derivation, generator job param acceptance, board output with
  `bpm_conflict` flag, conformance check, and file-level change plan.
  Data sources named: measured beat grid + section boundaries only (no
  estimated timing); library/metadata BPM used only for conflict
  comparison (±2 BPM tolerance).

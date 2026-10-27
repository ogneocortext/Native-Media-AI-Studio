# Tasks — Video Pipeline & Storyboard

Area map + behavior ledger: `docs/plans/focus-areas-and-behavior-ledgers-2026-10.md` §3.5
Rules: `docs/plans/tasks/README.md`
**Hold:** no music-video generation/rendering in Orion's environment
until the storyboard gate (T-VID-03) lands. Local-platform work only.

### T-VID-01 — Video Intros: recipe schema design
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

### T-VID-02 — Video Intros: first template render (local)
- **Status:** todo
- **Goal:** One intro rendered locally from the T-VID-01 recipe, sting
  synced to the measured beat grid, watermark/branding baked in from
  frame one.
- **Files:** per T-VID-01 design
- **Acceptance:** Ledger §3.5 intro items pass; owner approves the look
  before it becomes the template.
- **Last session:** —

### T-VID-03 — Storyboard enrichment S1 (spec for implementation)
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

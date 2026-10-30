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
- **Plan:** (Orion, 2026-10-29 — decisions already made; execute as
  written, mark a missing decision blocked rather than improvising.)
  0. Gate check: §3.5's state note ties this render to the storyboard
     gate, and the initiative text says intros ship *before* full music
     videos resume. This item is a LOCAL platform render — the owner's
     hold covers music-video rendering in Orion's environment, not
     this. Record the owner's go in Last session before Step 4; if the
     owner says the gate has not landed, stop after Step 3 (the recipe
     instance and the consumer are gate-independent and still useful).
  1. Recipe instance: create
     `docs/plans/intro-recipes/neocortext-v1.recipe.json` conforming to
     the T-VID-01 schema. Values: duration_seconds 5.0; canvas
     1920×1080 @ 24 fps, background #000000; brand.logo.source =
     packages/frontend/public/logo.svg, placement (0.5, 0.5), scale
     0.4, opacity 1.0, anchor center; brand.palette = three hex values
     taken from the logo/owner brand and recorded in the recipe (no
     placeholders at render time); motion.curve ease-out,
     motion.intro_animation fade-in; sting fields and logo_dwell_sec
     are set in Step 2. Validate the instance against the schema's
     validation rules (duration 3–7 s; motion phases sum ≤ duration;
     scale 0.1–1.0; opacity 0–1; gain −60…+6; hex colors).
  2. Sting + measured beat grid: choose a short sting from the owner's
     local audio library (or trim one from an existing track with the
     backend audio edit tooling; record source + trim range in Last
     session). Copy the final sting to
     `packages/video-editor/public/branding/sting-v1.wav` (versioned
     path, served via staticFile — the schema's determinism rule wants
     immutable sources). Measure the sting with
     `tools/analyze_and_sync.py` — MEASURED beat grid only, never
     inherited BPM metadata (ledger rule). Set sting.fade_in_sec /
     fade_out_sec / gain_db and motion.logo_dwell_sec so the logo is
     fully visible on a downbeat and the 5.0 s duration ends on a beat
     boundary; record the measured BPM and the alignment choice in
     Last session. This parameter-level sync is how "sting synced to
     the beat grid" is honored inside schema v1, whose non-goals
     exclude audio-reactive motion.
  3. Consumer (verified missing 2026-10-29 — this is the build inside
     this item): no code consumes the recipe yet; the frontend
     package has no Remotion dependency. Remotion 4.0.534 lives in
     packages/video-editor. Add
     `packages/video-editor/src/compositions/IntroTemplate.tsx`
     implementing the schema's Usage steps 1–5 (clear canvas → draw
     logo per placement/scale/opacity → apply intro_animation with
     curve across the dwell → play sting with fades/gain → hold →
     fade out), all animation derived from frame/fps
     (useCurrentFrame) — no clocks, no randomness (determinism
     guarantee). The recipe arrives as composition props;
     calculateMetadata derives durationInFrames / width / height /
     fps from it. Copy the logo to
     `packages/video-editor/public/branding/logo.svg` so one
     staticFile root serves both brand assets. Register the
     composition in `packages/video-editor/src/Root.tsx` with id
     `IntroTemplate`, modeled on compositions/Template.tsx and the
     existing Root registrations.
  4. Render (local, Windows): from packages/video-editor,
     `pnpm exec remotion render IntroTemplate output/intros/neocortext-v1.mp4`
     with the recipe file passed via --props (pinned pnpm exec form,
     never bare npx — decision log). output/ is gitignored: the MP4
     is a local artifact; the recipe, composition and assets are the
     committed deliverables. No backend or ComfyUI services are
     needed. Rendering through the studio UI instead is a scope
     change — stop and note it; v1 is the CLI render.
  5. Verify: render TWICE from the same recipe and confirm identical
     brand elements (logo placement/scale, palette, sting) across
     both outputs; ffprobe the MP4 (duration within one frame of
     5.0 s, 1920×1080, 24 fps, audio stream present); grab the
     dwell-midpoint frame for the owner's look check. Then run the
     scoped gates (tsc + eslint on packages/video-editor) and
     check-all once before the commit that marks this item done.
- **Files:** docs/knowledge-library/video-intro-recipe-schema-2026-10.md
  (input — do not modify); docs/plans/intro-recipes/neocortext-v1.recipe.json
  (new); packages/video-editor/src/compositions/IntroTemplate.tsx (new);
  packages/video-editor/src/Root.tsx (register composition);
  packages/video-editor/public/branding/logo.svg +
  packages/video-editor/public/branding/sting-v1.wav (new);
  tools/analyze_and_sync.py (existing — beat-grid measurement);
  output/intros/neocortext-v1.mp4 (local render artifact, gitignored)
- **Acceptance:** Ledger §3.5 intro items pass: (a) an intro renders
  from a recipe at 3–7 s; (b) sting synced to the measured beat grid
  (measured values recorded in Last session); (c) same recipe ⇒
  identical brand elements across two renders. Recipe instance passes
  the schema's validation rules. Owner approves the look before it
  becomes the template.
- **Last session:** Orion, 2026-10-29 — executor-ready Plan written
  (this block) from the T-VID-01 schema, Ledger §3.5, and a source
  sweep (no recipe consumer exists; Remotion surface is
  packages/video-editor). Render not started.

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

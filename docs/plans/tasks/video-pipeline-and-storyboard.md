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
      packages/frontend/public/logo.svg so one
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
  packages/frontend/public/logo.svg +
  packages/frontend/public/branding/sting-v1.wav (new);
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

### T-VID-05 — Design a spec-driven 3D scene builder (scenes as data)
- **Status:** todo
- **Goal:** A written spec for 3D scene generation in which the
  model emits a validated scene spec (JSON) and a deterministic
  builder executes it — the intro-recipe pattern extended to
  scenes. Design only: no code, no renders (the standing
  music-video hold is unaffected; implementation is a later item).
- **Plan:** Evidence: `docs/knowledge-library/3d-viz-code-harnesses-2026.md`
  (SceneCraft graph → constraints → solver; Holodeck spec →
  scene JSON; the spec-builder survey finding that a validator
  before the engine starts is the safe shape). Steps: (1) Define
  the scene-spec schema v0: objects (primitive or asset ref,
  transform, material), lights, camera, spatial relations stated
  as constraints (on / left-of / above / aligned), and
  audio-reactive bindings — a spec field naming which measured
  analysis feature (beat grid from T-VID-03, section boundaries,
  stem energy) a property follows. (2) Map the builder split:
  validator (rejects a bad spec before any engine starts),
  Blender builder (bpy generated from spec by project code, never
  by the model directly), Unity loader (scene JSON, Holodeck
  style). (3) Worked example: hand-write one spec for a simple
  visualizer scene and walk it through both builder outlines on
  paper, noting every ambiguity the schema must resolve.
  (4) Record open questions for the owner: asset-library source
  for refs; whether the frontend Three.js visualizer gets a third
  builder. If a later Three.js builder emits custom GLSL, route that
  source through the `glsl` gate from T-PLT-10 as ESSL 1.00 before
  browser preview; `glslangValidator` checks shader source, not scene
  JSON, ShaderLab, or runtime WebGL behavior.
- **Files:** docs/plans/scene-spec-v0-2026-11.md,
  docs/knowledge-library/3d-viz-code-harnesses-2026.md
- **Acceptance:** The spec document exists with the schema,
  validator rules, both builder outlines, and the worked example;
  no code or renders produced.
- **Last session:** Orion, 2026-11-01 — Item created with the
  knowledge doc; not started. GPT-6, 2026-11-01 — amended the plan
  to include the existing ESSL 1.00 compile gate if a future Three.js
  builder emits custom GLSL.

### T-VID-06 — Decompose music-video steps.tsx into per-step modules
- **Status:** done
- **Goal:** Split the ~1050-line `features/music-video/steps.tsx` (five wizard step components) into focused modules so each step is independently readable.
- **Files:** packages/frontend/src/features/music-video/steps.tsx (now a barrel), packages/frontend/src/features/music-video/steps/{UploadStep,AnalyzeStep,ConfigureStep,GenerateStep,ReviewStep}.tsx + shared.ts (new)
- **Acceptance:** Each step component lives in its own file under `steps/`; shared constants (SECTION_COLORS, SHOT_SIZES, CAMERA_ANGLES, PROMPT_SUGGESTIONS) in `steps/shared.ts`; `steps.tsx` re-exports all five so `MusicVideoWizard`'"'"'s `./steps` import is unchanged; tsc -b clean on touched files (only pre-existing agent-chat WIP errors remain), eslint 0 errors on the new files.
- **Last session:** Devin, 2026-11-30 — pure move, no behavior change. Verified: `npx tsc -b` reports zero errors under `features/music-video/` (only unrelated agent-chat WIP errors project-wide); `npx eslint` on steps.tsx + steps/ = 0 errors, 8 pre-existing warnings; no music-video unit tests exist (vitest filter returns none). Import specifiers were trimmed per-file from tsc TS6133/TS6192 output; relative import depth corrected for the new `steps/` subdirectory.

### T-VID-07 — Design a video-to-video (V2V) transformation route (existing footage as pipeline input)
- **Status:** todo
- **Goal:** A written design for a transformation route — existing video in, ComfyUI workflow applied, transformed video out, registered as a normal job output — because every current pipeline starts from text or an image. Design only: no code, no renders; the standing music-video hold is unaffected, and this item registers the gap, it does not authorize a build.
- **Plan:** Evidence: code survey 2026-11-06 (Orion) — no V2V path exists; `grep` for inpaint/depth/relight/motion-transfer/segmentation across `packages/` returns nothing in code; T2V/I2V only (`music_video_handler`, adapter I2V builders). Research: `docs/knowledge-library/higgsfield-comfyui-challenge-2026.md` (the project-gap section). Steps: (1) Define the route contract in the shape of the existing generation routes: input video reference (library file or prior job output), workflow id, typed params, output registration + estimator treatment. (2) Reuse, don't reinvent: job/queue lifecycle, `comfyui_workflow_handler`, and the VRAM lane (D71) are the substrate — name exactly which pieces the route plugs into. (3) Identify the reusable stages the dependent items (T-VID-08/09/10) share — segmentation, depth estimation, inpaint/propagation — so each is specced once, as a stage, not three times as features. (4) 8 GB feasibility pass per `docs/knowledge-library/video-generation-vram-2026.md`: which candidate models/workflows fit the owner's card at usable lengths, which don't, stated plainly.
- **Files:** docs/plans/v2v-transformation-design-2026-11.md (new); reference: packages/backend/app/services/comfyui_workflow_handler.py, packages/backend/app/services/music_video_handler.py, packages/backend/app/adapters/comfyui.py
- **Acceptance:** The design doc exists with the route contract, the substrate mapping, the shared-stage list, and the VRAM verdicts; no code or renders produced.
- **Gate:** Design work may start any time; any implementation item spun out of it waits on the owner's word and sits downstream of T-VID-02 and the storyboard critical path.
- **Last session:** Orion, 2026-11-06 — item registered with T-VID-08..11 at the owner's request, following the code-level gap survey; not started.

### T-VID-08 — Spec character/object swap in video (Openjutsu pattern)
- **Status:** todo
- **Goal:** A written spec for swapping a character, outfit, or object inside existing footage while preserving the original motion and camera work — segmentation stage + video-model replacement over the T-VID-07 route. Spec only: no code, no renders.
- **Plan:** Research: `docs/knowledge-library/higgsfield-comfyui-challenge-2026.md` §The 8 recreations #1 (Openjutsu: local ComfyUI around a MiniMax video model + segmentation; an official challenge category). Steps: (1) Name a candidate workflow/model chain and give its 8 GB feasibility verdict (from T-VID-07 step 4, or standalone if that hasn't run). (2) Define the inputs a user supplies: source video, target reference (image or description), mask source (auto-segmentation vs painted — note the T-VID-09 overlap). (3) Define the failure surface to design around: identity drift across frames, mask edge artifacts, motion faster than the tracker. (4) State what "good" is checkable as: same camera path, same motion timing, swapped element consistent at section boundaries.
- **Files:** spec section in docs/plans/v2v-transformation-design-2026-11.md (created by T-VID-07)
- **Acceptance:** The spec exists with candidate chain, feasibility verdict, input contract, and failure surface; no code or renders produced.
- **Depends on:** T-VID-07 (route + segmentation stage design). Gate: as T-VID-07.
- **Last session:** Orion, 2026-11-06 — registered; not started.

### T-VID-09 — Spec first-frame paint → propagation editing (Paint a Plate pattern)
- **Status:** todo
- **Goal:** A written spec for draw-to-edit on generated footage: the user paints the change onto the first frame (remove an object, relight a region, add an effect) and a propagation workflow carries it through the shot — the fix-a-panel tool the storyboard pipeline currently lacks. Spec only: no code, no renders, and the paint UI surface itself is explicitly out of scope.
- **Plan:** Research: `docs/knowledge-library/higgsfield-comfyui-challenge-2026.md` §The 8 recreations #8 (AInVFX Paint a Plate). Note for the specifier: "inpainting" in this repo's docs previously meant 3D texture inpainting only — this is a different technique; don't let the older docs' vocabulary steer the design. Steps: (1) Define the pipeline contract: source video + edited first frame (+ optional mask) → propagation workflow → edited video, over the T-VID-07 route. (2) Name candidate propagation approaches and the 8 GB verdict for each. (3) Define edit classes v0 supports (removal, relight, additive effect) and which it explicitly doesn't. (4) Define the acceptance shape a later implementation would be judged by: edit present and stable across the shot, unedited regions unchanged (frame-diff outside the mask ≈ 0).
- **Files:** spec section in docs/plans/v2v-transformation-design-2026-11.md (created by T-VID-07)
- **Acceptance:** The spec exists with pipeline contract, candidates + verdicts, edit classes, and the frame-diff acceptance shape; no code or renders produced.
- **Depends on:** T-VID-07 (route design). Gate: as T-VID-07.
- **Last session:** Orion, 2026-11-06 — registered; not started.

### T-VID-10 — Spec re-shoot: depth estimate → new camera path → view rebuild (ReAngle pattern)
- **Status:** todo
- **Goal:** A written spec for re-angling footage that already exists: estimate the shot's depth, author a new 3D camera path, and rebuild the view with a video model (LTX family) — new coverage from a single rendered or recorded take. Spec only: no code, no renders.
- **Plan:** Research: `docs/knowledge-library/higgsfield-comfyui-challenge-2026.md` §The 8 recreations #6 (ReAngle: depth estimate → camera path → LTX rebuild; the challenge ran "Re-shoot a video" as an official category). Steps: (1) Name the depth-estimation stage (shared with T-VID-07 step 3) and the rebuild model candidates with 8 GB verdicts. (2) Define the camera-path authoring input: reuse the T-VID-11 rig vocabulary (named moves as paths) where it fits, free path where it doesn't — state which. (3) Record the known limit up front (video-reported and physically expected): large moves break — define the spec's move envelope (degrees/distance) beyond which output is expected to degrade, so a later implementation is judged inside it. (4) Define the checkable acceptance shape: rebuilt view matches the authored path's framing at sampled timestamps; original subject identity/motion preserved.
- **Files:** spec section in docs/plans/v2v-transformation-design-2026-11.md (created by T-VID-07)
- **Acceptance:** The spec exists with stage/model verdicts, path-authoring decision, move envelope, and acceptance shape; no code or renders produced.
- **Depends on:** T-VID-07 (route + depth stage design). Relation: T-VID-11 (camera vocabulary). Gate: as T-VID-07.
- **Last session:** Orion, 2026-11-06 — registered; not started.

### T-VID-11 — Camera direction as preset data: one typed rig registry for the I2V path (Backlot pattern)
- **Status:** todo
- **Goal:** A written design (plus the registry schema) promoting camera direction from prompt-text suffixes to inspectable preset data: one typed registry of rigs — move, lens, lighting, look — consumed by the ComfyUI adapter, replacing the current 8 hardcoded prompt strings. Design only; the adapter change itself is a later item.
- **Plan:** Evidence: `packages/backend/app/models/generation.py:162` defines 8 `camera_motion` values; `packages/backend/app/adapters/comfyui.py` maps them to prompt suffixes (`"orbit": "camera orbits around subject"`) in two duplicated spots (~1305 and ~1509 — the same duplication class as the dead `_build_i2v_workflow` found 2026-10-28). Research: `docs/knowledge-library/higgsfield-comfyui-challenge-2026.md` §The 8 recreations #5 (Backlot: ~30 cameras + lens/lighting/look as workflow data). Steps: (1) Schema: rig = { id, move (one of the existing 8 or a path ref for T-VID-10), lens (focal character), lighting (setup), look (grade/palette note), prompt fragments per field } — fields the current suffix map cannot express are the point. (2) Seed set: port the existing 8 moves losslessly (same prompt output for the same selection — behavior-preserving by construction), then add lens/lighting variants as data only. (3) Name the single consumption point in the adapter and the dedup of the two suffix maps. (4) Note the storyboard consumer: rig ids are what a storyboard panel should store, not prose.
- **Files:** docs/plans/camera-rig-presets-2026-11.md (new); reference: packages/backend/app/models/generation.py, packages/backend/app/adapters/comfyui.py
- **Acceptance:** The design doc exists with the schema, the lossless seed mapping for all 8 existing moves, and the named consumption point; no code changed.
- **Gate:** Design work may start any time; implementation waits on the owner's word (it touches the live generation path, so it does not ride along with unrelated fixes).
- **Last session:** Orion, 2026-11-06 — registered with T-VID-07..10 at the owner's request; not started.

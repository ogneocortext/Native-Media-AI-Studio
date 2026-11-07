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

### T-VID-12 — Encode real-time 3D budgets in the asset + scene pipeline (Pascal budget discipline)
- **Status:** todo
- **Goal:** The budgets in `docs/knowledge-library/pascal-3d-budget-discipline-2026.md` become enforced data instead of prose: per-role decimation targets in gen3d, a texture post-step at ingest, a per-asset budget report, and budget validation in the T-VID-05 scene builder's validator — so an over-budget asset or scene is flagged before any engine starts.
- **Plan:** Evidence: `packages/backend/app/services/gen3d/decimate_glb.py:8` defaults `target_faces` to a flat 50,000 and `gen3d_service.py` (~line 462) applies one target regardless of asset role; no texture budget exists anywhere in the ingest path. Steps: (1) Budgets as machine-readable config (one source the doc mirrors): role → { target_faces, max texture size, KTX2 required }, scene caps (draw calls, materials, dynamic lights). (2) gen3d: role parameter selects the decimation target; ingest post-step downscales + KTX2-converts textures and emits the LOD chain (LOD0/1/2 + sprite card); generation result gains a budget report (triangles, texture MB, materials, LOD presence). (3) T-VID-05's validator sums a scene spec against the scene caps and rejects over-budget specs with the violating line items named. (4) RenderStatsBadge shows budget-vs-actual for draw calls in the Three.js studio (rides on the T-VIZ-17/18 badge work).
- **Files:** docs/knowledge-library/pascal-3d-budget-discipline-2026.md (budget source); packages/backend/app/services/gen3d/ (decimate_glb.py, gen3d_service.py); the T-VID-05 spec doc when written
- **Acceptance:** Budget config exists and is consumed by gen3d (no hard-coded flat target remains); a generated asset carries a budget report; an over-budget scene spec is rejected by the validator with named violations before any engine starts.
- **Gate:** Config + report work may start any time; gen3d behavior changes (decimation targets, texture post-step) wait on the owner's word — they touch the live generation path.
- **Last session:** Orion, 2026-11-06 — registered with the budget doc at the owner's request; not started.

### T-VID-13 — Design the frame-package contract: control-pass rendering from owned scenes
- **Status:** todo
- **Goal:** A written spec for the frame package the 3D builder emits per scene: beauty frames plus the control passes Route B consumes — depth, normals, segmentation/object-ID, pose for rigged characters, and camera metadata — versioned as one contract that [[3d-bones-ai-skin-pipeline-2026]] §3 defines as the pipeline's interface. Design only.
- **Plan:** Evidence (2026-11-06): grep finds no pass/AOV support anywhere in scene/gen3d code; T-VID-05's spec covers objects/materials/lights/camera/bindings but no passes. Steps: (1) Pass list + semantics (what each pass encodes, value ranges, color space). (2) Formats + resolution relationship to beauty (full/half), naming and package versioning. (3) Storage/write budget on the SATA SSD (profile risk notes) — pass set sized so a song-length scene stays sane. (4) How the T-VID-05 spec requests passes (per-scene pass block) and how the validator checks them against the T-VID-12 scene caps.
- **Files:** docs/knowledge-library/3d-bones-ai-skin-pipeline-2026.md (§5 Gap 1); the T-VID-05 spec doc when written; docs/knowledge-library/pascal-3d-budget-discipline-2026.md (caps)
- **Acceptance:** A frame-package spec exists that a builder implementer and a lane implementer (T-VID-14) can each build against without asking the other questions; pass set + formats + versioning are named decisions, not options.
- **Gate:** Design work may start any time; any implementation item spun out of it waits on the owner's word and sits downstream of T-VID-02 and the storyboard critical path.
- **Last session:** Orion, 2026-11-06 — registered with the bones/skin gap analysis at the owner's request; not started.

### T-VID-14 — Design the control-conditioned generation lane (frame packages → AI skin)
- **Status:** todo
- **Goal:** A written design for the ComfyUI lane that consumes frame packages (T-VID-13) and paints appearance under geometric control: depth/pose/segmentation conditioning + AnimateDiff-class temporal modeling on the profile's blessed SD 1.5 tier. Design only.
- **Plan:** Evidence (2026-11-06): the integration is declared but unbuilt — `packages/backend/app/api/integrations_music_video.py:565` catalogs "Advanced AnimateDiff with controlnet and IP-adapter" (`mm_sd_v15_v2.safetensors`, `controlnet_openpose`) and `Settings.tsx` offers a "ControlNet + Image" mode, yet `config/comfyui/workflows/` holds 3 workflows, none control-based. Steps: (1) Workflow graph design: which passes feed which control units, weights per pass class. (2) Lane assignment under the hardware profile (768×768 fp16 defaults, VRAM-manager coexistence with Ollama, CPU lane for batch). (3) Seed/parameter contract for reproducibility (same package + params ⇒ same skin). (4) Failure vocabulary: what the lane reports when a package is malformed or a model is missing.
- **Files:** docs/knowledge-library/3d-bones-ai-skin-pipeline-2026.md (§5 Gap 2); config/comfyui/workflows/ (inventory); config/hardware-profile.json (lanes)
- **Acceptance:** A workflow design exists that names every node class, input pass, and parameter; the model set fits the profile's limits without exception requests; reproducibility contract stated.
- **Depends on:** T-VID-13 (frame-package contract). **Gate:** as T-VID-13.
- **Last session:** Orion, 2026-11-06 — registered with the bones/skin gap analysis at the owner's request; not started.

### T-VID-15 — Design lighting + look rigs as spec data (the T-VID-11 pattern, scene side)
- **Status:** todo
- **Goal:** A rig registry for the 3D/scene side mirroring T-VID-11's camera registry: named lighting rigs (three-point, studio, practical archetypes as data), a lens set, and look/grade presets that T-VID-05 scene specs reference by name — so cinematography is a vocabulary, not per-scene improvisation. Design only.
- **Plan:** Evidence: T-VID-11 covers camera for the I2V prompt path; no lighting/look vocabulary exists for scenes, and Route A output has no defined grade step. Steps: (1) Rig archetype list v0 with parameters (positions, intensities, color temps) expressed in spec terms. (2) Lens set (focal lengths + the look each implies) aligned with T-VID-11's vocabulary where they overlap — one camera language across both paths. (3) Look presets: LUT/grade references as spec fields; Route A's grade step named in the pipeline. (4) Budget conformance: rigs respect the budget doc's baked/static lighting + dynamic-light cap (≤3).
- **Files:** docs/knowledge-library/3d-bones-ai-skin-pipeline-2026.md (§5 Gap 3); docs/knowledge-library/pascal-3d-budget-discipline-2026.md (lighting caps); T-VID-11's registry design when written
- **Acceptance:** A registry design exists with named rigs/lenses/looks and their spec representation; every rig provably fits the dynamic-light cap; overlap with T-VID-11's camera vocabulary is reconciled, not duplicated.
- **Gate:** as T-VID-13.
- **Last session:** Orion, 2026-11-06 — registered with the bones/skin gap analysis at the owner's request; not started.

### T-VID-16 — Design the character identity layer: one asset, both layers
- **Status:** todo
- **Goal:** A written design for the character asset as a single versioned definition — mesh, proportions, materials, rig, and identity reference set — consumed by the builder (geometry consistency) and by the generation lane (identity conditioning), so a character cannot drift between scenes or between layers. Design only.
- **Plan:** Evidence: IP-Adapter is named in the declared integration (integrations_music_video.py:565) but no character-asset definition exists to key it to. Steps: (1) Character asset schema: identity block (reference set), geometry block (mesh/rig refs), material block, version field. (2) The consistency contract: same asset id + version ⇒ same proportions from the builder and same identity conditioning in the lane; what a version bump means and who approves it. (3) Reference-set curation rule: what images constitute an identity, minimum set, change procedure. (4) How scene specs instance characters (asset ref + per-scene overrides that may not touch identity fields).
- **Files:** docs/knowledge-library/3d-bones-ai-skin-pipeline-2026.md (§5 Gap 4); the T-VID-05 spec doc when written (asset refs)
- **Acceptance:** A schema + contract exist that make "same character, new scene" a spec operation, not a hope; identity-affecting changes are versioned and gated by the curation rule.
- **Depends on:** T-VID-05 (asset refs), T-VID-14 (lane identity inputs). **Gate:** as T-VID-13.
- **Last session:** Orion, 2026-11-06 — registered with the bones/skin gap analysis at the owner's request; not started.

### T-VID-17 — Design the bones render lane: deterministic capture spec
- **Status:** todo
- **Goal:** A written capture spec for turning scenes into frame packages: Eevee-class real-time raster as the decided engine lane, sampling/denoise settings, a resolution ladder tied to the budget doc, and deterministic frame export. Design only — the decision and its settings, no renders.
- **Plan:** Evidence: no engine/settings decision exists for scene capture; the baseline argues it (§5 Gap 5 of the gap doc): no RT cores and a 6-physical-core CPU fallback make a Cycles-class lane unable to be the iteration loop on this hardware. Steps: (1) Engine decision recorded with the baseline reasoning (Eevee-class default; Cycles-class named as final-frame luxury, explicitly not the loop). (2) Capture settings: samples/denoise, resolution ladder (draft/final) mapped to budget-doc caps and the profile's 768×768 ComfyUI input expectations for Route B. (3) Determinism: frame stepping + seed discipline — the [[three-js-render-motion-2026]] clock discipline applied to the bpy side. (4) Throughput expectations per lane (CPU playbook: batch renders are solo/split-lane jobs).
- **Files:** docs/knowledge-library/3d-bones-ai-skin-pipeline-2026.md (§5 Gap 5); docs/knowledge-library/ryzen-5500-cpu-playbook-2026.md (lanes); config/hardware-profile.json
- **Acceptance:** A capture spec exists with the engine decision and its reasoning recorded; an implementer can cost a scene (frames × settings → wall-clock lane) from the spec alone.
- **Gate:** as T-VID-13.
- **Last session:** Orion, 2026-11-06 — registered with the bones/skin gap analysis at the owner's request; not started.

### T-VID-18 — Design the scene vocabulary + material library (what the builder can choose from)
- **Status:** todo
- **Goal:** A written design that lifts the Three.js Studio's content ceiling: parameterized primitives (sizes as spec fields, not factory constants), a named PBR material library with texture sets, GLTF asset references as first-class vocabulary, and the mesh factory refactored into a consumer of that library. Design only.
- **Plan:** Evidence: [[three-js-studio-scene-quality-2026]] (2026-11-06) — the factory (`useMeshFactory.ts`) offers 7 fixed-size shapes (crown/sphere/box/cylinder/cone/torus/bars) and one 5-scalar `MeshStandardMaterial` with no texture maps; the owner's recorded scene is a single `crown` preset ("Objects 1"). The same doc records the unused asset: the factory already loads GLTF models with animation mixers — the generator never routes through it. Steps: (1) Vocabulary audit + expansion design: which parameterized primitives and composite presets earn a place; every size becomes a spec field with budget-doc bounds. (2) Material library: named PBR materials with texture sets (color/normal/roughness), KTX2 delivery per [[pascal-3d-budget-discipline-2026]], emissive discipline (bloom-safe ranges, ties to T-VID-15 rigs). (3) Asset vocabulary: gen3d output and curated GLTFs referenced by asset id from scene specs (T-VID-05 schema), with T-VID-12 budget reports as the admission ticket. (4) Reconcile the dead path: `packages/backend/app/api/ai.py` `POST /generate-scene` is a placeholder stub — remove it or route it to the real generator, so the codebase stops advertising a route that does not exist. (5) Factory-as-consumer: the mesh factory builds from library entries; no geometry constants or material scalars defined inline.
- **Files:** docs/knowledge-library/three-js-studio-scene-quality-2026.md (evidence); packages/frontend/src/features/three-js-studio/hooks/useMeshFactory.ts; packages/backend/app/api/ai.py (stub); the T-VID-05 spec doc when written
- **Acceptance:** A vocabulary + material library design exists with named entries and spec representation; a scene spec can express a textured, asset-bearing scene the current factory cannot; the stub endpoint's fate is decided in the design (remove or wire).
- **Depends on:** T-VID-05 (spec fields the vocabulary plugs into), T-VID-12 (texture/budget rules). **Gate:** as T-VID-13.
- **Last session:** Orion, 2026-11-06 — registered with the scene-quality findings at the owner's request; not started.

### T-VID-19 — Research: character sourcing, auto-rigging, and the house skeleton standard
- **Status:** done
- **Goal:** A knowledge doc answering [[browser-character-pipeline-research-2026]] Steps 1–2 with verdicts for this studio: where rigged characters come from, how unrigged gen3d meshes get bones, and the one house skeleton every character and clip conforms to.
- **Plan:** Questions (agenda doc Steps 1–2): character sources + licensing (incl. what gen3d output looks like as a character); auto-rigging routes compared (Mixamo / AccuRig / Blender addons — quality, skeleton compatibility, automation); the house skeleton decision (bone list, naming, twist bones, the ≤64-bone budget from [[pascal-3d-budget-discipline-2026]] spent where); skinning quality bar + a rig acceptance test. Answer shape: recommendations with reasons, checked against the budget doc and the hardware profile — not a link survey.
- **Files:** docs/knowledge-library/browser-character-pipeline-research-2026.md (agenda); output: a new knowledge doc registered on landing
- **Acceptance:** Doc exists and is registered in the library; the house skeleton is a named decision (bone list + naming) that T-VID-20 and T-VID-22 can build on; every agenda question carries a verdict.
- **Gate:** Research may start any time (reading + writing only). Design/implementation items spin out only on the owner's word.
- **Last session:** Orion, 2026-11-06 — done in this commit. Evidence: [[browser-character-pipeline-verdicts-2026]] §1–2 (registered in the library): hybrid sourcing verdict (Mixamo primary, redistribution nuance recorded), Blender-hub conversion chain with weight/decimate gates, and HouseRig_v1 as a named decision — 47-bone base / 59 hero, Mixamo-compatible names, twist bones included, finger chains rebalanced from the source report's 54-bone layout. Sources: two external AI deep-research reports run by the owner against the agenda (Gemini + Perplexity, both search-grounded), distilled per the external-sources policy; disagreements and corrections in verdicts §6.

### T-VID-20 — Research: animation clips, retargeting, and beat-mapped blending in three.js
- **Status:** done
- **Goal:** A knowledge doc answering agenda Step 3: how clips are sourced and retargeted onto the house skeleton, how the AnimationMixer blends them under song-section state machines, and how the measured beat grid maps onto clip phase deterministically.
- **Plan:** Questions (agenda doc Step 3): clip sources + retargeting tooling (Blender retarget addons, three.js SkeletonUtils) and their failure modes (foot-slide, scale drift, root motion); mixer patterns (crossfades, additive layers, section-driven state machines) that survive multiple characters; beat-phase engineering — T-VID-03's grid → clip phase, extending [[character-animation-2026-summer-synthesis]]'s beatPhase philosophy into mixer mechanics.
- **Files:** docs/knowledge-library/browser-character-pipeline-research-2026.md (agenda); output: a new knowledge doc registered on landing
- **Acceptance:** Doc exists and is registered; retargeting route is a named recommendation; the beat→phase mapping is specified concretely enough to implement from.
- **Depends on:** T-VID-19 (house skeleton). **Gate:** as T-VID-19.
- **Last session:** Orion, 2026-11-06 — done in this commit. Evidence: verdicts doc §3: offline Blender retarget route (name-map + two-bone IK foot-lock, foot-slide ≤0.05 m and loop-closure ≤0.5° validation), clip metadata schema (BPM/loop/skeleton version), AI motion = reference only, and the beat architecture — audio clock + measured-grid interpolation (the source's uniform-beat controller math corrected), BPM-scaled intensity crossfades.

### T-VID-21 — Research: character textures, KTX2 budgets, and skinned LOD
- **Status:** done
- **Goal:** A knowledge doc answering agenda Steps 4–5: character PBR texture sets at browser budgets, the per-character KTX2 budget math, hair/eye approaches, skinned-LOD strategy, and the draw-call anatomy of multi-character scenes.
- **Plan:** Questions (agenda doc Steps 4–5): skin/cloth/hair material approaches per character class within the ≤1 GB scene texture cap; KTX2 settings for multi-map characters (extending T-VID-12's scene-texture work); hair cards vs shells, eye shading cheats; bone-reduced LOD chains and the impostor threshold; per-character draw-call accounting against the ≤150 scene cap (materials, shadow pass).
- **Files:** docs/knowledge-library/browser-character-pipeline-research-2026.md (agenda); docs/knowledge-library/pascal-3d-budget-discipline-2026.md (caps); output: a new knowledge doc registered on landing
- **Acceptance:** Doc exists and is registered; per-class texture budgets and a skinned-LOD rule are stated as numbers/rules, not directions.
- **Gate:** as T-VID-19 (research only; independent of T-VID-19/20, may run parallel in research time).
- **Last session:** Orion, 2026-11-06 — done in this commit. Evidence: verdicts doc §4: KTX2 character settings (ETC1S albedo / UASTC normals, sRGB rule), per-class resolutions, single-material + atlas rule with draw-call anatomy (~2 calls/character), hair alphaTest values with the transparent:true ban. Skinned LOD depth came from the second report: offline chains (LOD1 ~31 joints, fingers collapse; LOD2 ~21) with projected-height thresholds + hysteresis, and the rule that a control-driving character never swaps to a billboard.

### T-VID-22 — Research: three.js runtime at character scale + pose-pass encoding
- **Status:** done
- **Goal:** A knowledge doc answering agenda Steps 6–7: AnimationMixer management for multiple characters (clip caching, memory disposal), character lighting under the studio's single shadow-casting directional, and how a skeleton is encoded as T-VID-13's pose pass.
- **Plan:** Questions (agenda doc Steps 6–7): shared vs per-character mixers, clip cache strategy, GPU memory disposal on scene swap; flattering character shading without SSS (rim, wrap, gradient maps) under one shadow light; pose-pass encoding options (joint positions vs rotations, format, resolution) judged against what the T-VID-14 lane can consume.
- **Files:** docs/knowledge-library/browser-character-pipeline-research-2026.md (agenda); docs/plans/tasks/video-pipeline-and-storyboard.md (T-VID-13 contract, T-VID-14 lane); output: a new knowledge doc registered on landing
- **Acceptance:** Doc exists and is registered; pose encoding is a named format decision T-VID-13's spec can cite; runtime patterns are stated as rules for the factory/studio code.
- **Depends on:** T-VID-19 (house skeleton — pose encoding encodes it), T-VID-13 (frame-package contract). **Gate:** as T-VID-19.
- **Last session:** Orion, 2026-11-06 — done in this commit. Evidence: verdicts doc §5: renderer baseline, tight-stage 2048² shadow decision (headed test in T-VID-23), diffuse-wrap via onBeforeCompile (start 0.25, shadow-attenuated), reference-counted disposal discipline (factory gap spun out as T-VID-23). Pose encoding answered by the second report (Perplexity) after the first drifted to foreign-video extraction: one evaluated pose → three outputs (OpenPose-format control image via landmark markers, fixed-bounds depth image, Float32 numeric archive) — now T-VID-13's pose-pass contract input.

### T-VID-23 — Studio character lifecycle: disposal, shadow baseline, diffuse-wrap option
- **Status:** todo
- **Goal:** Close the three code-level gaps the character research exposed in the Three.js Studio: (1) character/scene swaps dispose GPU resources (mixer stopAllAction + uncacheRoot, traverse-dispose of geometry/materials/textures); (2) the shadow-map size decision (current 1024² vs the research-recommended 2048²) made by a headed A/B on the reference rig, not by opinion; (3) an optional diffuse-wrap shading toggle for character materials (wrap ~0.5 skin / ~0.2 cloth) via onBeforeCompile on MeshStandardMaterial.
- **Plan:** Evidence: [[browser-character-pipeline-verdicts-2026]] §5 (the factory's GLTF path never disposes — a slow GPU-memory leak across swaps; mount config runs a 1024² shadow map; no wrap shading exists). Steps: (1) disposal helper in the factory/object-manager path, called on every swap/removal, with a before/after GPU-memory reading across 10 swaps. (2) Headed A/B: same scene at 1024² vs 2048² shadow maps — frame-time p95 + visual check; record the winner in the mount config with the numbers. (3) Wrap toggle in the material path, default off, per-material wrap factor.
- **Files:** packages/frontend/src/features/three-js-studio/hooks/useMeshFactory.ts; packages/frontend/src/features/three-js-studio/hooks/mountThreeScene.ts; docs/knowledge-library/browser-character-pipeline-verdicts-2026.md (§5)
- **Acceptance:** Twenty consecutive character/scene swaps show no unbounded growth in renderer.info counts or the texture byte ledger; the shadow decision is recorded with measured p95 numbers; the wrap toggle visibly softens skin-class shading in a headed check; gates green (run-gates).
- **Gate:** Implementation waits on the owner's word (live studio code); the shadow A/B is a headed check on the owner's rig.
- **Last session:** Orion, 2026-11-06 — registered as the spin-out of T-VID-22's research findings; not started.


### T-VID-24 — Visual style registry: one style record consumed by all four surfaces
- **Status:** todo
- **Goal:** Styles become data. A single registry of named style records ([[visual-style-system-2026]] §2: palette / lighting / material character / post / motion character / AI-skin language / best-for) that scene generation, the visualizer, HyperFrames storyboards, and T-VID-15's look rigs all read — replacing today's per-surface improvisation (stage drifts to bloom + violet on near-black; storyboard palette slots filled ad hoc; each visualizer preset embedding its own color decisions).
- **Plan:** Design source: [[visual-style-system-2026]] (six proposed looks in §3; anti-styles in §4 are review rules for any record). Steps: (1) owner curation pass over the six proposals — strike / rename / re-palette; only survivors enter the registry (the doc's §5 terms). (2) Registry format design on the hardware-profile precedent: `config/visual-styles.json` + a pydantic loader mirroring `hardware_profile.py`'s tolerance rules, records keyed by style id with the seven fields. (3) Consumer mapping, one paragraph each: AISceneGenerator + stage settings (palette/lighting/post per record), storyboard palette slots (`base`/`primary`/`accent` filled from the record), visualizer presets declaring their style id, T-VID-15 look rigs as the 3D expression of the same record so Routes A and B render one look two ways. (4) Material honesty: until T-VID-18 lands, records express material character only within the 5-scalar ceiling; a record field that exceeds it is marked as pending-T-VID-18, never silently dropped.
- **Files:** config/visual-styles.json (new, on owner approval); packages/backend/app/core/ (loader, beside hardware_profile.py); docs/knowledge-library/visual-style-system-2026.md (records as curated)
- **Acceptance:** The registry file + loader exist with the owner-curated records (count = however many survive curation, recorded here); at least two surfaces demonstrably read the same record (scene gen + HyperFrames palette fill are the proof pair); the doc's catalog matches the registry exactly.
- **Gate:** Design anytime; the curation pass is the owner's; implementation on the owner's word, executor lane. Motion-character fields assume measured bands (landed via T-PLT-47); material depth downstream of T-VID-18.
- **Last session:** Orion, 2026-11-07 — registered with the style-system exploration at the owner's request; curation pass is the next step and is the owner's.

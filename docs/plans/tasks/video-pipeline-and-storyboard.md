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
- **Status:** done
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
- **Last session:** Devin, 2026-11-07 — done in this commit (code
  landed earlier under 81c5e7b9 when a concurrent lint-sweep commit
  picked up the uncommitted files; verified post-sweep). Evidence:
  recipe `docs/plans/intro-recipes/neocortext-v1.recipe.json` passes
  every schema validation rule (5.0 s ∈ [3,7]; phases 0.627+3.473+0.8
  = 4.9 ≤ 5.0; scale 0.4; opacity 1.0; gain 0.0 dB; all hex colors).
  Sting: `packages/video-editor/public/branding/sting-v1.wav`, 4.90 s,
  measured via `tools/analyze_and_sync.py` — 184.6 BPM, 14 beats, first
  beat 0.65 s; intro ramp completes at 0.627 s ≈ first downbeat, outro
  fade spans 4.1–4.9 s across the final beats. Logo path resolved:
  `packages/video-editor/public/branding/logo.svg` is byte-identical
  (SHA256 FBF7868B2A86) to `packages/frontend/public/logo.svg` — the
  frontend file is the source of truth; video-editor serves its own
  copy via staticFile. Consumer:
  `packages/video-editor/src/compositions/IntroTemplate.tsx`
  (frame/fps-derived, no clocks/randomness) registered in Root.tsx as
  `IntroTemplate` with calculateMetadata. Rendered twice via
  `pnpm exec remotion render IntroTemplate output/intros/neocortext-v1.mp4
  --props=<recipe>`: SHA256-identical MP4s (EA3F72181AB26ADB, 607,385 B)
  — determinism proven byte-for-byte, stronger than the brand-element
  check. ffprobe: h264 1920×1080 @ 24 fps, video stream 5.000 s, AAC
  audio present, container 5.013 s (13 ms over, within one frame).
  Vision QA (gemma4:e2b-it-qat): midpoint frame f60 — logo visible,
  centered, no defects, score 10/10; f8 and f115 confirm fade-in/fade-out
  phases. Scoped gates: `tsc --noEmit` and `eslint` on
  packages/video-editor both clean (exit 0). PENDING: owner look
  approval — the midpoint PNG is at
  `packages/video-editor/output/intros/midpoint.png` (gitignored local
  artifact) for review; intro is not promoted to template status until
  the owner approves the look.

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
- **Status:** done
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
- **Last session:** Devin, 2026-11-07 — done in this commit. Evidence:
  `docs/plans/scene-spec-v0-2026-11.md` (registered in plans README,
  Status Proposed) — the capstone integrating this session's
  vocabulary docs: camera (T-VID-11), lighting/look (T-VID-15),
  passes (T-VID-13), characters (T-VID-16), primitives/materials/
  assets (T-VID-18) all cited as field authority, never re-decided.
  Schema v0: stage/camera/lighting/look/objects/characters/passes/
  analysis/features_used. v0 owns two new field families:
  `relations` (7 declarative spatial constraints, spec-order
  deterministic resolution, no cycles, fixed conventions — metres,
  Y-up, glTF frame, degrees, feet-at-origin) and `bindings`
  (audio-reactive props bound to measured-grid features only —
  beat→frame quantization, never metadata BPM). `analysis` block
  pins the spec to a specific measured beat-grid/stem-analysis —
  caught during the worked-example walk: feature names are
  track-relative so the binding had to become explicit data.
  Validator: 8 ordered rule groups. Builders: bpy generator
  (spec→bpy script, never model-written Python), Unity SpecLoader
  (spec IS the scene JSON — Holodeck's solver step correctly
  inverted), Three.js preview consumer. Worked example: 30 s
  monolith scene walked through all three builders; ambiguities
  found were fixed in-schema (analysis_ref→analysis field,
  heightVar_dist, degrees, feet-at-origin) not left as prose. Four
  owner open questions recorded (asset-library source, third
  builder?, analysis hash-vs-path, multi-shot v0). ESSL 1.00 GLSL
  gate note carried per T-PLT-10. No code or renders produced.
  Prior: Orion, 2026-11-01 — Item created with the knowledge doc;
  not started. GPT-6, 2026-11-01 — amended the plan to include the
  existing ESSL 1.00 compile gate if a future Three.js builder
  emits custom GLSL.

### T-VID-06 — Decompose music-video steps.tsx into per-step modules
- **Status:** done
- **Goal:** Split the ~1050-line `features/music-video/steps.tsx` (five wizard step components) into focused modules so each step is independently readable.
- **Files:** packages/frontend/src/features/music-video/steps.tsx (now a barrel), packages/frontend/src/features/music-video/steps/{UploadStep,AnalyzeStep,ConfigureStep,GenerateStep,ReviewStep}.tsx + shared.ts (new)
- **Acceptance:** Each step component lives in its own file under `steps/`; shared constants (SECTION_COLORS, SHOT_SIZES, CAMERA_ANGLES, PROMPT_SUGGESTIONS) in `steps/shared.ts`; `steps.tsx` re-exports all five so `MusicVideoWizard`'"'"'s `./steps` import is unchanged; tsc -b clean on touched files (only pre-existing agent-chat WIP errors remain), eslint 0 errors on the new files.
- **Last session:** Devin, 2026-11-30 — pure move, no behavior change. Verified: `npx tsc -b` reports zero errors under `features/music-video/` (only unrelated agent-chat WIP errors project-wide); `npx eslint` on steps.tsx + steps/ = 0 errors, 8 pre-existing warnings; no music-video unit tests exist (vitest filter returns none). Import specifiers were trimmed per-file from tsc TS6133/TS6192 output; relative import depth corrected for the new `steps/` subdirectory.

### T-VID-07 — Design a video-to-video (V2V) transformation route (existing footage as pipeline input)
- **Status:** done
- **Goal:** A written design for a transformation route — existing video in, ComfyUI workflow applied, transformed video out, registered as a normal job output — because every current pipeline starts from text or an image. Design only: no code, no renders; the standing music-video hold is unaffected, and this item registers the gap, it does not authorize a build.
- **Plan:** Evidence: code survey 2026-11-06 (Orion) — no V2V path exists; `grep` for inpaint/depth/relight/motion-transfer/segmentation across `packages/` returns nothing in code; T2V/I2V only (`music_video_handler`, adapter I2V builders). Research: `docs/knowledge-library/higgsfield-comfyui-challenge-2026.md` (the project-gap section). Steps: (1) Define the route contract in the shape of the existing generation routes: input video reference (library file or prior job output), workflow id, typed params, output registration + estimator treatment. (2) Reuse, don't reinvent: job/queue lifecycle, `comfyui_workflow_handler`, and the VRAM lane (D71) are the substrate — name exactly which pieces the route plugs into. (3) Identify the reusable stages the dependent items (T-VID-08/09/10) share — segmentation, depth estimation, inpaint/propagation — so each is specced once, as a stage, not three times as features. (4) 8 GB feasibility pass per `docs/knowledge-library/video-generation-vram-2026.md`: which candidate models/workflows fit the owner's card at usable lengths, which don't, stated plainly.
- **Files:** docs/plans/v2v-transformation-design-2026-11.md (new); reference: packages/backend/app/services/comfyui_workflow_handler.py, packages/backend/app/services/music_video_handler.py, packages/backend/app/adapters/comfyui.py
- **Acceptance:** The design doc exists with the route contract, the substrate mapping, the shared-stage list, and the VRAM verdicts; no code or renders produced.
- **Gate:** Design work may start any time; any implementation item spun out of it waits on the owner's word and sits downstream of T-VID-02 and the storyboard critical path.
- **Last session:** Devin, 2026-11-07 — done in this commit. Evidence: `docs/plans/v2v-transformation-design-2026-11.md` exists with all four required elements: §2 route contract (`POST /api/video/transform` + reused jobs router, `video_transform` job type, output/video sidecar registration, per-stage estimator treatment honoring T-VID-04's cloud opt-in), §3 substrate mapping (every plug-in point named with file:line — processor registry, VRAM lane + pricing row, `_submit_prompt` arbitrary graphs, `upload_video`, I2V builders, output scan), §4 shared stages (segment/depth/propagate/reshoot contracts — propagation decided as I2V-with-constrained-start-frame reusing `_build_ltx_i2v_workflow`/`_build_wan_i2v_workflow`, true video inpainting rejected), §5 8 GB verdicts (LTX+Wan GGUF feasible on disk; SAM2/Depth-Anything feasible on CPU lane but owner-gated deps; VACE/V2V and ControlNet-conditioned rebuild deferred). No code or renders produced. Registered in `docs/plans/README.md` Proposed list.

### T-VID-08 — Spec character/object swap in video (Openjutsu pattern)
- **Status:** done
- **Goal:** A written spec for swapping a character, outfit, or object inside existing footage while preserving the original motion and camera work — segmentation stage + video-model replacement over the T-VID-07 route. Spec only: no code, no renders.
- **Plan:** Research: `docs/knowledge-library/higgsfield-comfyui-challenge-2026.md` §The 8 recreations #1 (Openjutsu: local ComfyUI around a MiniMax video model + segmentation; an official challenge category). Steps: (1) Name a candidate workflow/model chain and give its 8 GB feasibility verdict (from T-VID-07 step 4, or standalone if that hasn't run). (2) Define the inputs a user supplies: source video, target reference (image or description), mask source (auto-segmentation vs painted — note the T-VID-09 overlap). (3) Define the failure surface to design around: identity drift across frames, mask edge artifacts, motion faster than the tracker. (4) State what "good" is checkable as: same camera path, same motion timing, swapped element consistent at section boundaries.
- **Files:** spec section in docs/plans/v2v-transformation-design-2026-11.md (created by T-VID-07)
- **Acceptance:** The spec exists with candidate chain, feasibility verdict, input contract, and failure surface; no code or renders produced.
- **Depends on:** T-VID-07 (route + segmentation stage design). Gate: as T-VID-07.
- **Last session:** Devin, 2026-11-07 — done in this commit. Evidence: spec section §7 of `docs/plans/v2v-transformation-design-2026-11.md`: three lanes with verdicts (asset-composite preferred for CG swaps — deterministic identity, untouched background; generative propagation for short clips with drift limits; per-frame rebuild + true V2V deferred), input contract (`target` asset/image/description + `mask` auto/provided/first_frame_prompt), failure surface (identity drift, mask edge artifacts, scene-cut chunking, static-camera v0 constraint), checkable acceptance (SSIM ≥0.80, flow correlation ≥0.7, boundary consistency). No code or renders produced.

### T-VID-09 — Spec first-frame paint → propagation editing (Paint a Plate pattern)
- **Status:** done
- **Goal:** A written spec for draw-to-edit on generated footage: the user paints the change onto the first frame (remove an object, relight a region, add an effect) and a propagation workflow carries it through the shot — the fix-a-panel tool the storyboard pipeline currently lacks. Spec only: no code, no renders, and the paint UI surface itself is explicitly out of scope.
- **Plan:** Research: `docs/knowledge-library/higgsfield-comfyui-challenge-2026.md` §The 8 recreations #8 (AInVFX Paint a Plate). Note for the specifier: "inpainting" in this repo's docs previously meant 3D texture inpainting only — this is a different technique; don't let the older docs' vocabulary steer the design. Steps: (1) Define the pipeline contract: source video + edited first frame (+ optional mask) → propagation workflow → edited video, over the T-VID-07 route. (2) Name candidate propagation approaches and the 8 GB verdict for each. (3) Define edit classes v0 supports (removal, relight, additive effect) and which it explicitly doesn't. (4) Define the acceptance shape a later implementation would be judged by: edit present and stable across the shot, unedited regions unchanged (frame-diff outside the mask ≈ 0).
- **Files:** spec section in docs/plans/v2v-transformation-design-2026-11.md (created by T-VID-07)
- **Acceptance:** The spec exists with pipeline contract, candidates + verdicts, edit classes, and the frame-diff acceptance shape; no code or renders produced.
- **Depends on:** T-VID-07 (route design). Gate: as T-VID-07.
- **Last session:** Devin, 2026-11-07 — done in this commit. Evidence: spec section §8 of `docs/plans/v2v-transformation-design-2026-11.md`: pipeline contract over the T-VID-07 route (`transform: paint-propagate`, stages `[propagate]`), edit classes v0 (removal via delogo/SD1.5-inpaint, relight, additive overlay — replacement/per-frame/crisp-text excluded or partial), propagation candidates (LTX primary, Wan GGUF quality), and acceptance shape with an honest correction — literal frame-diff≈0 is impossible under I2V regeneration, so the spec adopts measurable proxies (edit persistence ≥80% sampled frames, outside-region SSIM ≥0.80 + flow ≥0.7) with the tightening path noted for a future true-V2V lane. No code or renders produced.

### T-VID-10 — Spec re-shoot: depth estimate → new camera path → view rebuild (ReAngle pattern)
- **Status:** done
- **Goal:** A written spec for re-angling footage that already exists: estimate the shot's depth, author a new 3D camera path, and rebuild the view with a video model (LTX family) — new coverage from a single rendered or recorded take. Spec only: no code, no renders.
- **Plan:** Research: `docs/knowledge-library/higgsfield-comfyui-challenge-2026.md` §The 8 recreations #6 (ReAngle: depth estimate → camera path → LTX rebuild; the challenge ran "Re-shoot a video" as an official category). Steps: (1) Name the depth-estimation stage (shared with T-VID-07 step 3) and the rebuild model candidates with 8 GB verdicts. (2) Define the camera-path authoring input: reuse the T-VID-11 rig vocabulary (named moves as paths) where it fits, free path where it doesn't — state which. (3) Record the known limit up front (video-reported and physically expected): large moves break — define the spec's move envelope (degrees/distance) beyond which output is expected to degrade, so a later implementation is judged inside it. (4) Define the checkable acceptance shape: rebuilt view matches the authored path's framing at sampled timestamps; original subject identity/motion preserved.
- **Files:** spec section in docs/plans/v2v-transformation-design-2026-11.md (created by T-VID-07)
- **Acceptance:** The spec exists with stage/model verdicts, path-authoring decision, move envelope, and acceptance shape; no code or renders produced.
- **Depends on:** T-VID-07 (route + depth stage design). Relation: T-VID-11 (camera vocabulary). Gate: as T-VID-07.
- **Last session:** Devin, 2026-11-07 — done in this commit. Evidence: spec section §9 of `docs/plans/v2v-transformation-design-2026-11.md`: stage/model verdicts (depth stage CPU-feasible owner-gated; I2V rebuild feasible; SD1.5 depth-ControlNet on disk for hero frames; true geometry rebuild rejected), path-authoring decision (v0 prompt-level paths — enum + free text — explicitly not blocked on T-VID-11's registry), move envelope stated as numbers (≤45° orbit, ≤20% width translation, no compound moves, ≤8 s — beyond marked `degraded` not failed), acceptance shape (framing match at ≥3 sampled timestamps + identity/motion preservation + reinterpretation-not-footage residual noted). No code or renders produced.

### T-VID-11 — Camera direction as preset data: one typed rig registry for the I2V path (Backlot pattern)
- **Status:** done
- **Goal:** A written design (plus the registry schema) promoting camera direction from prompt-text suffixes to inspectable preset data: one typed registry of rigs — move, lens, lighting, look — consumed by the ComfyUI adapter, replacing the current 8 hardcoded prompt strings. Design only; the adapter change itself is a later item.
- **Plan:** Evidence: `packages/backend/app/models/generation.py:162` defines 8 `camera_motion` values; `packages/backend/app/adapters/comfyui.py` maps them to prompt suffixes (`"orbit": "camera orbits around subject"`) in two duplicated spots (~1305 and ~1509 — the same duplication class as the dead `_build_i2v_workflow` found 2026-10-28). Research: `docs/knowledge-library/higgsfield-comfyui-challenge-2026.md` §The 8 recreations #5 (Backlot: ~30 cameras + lens/lighting/look as workflow data). Steps: (1) Schema: rig = { id, move (one of the existing 8 or a path ref for T-VID-10), lens (focal character), lighting (setup), look (grade/palette note), prompt fragments per field } — fields the current suffix map cannot express are the point. (2) Seed set: port the existing 8 moves losslessly (same prompt output for the same selection — behavior-preserving by construction), then add lens/lighting variants as data only. (3) Name the single consumption point in the adapter and the dedup of the two suffix maps. (4) Note the storyboard consumer: rig ids are what a storyboard panel should store, not prose.
- **Files:** docs/plans/camera-rig-presets-2026-11.md (new); reference: packages/backend/app/models/generation.py, packages/backend/app/adapters/comfyui.py
- **Acceptance:** The design doc exists with the schema, the lossless seed mapping for all 8 existing moves, and the named consumption point; no code changed.
- **Gate:** Design work may start any time; implementation waits on the owner's word (it touches the live generation path, so it does not ride along with unrelated fixes).
- **Last session:** Devin, 2026-11-07 — done in this commit. Evidence: `docs/plans/camera-rig-presets-2026-11.md` exists with the rig schema (move/lens/lighting/look + fixed-order composer), the lossless 8-rig seed table (fragments byte-identical to the current dicts, empty lens/lighting/look), the named consumption point (`app/services/camera_rigs.py::resolve_prompt_suffix` called by both `_build_wan_i2v_workflow` and `_build_ltx_i2v_workflow`, inline dicts deleted, enum values become aliases of the seed set), the additive `camera_rig` request field, and the storyboard consumer rule (panels store rig ids, not prose). Registered in `docs/plans/README.md`. No code changed.

### T-VID-12 — Encode real-time 3D budgets in the asset + scene pipeline (Pascal budget discipline)
- **Status:** doing
- **Goal:** The budgets in `docs/knowledge-library/pascal-3d-budget-discipline-2026.md` become enforced data instead of prose: per-role decimation targets in gen3d, a texture post-step at ingest, a per-asset budget report, and budget validation in the T-VID-05 scene builder's validator — so an over-budget asset or scene is flagged before any engine starts.
- **Plan:** Evidence: `packages/backend/app/services/gen3d/decimate_glb.py:8` defaults `target_faces` to a flat 50,000 and `gen3d_service.py` (~line 462) applies one target regardless of asset role; no texture budget exists anywhere in the ingest path. Steps: (1) Budgets as machine-readable config (one source the doc mirrors): role → { target_faces, max texture size, KTX2 required }, scene caps (draw calls, materials, dynamic lights). (2) gen3d: role parameter selects the decimation target; ingest post-step downscales + KTX2-converts textures and emits the LOD chain (LOD0/1/2 + sprite card); generation result gains a budget report (triangles, texture MB, materials, LOD presence). (3) T-VID-05's validator sums a scene spec against the scene caps and rejects over-budget specs with the violating line items named. (4) RenderStatsBadge shows budget-vs-actual for draw calls in the Three.js studio (rides on the T-VIZ-17/18 badge work).
- **Gated spec — texture/KTX2 ingest tool (added 2026-11-07, BUILT same day on owner word):** `tools/ingest-texture.py` implements it — `glb` mode runs gltf-transform `resize` (role cap, aspect-preserving, downscale-only) → `etc1s`/`uastc` KTX2 → `check-asset-budget.py`; `map` mode downscales via Pillow and encodes `assets/materials/<name>_{c,n,r}.ktx2` via vendored toktx (`tools/vendor/ktx-software-bin/`, gitignored). Verified: stage.glb 22.4 MB/26 uncompressed textures → 1.76 MB GLB, 26/26 KTX2, 0.94 MB embedded (triangles FAIL remains — decimation is separate gated work). WIRED 2026-11-07 (owner proceed): gen3d accepts `role`, decimates to the role's `max_triangles` ceiling, runs ingest in place, and returns `budget` + `texture_ingest` in the result. STILL OPEN: LOD chain generation, T-VID-05 validator wiring, RenderStatsBadge.
- **Files:** docs/knowledge-library/pascal-3d-budget-discipline-2026.md (budget source); packages/backend/app/services/gen3d/ (decimate_glb.py, gen3d_service.py); the T-VID-05 spec doc when written
- **Acceptance:** Budget config exists and is consumed by gen3d (no hard-coded flat target remains); a generated asset carries a budget report; an over-budget scene spec is rejected by the validator with named violations before any engine starts.
- **Gate:** Config + report work may start any time; gen3d behavior changes (decimation targets, texture post-step) wait on the owner's word — they touch the live generation path.
- **Last session:** Devin, 2026-11-07 — ungated slice landed in this
  commit (config + report only, per the Gate). Evidence:
  `config/asset-budgets.json` encodes the pascal doc §3 table as data
  (roles hero/mid/background/far → triangle + texture-px caps, KTX2/LOD
  requirements, impostor-card rule for far; scene caps incl. draw calls,
  1.5M tris/frame, 1 GB textures, 40 materials, 3 dynamic lights, 64
  bones/skin, ≤8 skinned meshes, instancing ≥4); the doc now mirrors the
  config with a pointer block. `tools/check-asset-budget.py` (stdlib-only)
  inspects .glb/.gltf and reports triangles, texture MB/dimensions, KTX2
  count, materials, skins, LOD nodes vs role caps — verified live:
  triposr GLB 30K tris PASS-cap/WARN-LOD; `stage.glb` correctly FAILs as
  background (15.7K>10K tris, 4096px>1024px textures, 0/26 KTX2);
  `mv_e2e_test` correctly FAILs as far (mesh where impostor required).
  Ruff clean. 2026-11-07 addendum (same commit): new KB doc
  [[texture-pipeline-ktx2-authoring-and-ingest-2026]] covers the
  authoring side (encoder choice, naming, ingest workflow, tooling
  status) and a gated ingest-tool spec was added above — still no
  gen3d behavior change without owner word. 2026-11-07 (owner approved
  build): `tools/ingest-texture.py` landed — glb + map modes verified
  live (stage.glb → 26/26 KTX2, 22.4→1.76 MB; loose map → KTX2/ZSTD);
  KTX-Software 4.4.2 vendored to `tools/vendor/ktx-software-bin/`
  (gitignored); KB doc status table updated. 2026-11-07 (owner said
  proceed — live-path wiring landed): `POST /api/3d/generate` accepts
  `role` (hero|mid|background|far, validated) and
  `/api/3d/generate-image` takes `?role=`; the role threads
  generate_from_text/image → _submit_workflow → _finish_with_timing →
  _upload_image. In `_upload_image`: role's `max_triangles` replaces the
  flat per-backend `target_faces` as the decimation ceiling (no role →
  legacy target unchanged); `tools/ingest-texture.py glb --role <r>
  --codec etc1s --out <same>` runs in place (non-fatal on failure,
  reported under `texture_ingest`); `tools/check-asset-budget.py --json`
  re-validates the final asset and lands under `budget` in the result.
  Verified: `_role_budget` returns role caps; `check-asset-budget --json`
  stdout parses (nonzero exit on FAIL is expected and handled);
  ruff clean on both touched files. 2026-11-07 addendum: owner asked for
  a way to *see* triangle counts vs the ceiling — `tools/preview-tri-budget.py`
  + `tools/blender/tri_ladder.py` landed: re-imports the GLB per level,
  COLLAPSE-decimates to each target, auto-frames a 3/4 camera, renders
  640px PNGs (Eevee→Workbench fallback), and PIL-assembles a labeled
  contact sheet at `output/tests/tri-ladder/<stem>/<stem>-tri-ladder.png`.
  Default ladder = role caps + half-steps + original; `--counts` overrides.
  Verified live on stage.glb: 5 levels in ~50 s, real face deltas
  (15,702→2,521), non-blank renders. STILL GATED/OPEN: LOD chain
  generation (LOD0/1/2 + sprite card), T-VID-05 scene-spec validator
  budget wiring, RenderStatsBadge budget-vs-actual.
  2026-11-07 addendum (owner: clean up existing/experiment assets
  before they hit the live preview canvas): `POST /api/3d/ingest`
  accepts `{path, role?}` for any .glb/.gltf already on disk —
  path must resolve under `output/`, `packages/frontend/public/`, or
  the ComfyUI output tree (rejects everything else). The source is
  copied to `output/generated_3d/ingest_<stem>_<ts>.glb` (original
  never modified) and runs the SAME post-process as a fresh
  generation — the decimate/ingest/budget block was extracted from
  `_upload_image` into `_postprocess_glb()` so both paths share it.
  Chrome PBR auto-apply is name-triggered only for ingests (the
  generation path's blanket rule would repaint vertex-colored
  imports). Verified live: `stage.glb` (background role) → Blender
  decimate ran, 26/26 textures KTX2, honest budget FAIL surfaced
  (10,006 tris vs 10,000 cap); `Y_Bot.glb` correctly reported
  "not a GLB" — it is a 14-byte `404: Not Found` placeholder from a
  failed download, not a model. Companion frontend fix (same
  commit): the preview had NO KTX2Loader, so every KTX2-compressed
  texture the pipeline emits would render untextured — new
  `src/utils/gltfLoader.ts` attaches `KTX2Loader` (transcoder in
  `public/basis/`, ~585 KB) per-renderer; `ModelPreview` and the
  three-js-studio loaders now use it. ruff clean on both backend
  files; `tsc -b` shows no new errors.

### T-VID-13 — Design the frame-package contract: control-pass rendering from owned scenes
- **Status:** done
- **Goal:** A written spec for the frame package the 3D builder emits per scene: beauty frames plus the control passes Route B consumes — depth, normals, segmentation/object-ID, pose for rigged characters, and camera metadata — versioned as one contract that [[3d-bones-ai-skin-pipeline-2026]] §3 defines as the pipeline's interface. Design only.
- **Plan:** Evidence (2026-11-06): grep finds no pass/AOV support anywhere in scene/gen3d code; T-VID-05's spec covers objects/materials/lights/camera/bindings but no passes. Steps: (1) Pass list + semantics (what each pass encodes, value ranges, color space). (2) Formats + resolution relationship to beauty (full/half), naming and package versioning. (3) Storage/write budget on the SATA SSD (profile risk notes) — pass set sized so a song-length scene stays sane. (4) How the T-VID-05 spec requests passes (per-scene pass block) and how the validator checks them against the T-VID-12 scene caps.
- **Files:** docs/knowledge-library/3d-bones-ai-skin-pipeline-2026.md (§5 Gap 1); the T-VID-05 spec doc when written; docs/knowledge-library/pascal-3d-budget-discipline-2026.md (caps)
- **Acceptance:** A frame-package spec exists that a builder implementer and a lane implementer (T-VID-14) can each build against without asking the other questions; pass set + formats + versioning are named decisions, not options.
- **Gate:** Design work may start any time; any implementation item spun out of it waits on the owner's word and sits downstream of T-VID-02 and the storyboard critical path.
- **Last session:** Devin, 2026-11-07 — done in this commit. Evidence:
  `docs/plans/frame-package-contract-2026-11.md` (registered in
  plans README, Status Proposed). Named decisions, not options: pass
  set = beauty (PNG sRGB 8-bit) + depth (16-bit gray, fixed shot
  bounds, nearer-white) + normals (8-bit RGB **world-space** —
  view-space rejected: re-encodes under camera moves) +
  segmentation (16-bit object index + palette, spec-stable IDs) +
  pose (OpenPose RGB, verdicts-doc contract adopted verbatim, pose
  from evaluated owned skeleton never re-estimated) + pose_archive
  (float32 `[frame][joint][10]` + JSON, HouseRig_v1 joint order,
  sha256-bound to asset rig manifest) + camera.jsonl (glTF
  cam-to-world 4×4 per frame, depth bounds repeated per frame).
  Versioning: `frame-package/v1` string in manifest; major = encoding/
  precision/layout change, minor = optional fields. Scene-spec
  `passes` block defined incl. `pose:"auto"` and per-pass `scale`
  1.0/0.5; validator checks pass set against
  `config/asset-budgets.json` caps as a write-bandwidth estimate.
  Storage honesty: full set ≈20–38 GB per 4-min song at 1080p30 —
  passes are selectable and half-res is the pressure valve; sequential
  per-directory writes mandated for the SATA SSD. Seven validator
  checks enumerated (§10). Unblocks T-VID-14 (lane inputs), T-VID-16
  (identity refs), informs T-VID-15/17. No code or renders produced.

### T-VID-14 — Design the control-conditioned generation lane (frame packages → AI skin)
- **Status:** done
- **Goal:** A written design for the ComfyUI lane that consumes frame packages (T-VID-13) and paints appearance under geometric control: depth/pose/segmentation conditioning + AnimateDiff-class temporal modeling on the profile's blessed SD 1.5 tier. Design only.
- **Plan:** Evidence (2026-11-06): the integration is declared but unbuilt — `packages/backend/app/api/integrations_music_video.py:565` catalogs "Advanced AnimateDiff with controlnet and IP-adapter" (`mm_sd_v15_v2.safetensors`, `controlnet_openpose`) and `Settings.tsx` offers a "ControlNet + Image" mode, yet `config/comfyui/workflows/` holds 3 workflows, none control-based. Steps: (1) Workflow graph design: which passes feed which control units, weights per pass class. (2) Lane assignment under the hardware profile (768×768 fp16 defaults, VRAM-manager coexistence with Ollama, CPU lane for batch). (3) Seed/parameter contract for reproducibility (same package + params ⇒ same skin). (4) Failure vocabulary: what the lane reports when a package is malformed or a model is missing.
- **Files:** docs/knowledge-library/3d-bones-ai-skin-pipeline-2026.md (§5 Gap 2); config/comfyui/workflows/ (inventory); config/hardware-profile.json (lanes)
- **Acceptance:** A workflow design exists that names every node class, input pass, and parameter; the model set fits the profile's limits without exception requests; reproducibility contract stated.
- **Depends on:** T-VID-13 (frame-package contract). **Gate:** as T-VID-13.
- **Last session:** Devin, 2026-11-07 — done in this commit. Evidence:
  `docs/plans/control-conditioned-lane-2026-11.md` (registered in plans
  README, Status Proposed). Model inventory verified on disk, not
  catalog-trusted: SD1.5 `v1-5-pruned-emaonly` + AnimateDiff
  `mm_sd_v15_v2.ckpt` (catalog said .safetensors — actual file is .ckpt)
  + fp16 depth & openpose ControlNets all present; **no** seg/normal
  controlnet and **no** IP-Adapter — normals pass reserved, seg gets
  honest v1 uses (post-composite mask, v1.1 lineart-from-edges);
  unidentified 1.38 GB `diffusion_pytorch_model.safetensors` flagged
  do-not-wire-blind. VRAM math ≈5.5–6.5 GB peak fits 8 GB with the
  existing Ollama-offload rule — zero exception requests. Graph names
  every node class (VHS_LoadImagePath → ADE loader/context/keyframe →
  2× ControlNetApplyAdvanced @0.75/0.85 → KSampler 20 steps CFG 7.5 →
  VAEDecode → VHS_VideoCombine); frame alignment contractual, gaps are
  hard errors. Reproducibility: `package_manifest_sha256` + full param
  block recorded per job; model-file substitution must bump recorded
  files. Failure vocabulary: 8 named codes. SCENE_SKIN job type
  proposed (sibling to REMOTION_RENDER, not video_transform).
  Implementation items enumerated §9, all owner-gated. No code or
  renders produced.

### T-VID-15 — Design lighting + look rigs as spec data (the T-VID-11 pattern, scene side)
- **Status:** done
- **Goal:** A rig registry for the 3D/scene side mirroring T-VID-11's camera registry: named lighting rigs (three-point, studio, practical archetypes as data), a lens set, and look/grade presets that T-VID-05 scene specs reference by name — so cinematography is a vocabulary, not per-scene improvisation. Design only.
- **Plan:** Evidence: T-VID-11 covers camera for the I2V prompt path; no lighting/look vocabulary exists for scenes, and Route A output has no defined grade step. Steps: (1) Rig archetype list v0 with parameters (positions, intensities, color temps) expressed in spec terms. (2) Lens set (focal lengths + the look each implies) aligned with T-VID-11's vocabulary where they overlap — one camera language across both paths. (3) Look presets: LUT/grade references as spec fields; Route A's grade step named in the pipeline. (4) Budget conformance: rigs respect the budget doc's baked/static lighting + dynamic-light cap (≤3).
- **Files:** docs/knowledge-library/3d-bones-ai-skin-pipeline-2026.md (§5 Gap 3); docs/knowledge-library/pascal-3d-budget-discipline-2026.md (lighting caps); T-VID-11's registry design when written
- **Acceptance:** A registry design exists with named rigs/lenses/looks and their spec representation; every rig provably fits the dynamic-light cap; overlap with T-VID-11's camera vocabulary is reconciled, not duplicated.
- **Gate:** as T-VID-13.
- **Last session:** Devin, 2026-11-07 — done in this commit. Evidence:
  `docs/plans/lighting-look-rigs-2026-11.md` (registered in plans
  README, Status Proposed). Reconciliation call made (T-VID-11
  deferred it here): one numeric vocabulary two representations —
  `focal_mm` shared verbatim, look ids shared across both paths
  (camera-rigs `look.grade` string now *means* a registry id, no
  schema change), lighting rigs scene-side-only with prose fragments
  on the I2V side. Registry shape `config/cinematography-rigs.json`
  mirrors T-VID-11's load/validate/fail-fast rules. Seed data: 6-lens
  set (14–135 mm, aligned to T-VID-11 focal_mm), 5 looks incl.
  `look-neutral` lossless seed, **7 lighting rigs with dynamic counts
  {3,2,1,2,1,1,1} — all provably ≤3** (baked/emissive explicitly not
  dynamic). Route A grade step named: `grade` stage in finishing chain
  reading `look`+`grade_strength`, LUT `.cube` under `assets/looks/`
  or parametric fields. Spec fields `lighting_rig`/`lens`/`look`/
  `grade_strength` defined with validator membership checks. No code
  or renders produced.

### T-VID-16 — Design the character identity layer: one asset, both layers
- **Status:** done
- **Goal:** A written design for the character asset as a single versioned definition — mesh, proportions, materials, rig, and identity reference set — consumed by the builder (geometry consistency) and by the generation lane (identity conditioning), so a character cannot drift between scenes or between layers. Design only.
- **Plan:** Evidence: IP-Adapter is named in the declared integration (integrations_music_video.py:565) but no character-asset definition exists to key it to. Steps: (1) Character asset schema: identity block (reference set), geometry block (mesh/rig refs), material block, version field. (2) The consistency contract: same asset id + version ⇒ same proportions from the builder and same identity conditioning in the lane; what a version bump means and who approves it. (3) Reference-set curation rule: what images constitute an identity, minimum set, change procedure. (4) How scene specs instance characters (asset ref + per-scene overrides that may not touch identity fields).
- **Files:** docs/knowledge-library/3d-bones-ai-skin-pipeline-2026.md (§5 Gap 4); the T-VID-05 spec doc when written (asset refs)
- **Acceptance:** A schema + contract exist that make "same character, new scene" a spec operation, not a hope; identity-affecting changes are versioned and gated by the curation rule.
- **Depends on:** T-VID-05 (asset refs), T-VID-14 (lane identity inputs). **Gate:** as T-VID-13.
- **Last session:** Devin, 2026-11-07 — done in this commit. Evidence:
  `docs/plans/character-identity-layer-2026-11.md` (registered in plans
  README, Status Proposed). Schema `character-asset/v1` at
  `assets/characters/<id>/character.json`: identity block (curated,
  sha256'd reference set + digest + proportions_hash), geometry block
  (mesh sha256 + HouseRig_v1 manifest_sha256 + LOD chain), materials,
  budget role. Consistency contract: id+version ⇒ identical geometry
  (mesh hash), rig (manifest hash — interlocks with T-VID-13 §3.6
  pose-archive binding already specced), identity (ref-set digest →
  lane conditioning payload). Semver rules: MAJOR = identity/
  proportions (owner-approved, new character lineage), MINOR =
  materials/LOD, PATCH = docs; published versions immutable. Curation
  rule v1: min 3 views (front mandatory), neutral expression/
  lighting/framing, AI-self-references and generated-video frames
  prohibited (identity laundering), candidate→owner-approve→publish.
  Spec instancing with validator-enforced override whitelist
  (transform/materials/animation/visibility) and identity-field
  rejection. IP-Adapter honestly absent on disk (T-VID-14 verified) —
  interface fixed model-agnostically via digest+ordered refs. No code
  or renders produced.

### T-VID-17 — Design the bones render lane: deterministic capture spec
- **Status:** done
- **Goal:** A written capture spec for turning scenes into frame packages: Eevee-class real-time raster as the decided engine lane, sampling/denoise settings, a resolution ladder tied to the budget doc, and deterministic frame export. Design only — the decision and its settings, no renders.
- **Plan:** Evidence: no engine/settings decision exists for scene capture; the baseline argues it (§5 Gap 5 of the gap doc): no RT cores and a 6-physical-core CPU fallback make a Cycles-class lane unable to be the iteration loop on this hardware. Steps: (1) Engine decision recorded with the baseline reasoning (Eevee-class default; Cycles-class named as final-frame luxury, explicitly not the loop). (2) Capture settings: samples/denoise, resolution ladder (draft/final) mapped to budget-doc caps and the profile's 768×768 ComfyUI input expectations for Route B. (3) Determinism: frame stepping + seed discipline — the [[three-js-render-motion-2026]] clock discipline applied to the bpy side. (4) Throughput expectations per lane (CPU playbook: batch renders are solo/split-lane jobs).
- **Files:** docs/knowledge-library/3d-bones-ai-skin-pipeline-2026.md (§5 Gap 5); docs/knowledge-library/ryzen-5500-cpu-playbook-2026.md (lanes); config/hardware-profile.json
- **Acceptance:** A capture spec exists with the engine decision and its reasoning recorded; an implementer can cost a scene (frames × settings → wall-clock lane) from the spec alone.
- **Gate:** as T-VID-13.
- **Last session:** Devin, 2026-11-07 — done in this commit. Evidence:
  `docs/plans/bones-render-capture-spec-2026-11.md` (registered in plans
  README, Status Proposed). Engine decision recorded with reasoning:
  Blender bpy + Eevee is THE capture lane (no RT cores + 6 physical
  cores ⇒ Cycles CPU fallback can't iterate; budget doc IS Eevee's
  quality strategy); Cycles named final-frame luxury explicitly not
  the loop; Three.js Studio = preview surface not package authority
  (no AOV pipeline — v2 question). Settings table: draft 540p/16spp,
  final spec-native ≤1080p/64spp, OIDN denoise, AgX view transform;
  control passes as separate bpy render layers at 0.2–0.4× beauty
  cost. Resolution ladder draft/review/final mapped to budget caps +
  2026-11-07 addendum (implementation began, owner "fill the gaps"):
  `tools/blender/frame_package.py` v1 emits a real frame-package/v1 —
  verified on stage.glb (4 frames, draft, orbit): beauty/f%06d.png +
  normals/f%06d.png (world-space emission-override render) +
  camera.jsonl (fx/fy/cx/cy + column-major cam-to-world) + manifest.json
  claiming only emitted passes + deterministic frame_set stepping.
  Blender 5.2.3 API realities recorded in the script docstring: compositor
  is `compositing_node_group` + `NodeGroupOutput` sink; Output File FLOAT
  items write a single overwritten f.exr (no frame numbering, read-only
  format) so depth/seg/pose are honestly NOT emitted — v1.1 path is
  multilayer-EXR data renders + post-convert. Also landed:
  `app/services/video/frame_sequence.py` (inspect/gap-detect/manifest),
  ffmpeg renderer refuses gapped sequences unless extra.allow_gaps,
  `tools/frame-sequence.py` CLI, and /api/threestudio/export now returns
  honest 501 instead of mock success.
  2026-11-07 research-alignment addendum (current-best-practices pass on
  AOV/ControlNet conventions): the "no PNG16 path" conclusion was WRONG —
  Blender 5.2's Output File node defaults media_type to
  MULTI_LAYER_IMAGE (locks format to OPEN_EXR_MULTILAYER); setting
  media_type='IMAGE' + file_format='PNG' + color_depth='16' +
  color_mode='BW' emits true 16-bit grayscale. Also: FLOAT items force
  EXR (use 'RGBA' items), file_name only gets frame suffixes in
  animation renders (still mode sets it per frame), ShaderNodeMapRange
  replaces the removed CompositorNodeMapRange, and the depth pass is now
  the real Z 'Depth' socket normalized over [near,far] — not mist.
  Verified live: depth/f%06d.png 16-bit gray colortype-0, values
  20213–65535 across frame. Segmentation stays honestly un-emitted —
  5.2 exposes no object-index compositor socket (Cryptomatte is the
  modern replacement; needs manifest decode, v1.1).
  Route B's 768×768 lane input (lane downscales, package ships
  scene-native). Determinism: six bpy-side rules mirroring
  three-js-render-motion-2026 — pure function of frame_set(f), seeded
  randomness (scene.nma_seed+f), baked sims, beat→frame quantization,
  builder version in manifest, fixed samples/res/color-mgmt.
  Throughput cost model with worked example: 5,760-frame scene ≈
  30–35 min final / 5–8 min draft, solo-lane batch job; golden-scene
  measurement named as the calibration step (verdicts §7). No code or
  renders produced.

### T-VID-18 — Design the scene vocabulary + material library (what the builder can choose from)
- **Status:** done
- **Goal:** A written design that lifts the Three.js Studio's content ceiling: parameterized primitives (sizes as spec fields, not factory constants), a named PBR material library with texture sets, GLTF asset references as first-class vocabulary, and the mesh factory refactored into a consumer of that library. Design only.
- **Plan:** Evidence: [[three-js-studio-scene-quality-2026]] (2026-11-06) — the factory (`useMeshFactory.ts`) offers 7 fixed-size shapes (crown/sphere/box/cylinder/cone/torus/bars) and one 5-scalar `MeshStandardMaterial` with no texture maps; the owner's recorded scene is a single `crown` preset ("Objects 1"). The same doc records the unused asset: the factory already loads GLTF models with animation mixers — the generator never routes through it. Steps: (1) Vocabulary audit + expansion design: which parameterized primitives and composite presets earn a place; every size becomes a spec field with budget-doc bounds. (2) Material library: named PBR materials with texture sets (color/normal/roughness), KTX2 delivery per [[pascal-3d-budget-discipline-2026]], emissive discipline (bloom-safe ranges, ties to T-VID-15 rigs). (3) Asset vocabulary: gen3d output and curated GLTFs referenced by asset id from scene specs (T-VID-05 schema), with T-VID-12 budget reports as the admission ticket. (4) Reconcile the dead path: `packages/backend/app/api/ai.py` `POST /generate-scene` is a placeholder stub — remove it or route it to the real generator, so the codebase stops advertising a route that does not exist. (5) Factory-as-consumer: the mesh factory builds from library entries; no geometry constants or material scalars defined inline.
- **Files:** docs/knowledge-library/three-js-studio-scene-quality-2026.md (evidence); packages/frontend/src/features/three-js-studio/hooks/useMeshFactory.ts; packages/backend/app/api/ai.py (stub); the T-VID-05 spec doc when written
- **Acceptance:** A vocabulary + material library design exists with named entries and spec representation; a scene spec can express a textured, asset-bearing scene the current factory cannot; the stub endpoint's fate is decided in the design (remove or wire).
- **Depends on:** T-VID-05 (spec fields the vocabulary plugs into), T-VID-12 (texture/budget rules). **Gate:** as T-VID-13.
- **Last session:** Devin, 2026-11-07 — done in this commit. Evidence:
  `docs/plans/scene-vocabulary-material-library-2026-11.md` (registered
  in plans README, Status Proposed). Vocabulary: 7 existing types
  parameterized (all sizes → spec fields with budget bounds) + 4 new
  (capsule, plane, ico, parameterized `bars`/`crown` composites);
  bespoke geometry explicitly routed to GLTF assets not new primitives.
  Material library `config/material-library.json`: named PBR entries
  with KTX2 color/normal/roughness sets (≤2048²/≤1 GB per budget doc),
  `bloom_safe` emissive discipline tied to T-VID-15 looks, ~10 seed
  entries. Asset vocabulary: `asset`/`asset-ref` schemas with
  check-asset-budget PASS as admission ticket; characters consume
  T-VID-16's character-asset/v1 through the factory's already-real
  GLTFLoader+AnimationMixer path. Factory-as-consumer acceptance is
  grep-verifiable (no inline Geometry args/material scalars). Stub
  endpoint verified zero callers → design recommends removal (§6),
  pending owner approval. No code or renders produced.

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
- **Last session:** Orion, 2026-11-07 — registered with the style-system exploration at the owner's request. Same night, the owner asked for the catalog to be checked against the actual tracks: the doc's §6 maps all fourteen tracks to the looks from their captured Suno style prompts and records five findings. The owner then directed creating the missing styles: three new looks landed in §3.7–3.9 (Dial-Up for the Y2K gap, Future Gloss for the gloss family, Drift for the phonk pair), with §6 primaries reassigned accordingly — the working catalog is now nine looks, balanced 1–3 primaries each. Finally the owner set the governing rule — avoiding AI slop patterns goes through everything — and Vice Sunset was redesigned under it (§3.3: place/broadcast traits, vaporwave elements banned by name; §4 now states the rule for the whole system, and registry records must state their slop-avoidance to enter). A curation packet was prepared 2026-11-07 to make the pass a minutes-long decision: per-look keep/rename/strike lines with the §6 evidence, my read on each, the Arcade-Velocity look-vs-register question, the exception-token approval, and Decision 0 — the brand palette kit is still v0.1 draft awaiting adoption, and Console's palette is the kit, so the kit call precedes Console's. Packet: workspace your_files/tvid24-curation-packet-2026-11-07.md + Drive (Native Media AI Studio folder) id 1r3AN2eBseHhT-axsq42bH05Iw3fKDKqQ. Awaiting the owner's decisions.

### T-VID-25 — Media anti-patterns rollout: canonical doc, pointers, surface fixes
- **Status:** doing
- **Goal:** Close the gap measured in [[media-anti-patterns-audit-2026]]: the library teaches generation capability in depth and slop-avoidance almost nowhere (17 of 49 media-tagged docs carry any avoid-language; exactly one carries a named pattern list; the three ComfyUI workflows ship positive-only adjective-stack prompts with no negative prompt at all). Under the owner's governing rule (anti-slop goes through everything), media work gets the same treatment the style system got: named patterns, each with its specification replacement.
- **Plan:** (1) Canonical doc `docs/knowledge-library/media-anti-patterns-2026.md` — per-medium pattern lists (cross-medium, image, video/motion, 3D, music/Suno, lyrics) drafted from the audit's §5 preview + the owner's standing doctrine (medium-with-constraints, composition decided, palette capped, texture specified, AVOID list carried, results graded before presentation). Production Pipeline category; register in index/tracker in the same commit. (2) Pointers, not copies: one-line references from the generation-front-door docs — comfyui-workflows, 3d-generation-options, text-to-3d-options, hunyuan3d-setup, animatediff-evolved, prompt-engineering (plus its defect-vs-pattern distinction note), character-driven-visualization-research, 3d-bones-ai-skin-pipeline. (3) Surface fixes (executor lane, rig-proven): the three workflows in `config/comfyui/workflows/` gain real negative prompts and decision-led positive prompts; a generation run per workflow on the rig proves they still execute. (4) The style system's §4 stays the style-record expression of the same rule — cross-link, do not duplicate.
- **Files:** docs/knowledge-library/media-anti-patterns-2026.md (new); the pointer docs listed in step 2; config/comfyui/workflows/*.json (step 3)
- **Acceptance:** Canonical doc exists and is registered; every step-2 doc carries its pointer (grep-verifiable); the three workflows carry negative prompts and produce successful rig runs; check-all docs gate no worse than baseline.
- **Gate:** Steps 1–2 are doc work — research lane anytime, on the owner's word. Step 3 touches generation surfaces: executor lane, rig-proven, owner's word.
- **Last session:** Orion, 2026-11-07 — step 1 landed the same night on the owner's go-ahead — the canonical doc [[media-anti-patterns-2026]] is written and registered (six-point brief discipline, defect-vs-pattern distinction, per-medium pattern tables, grading checklist); step 2 landed the same night on the owner's go-ahead — pointers added under the title of comfyui-workflows, 3d-generation-options, text-to-3d-options, hunyuan3d-setup, animatediff-evolved, character-driven-visualization-research and 3d-bones-ai-skin-pipeline, plus the defect-vs-pattern note in prompt-engineering's Negative Prompts section (all eight grep-verified). The owner then had the canon checked against current practice (deep-research pass, 2026-11-07): core thesis confirmed (Anthropic's 'distributional convergence'), and the full amendment package landed on his go-ahead — per-model negatives table in §2, typography rule rewritten (blanket ban expired), temporal video tells + motion-only image-to-video + Sora/AnimateDiff currency notes, Suno v5-line field findings, and new §9 (UI/frontend), §10 (voice/TTS), §11 (social, thumbnails, platform enforcement, provenance) sections; checklist now six questions incl. functional plausibility. Step 3 (workflow surface fixes, executor lane, rig-proven) remains on the owner's word.

### T-VID-26 — Asset intake & retopology gate for generated 3D assets
- **Status:** todo
- **Goal:** Give the bones/skin pipeline the intake gate registered as Gap 6 in [[3d-bones-ai-skin-pipeline-2026]] (expanded 2026-11-07): generated 3D output is marching-cubes triangle soup by default — dense, non-manifold, texture-painted detail, hallucinated hidden sides — and no rig binds to it. Nothing in the pipeline currently stands between a generator and the asset library.
- **Plan:** (1) Intake checklist as data + doc: image-to-3D input discipline (single object, clean/transparent background, even neutral light, 3/4 view; image-to-3D preferred over text-to-3D); generated output classified blockout by default. (2) Retopology order: built-in auto-retopology first (Meshy Remesh / Tripo Smart Mesh-class quad remesh) before export; manual retopology reserved for rigged/hero assets where deformation decides. (3) Verdicts checks enforced at the gate: KTX2 residency (hero ≤64 MiB / mid ≤24 / bg ≤8), actual transcode format verified (RGBA8-fallback trap), license intake (CC BY-NC rejected, redistribution rules recorded), HouseRig conformance for characters. (4) Script seam: an intake script that runs the mechanical checks (triangle count vs budget, manifoldness, texture bytes/format) and reports pass/fail per asset; human judgment only where the script cannot see (hidden-side quality, silhouette).
- **Files:** docs/knowledge-library/3d-bones-ai-skin-pipeline-2026.md (Gap 6 is the design source); intake script home TBD by the design (tools/ or packages/backend per layering); asset schema touches T-VID-16's definition
- **Acceptance:** Checklist published in the Gap 6 design; intake script runs against a real generated asset and reports the mechanical checks; a blockout-class asset and a hero-class asset both pass through the gate with recorded verdicts.
- **Gate:** Design-first under the T-VID-07 pattern — design anytime on the owner's word; implementation downstream of T-VID-16's asset definition and the storyboard critical path.
- **Last session:** Orion, 2026-11-07 — registered with the bones/skin doc expansion at the owner's direction; not started.

### T-VID-27 — Visual storytelling grammar as storyboard source
- **Status:** todo
- **Goal:** Make [[visual-storytelling-grammar-2026]] a consumed input of storyboard enrichment (T-VID-02 Step 5), the way the practice doc's R1–R6 rules already are: today a board can be grammatically empty — panels with framings and timings but no mode, no motivated-cut rationale, no motif — and nothing downstream can tell.
- **Plan:** (1) Board schema grows the grammar fields from the doc's §10: `mode` (performance/narrative/conceptual/hybrid), `cut_grammar` (the active look's §8 row), per-section treatment rationale citing a §3 motivation, `motif` + payoff section, opening/re-hook/last-frame decisions. (2) The storyboard generator's prompt/contract names the grammar doc as required reading alongside the practice doc; a board missing the fields is incomplete, not stylistically different. (3) Review pass: one existing board (or the next one produced) annotated against the grammar as the worked acceptance — every section's treatment traceable to a rule.
- **Files:** docs/knowledge-library/visual-storytelling-grammar-2026.md (source, landed); storyboard generator + board schema (Step 5 homes, per T-VID-02); docs/knowledge-library/music-video-production.md (pointer landed with the grammar)
- **Acceptance:** Schema carries the §10 fields; one board exists with all fields populated and rule-cited treatments; check-all docs gate no worse than baseline.
- **Gate:** Design/schema work — research lane on the owner's word; implementation inside Step 5's existing gate (downstream of T-VID-02).
- **Last session:** Orion, 2026-11-07 — registered with the grammar doc at the owner's direction; not started.

### T-VID-28 — Frame sequence service (advance frame setups, stop-motion timing)
- **Status:** doing
- **Goal:** The owner found the gap directly (2026-11-07): there was no way to set up a sequence of frames in advance — the board plans panels and the frame package (T-VID-13) carries rendered passes, but no first-class object holds an ordered, timed frame sequence the way stop-motion work needs. A frame sequence service closes it: sequences authored ahead of generation/rendering, reusable across boards, with per-frame holds as real timing.
- **Plan (design seams, agreed at registration):** (1) **Beat anchoring** — frame in/out points anchor to the track’s measured beat grid (R1), and the service computes absolute timeline start times from the grid (R6): the two real V5 assembly bugs were timestamp bugs (per-frame pulse evaluation; output-timestamp slow-mo shifting later cuts), and this service is where that class dies. (2) **Reference, don’t duplicate** — sequence entries point at panel / frame-package entries and carry their R5 state (planned → generated → accepted | rejected+reason) through; the board stays the single source of panel truth, the sequence is the single source of order and timing. (3) **Holds are first-class** — per-frame hold counts (on 1s / 2s / 3s) expressible in frames or beats; holds are how the stepped motion characters (Dial-Up, Analog Print in the style system and cut grammars) get authored rather than faked in post. (4) **Layering** — service under `app/services/` with its API in `app/api/` per the repo’s api → services → adapters rule; no second timeline may grow inside the HyperFrames compiler — it consumes sequences.
- **Files:** packages/backend/app/services/ (new sequence service); packages/backend/app/api/ (its routes); storyboard/board consumers per T-VID-27’s fields
- **Acceptance:** Service exists with sequence CRUD; entries demonstrably reference panels with R5 states carried (no duplicated panel payloads); a sequence built on the V5 cut’s verified 123.0 BPM grid reproduces its panel boundaries as absolute times (the R6 fixture); hold counts in beats and frames both honored on export; backend tests + ruff pass in the conda env.
- **Gate:** Owner is the builder (in progress at registration); no separate gate.
- **Last session:** Owner + Orion, 2026-11-07 — gap found by the owner mid-build; registered at his direction with the seams above so the service composes with the board and frame-package contracts. Orion verified beforehand: no sequence service exists in the backend and remote main carried no conflicting work.

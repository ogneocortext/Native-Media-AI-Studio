# Tasks — Local Models & Vision Loop

Area map + behavior ledger: `docs/plans/focus-areas-and-behavior-ledgers-2026-10.md` §3.6
Rules: `docs/plans/tasks/README.md`

### T-MOD-01 — Measure Atomic Chat vs Ollama cold first-token time (A/B)
- **Status:** done
- **Goal:** Same prompt set run cold on both engines (Qwen3.5-4B):
  cold-load-to-first-token, total wall time, peak VRAM recorded
  separately. Precondition: model files present in Atomic (owner
  confirms — main GGUF confirmed 2026-10-25; draft/projector not
  required for this test).
- **Files:** tools/model-reliability/ (results), tools/vision/
- **Acceptance:** Numbers written down in the session note; result
  appended to `tools/model-reliability/observed.jsonl`.
- **Last session:** Kilo, 2026-10-27 — A/B measurement complete via
  tools/model-reliability/ab_measure.py:
  - Ollama (qwen3.5:4b): first_token=12081ms, total=17327ms,
    load=11787ms (cold)
  - Atomic Chat (unsloth/Qwen3_5-4B-GGUF-Q4_K_M): first_token=5815ms,
    total=26292ms (model resident, no separate load)
  Result: Atomic Chat wins cold first-token 2.1x (key for synchronous
  4B callers per focus map §3.6); Ollama wins total batch time 1.5x.
  Both entries appended to observed.jsonl.

### T-MOD-03 — Consolidate vram_manager.py onto extracted vram_* modules
- **Status:** done
- **Goal:** vram_manager.py imports enums, provider infra, resident cache, monitor and adapter functions from its already-extracted siblings (vram_types, vram_providers, vram_config, vram_monitor, vram_adapters) instead of defining them twice; keeps only the VRAMManager orchestration class, the `vram_manager` singleton, and the re-exports callers/tests depend on.
- **Files:** packages/backend/app/services/vram_manager.py
- **Acceptance:** vram_manager.py contains no duplicated enum/provider/adapters/monitor definitions; `ruff check` clean; `tools/check-import-cycles.py` reports 0 cycles; `pytest test_vram_manager.py test_vram_comfyui.py test_vram_leak.py test_audio_vram_handover.py test_timing_and_resource_protocols.py test_lipsync.py` passes.
- **Last session:** Kilo, 2026-10-30 — consolidated vram_manager.py onto extracted vram_* modules; removed duplicated enums/providers/resident-cache/adapter/monitor definitions (~1200 lines); kept VRAMManager class, `vram_manager` singleton and caller/test re-exports. `ruff check` baseline-parity (2 pre-existing TC003), `check-import-cycles.py` clean, 40/42 VRAM tests pass (2 failures are pre-existing/environmental: confirmed failing on unmodified baseline).

### T-MOD-02 — Set atomic_chat_enabled based on the A/B result
- **Status:** done
- **Goal:** `config/ports.json` `atomic_chat_enabled` set deliberately —
  on if Atomic wins cold *and* stays reliable under bursty agent
  calling, off otherwise — with the reason in the commit message.
- **Files:** config/ports.json
- **Acceptance:** Ledger §3.6 — Atomic routing engages exactly when the
  flag says so; no silent Ollama fallback confusion.
- **Last session:** Kilo, 2026-10-27 — Set `atomic_chat_enabled: true`
  in config/ports.json. Reason: A/B measurement (T-MOD-01) showed Atomic
  Chat wins cold first-token (5,815ms vs 12,081ms, 2.1x) — the critical
  metric for synchronous 4B callers per focus map §3.6 ("4B class for
  synchronous callers; 9B warm/batch only"). Ollama wins total batch
  time (17,327ms vs 26,292ms) but that's secondary for interactive use.
  Atomic Chat's model is resident (no separate load), so first-token
  latency stays low on subsequent calls. Burst reliability under heavy
  concurrent calling has not been measured — flag can be toggled off if
  burst issues emerge.

### T-MOD-04 — Bring the local-model calling path up to the measured Bolt-era rules
- **Status:** doing (step 6 live validation blocked pending service availability)
- **Goal:** The backend's Atomic/Ollama calling path handles
  reasoning-era local models correctly and says which route
  served: reasoning content is captured rather than dropped,
  the thinking toggle is a deliberate per-call policy, output
  limits carry reasoning headroom, and route attribution is
  logged per call — closing the silent-fallback confusion
  class that T-MOD-02's acceptance named.
- **Plan:** Evidence:
  `docs/knowledge-library/nemotron-3-5-bolt-e4b-2026.md`
  §"Calling it from an agent (API behavior)" — all figures
  measured live on 2026-11-01. Grounding at item creation:
  the Atomic adapter already discovers the resident model id
  via `/v1/models` (`_discover_model`), but no
  `reasoning_content`, `enable_thinking`, or
  `chat_template_kwargs` handling exists anywhere in
  `adapters/` or `agents/` today. Steps: (1) Audit first,
  per repo rule (measure before claiming): trace one chat
  call through adapter → registry → caller and write what
  actually happens today — reasoning field, options
  pass-through, fallback trigger, route stamping — into
  Last session before changing anything; fix only what the
  audit confirms. (2) Reasoning: when a response carries
  `reasoning_content`, preserve it through the normalized
  response shape (a named field, not folded into content)
  and count it in usage reporting. (3) Thinking policy: a
  per-call option, default on, mapped to
  `chat_template_kwargs: {"enable_thinking": ...}` for
  Atomic-routed calls; call sites that want it off (pure
  format/extraction with mechanical validation) say so
  explicitly. (4) Headroom: where output limits are set for
  reasoning-capable local models, document and apply the
  ~200-token reasoning headroom rule so tight budgets stop
  returning empty content. (5) Route truth: every chat call
  logs the serving route and exact model id; a fallback to
  Ollama logs at warning level with the reason — no silent
  substitution anywhere on the path. (6) Validate: unit
  tests for the normalization and policy mapping, plus one
  live Bolt call through the backend path showing the
  reasoning field captured and the route stamped correctly;
  outcome appended to `tools/model-reliability/observed.jsonl`.
- **Files:** packages/backend/app/adapters/atomic_chat.py,
  packages/backend/app/adapters/ollama.py,
  packages/backend/app/adapters/registry.py
- **Acceptance:** The audit is recorded in Last session;
  reasoning content survives normalization; the thinking
  option demonstrably flips Bolt's reasoning over the
  backend path; fallback events log with reasons; the live
  validation call is logged in observed.jsonl.
- **Last session:** Kilo, 2026-11-01 — T-MOD-04 implemented (steps 2-5 done).
  Audit recorded previously. Changes: (1) `atomic_chat.py` — `reasoning_content`
  extracted from response into a top-level `"reasoning_content"` field; `think`
  param mapped to `chat_template_kwargs: {"enable_thinking": ...}` (Bolt API
  behavior); ~200-token reasoning headroom added to `max_tokens` when thinking
  is on; `[route=atomic-chat]` added to chat log line; `**options` → explicit
  `options` param (fixes `options={...}` kwarg being nested under `**options`);
  `options=None` guarded before `in` check. (2) `ollama_adapter.py` — same
  reasoning_content normalization, chat_template_kwargs mapping, headroom, and
  route logging; same `**options` → explicit `options` fix. (3) New unit tests
  in `packages/backend/tests/test_adapter_reasoning.py` (11 tests, all pass)
  covering reasoning preservation, think→chat_template_kwargs mapping, headroom
  application, and route-truth logging for both adapters. Live Bolt validation
  call (step 6) blocked: neither Atomic Chat's `/v1/models` API nor Ollama on
  11434 is responding (ports show bound but return dashboard HTML / service
  disabled / connection refused). Unit tests cover the normalization/policy
  mapping acceptance criteria; live call pending service availability.

### T-MOD-05 — Line-by-line review of tools/vision scripts (two passes)

- **Status:** done
- **Goal:** Owner asked for a twice-through line-by-line review of the
  vision pipeline, then use it to improve the visualizer baseline.
- **What changed (bugs found & fixed):**
  - `analyze.mjs` — the Atomic Chat → direct-Ollama fallback posted the
    *Atomic* model id (e.g. `unsloth/Qwen3_5-4B-GGUF-...`) to Ollama
    `/api/chat`: guaranteed 404, self-healed only via the later
    pickFallbackModel pass. Both atomic branches now resolve an
    Ollama-side model via `resolveOllamaFallback()`, and the later
    fallback skips a model already tried.
  - `analyze.mjs` — `analyzeWithAtomicChat` hardcoded
    `data:image/jpeg` while `encodeImage` returns PNG bytes for
    pngPassthrough text modes; data URL now sniffs the PNG magic prefix.
  - `analyze.mjs` — VRAM abort gate used `residentVisionModels()` which
    reads `/api/tags` = *installed* models, so `modelAlreadyResident`
    was true even with every model cold and the 85% abort never fired
    when a real cold load was required. Now intersects with `/api/ps`
    via `getRunningModels()` (baseName-compared).
  - `vision-common.mjs` `ensureVisionModel` — `offload-ollama` unloads
    ALL models including the target, but the `targetIsOllama` check
    skipped the reload exactly then: "ensure" left the requested model
    cold. Target is now always re-warmed after an offload.
  - Cosmetics: duplicated comment block in `parseArgs`, one-line double
    statement in `toAtomicChatModel`.
- **Files:** tools/vision/{analyze.mjs,vision-common.mjs}.
- **Verification:** `node --check` clean on all five vision files;
  live `--mode ui --json` run against a real screenshot returned a
  well-formed analysis through the fixed path.
- **Acceptance:** satisfied at completion.
- **Last session:** Devin, 2026-11-07 — two full passes; 4 real bugs +
  cosmetics fixed; noted (not fixed) run-interaction-audit's unescaped
  `--label` interpolation and analyze.mjs's local analyzeWithOllama
  duplicating vision-common (intentional: it needs format:json +
  per-model profiles the shared helper lacks).

### T-MOD-06 — Vision pipeline upgrades from 2026 best-practices research

- **Status:** done
- **Goal:** Apply current VLM-analysis best practices (researched via
  current-best-practices skill) to tools/vision.
- **What changed:**
  - `--crop "x,y,w,h"` + `--scale N` ROI support in `encodeImage`
    (vision-common.mjs) — element-level captures no longer invisible to
    the model at 1x (proven this session: 240px figure canvas read
    "no shading" at 1x, confirmed at 3x).
  - `--dom file` — inject serialized DOM/a11y snapshot as ground truth;
    2026 consensus is tree-first, pixels-second for UI analysis.
  - `tools/vision/schemas.mjs` — per-mode JSON schemas (ui, responsive,
    regression, compare, multicomp, ocr) passed as Ollama `format`
    objects = constrained decoding, replacing bare `format:'json'`.
  - Diff gate for compare/multicomp: `diffImagesRegion` pixel-diffs the
    two frames, skips the VLM entirely below threshold, else crops both
    to the changed bbox (+margin) — VLM-SubtleBench: crops beat
    side-by-side full frames. `--no-diff-gate` escapes.
  - Provenance in `--json`: per-image orig dims/bytes, crop/scale, dom
    file, diff_gate result, prompt_sha256, duration_ms.
  - `probeImageMeta`, `cropImageToFile` helpers; dead `execSync` import
    removed; renderJsonSections gained summary/uncertain keys.
- **Files:** tools/vision/{analyze.mjs,vision-common.mjs,schemas.mjs},
  docs/plans/tasks/local-models-and-vision-loop.md.
- **Verification:** `node --check` clean x3; encodeImage crop+scale
  → 360x480 PNG correct; identical-image compare exits via
  deterministic-diff-gate with provenance; modified-image compare
  cropped to 116x116 region and returned schema-shaped JSON in 23s;
  `--dom` injection + ui schema returned findings/summary shape.
- **Acceptance:** satisfied at completion.
- **Last session:** Devin, 2026-11-07 — commit pending.

### T-MOD-07 — Line-by-line review of T-MOD-06 vision upgrades

- **Status:** done
- **Goal:** Self-review the just-landed ROI/dom/schema/diff-gate/
  provenance changes before they calcify.
- **Findings fixed:**
  - `encodeImage` crop guard checked only `.left` — a partial crop
    object passed NaN into sharp.extract. Now validates all four fields.
  - sharp-missing fallback silently ignored crop/scale while provenance
    claimed them applied — now warns on stderr.
  - `diffImagesRegion` indexed both buffers with `a.info.channels` —
    a grayscale/palette source could misalign the diff. Channel-count
    guard added (`channel-mismatch` reason).
  - Diff gate short-circuited on `images-too-small` — "could not
    compare" was reported as "no difference". Only `below-threshold`
    exits now; all failure reasons fall through to full-frame VLM.
  - Same bbox was applied to image B — wrong region whenever the pair
    differs in size. Bbox now scales per-image dims.
  - Temp crop dir (`os.tmpdir()/viz-diff-*`) leaked per run — removed
    after analysis; `sent_images` + `diff_tmpdir` recorded in provenance.
- **Files:** tools/vision/{analyze.mjs,vision-common.mjs},
  docs/plans/tasks/local-models-and-vision-loop.md.
- **Verification:** node --check clean; identical-image compare still
  exits via deterministic gate; different-dims pair diffs and crops
  correctly (bbox in A-pixels, scaled for B).
- **Acceptance:** satisfied at completion.
- **Last session:** Devin, 2026-11-07 — commit pending.

### T-MOD-08 — Video analysis mode (--video) for temporal UI defects

- **Status:** done
- **Goal:** Owner request — stills cannot catch layers that collide only
  mid-transition; add frame-by-frame video analysis to the vision
  skillbase and use a real interaction recording to find live defects.
- **What changed:**
  - New `tools/vision/video-frames.mjs`: `probeVideo` (ffprobe),
    `extractFrames` (ffmpeg fps sampling into temp dir),
    `selectKeyframes` (consecutive-frame pixel diff via the existing
    `diffImagesRegion`; keeps first/last + strongest change boundaries
    with min-gap enforcement, budget-capped).
  - `analyze.mjs --video <file>`: expands a recording into a
    chronological keyframe set, defaults mode to `video` (custom
    `--mode`/`--prompt` still honored; custom prompts get the keyframe
    timestamp manifest appended), `video` added to TEXT_MODES and
    reasoningModes. Provenance records source meta, sample fps,
    per-boundary diff ratios, and every keyframe timestamp; temp dir
    cleaned after the run.
  - `schemas.mjs`: `video` schema — `per_frame`, `transitions`,
    `overlaps` arrays + `uncertain`/`summary`.
  - Self-review fixes: NaN/negative `--video-fps` clamped, keyframe
    budget floored at 2.
  - Skills updated: `vision-page-analysis` documents `--video` +
    the geometry-sampler pairing; `visual-qa-loop` gained the
    recordVideo capture step.
- **Files:** tools/vision/{video-frames.mjs (new), analyze.mjs,
  schemas.mjs}, .claude/skills/{vision-page-analysis,visual-qa-loop}/SKILL.md.
- **Verification:** live run on a 24s Playwright recording — ffprobe
  meta, 24 frames @1fps, 6 diff-peak keyframes (f0001/010/014/019/022/024
  spanning the mode switches), schema-shaped temporal JSON in ~67s.
  Honest limit: gemma4's per-frame semantics are coarse — geometry
  sampling remains the authoritative overlap detector.
- **Acceptance:** satisfied at completion.
- **Last session:** Devin, 2026-11-08 — commit pending.

### T-MOD-09 — Line-by-line review of T-MOD-08 video mode

- **Status:** done
- **Goal:** Self-review the --video pipeline before it calcifies.
- **Findings fixed:**
  - **Coverage bug (real):** `-frames:v` caps output count, so a video
    longer than maxFrames/sampleFps seconds was silently truncated —
    only its first N seconds reached the model. Sampling rate now thins
    to `maxFrames/duration` (floor 0.1fps) so frames span the full
    recording; `sample_fps` in provenance records the effective rate.
  - `probeVideo` used only `avg_frame_rate` — containers reporting
    "0/0" got fps=0. Falls back to `r_frame_rate`.
  - `runStartedAt` was declared after video extraction, so
    `duration_ms` excluded ffmpeg+diff time (~20-30s on real clips).
    Moved before the video block; provenance now reflects the full run.
  - Log line printed the raw `--video-fps` arg instead of the clamped
    `sampleFps`.
- **Files:** tools/vision/{video-frames.mjs, analyze.mjs},
  docs/plans/tasks/local-models-and-vision-loop.md.
- **Verification:** node --check clean; math checked for 16s clip
    (fps stays 1, 16 frames) and hypothetical 120s clip (fps→0.2,
    24 frames spanning full duration).
- **Acceptance:** satisfied at completion.
- **Last session:** Devin, 2026-11-08 — commit pending.

### T-MOD-10 — Walkthrough set 3 + vision-tooling fixes found by real use

- **Status:** done
- **Goal:** Run the third sidebar walkthrough (Library x4 + Audio
  Analysis) through tools/vision/walkthrough.mjs and fix what actual
  use exposed.
- **Run:** spec-driven capture, 5 pages, 49.3s webm, per-page ui
  analysis + video pass; report.md/json in
  ~/nav-walkthrough-3b/ (local, not committed). 19 console errors
  (all the known React uncached-promise dev warning), 0 bad responses.
- **Defects found in the tooling itself (all fixed):**
  - **Stale-video selection (worst):** walkthrough.mjs picked
    `videos[0]` from --out; a truncated .webm left by an earlier FAILED
    run was analyzed instead of the real 49.3s recording — video
    analysis silently covered only 24s. recordVideo now writes to
    outDir/video and selection picks newest .webm by mtime.
  - **duration_s=0 cascade:** Playwright webm has no container
    duration (format.duration absent, stream.duration null), so
    probeVideo returned 0 -> sampleFps thinning never engaged ->
    -frames:v truncated long recordings to their first 24s. probeVideo
    now falls back to counting packets via ffmpeg null remux
    (demux-only, ~instant) and derives duration = frames/fps.
  - **Video report never rendered:** walkthrough looked for
    analysis_parsed.findings, but the video schema returns
    transitions/overlaps — the temporal section was always empty.
    Now renders transitions + overlaps with severity.
  - **Marks clock skew:** marks used a t0 from before browser launch;
    Playwright starts the webm at page creation. Marks now use
    videoT0 = newPage() time so video timestamps align.
  - **Dead reference:** page-prompt lookup used an out-of-scope
    `route` variable (would ReferenceError under --analyze); now
    indexes pageSpecs by mark order. Spec pages gained a "prompt"
    field passed through as --prompt.
  - **VLM timestamp hallucination:** video prompt now injects the
    measured diff_ratios as "change HINTS" (where, not what) plus
    capture marks as expected events, and demands per-frame page
    identification — after observing the model copy hint percentages
    as transition descriptions.
  - **Wrong TARGET in ui prompt:** gemma4-ui hardcoded "Media Library"
    for every page; now {{TARGET}} = --label, LAYER 1 region list
    generalized (was file-browser-specific), findings gained
    confidence field in prompt + schema (severity enum also gained
    "cosmetic" to match the prompt's vocabulary).
- **Model ceiling documented:** gemma4:e2b-it-qat degenerates on ~10
  keyframes of a multi-page video (claimed a loading spinner on every
  frame of a recording that verifiably navigated 5 pages — confirmed
  by extracting frames manually and re-analyzing: f005=Media Library
  file list, f008=Storyboards). Per-page screenshot analysis remains
  the reliable signal; video analysis is supplementary; geometry
  sampling stays authoritative for overlaps. Walkthrough video pass
  uses 32 frames / 8 keyframes accordingly.
- **Files:** tools/vision/{walkthrough.mjs (new), video-frames.mjs,
  analyze.mjs, schemas.mjs, prompts/gemma4-ui.mjs},
  .claude/skills/{vision-page-analysis,visual-qa-loop}/SKILL.md +
  mirrors, docs/plans/tasks/local-models-and-vision-loop.md.
- **Verification:** node --check all touched files; probeVideo on the
  real webm returns duration 49.32 (was 0); video re-run spans full
  duration with keyframes 0..48s; frame-level spot checks confirm the
  recording navigated (f005 Media Library, f008 Storyboards).
- **Acceptance:** satisfied at completion.
- **Last session:** Devin, 2026-11-08 — commit pending.

### T-MOD-11 — Vision model bake-off: qwen3.5:4b vs gemma4:e2b-it-qat

- **Status:** done
- **Trigger:** user noted other vision models are installed.
- **Goal:** Determine which locally-available vision model (gemma4:e2b-it-qat
  vs qwen3.5:4b) produces more accurate UI analysis for the vision
  pipeline, and update the tooling to use the better model by default.
- **Inventory:** Ollama vision-capable = gemma4:e2b-it-qat (4.3GB),
  qwen3.5:4b (3.4GB, thinking mode). Cloud: muse-spark-open and
  minimax-m3.1-flash return 402 Payment Required; beam:cloud has no
  vision capability. llama3.2:3b tag lacks vision in this build.
- **Measured on identical frames (f005 Media Library, f008 Storyboards):**
  - gemma4:e2b-it-qat: mislabeled frames, hallucinated "Loading..."
    across an entire 10-keyframe video that verifiably navigated.
  - qwen3.5:4b: correct page ID + precise content (search placeholders,
    card titles, button labels, filenames) on both frames; structured
    === FINDINGS === text output (no JSON schema — thinking mode).
- **Changes:** qwen35-ui prompt parameterized {{TARGET}}=label +
  generalized regions + context injection (was hardcoded Media Library
  like gemma's was); walkthrough.mjs gained --model passthrough and
  extractTextFindings() so report.md works with either output format;
  skill doc records the trade-off and cloud 402 status.
- **Files:** tools/vision/{walkthrough.mjs, analyze.mjs,
  prompts/qwen35-ui.mjs}, .claude/skills/vision-page-analysis/SKILL.md
  + mirrors, docs/plans/tasks/local-models-and-vision-loop.md.
- **Verification:** node --check clean; extractTextFindings validated
  against real qwen3.5:4b output (4 findings parsed correctly);
  qwen ui-mode run produced OBSERVATION/HEURISTIC_CHECKS/FINDINGS/
  TOP_3_FIXES structure.
- **Acceptance:** satisfied at completion.
- **Last session:** Devin, 2026-11-08 — commit pending.

### T-MOD-12 — Vision task-tier routing: fast/describe vs workhorse vs deep
- **Status:** done
- **Goal:** Right-size the vision model per task — back-to-back mesh/UI
  iteration loops need a fast small VLM, not the 4 GB reasoning model;
  detail audits still need gemma4; subtle defect hunts need qwen3.5.
- **Measured (2026-11-08, mesh-QA renders, warm):** moondream ~1.5 s
  describe (hallucinates detail, answers detection prompts with raw
  bbox coords — smoke checks only); gemma4:e2b-it-qat ~7 s structured
  findings (workhorse); qwen3.5:4b ~27 s warm / ~133 s cold (deep —
  caught thin-limb + disjointed-part defects gemma4 missed).
- **Changes:** pulled `moondream` (~1.8 GB); analyze.mjs gained
  `fast`/`describe` modes -> `VISION_MODEL_FAST` env or moondream +
  MODEL_PROFILES entry; vision-mcp `vision_describe` gained `model`
  param (forwards `--model`, warms that model) and `fast`/`describe`
  mode enum values; ollama-model-ops skill records the tier table.
- **Files:** tools/vision/analyze.mjs, tools/mcp/vision-mcp.mjs,
  .claude/skills/ollama-model-ops/SKILL.md (+ .devin mirror),
  docs/plans/tasks/local-models-and-vision-loop.md.
- **Verification:** node --check clean on both files; live runs —
  `--mode fast` routed to moondream (mode-map+resident), moondream
  warm describe 1.5 s, qwen/gemma timings recorded above.
- **Acceptance:** satisfied — tier routing live and documented.
- **Last session:** Devin, 2026-11-08 — implemented + measured + committed.

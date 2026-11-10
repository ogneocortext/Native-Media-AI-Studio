# Repo review sweep — audit findings (2026-11-09, Devin executor lane)

Scope: hidden technical debt hunt across the focus areas in
`docs/plans/tasks/`. AUDIT ONLY — no fixes applied. Each finding carries
file:line, evidence, severity, and fix shape. Coverage was targeted
(seed verification + pattern sweeps for stubs, silent swallows, stale
tests, gate honesty), not exhaustive line-by-line per area; shards that
produced nothing are listed explicitly at the end.

## Seed-list verification

### S1. tools/ascii_pytest_plugin.py syntax error (commit 25f13433) — ALREADY FIXED

- Evidence: `fcbbad9b` ("chore: unbreak ascii_pytest_plugin syntax")
  repaired the `type('Result', (), {...})` paren bug; `d995c59f`
  consolidated the plugin into `packages/backend/tests/conftest.py` +
  root `cli_output.py`. Neither `ascii_pytest_plugin.py` nor
  `test_all.py` exists in the tree anymore; `cli_output.py` parses
  clean (`ast.parse` OK) and is the formatter conftest actually uses.
- Severity: none (resolved). Note for the record only.

### S2. T-PLT-46 loader half — CONFIRMED STILL OPEN (known, not hidden)

- `docs/plans/tasks/platform-and-workflow.md` T-PLT-46 status `doing`;
  its Last session already names the remaining work.
- Evidence: `packages/backend/app/core/hardware_profile.py:71-88`
  `HardwareLimits` still has only the 8 original fields — no `lanes`,
  `workloads`, or thread-cap fields. `config/hardware-profile.json`
  carries the reconciled config-side values (lane caps, encode
  decision, whisper/Demucs blocks per the task file), but
  `_limits_for_gpu` (line 228) only reads `limits.*`, and every model
  is `extra="ignore"`, so the new blocks are silently dropped.
- Severity: medium — config promises caps no service honors; a
  shared-lane job can still take 12 threads.
- Fix shape: add loader models for `lanes`/`workloads`/thread fields
  with backward-compatible defaults, then wire consumers (torch
  num_threads, ffmpeg concurrency, dataloader workers) per the task
  file's plan step (c).

### S3. Docs-gate failures — docs lane is GREEN; pytest lane is RED

- `python tools/run-gates.py --only doc` passes all 13 checks
  (including the new `skill mirrors` check added this session).
- `python tools/run-gates.py` (full): 10/11 gates pass; `pytest` FAIL
  with 4 test failures (details below). This is the current gate
  failure set.

## New findings

### F1. pytest gate interpreter probe cannot see gate-required plugins — MEDIUM

- `tools/gates/interpreter.py:196-238` probes candidates with `ruff
  check` + one small pytest file, but the pytest GATE argv
  (`tools/gates/gates.py:76-78`) adds `--testmon`. C:\Python314 passes
  the probes yet lacks `pytest-testmon`, so the gate dies on
  "unrecognized arguments: --testmon" before collecting a single test.
  The project env `D:\conda-envs\nma-studio-cuda` (Python 3.11) is
  correctly rejected — `app/core/logging_config.py:37` imports
  `typing.override` (3.12+), so the declared project env cannot run
  the current backend at all.
- Evidence: gate output `[pytest] error: unrecognized arguments:
  --testmon`; `pip show pytest-testmon` absent under C:\Python314,
  present (2.3.0) under nma-studio-cuda; probe code contains no
  plugin check.
- Severity: medium — the gate's verdict depends on which interpreter
  the probe cache happened to pick, and the probe can certify an
  interpreter that cannot run the gate.
- Fix shape: extend `_probes()` (or the pytest gate argv probe) to
  exercise the real gate flags, e.g. `pytest --testmon --collect-only
  -q` on one file, so plugin absence rejects the candidate.

### F2. Backend pytest suite: 4 failures on current main — MEDIUM

Gate run 2026-11-09: `4 failed, 987 passed, 7 skipped` (998 total,
`-m "not integration"`).

- `tests/test_media_library.py::test_init_db_creates_media_tables` —
  `assert 25 == 22`: the test pins `get_schema_version(conn) == 22`,
  but migrations have since landed (schema is now 25). Stale test
  text vs code state — exactly the "TODO no longer matches" class.
  Severity: low-medium (test debt, not product bug). Fix: update the
  expected version or assert `>=` with a named floor.
- `tests/test_stem_remixer.py::test_library_file_join_is_reported_only_when_unambiguous`
  and `::test_list_stem_sources_carries_the_library_file` — both
  `assert 'e150cc0a_SunoV6Mini-Ad-Nauseam.m4a' ==
  'SunoV6Mini-Ad-Nauseam.m4a'`: the tests assert against the LIVE
  audio library and the dedup-hash filename prefix (`e150cc0a_`)
  appeared after the tests were written. Data-dependent tests coupled
  to user content. Severity: medium (suite red until library or test
  changes). Fix: fixture the library listing instead of reading the
  real `output/audio/` tree.
- `tests/test_db_pool.py::test_close_pooled_connections_empties_the_pool`
  — `assert 1 == 0`: `close_pooled_connections()` left one pooled
  connection. Could be a real pool-drain bug or a test-isolation
  artifact; needs a repro run to classify. Severity: medium until
  classified. Fix: reproduce in isolation; if real, find which
  checkout path re-pools a connection during close.

### F3. `POST /api/ai/generate-scene` accepts `apply` and silently no-ops — MEDIUM

- `packages/backend/app/api/ai.py:87-95`: when `request.apply` is
  true the handler logs "Auto-applying scene to studio (not yet
  implemented)" at INFO and still returns `GenerateSceneResponse(
  success=True, ...)`. Callers cannot distinguish applied vs
  generated-only; the success flag claims more than the code did.
- Severity: medium — API honesty bug; any client trusting
  `success`/`apply` is misled.
- Fix shape: either implement apply, or return an explicit
  `applied: false` / `apply_supported: false` field (or 501) so the
  contract is honest.

### F4. SameBoy chip adapter is a registered placeholder — LOW-MEDIUM

- `packages/backend/app/adapters/chips/sameboy.py:30-51`: `_create_chip`
  returns None with "not yet implemented - using behavioral fallback",
  `_generate_raw` returns `b''`, `is_available()` returns False, yet
  the adapter self-registers for `gameboy`, `gameboy_dmg`,
  `gameboy_cgb`, `dmg`, `cgb` (lines 54-58). Whatever consumes the
  registry sees Game Boy as a supported system and gets the
  behavioral fallback audio, which may be presented as emulation.
- Severity: low-medium — honest in logs, but the registry surface
  advertises capability the adapter does not have.
- Fix shape: verify what the "behavioral fallback" renders and how the
  UI labels it; if it is a synth approximation, mark the system
  unavailable or label the output non-emulated in the picker/metadata.

### F5. `AIPresetGallery` delete path admits a missing server feature — LOW

- `packages/frontend/src/features/visualizer/components/AIPresetGallery.tsx:98`:
  `showToast("Delete not yet implemented on server", "warning")`.
  Honest UX, but the delete affordance exists in the UI while the
  endpoint does not — dead interactive path.
- Severity: low. Fix shape: hide/disable the delete control until the
  endpoint lands, or register the endpoint.

### F6. Root-level `cli_output.py` is a tracked repo-root module — LOW

- `cli_output.py` sits at repo root (imported by
  `packages/backend/tests/conftest.py:127` via sys.path insertion,
  per the comment at conftest.py:29). Works, but root-level modules
  are outside every package boundary and outside `tools/` conventions
  ("Write new helper scripts in Python under `tools/`").
- Severity: low (works today; layout debt). Fix shape: move under
  `tools/` or `packages/backend/tests/` support dir and update the
  conftest sys.path note.

## Seed/shard notes

- Docs gate: GREEN (13/13 incl. new skill-mirrors check).
- Full gates: pytest lane red on F1+F2 (see above); all other lanes
  green (docs, ruff, arch, routes, glsl, type, lint, tools-pytest,
  unit, build).
- `tools/ascii_pytest_plugin.py` seed: resolved history (S1).
- `viz-capture.mjs` CANVAS_2D_MODES/SHADER_PRESETS mirrors verified in
  sync with `visualizerHelpers.ts` (14/14 modes) — no drift today, but
  the "kept in sync manually" comment (viz-capture.mjs:52-53) is a
  standing drift risk worth a checker note, not a current violation.
- Shards with no findings beyond the above: audio-analysis-and-remix,
  library-and-organization, music-generation, local-models-and-vision-loop,
  video-pipeline-and-storyboard, agent-and-automation, integrations
  (beyond F3), visualizer (beyond F5 and the T-VIZ-54 fix this session).

# Tasks — Library & Organization

Area map + behavior ledger: `docs/plans/focus-areas-and-behavior-ledgers-2026-10.md` §3.1
Rules: `docs/plans/tasks/README.md`

### T-LIB-01 — Make media-library search reliable at real scale
- **Status:** done
- **Goal:** Media-library search finds items by name/tag reliably at the
  owner's real library size; no silent zero-result traps.
- **Files:** packages/frontend/src/features/media-library/,
  packages/backend/app/api/ (media-library routes)
- **Acceptance:** Ledger §3.1 — a named item is findable by search and by
  tag filter in the live UI.
- **Last session:** Kilo, 2026-10-27 — extended search to match tag names
  in addition to filename/relative_path; added tagFilter to FilterState;
  added tag dropdown pill filter to FilterBar (color-coded, "All" clear);
  wired tags from useMediaLibrary through useFileFilters + FilterBar +
  MediaLibrary; added tagFilter to page-reset effect deps. tsc + lint +
  891 vitest all pass.

### T-LIB-02 — Fix vision-review findings on media library pages
- **Status:** done
- **Goal:** One screenshot → vision-analyze → fix → re-verify cycle on the
  media library pages in their post-Oct-24 state.
- **Files:** packages/frontend/src/features/media-library/
- **Acceptance:** Findings from the qwen3.5 prompt family addressed or
  explicitly deferred with reasons in Last session.
- **Last session:** Kilo, 2026-10-27 — captured screenshot of /library,
  analyzed via ollama-tools_analyze_image (gemma4:e2b-it-qat). Findings:
  (1) Filenames truncated without tooltips — ALREADY FIXED: FileCard.tsx
  line 184 has `title={file.filename}`. (2) No empty state — ALREADY FIXED:
  FileGrid.tsx lines 34-39 render "No files found matching your criteria".
  (3) Footer/bottom nav redundancy — DEFERRED: pre-existing design concern
  outside scope of this polish pass. (4) Top "Library" icon vs bottom
  "Media Library" text — DEFERRED: pre-existing design concern.

### T-LIB-03 — Strip hash prefixes from audio selector display names
- **Status:** done
- **Goal:** Audio files carrying stacked content-hash prefixes (e.g.
  `5eab45eb_3a288113_music_video.m4a`) render as cleaned names
  (`music video`) in FileCard via the shared `audioDisplayName` helper
  (D16 selector consistency); raw filename preserved on tooltip and in
  rename. Scoped `/library/audio` page hides its file-type chips since it
  is already audio-scoped.
- **Files:** packages/frontend/src/features/media-library/components/FileCard.tsx,
  packages/frontend/src/features/media-library/components/FilterBar.tsx,
  packages/frontend/src/features/media-library/MediaLibraryView.tsx
- **Acceptance:** /library/audio shows cleaned audio names with raw name
  preserved in title/aria-label; file-type chips hidden on the scoped
  audio page; tsc + eslint + vitest all pass; verified live against the
  running backend (82 audio files, pagination + playback working).
- **Last session:** Cline, 2026-10-29 — vision-reviewed /library/audio,
  found raw hash names displayed and type chips shown on scoped page;
  applied all three fixes; verified live.

### T-LIB-04 — Normalize all task blocks to the R1 format
- **Status:** done
- **Goal:** Every task block in `docs/plans/tasks/` matches R1 of
  `docs/knowledge-library/organizational-consistency-2026.md`: em-dash
  heading, all five fields present, status in the canonical vocabulary;
  the three `T-PLT-XX` placeholder blocks are numbered or converted to
  plain backlog lines. Formatting only — no task content changes.
- **Files:** docs/plans/tasks/*.md
- **Acceptance:** `python tools/check-consistency.py` reports zero R1
  violations, and an independent recount finds the same tasks with the
  same statuses as before the sweep (nothing lost, nothing invented).
- **Last session:** Orion, 2026-11-06 — census measured the drift (43
  hyphen headings, 13 blocks missing Acceptance, 11 missing Last
  session, 3 placeholder IDs); spec + checker landed in the same commit
  as this item. The sweep itself is this item.
- **Last session:** Devin, 2026-11-06 — sweep landed: 82 hyphen
  headings converted to em dash across audio-analysis-and-remix,
  platform-and-workflow, visualizer; the three `T-PLT-XX` blocks
  numbered T-PLT-37/38/39; 26 missing Acceptance/Last-session fields
  backfilled with honest "predates R1" entries (no content invented).
  `check-consistency.py` now reports 127 blocks, zero R1 violations.
  Acceptance met: checker clean; statuses untouched (formatting only).

### T-LIB-05 — Reconcile the three library ledgers to one source
- **Status:** done
- **Goal:** `index.md` listings, `knowledge-tracker.md` sections, and the
  Tags Index counts agree with each other and with the files on disk,
  per R2–R4 of the consistency doc: `visualization-effects` gets one
  primary category (cross-refs become see-also), meta files are
  classified per R4, `animatediff-evolved-2026` is categorized, and the
  tracker's library total (113, vs 121 files on disk) is corrected.
- **Files:** docs/knowledge-library/index.md,
  docs/knowledge-library/knowledge-tracker.md, frontmatter of affected
  docs
- **Acceptance:** `tools/check-consistency.py` R2/R4 census is clean;
  the docs gate's knowledge-tags check passes (the `#research says 20,
  actual 21` class of failure is gone); every printed count in the three
  ledgers is reproducible from the files.
- **Last session:** Orion, 2026-11-06 — census table in the consistency
  doc records the three-way disagreement this item closes.
- **Last session:** Devin, 2026-11-06 — ledgers reconciled:
  `animatediff-evolved-2026` listed under Research & Reference in
  index.md; the `visualization-effects` triple-listing was a checker
  false positive (see-also `[[links]]` on consolidated-doc bullets were
  counted as category listings) — fixed `check-consistency.py` to count
  each bullet's primary link only, matching R2's see-also allowance;
  tracker total corrected 113 → 117 content docs (R4 meta exclusion
  stated explicitly). `check-consistency.py` and
  `validate-knowledge-tags.py` both clean; every ledger count now
  reproduces from frontmatter via the validators.

### T-LIB-06 — Wire check-consistency.py into the docs gate
- **Status:** done
- **Goal:** `tools/check-all.py` runs the consistency checker so format
  and ledger drift fail the gate instead of accumulating silently.
- **Files:** tools/check-all.py, tools/check-consistency.py
- **Acceptance:** A check-all run shows a consistency section; the gate
  passes with it included. Land only after T-LIB-04 and T-LIB-05 bring
  the census to zero (or wire it report-only first, by owner decision).
- **Last session:** Orion, 2026-11-06 — checker written and run
  standalone in the consistency commit; wiring deliberately deferred
  until the census is clean.
- **Last session:** Devin, 2026-11-06 — wired as hard gate "consistency"
  in `tools/check-all.py` (census reached zero under T-LIB-04/05, so no
  report-only phase needed); `_check_relevant` scopes it to docs/
  changes; docstring check list renumbered. Acceptance met: check-all
  run shows the consistency section and passes with it included.

### T-LIB-07 — Scan all of output/ so generated media is always listed
- **Status:** done
- **Goal:** Every media file a producer writes under `output/` appears in
  the Media Library without per-directory code changes; package-local
  render output (`packages/video-editor/output/`) is reachable too.
- **Files:** packages/backend/app/api/outputs_scanner.py,
  packages/frontend/src/features/media-library/hooks/useMediaFiles.ts,
  packages/frontend/src/state/outputStore.ts
- **Acceptance:** `GET /api/outputs?limit=500` returns media from every
  producer subdir (stems, remixes, packages-output, videos, music,
  previews, video-editor, comfyui, generated_3d, ...); internal dirs
  (logs, caches, beat_data, thumbnails, screenshots, quarantine-*) and
  frame-sequence dumps (frame_0001.png / f000123.png) stay excluded; the
  library UI fetches past the API's 500/page cap so nothing is silently
  truncated.
- **Last session:** Devin, 2026-11-07 — replaced the hardcoded 5-subdir
  scan list with recursive coverage of every non-excluded top-level dir
  under `output/` (`_SCAN_EXCLUDE_DIRS` + quarantine prefix +
  `_FRAME_SEQ_RE` + media-ext filter via `get_file_type`); per-file logic
  extracted to `_scan_file`; `_get_dir_mtime` watches the same tree via
  `_iter_scannable_dirs`. Added `output/video-editor` junction →
  `packages/video-editor/output` (machine-local, output/ is gitignored —
  recreate with `New-Item -ItemType Junction` if output/ is wiped) so
  Remotion CLI renders list and serve under `output_base`. Frontend:
  `useMediaFiles` paginates `/api/outputs` until `total` is reached;
  outputStore default limit 200→500. Verified live: API returns 409
  outputs across 16 top dirs (was ~10 from 5 dirs); tsc errors seen are
  unrelated untracked admin-page WIP; eslint clean on touched files.

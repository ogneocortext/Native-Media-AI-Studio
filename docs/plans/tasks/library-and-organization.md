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

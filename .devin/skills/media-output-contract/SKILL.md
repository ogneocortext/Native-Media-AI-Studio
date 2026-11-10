---
name: media-output-contract
description: >-
  Where generated media must land to appear in the Media Library — the
  output/ scan contract, excluded dirs, frame-sequence naming, sidecar
  metadata, the junction pattern for external render roots, and API
  pagination. Use whenever creating a render/generation pipeline, picking
  an output path, adding a producer that writes files, or debugging
  "generated media missing from the library".
---

# Media Output Contract

> [!warning] The Media Library does not watch arbitrary paths. A file is
> visible only if it lands somewhere the scanner covers — or a junction
> makes it look like it did. "I rendered it but can't find it" is almost
> always an output-path problem, not a UI problem.

## What the scanner covers

`packages/backend/app/api/outputs_scanner.py` scans, recursively:

- **Every non-excluded top-level dir under `output/`** — images, video,
  audio, generated_3d, remixes, previews, videos, stems, music,
  packages-output, remotion, renders, enhanced, and any dir a future
  producer invents. No code change needed for new subdirs.
- **Files directly under `output/`** (rare, but covered).
- **ComfyUI output `*.glb` only** — listed as `comfyui/<relative path>`.
  ComfyUI images/video are NOT scanned directly; the workflow handler
  copies results into `output/images` / `output/video`, which is the
  canonical path.

## What stays invisible (by design)

- `_SCAN_EXCLUDE_DIRS`: `agent-state`, `audio_analysis`, `beat_data`,
  `benchmarks`, `cache`, `fingerprints`, `interaction-audit`,
  `kb-context-cache`, `kb-embed-cache`, `logs`, `metadata`, `runtime`,
  `scratch`, `screenshots`, `setup-env`, `structure`, `tests`,
  `thumbnails`, `workflows` — plus anything named `quarantine-*`.
  Do not write deliverables here.
- **Frame-sequence dumps**: stems matching `^(frame[_-]?|f)\d{3,6}$`
  (`frame_0001.png`, `f000123.png`) are skipped — they are pipeline
  intermediates, and hundreds of them would flood the grid. Name
  deliverable stills descriptively instead (`neocortext-v1-midpoint.png`).
- **Non-media files**: only `get_file_type()` media extensions list,
  plus `.lrc`/`.srt`/`.vtt` as "other". `.json` is always a sidecar,
  never a listing.
- Files under 1 KB (images) or 10 KB (video/audio) — failed-render
  filter. Don't ship tiny placeholders.

## Producer rules

1. **Write final artifacts under `output/`** — any non-excluded dir.
   Prefer the typed dirs (`output/video`, `output/images`,
   `output/audio`, `output/generated_3d`, `output/remixes`) but the
   scanner does not require them.
2. **Sidecar metadata**: write `<file>.<ext>.json` (or `<file>.json`)
   beside the media for `job_id`/metadata — the scanner loads it
   automatically. In `output/audio/` and `output/video/`, an image
   sharing the media file's stem is treated as a cover and hidden —
   name standalone artwork differently.
3. **External render roots** (e.g. `packages/video-editor/output`):
   expose them with a directory junction inside `output/`:
   `New-Item -ItemType Junction -Path output\video-editor -Target <abs path>`.
   Files then list AND serve (the file endpoints resolve
   `relative_path` under `output_base` — outside-root files would 404).
   Junctions are machine-local (`output/` is gitignored); recreate if
   `output/` is wiped.
4. **Freshness**: listing is cached 30 s and mtime-watched on the same
   tree — new files appear within ~30 s, or immediately with
   `GET /api/outputs?refresh=true`.

## API pagination

`GET /api/outputs` returns at most **500/page** (`limit` ≤ 500,
`offset` paging, `total` in the response). The Media Library UI
(`useMediaFiles`) paginates until `total` — any new consumer must do the
same or it will silently truncate. `outputStore.fetchOutputs` defaults
to `limit=500`; pass `file_type`, `search`, `date_from`, `date_to` for
server-side filtering.

## Debugging "missing media"

1. `GET /api/outputs?limit=500&refresh=true` — is it in the API at all?
2. If no: check the path against `_SCAN_EXCLUDE_DIRS`, the frame-seq
   regex, and the size floors.
3. If yes but UI empty: check the consumer's `limit`/`offset` handling.
4. If the file lives outside `output/`: junction it in (rule 3).

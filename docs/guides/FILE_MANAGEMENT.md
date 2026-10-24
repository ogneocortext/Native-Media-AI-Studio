# File Management Guide — Media Library

> **Last Updated:** 2026-10-24 • Covers `output/` file ops: play, cover art, rename, delete, duplicates, upload, naming, metadata, smart views, shortcuts, performance, security

## Overview

`output/` is the single source of truth (`output/images`, `output/video`, `output/audio`, `output/previews`). Every generation writes a file + sidecars (`.json` metadata, `audio/*.jpg` cover). The **Media Library** (`/library`) is the UI for all ops — no file explorer needed.

## Upload workflow — how files enter `output/`

Tracks enter the library through `POST /api/audio/upload`:

- **Allowed extensions:** `.mp3`, `.wav`, `.flac`, `.ogg`, `.opus`, `.m4a`, `.wma`, `.aac`
- **Size cap:** 500 MB per file (413 otherwise)
- **Video → audio:** a dropped `.mp4` is converted to `.m4a` (stream copy when lossless, otherwise re-encoded to AAC) so a Suno draft or video reference becomes playable in one drop
- **Content-addressed dedup:** re-dropping the same file reuses the existing track instead of storing a second copy; the response reports `deduplicated: true`
- **Stored as-is:** audio is never transcoded on upload; the stored filename keeps any content hash prefix the backend assigns

After upload, run **Refresh** in the library so cover extraction and analysis pick up the new file.

## Audio Covers (Built-in Images)

HappyShrimp / Suno MP3s embed a `400x400` or `1024x1024` `attached pic` (ID3 `APIC`, FLAC `PICTURE`, Lavf62). On scan (`GET /api/outputs`), `outputs.py:93` `extract_audio_cover()` probes via FFmpeg:

```
ffmpeg -hide_banner -i audio.mp3  # checks "attached pic" / "Video:"
→ if found: ffmpeg -y -i audio.mp3 -an -vcodec copy -frames:v 1 -update 1 audio/{stem}.jpg
```

- Result: `cover_image: "audio/85a406ef_...jpg"` (relative, served via `GET /output/audio/...jpg`).
- Frontend grid `MediaLibrary.tsx:375` shows `<img cover>` for `audio && cover_image` with `♫` badge; list view `MediaLibrary.tsx:481` shows `10×10` thumb; modal `MediaLibrary.tsx:615` stacks `cover` above `<audio controls autoplay>`.
- Covers are **not** listed as standalone `image` outputs (skip in `scan_output_directory:165` for `subdir == "audio"`).
- Delete removes cover too (`outputs.py:340`).

## Metadata extracted per file

Every scanned output carries a metadata sidecar plus indexed fields the library uses for search, sort, and cards:

| Field | Populated from | Notes |
|-------|---------------|-------|
| `file_type` | extension scan | `audio`, `video`, `image`, `3d` |
| `size_bytes` | filesystem | used for sort + duplicate hashing |
| `created_at` / `modified_at` | filesystem | sort by date |
| `cover_image` | `extract_audio_cover()` (outputs.py:93) | ID3 APIC / MP4 `covr` / Vorbis `metadata_block_picture` / FLAC `PICTURE` |
| `has_cover` | cover present | drives the ♫ badge |
| `duration` | ffprobe | seconds |
| `loudness` | audio analysis | integrated LUFS |
| `waveform` | audio analysis | peak envelope for waveform preview |
| `analysis` | `/api/audio/analysis` | tempo (BPM), beat times, sections, energy curve |

Audio metadata is extracted on scan and on explicit **Probe / Analyze**. Video gets duration, size, and a thumbnail cover where one exists. No hardcoded track lists, filenames, or metadata are stored in frontend code (ARCHITECTURE.md rule — all media-derived data comes from `/api/audio/files` and `/api/audio/analysis`).

## Rename

*Grid hover → Pencil* or *Detail modal → Rename* or *Duplicates panel → Pencil*:

- Frontend `MediaLibrary.tsx:125` `renameOutput(relative_path, new_name)` → `POST /api/outputs/{path}/rename {"new_name": "My Track.mp3"}`.
- Backend validates: no `/` or `\` or `..`, `len <200`, not overwriting, stays inside `output/`. Renames file + sidecars: `file.json`, `file.mp3.json`, `file.jpg` (cover).
- After rename, `fetchOutputs()` + `fetchRecent(12)` refresh.

**API:**
```
POST /api/outputs/audio/85a406ef_Take%20the%20Crown.mp3/rename
{"new_name": "Take the Crown (Final).mp3"}
→ 200 {"new_path": "audio/Take the Crown (Final).mp3"}

## Naming conventions & version control

Consistent filenames make the library searchable without tags. Treat every upload as a candidate for reuse months later:

- **One final version.** Mark one file `final` and move every other cut into an `archive/` subfolder (or prepend `draft-`). Two plausible "final" files side by side is the single most common source of wrong-track bugs.
- **Date first, lowercase, dashes.** `YYYYMMDD-artist-title-version.ext` sorts chronologically and behaves identically on every device; never use spaces or special characters.
- **Say what the file is.** `master`, `instrumental`, `clean`, `explicit`, `cover` — never `final` or `new` alone.
- **Mark clean vs explicit** so the wrong version never ships to a distributor or video timeline.

The library deduplicates by content hash, so re-uploading the same audio never creates a second copy; use rename to give a deduped track a human-readable name instead of re-uploading.

## Delete (and Bulk)

- Grid hover → Trash, Detail → Delete, or Bulk bar (when any checkbox selected).
- Single: `DELETE /api/outputs/{path}` → removes file + `.json` + cover `.jpg` (`outputs.py:340`).
- Bulk: `POST /api/outputs/bulk-delete {"paths": ["audio/a.mp3", "video/b.mp4"]}` → `outputs.py:340` bulk.
- Frontend `MediaLibrary.tsx:97` `deleteOutput` and `MediaLibrary.tsx:148` `bulkDelete` optimistically update local state.

## Trash & undo recovery

Deletes are soft where the UI supports it: a removed file goes to trash first and can be restored within the session. When a bulk delete succeeds, the library refreshes and selection clears. If a delete touches a file still referenced by a job or storyboard, confirm before proceeding — the backend removes sidecars (`.json`, cover `.jpg`) along with the file, so a delete is effectively permanent once the page reloads.

## Duplicates

HappyShrimp re-uploads create exact duplicates with different prefixes (`f3a608e2_Still I Rise.mp3`, `64ab7938_Still I Rise.mp3`, `54360357_Still I Rise.mp3` — same SHA, 5.4 MB each).

*Backend* `outputs.py:250` `GET /api/outputs/duplicates/groups?quick=true`:

- Scans `output/{images,video,audio,previews}` (skips `.json`/cover `.jpg` in audio).
- Hash: `quick=true` → `SHA256(size + first 1MB + last 8KB)` (fast, 50 files <100ms); `quick=false` → full SHA256.
- Groups `hash → [paths]`, keeps `len ≥2`, sorts by `wasted_bytes = size*(count-1)` descending.

*Frontend* `MediaLibrary.tsx:161` `handleFindDuplicates()` → `GET /api/outputs/duplicates/groups` → panel `showDuplicates`:

- Header: `Duplicate groups — 3 found • Exact hash (size + 1MB) • keeps oldest, deletes rest`
- Each group: `#hash • 3 files • 10.8 MB wasted` + `Keep oldest, delete 2` button → `bulkDelete(files.slice(1))` + refresh.
- Grid/list cards show amber `Copy` dot at `top-2 right-10` if `duplicatePaths.has(relative_path)`.

## Smart views

The library root offers filtered views that replace the folder/file grid entirely while active:

- **Favorites** — every starred item of the current kind
- **Recent uploads** — files added in the last 7 days
- **Duplicates** — exact-hash groups; only shown when at least one pair exists

Use these instead of re-running a search when you repeatedly need the same slice of the library.


- Grid card top-right: `Square` / `CheckSquare` (`violet-600` when selected) toggles `selectedPaths: Set<string>` (`MediaLibrary.tsx:140` `toggleSelect`).
- List row first column same.
- When `selectedPaths.size >0`, bulk bar appears (`MediaLibrary.tsx:316`): `N selected — Clear / Delete Selected` → `POST /bulk-delete`.

## Keyboard shortcuts & selection

- `Shift + click` — selects a range from the last item clicked
- `Ctrl / Cmd + A` — selects everything in the current view
- Checkbox on a card, or click-drag over empty grid space — starts or extends a selection without opening anything
- `Escape` — closes playback modal, detail modal, or duplicates panel
- Click-drag needs to move more than ~5 px to count as a rubber-band selection, so a steady click still opens the item

## Playback

- **Video:** grid cover or `VIDEO` icon → click → modal `<video src="/output/video/...mp4" controls autoplay class="max-h-[60vh] bg-black">`.
- **Audio:** grid cover (extracted) → click → modal `<img cover>` + `<audio controls autoplay>` (`MediaLibrary.tsx:615`). No embedded cover → `Music` placeholder + “No embedded cover” hint.
- All served via Vite proxy `/output/*` → `http://localhost:8000/output/*` or direct `getOutputUrl()`.

## Performance for large libraries

- **Pagination:** the grid paginates at 50 files per page; only the current page renders
- **Thumbnail lazy loading:** video covers are captured in the browser as the card nears the viewport (at most three at once), so a heavy folder fills in progressively rather than all at once
- **Filter counts are real:** search, filters, and sorting run across the entire library, not just the loaded page; counts reflect the full result set

## Troubleshooting

| Issue | Cause | Fix |
|---|---|---|
| Cover not shown | No `attached pic` in file | Add via ID3 editor, re-upload |
| Cover shows generic icon after upload | Scan hasn't run | Click **Refresh** — scan extracts on demand |
| Rename fails `409` | Target exists | Pick different name |
| Delete leaves `.jpg` | Old file before cover extraction | Manually delete `audio/*.jpg` or re-extract |
| Duplicates not found | Files differ by 1 byte (different encode) | Use `quick=false` for full hash, or accept as not duplicate |

## Security

- **Path traversal protection:** rename and delete reject any path containing `/`, `\`, or `..`, and require the target to stay inside `output/` (backend `outputs.py`)
- **Safe filenames:** the backend sanitizes names to `<200 chars, no path separators, no overwriting an existing file`; the frontend never constructs a path from raw user input
- **No hardcoded metadata:** all media-derived data comes from `/api/audio/files` and `/api/audio/analysis`; never bake track lists or filenames into frontend code

## See Also

- `technical-reference.md` — Outputs API, job queue
- `music-video-production.md` — Pipeline that creates `output/video/*.mp4`
- `outputs.py:93` — extraction impl

*This doc should be updated when new output types or hash methods are added.*

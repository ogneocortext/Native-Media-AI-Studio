# File Management Guide — Media Library

> **Last Updated:** 2026-09-05 • Covers `output/` file ops: play, cover art, rename, delete, duplicates

## Overview

`output/` is the single source of truth (`output/images`, `output/video`, `output/audio`, `output/previews`). Every generation writes a file + sidecars (`.json` metadata, `audio/*.jpg` cover). The **Media Library** (`/library`) is the UI for all ops — no file explorer needed.

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
```

## Delete (and Bulk)

- Grid hover → Trash, Detail → Delete, or Bulk bar (when any checkbox selected).
- Single: `DELETE /api/outputs/{path}` → removes file + `.json` + cover `.jpg` (`outputs.py:340`).
- Bulk: `POST /api/outputs/bulk-delete {"paths": ["audio/a.mp3", "video/b.mp4"]}` → `outputs.py:340` bulk.
- Frontend `MediaLibrary.tsx:97` `deleteOutput` and `MediaLibrary.tsx:148` `bulkDelete` optimistically update local state.

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

## Selection & Bulk Bar

- Grid card top-right: `Square` / `CheckSquare` (`violet-600` when selected) toggles `selectedPaths: Set<string>` (`MediaLibrary.tsx:140` `toggleSelect`).
- List row first column same.
- When `selectedPaths.size >0`, bulk bar appears (`MediaLibrary.tsx:316`): `N selected — Clear / Delete Selected` → `POST /bulk-delete`.

## Playback

- **Video:** grid cover or `VIDEO` icon → click → modal `<video src="/output/video/...mp4" controls autoplay class="max-h-[60vh] bg-black">`.
- **Audio:** grid cover (extracted) → click → modal `<img cover>` + `<audio controls autoplay>` (`MediaLibrary.tsx:615`). No embedded cover → `Music` placeholder + “No embedded cover” hint.
- All served via Vite proxy `/output/*` → `http://localhost:8000/output/*` or direct `getOutputUrl()`.

## Troubleshooting

| Issue | Cause | Fix |
|---|---|---|
| Cover not shown | No `attached pic` in file | Add via ID3 editor, re-upload |
| Cover shows generic icon after upload | Scan hasn't run | Click **Refresh** — scan extracts on demand |
| Rename fails `409` | Target exists | Pick different name |
| Delete leaves `.jpg` | Old file before cover extraction | Manually delete `audio/*.jpg` or re-extract |
| Duplicates not found | Files differ by 1 byte (different encode) | Use `quick=false` for full hash, or accept as not duplicate |

## See Also

- `technical-reference.md` — Outputs API, job queue
- `music-video-production.md` — Pipeline that creates `output/video/*.mp4`
- `outputs.py:93` — extraction impl

*This doc should be updated when new output types or hash methods are added.*

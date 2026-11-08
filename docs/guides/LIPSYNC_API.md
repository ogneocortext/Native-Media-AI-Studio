# Lip-Sync API — External Caller Contract (Maya handoff)

> **Status:** live and verified 2026-11-08. Real MuseTalk v1.5 inference
> runs on this machine (GTX 1070 Ti, 8 GB VRAM). Local-only — no
> third-party lip-sync APIs are used or contacted.

## Base URL

```
http://100.95.60.73:8004
```

This machine's Tailscale address (`customrig`, tailnet
`tailb89a58.ts.net`). The FastAPI backend binds `127.0.0.1:8004`;
`tailscale serve --tcp=8004` forwards tailnet traffic to it. Reachable
from any tailnet node (e.g. `muse` at `100.124.151.51`) — **tailnet
membership required**, it is not exposed to the public internet.

Equivalent hostname form: `http://customrig.tailb89a58.ts.net:8004`
(also in the TrustedHost allowlist).

## Submit a job

```
POST /api/video/lipsync
Content-Type: application/json
```

Request body (`LipSyncRequest`, `packages/backend/app/api/video.py:815`):

| Field | Type | Required | Meaning |
|---|---|---|---|
| `video_path` | string (abs path) | one of video/image | Existing clip to lip-sync |
| `image_path` | string (abs path) | one of video/image | Still portrait to animate + lip-sync |
| `audio_path` | string (abs path) | yes* | Audio file on this machine — **pass the isolated vocals stem for best results** (full mixes sync markedly worse) |
| `audio_filename` | string | alternative | Filename resolved under `output/audio/` (traversal-guarded) |
| `section` | string | no (default `"chorus"`) | Song section label, carried into job metadata |
| `output_path` | string (abs path) | no | Exact output file; default `output/video/<source-stem>_lipsync_<job8>.mp4` |

\* Exactly one of `audio_path` / `audio_filename` is effectively required —
without audio the endpoint returns 400.

Example:

```json
POST /api/video/lipsync
{
  "video_path": "D:\\MuseTalk\\data\\video\\yongen.mp4",
  "audio_path": "D:\\MuseTalk\\data\\audio\\yongen.wav",
  "section": "smoke",
  "output_path": "D:\\Backup of Important Data for Windows 11 Upgrade\\Native Media AI Studio\\output\\video\\lipsync_remote_smoke.mp4"
}
```

Response (`LipSyncResponse`):

```json
{"success": true, "job_id": "43e12f16-6dd9-44ea-8e08-993c22a0484d",
 "output_path": "D:\\...\\output\\video\\lipsync_remote_smoke.mp4",
 "section": "smoke", "error": null,
 "message": "Queued lip-sync for section 'smoke' as job 43e12f16"}
```

Errors: `400` bad request, `404` source/audio file not found,
`503` MuseTalk not ready (weights missing / `inference.command` unset).

**Important:** `video_path`/`audio_path`/`output_path` are **filesystem
paths on this machine**, not uploads. To feed remote media, first copy
the files onto this host (e.g. into `output/audio/` or `output/video/`
and reference them by absolute path). For audio + still-image inputs
use the upload endpoint below — it is the intended remote path.

## Upload inputs (remote callers)

```
POST /api/video/lipsync-upload
Content-Type: multipart/form-data
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `audio` | file | yes | Audio to sync to. Allowlist: `.wav` `.mp3` `.m4a` `.flac`; ≤ 50 MB (413 beyond) |
| `image` | file | no | Still portrait to animate + lip-sync. Allowlist: `.png` `.jpg` `.jpeg` `.webp`; ≤ 50 MB |
| `video_path` | string | no | Rig-local clip (same as `/lipsync`) — mutually exclusive with `image`/`image_path` |
| `image_path` | string | no | Rig-local still — used only when no `image` file is sent |
| `section` | string | no (default `"chorus"`) | Section label |
| `output_path` | string | no | Exact output path; same default rule as `/lipsync` |

Staging behavior:

- Files are stored under `output/uploads/lipsync/` as
  `<uuid4-hex>.<ext>` — the client-supplied filename is used for its
  extension only, never for the stored name (no traversal, no
  collisions, no overwrites).
- `output/uploads/` is excluded from the media-library scanner, so
  staged inputs never appear as library items.
- Sending both an `image` file and `image_path`/`video_path` → 400.
- Bad extension → 400; oversized → 413; missing audio part → 422
  (FastAPI required-field).
- The staged paths feed the same job machinery unchanged — response
  shape, polling (`GET /api/jobs/{job_id}`), and download
  (`GET /output/video/...`) are identical to `/lipsync`.

Example:

```bash
curl -X POST http://100.95.60.73:8004/api/video/lipsync-upload \
  -F "audio=@voice.wav" -F "image=@portrait.png" \
  -F "section=hook" -F "output_path=D:\\...\\output\\video\\out.mp4"
```

## Poll status

```
GET /api/jobs/{job_id}
```

Returns the queue `Job` object — poll until `status` is `completed`,
`failed`, or `cancelled`. Relevant fields observed live:

```json
{"status": "running", "progress": 0.95, "message": "Rendering 100%",
 "started_at": "...", "completed_at": null, "error": null, "result": null}
```

- `progress` is 0–1; `message` carries the latest stage
  ("running MuseTalk", "Rendering NN%").
- `result` on completion contains `output_path`, `backend`, `source_fps`,
  `target_fps`, `use_float16`.
- `POST /api/jobs/{job_id}/cancel` cancels; the adapter terminates the
  MuseTalk subprocess and releases VRAM.

## Download the output

Outputs land under `output/` and are served statically:

```
GET /output/{relative-path-under-output/}
```

For the default output path `output/video/<name>.mp4`:

```
GET /output/video/<name>.mp4
```

Verified live: `GET http://100.95.60.73:8004/output/video/lipsync_remote_smoke.mp4`
→ HTTP 200, 826,536 bytes, valid 8 s mp4, ~0.14 s.

Map the absolute `output_path` from the submit response to a URL by
stripping the `output/` root: `<repo>/output/video/x.mp4` →
`/output/video/x.mp4`.

## Batch variant (long audio)

For audio longer than ~20 s, prefer the chunked batch flow — it keeps
VRAM flat (one ~20 s chunk per job) and stitches at the end:

| Step | Route |
|---|---|
| Submit | `POST /api/video/lipsync-batch` — same body + `chunk_seconds` (default 20, max 120) |
| Status | `GET /api/video/lipsync-batch/{batch_id}` → `{total, completed, failed, stitched, chunks[]}` |
| Stitch | `POST /api/video/lipsync-batch/{batch_id}/stitch` (idempotent; muxes source audio back) |
| Cleanup | `DELETE /api/video/lipsync-batch/{batch_id}` — 409 while any chunk job is active |

## Remote-route proof (2026-11-08)

The existing 8 s smoke pair (`yongen.mp4` + `yongen.wav`) was run
entirely over `http://100.95.60.73:8004`:

- `POST /api/video/lipsync` → job `43e12f16-…`
- `GET /api/jobs/{id}` polled to `completed` — wall clock **~6.5 min**
  (slower than the 220 s local-adapter run; landmark extraction re-ran
  and the queue was live — the model cost dominates, not the network)
- `GET /output/video/lipsync_remote_smoke.mp4` → 200, byte-identical
  size to the local render (826,536 B)

Upload-path proof (same day, still image + wav over multipart):
`POST /api/video/lipsync-upload` → job `a945bfd6-…` → completed in
**~4.5 min** wall (still input skips per-frame landmark detection) →
`GET /output/video/lipsync_upload_smoke.mp4` → 200, 171,888 B, 8.0 s,
704×1216 @ 25 fps, 200 frames.

Network overhead is negligible; the ~25–30× realtime factor is MuseTalk
inference on the 1070 Ti at `batch_size: 1` (kept at 1 — 8 GB VRAM).

## Operational notes for the caller

- **One job at a time is safest.** The queue serializes LIPSYNC jobs,
  but other GPU work (ComfyUI, Ollama) competes for the same card.
- Cold start adds ~30–60 s (model load); keep-alive is per-process, so
  back-to-back jobs in one batch amortize it.
- Face must be visible and roughly frontal; MuseTalk detects one face
  per frame and skips frames with `coord_placeholder`.
- `section` is metadata only — any string.
- Source fps ≠ 25 produces a warning in job logs; MuseTalk was trained
  at 25 fps.

---
tags:
  - production
  - video
---

# Video Generation — Route Documentation

> Compiled: 2026-09-15 · **Rewritten 2026-11-05** against the current tree
> Context: Native Media AI Studio — `/create/video` route reference

## Overview

`/create/video` is the **text-to-video / image-to-video (T2V/I2V)
generation** page. It lives at
`packages/frontend/src/features/video-generation/VideoGenerationPage.tsx`
and provides:

- Three modes: T2V (prompt only), I2V (prompt + uploaded start image —
  Wan TI2V / LTX I2V), and section-based generation
- Model picker driven by `/api/video/models` (Wan 2.2 TI2V, LTX, etc.)
- Queue status and per-job progress with named stages
  (queued → uploading → planning → rendering → ready)
- Advanced settings (scheduler, seed, fps, resolution, section,
  start_image for I2V)
- Result gallery with variation support and inspiration gallery in the
  empty state

The legacy `/video-generation` path redirects to `/create/video`
(`App.tsx`). The **music-video wizard** is a different surface: it lives
at `/create/music-video`
(`packages/frontend/src/features/music-video/MusicVideoWizard.tsx`) and
still calls the `/api/integrations/music-video/*` backend documented
below.

## Architecture

### Core Components (`features/video-generation/`)

- **VideoGenerationPage.tsx** — orchestrator; mode selection, prompt,
  validation checklist, result gallery
- **components/ModelSelector.tsx** — video model picker
- **components/AdvancedSettings.tsx** — scheduler/seed/fps/resolution/
  section/start-image controls
- **components/JobProgress.tsx** — staged progress display
- **components/QueueStatus.tsx** — queue depth / position
- **hooks/** — `useVideoModels`, `useJobProgress`, `useQueueStatus`
- **utils/** — `stylePlaceholders.ts`, `videoModelInfo.ts`

### Music-Video Wizard (`features/music-video/`)

- **MusicVideoWizard.tsx** — step flow for the beat-synced music video
- **steps.tsx**, **types.ts**, **PromptHistoryPanel.tsx**

### Backend Contract (music-video path, `api/integrations_music_video.py`)

All routes are mounted under `/api/integrations`:

| Method | Path | Purpose |
|---|---|---|
| GET | `/music-video/styles` | 7 visual styles (see below) |
| POST | `/music-video/generate` | Queue a `JobType.MUSIC_VIDEO` job |
| POST | `/music-video/generate-preview` | Quick preview job (`MUSIC_VIDEO_PREVIEW`) with Wan GGUF / AnimateDiff motion controls |
| POST | `/music-video/preview` | 5-second draft preview (`PreviewGenerationRequest`) |
| POST | `/music-video/style-preview` | Single-image style thumbnail via ComfyUI |
| GET | `/music-video/job/{job_id}/progress` | Progress, ETA, frame counters |
| GET | `/music-video/templates` | Workflow templates |

`MusicVideoRequest` fields: `audio_path`, `style` (template_id, prompt,
negative_prompt, motion_strength, beat_reactivity), `beat_markers`,
`duration` (`30s|60s|90s|full`), `resolution` (`720p|1080p|4k`), `fps`,
`quality` (`draft|standard|high` → steps 10/20/30), `num_frames`
(**default 16**), `motion_module`, `genre`, `track_name`,
`on_source_failure` (`auto|fail` — Q2 deterministic fallback).

### Generation Pipeline

1. Frontend POSTs `MusicVideoRequest`; backend enqueues
   `JobType.MUSIC_VIDEO` with resolved width/height/steps/num_frames
2. `ensure_vram_available(required_mb=4096)` runs first; a shortfall or
   a missing/disconnected ComfyUI adapter degrades the job to the
   deterministic visualization path (`method: "visualization"`,
   `degraded: true`) unless `on_source_failure="fail"` (then 503)
3. ComfyUI adapter builds the AnimateDiff / Wan workflow; progress is
   polled via `/music-video/job/{job_id}/progress` (no SSE on this path)
4. `estimated_end_time` is computed from `datetime.now(UTC)` and returned
   with a `Z` suffix

### 7 Music Video Styles

| ID | Name | Category | Prompt Focus |
|---|---|---|---|
| `cyberpunk_neon` | Cyberpunk Neon | energetic | Neon cityscape, synthwave |
| `organic_flow` | Organic Flow | organic | Nature, water, smoke |
| `geometric_pulse` | Geometric Pulse | geometric | Triangles, hexagons, pulsing |
| `particle_dance` | Particle Dance | abstract | Swirling particles, volumetric |
| `vinyl_retro` | Vinyl Retro | atmospheric | Spinning vinyl, 1970s warm |
| `waveform_classic` | Waveform Classic | geometric | Oscilloscope, green phosphor |
| `fire_energy` | Fire Energy | energetic | Flames, heat distortion |

## Key Patterns

### Degraded Fallback (Q2)

```python
adapter_available = adapter is not None and adapter.get_status() == AdapterStatus.CONNECTED
if not adapter_available:
    if fail_fast:  # on_source_failure == "fail"
        raise HTTPException(503, ...)
    degraded, degraded_reason = True, "ComfyUI adapter not available"
```

The same degradation applies to insufficient VRAM. A registered-but-
disconnected ComfyUI counts as unavailable — check `get_status()`, not
just registry membership.

### Progress Polling

```tsx
// frontend polls GET /api/integrations/music-video/job/{jobId}/progress
// response: { progress, current_step, total_steps, current_frame,
//            total_frames, elapsed_seconds, remaining_seconds,
//            estimated_end_time, error }
```

`created_at` is naive **local** time; elapsed is computed against
`datetime.now()`, while `estimated_end_time` is rendered in UTC with a
`Z` suffix. Do not "fix" either clock — they are deliberate.

## Known Limitations

- Style preview (`style-preview`) requires ComfyUI and ≥2 GB free VRAM;
  it is synchronous and can time out on busy machines
- Wan 2.2 TI2V-5B GGUF (Q4/Q5 + CPU T5 offload) is the practical quality
  ceiling for the GTX 1070 Ti 8GB; 1080p+ sustained generation needs
  cloud or 16 GB+ VRAM
- LTX distilled variants auto-force `cfg=1.0`; WAN enforces a minimum of
  40 steps in its workflow path
- Preview generation returns after enqueueing a `MUSIC_VIDEO_PREVIEW`
  job; there is no separate async preview poller beyond the shared
  job-progress endpoint

## Related Files

- `packages/frontend/src/features/video-generation/` — T2V/I2V page,
  components, hooks
- `packages/frontend/src/features/music-video/` — music-video wizard
- `packages/frontend/src/services/api/integrations.ts` —
  `getMusicVideoStyles()`, templates client
- `packages/frontend/src/services/api/index.ts` — re-exports
- `packages/backend/app/api/integrations_music_video.py` — all
  `/api/integrations/music-video/*` routes
- `packages/backend/app/api/integrations_config.py` —
  `ensure_vram_available` advisory preflight
- `packages/backend/app/services/generation_estimator.py` —
  `estimate_generation_time`

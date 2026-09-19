# Video Generation — Route Documentation

> Compiled: 2026-09-15
> Context: Native Media AI Studio — `/video-generation` route reference

## Overview

`/video-generation` is the **music-video wizard** UI. It lives at `packages/frontend/src/features/video-generation/VideoGenerationPage.tsx` and provides:
- Style picker with 7 backend-driven visual styles
- Prompt suggestion engine (auto-generated from audio metadata)
- Workflow template selector (AnimateDiff, Wan 2.2, Kandinsky)
- Progress polling with ETA and stage breakdown
- Preview generation (5-second 720p draft)
- Output gallery with download

## Architecture

### Core Components
- **VideoGenerationPage.tsx** — main wizard page; state machine for step flow (style → prompt → generate → preview)
- **StylePicker.tsx** — card grid of 7 styles with gradient previews; fetches `/api/integrations/music-video/styles`
- **WorkflowSelector.tsx** — model/template picker (AnimateDiff SD 1.5, Wan 2.2 text/image-to-video, Kandinsky 5 Lite)
- **ProgressPanel.tsx** — SSE-backed progress bar with stage labels (Upload → Audio Analysis → Rendering → Done)
- **OutputGallery.tsx** — grid of generated videos with `download_url` and `job_id`

### Backend Contract
- **Styles endpoint**: `GET /api/integrations/music-video/styles` → `{ styles: [...] }`
- **Generate endpoint**: `POST /api/integrations/music-video/generate` → `{ job_id, status, estimated_duration }`
- **Progress endpoint**: `GET /api/integrations/music-video/job/{job_id}/progress` → `{ progress, current_step, total_steps, estimated_end_time }`
- **Preview endpoint**: `POST /api/integrations/music-video/style-preview` → `{ success, image, output_path }`

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

### Generation Pipeline
1. Frontend POSTs `MusicVideoRequest` to backend
2. Backend enqueues `JobType.MUSIC_VIDEO` with params (prompt, style_template, motion_strength, beat_reactivity, num_frames)
3. ComfyUI adapter builds AnimateDiff or Wan video workflow
4. Job status streamed via SSE (`GET /api/events`)
5. Output written to `output/video/` with JSON sidecar (`job_id`, `prompt`, `seed`, `model`, `generation_time`)
6. Frontend polls `progress` endpoint; `estimated_end_time` computed from `datetime.now(timezone.utc)`

## Key Patterns

### Style Selection
```tsx
const STYLE_GRADIENTS: Record<string, string> = {
  cyberpunk_neon: "linear-gradient(135deg, #ff00ff 0%, #00ffff 50%, #ff00aa 100%)",
  // ... 7 total
};
```

### Progress Polling
```tsx
const startProgressPolling = useCallback((jobId: string) => {
  progressIntervalRef.current = setInterval(async () => {
    const res = await fetch(`/api/integrations/music-video/job/${jobId}/progress`);
    const data = await res.json();
    setJobProgress(data);
  }, 2000);
}, []);
```

### VRAM Guard
Backend checks `ensure_vram_available(required_mb=4096)` before enqueue. Frontend shows VRAM status badge from response `vram_status`.

## Known Limitations
- Style preview generation (`style-preview` endpoint) requires ComfyUI and 2GB+ free VRAM — can timeout on busy machines
- Wan 2.2 5B 480p is the practical ceiling for GTX 1070 Ti 8GB; 1080p+ requires model offloading
- `num_frames` defaults to 16 in the Pydantic model but is overwritten by `target_duration * fps` in the handler
- Preview generation is synchronous (returns after render); no async polling for preview jobs

## Related Files
- `packages/frontend/src/features/video-generation/VideoGenerationPage.tsx`
- `packages/frontend/src/features/video-generation/StylePicker.tsx`
- `packages/frontend/src/features/video-generation/ProgressPanel.tsx`
- `packages/backend/app/api/integrations_music_video.py` — styles + generate + progress endpoints
- `packages/backend/app/api/integrations_config.py` — `ensure_vram_available` (advisory preflight)
- `packages/backend/app/services/generation_estimator.py` — `estimate_generation_time`
- `packages/frontend/src/services/api.ts` — `getMusicVideoStyles()`, `generateMusicVideo()`

# Music Video Studio Guide

> **Last Updated:** August 2026 (Three.js Studio modernization) • **UI:** Dashboard `Drop your song` → Wizard `5 steps` (live)
> **For Classic tabbed UI see `Docs → Guides & API → MUSIC_VIDEO_GUIDE (Classic)` in vault `music-video-production.md`**

## Overview (3 steps, not 6)

The primary flow is **Dashboard → Wizard**. Classic `Music Video (tabs)` at `/music-video` still exists but is secondary.

```
Dashboard hero "Drop audio file here" → Wizard: Upload → Analyze → Style → Generate → Export
```

| Step | What happens | Where |
|---|---|---|
| **1. Drop** | Upload MP3/WAV/FLAC/OGG/M4A (500 MB) → saved to `output/audio/{id}_name.mp3` | Dashboard drop-zone or Wizard `Upload` |
| **2. Analyze** | `POST /api/audio/analyze` → real `librosa` `tempo_bpm`, `beat_times[~300]`, `energy_curve[100]`, `sections[8]` energy-aware beat-snapped | Wizard `Analyze` shows intro/verse/chorus bars with energy |
| **3. Style → Generate → Export** | Structured prompt `Shot+Angle+Subject+Action+Setting+Lighting+Mood` → per-section `POST /api/video/generate-section` queues `MUSIC_VIDEO` jobs → poll `GET /api/jobs/{id}` → FFmpeg `testsrc+geq` → `output/video/*.mp4` → `Media Library` | Wizard `Style`/`Generate`/`Export` |

No separate `Beat Timeline` tab in wizard — beats are shown in Analyze and cuts land on strong beats automatically (92% sync target per vault).

## Quick Start (Wizard)

### 1. Upload
- From **Dashboard**: drop file onto `Drop audio file here` (violet card) — it handoffs via `window.__pendingAudioFile` to Wizard, no re-upload. Or click to browse.
- From **Wizard Upload**: `Click or drop audio file here` or `or paste a track from Media Library`. Supports `MP3, WAV, FLAC, OGG, M4A`.

### 2. Analyze (automatic)
- `Analyze Track →` calls `POST /api/audio/analyze` (multipart). On success shows:
  - `Tempo 97.5 BPM | Duration 234s | Beats 336 | Confidence 0.365`
  - Song Structure bar: `intro 0→29.5 0.20 / chorus 29→58 0.795 … outro 204→234 0.524` (8 max, `beat_times[0]=20.3s` matches `VISUAL_STORYTELLING_2026.md`).
- If backend shows `503 librosa not installed`, run in venv: `pip install librosa soundfile`.

### 3. Style
- **Structured Builder** (not 6 style templates): `Shot size` (`Wide/Medium/Close-up`…) + `Camera angle` → auto-composes `Medium shot, eye-level angle, a joyful shrimp dancing… underwater disco club, colorful neon lighting, energetic and fun, cinematic 35mm film`.
- **Style suggestions:** 5 pills `happy/calm/dark/electronic/natural` → `+ upbeat` appends to prompt.
- **Prompt:** one flowing paragraph `<75 words`, present tense. See `FILE_MANAGEMENT.md` for rename/cover.
- **Vertical-first:** checkbox `Vertical-first master (9:16)` → `1080×1920` safe `1620px` (top 100 / bottom 200), derive `16:9` by framed center.
- **Reference Images:** drop 3-5 style refs for lock (character/scene) — shown as 3-col thumbs.

### 4. Generate (per-section, serial)
- Lists each detected section with `energy%` and `Visual Treatment` (`intro: wide`, `chorus: peak close-ups`). Optional per-section prompt override.
- `Generate Video — N sections` → sequential `POST /api/video/generate-section` with `audio_path: stored_path` from Analyze, then `poll GET /api/jobs/{id}` every `1.2s` until `completed` (not fake `400ms`). Queue is serial to avoid `GTX 1070 Ti 8GB` OOM.

### 5. Export
- Matrix: `YouTube 16:9 1920×1080 16Mbps`, `Shorts 9:16 1080×1920 safe 1620`, `Canvas 3-8s loop` + `Thumbnails ×3 A/B` — same as `youtube-optimization.md`.
- Opens `Media Library` — covers extracted via `FILE_MANAGEMENT.md`.

## Classic vs Wizard

|  | Wizard (primary) | Classic `/music-video` (secondary) |
|---|---|---|
| Entry | Dashboard hero | Sidebar `Music Video (Classic)` |
| Steps | 5 linear | 4 tabs `Audio/AI Visuals/Visual Style/Beat Timeline/Batch` |
| Beats | Auto in Analyze | Manual `Beat Timeline` editor `Add Marker/Auto-Detect` |
| Use when | First video, guided | Fine-tuning beats or batch of 3+ tracks |

Classic docs remain in vault `music-video-production.md` — this guide no longer repeats them.

## Visualization Styles

The wizard's **Style suggestions** map to these, but you write the prompt, not pick a template card:

- **Cyberpunk Neon** — `neon futuristic cyberpunk` → `laser`/`chrome` prompts
- **Organic Flow** — `organic earthy warm` → `underwater garden` etc.
- **Geometric Pulse** — `sharp hexagon` → `pulse on beat`
- **Particle Dance** — `particle swirl` → `bass → scale`
- **Vinyl Retro / Waveform Classic** — `retro VHS` → `low contrast`

For full palette/mood mapping see `prompt-engineering.md`.

## Render Settings (in Style → Technical)

- `Steps` 15 draft / 20 std / 30 high
- `CFG` 7.0 balanced
- `Seed` `-1` = random
- `Wan 2.2 5B @ 480p` fits 8GB (see `GPU_PIPELINE.md`)

## Batch (Wizard does not batch — use Classic)

For 3+ tracks: switch to Classic `/music-video` → `Batch Queue` tab → `Add to Batch` → `Process N Pending Jobs`. Wizard is 1 track at a time by design to keep VRAM safe.

## Tips

- **Preview first is now Generate per-section:** each section polls real job, so first section = your preview.
- **Serial queue:** `GET /api/jobs/stats` → `0 pending 0 running` before next. Don't parallelize.
- **FFmpeg required:** `ffmpeg -version` must be `8.1+` with `libx264`/`aac` (see `GPU_PIPELINE.md` troubleshooting).

## Troubleshooting (unique to Wizard — other tables live in `FILE_MANAGEMENT.md` / `GPU_PIPELINE.md`)

| Issue | Solution |
|---|---|
| `503 librosa not installed` | `venv\Scripts\python -m pip install librosa soundfile` then restart backend |
| `audio_path is required` on Generate | Upload via Dashboard/Wizard Upload first; if you picked from `Media Library`, ensure `stored_path` was passed (see `MediaLibrary → Create Video` handoff) |
| Job `failed: FFmpeg failed: No option name near` | Fixed in `handler.py:213` `geq:cb:cr` colon bug — pull latest and restart backend |
| `409 Target already exists` on rename | Pick different name (`FILE_MANAGEMENT.md`) |

## Three.js Studio (live reactive preview)

The Three.js Studio is a **lightweight, browser-based, music-reactive 3D scene editor** at `/three-js-studio`. It is the fastest path from "I have a song" to "I have a music-video-style visual" — no Unity, no Blender render queue, no GPU-hours. It is a preview/composition tool, not a final renderer; for shipping quality use the Wizard above or the Unity → Blender → Remotion pipeline.

### When to use

- Quick concept exploration: load a track, try every scene template, see what fits the mood.
- Album visualizer / YouTube loop: export PNG frames at 24/30/60 fps and stitch in Remotion.
- 3D motion reference for downstream tools: drive Unity scene parameters from the beat timeline.
- Live performance backdrop: fullscreen a second monitor and play the song.

### Layout (compact + responsive)

- **Header (single row):** Play/Pause · quick-add (Crown/Sphere/Box) · track selector (auto-fills BPM) · Export PNG · drawer toggle.
- **Track info bar (only when a track is selected):** BPM input · Sync ON/OFF · live beat count · beat-punch slider.
- **Canvas:** fills all available space; no side panels competing for room.
- **Bottom drawer (3 tabs):** **Objects** · **Inspector** · **Scene**. Default closed so the canvas stays large.

### Scene templates (one click → production-ready)

Defined in `packages/frontend/src/features/three-js-studio/sceneTemplates.ts`. Each template bundles mesh layout, particles, camera, and tuned post-fx:

| Template | What it is | Best for |
|---|---|---|
| 🎤 **Concert Stage** | Lit stage + hero + 3 orbital colored spotlights | Pop / EDM / hip-hop with a "performer" focal point |
| 🌌 **Cosmic Void** | Planet + ring system + dust particles | Ambient / chill / synthwave |
| 🎚️ **Equalizer Wall** | 32 bars, each Y-scale driven by live bass | Any genre with strong bass (trap, dubstep, dnb) |
| 🏙️ **Geometric City** | 24 glowing pillars + skyline hero, dolly cam | Lo-fi / cyberpunk / vaporwave |
| 💿 **Vinyl Spin** | Turntable + spinning record + tonearm | Soul / funk / classic hip-hop |
| ✨ **Pulse Orb** | Single hero sphere, max beat punch | Minimalist intro/outro cards |

Click any template to **replace** the current scene. After loading, every object is still editable in the Inspector tab — templates are starting points, not lock-ins.

**Audio-driven primitives:** the **Equalizer Wall** and **Geometric City** templates set `audioDriven: "bars" | "pillars"`. The animation loop reads live Web Audio FFT (bass/treble) and modulates each object's Y-scale per frame — no timeline scrubbing needed, just play audio and it pulses.

### Real beat timeline (no more sine waves)

Previously the studio animated to `Math.sin(elapsed * beatPhase)`. The new `useBeatTimeline` hook (`packages/frontend/src/hooks/useBeatTimeline.ts`) reads real `beat_times[]` from the cached `librosa` analysis and exposes a per-frame `getCurrentBeat(elapsed)` API:

- `isOnBeat` — 100 ms window after each onset
- `timeSinceLastBeat` — for decay curves
- `smoothedEnergy` — interpolated `amplitude_envelope` for sub-beat motion

The animation loop prefers real-beat spikes over continuous sine. The HUD shows the loaded beat count (e.g. `Beats: 298 loaded`) when a track is selected and its cache is warm.

> **If the HUD shows `Beats: error`:** the cache miss is by design — open **Audio Analysis** for that track first, then return. The cache endpoint is `/api/audio/analysis/<filename>`.

### Post-FX chain (Scene tab)

| Pass | Default | What it does |
|---|---|---|
| Selective Bloom | ON | Only objects flagged `Hero glow` glow; rest of scene stays neutral |
| Chromatic Aberration | 0.0025 | Subtle RGB split, the music-video "lens" feel |
| Film Grain | 0.12 | Light noise to break up the synthetic look |
| Vignette | 0.55 darkness / 0.65 radius | Darkened corners, classic cinema framing |
| Beat Punch | 0.18 | Discrete scale spike on each beat onset |

All passes are code-split into their own chunks so the main bundle isn't bloated.

### Image as background (ComfyUI + Media Library integration)

The Scene tab exposes a **Background Image** field with a **Recent from library** thumbnail strip (12 covers, auto-loaded from `/api/outputs?file_type=audio|video|image` `cover_image` fields). Click any thumbnail to set it as the scene background — your album art, video thumbnails, or any AI-generated image from Image Gen.

The image is loaded via `THREE.Texture`, assigned to `scene.background`, and gets the same post-FX chain applied so the background blends with the music-video aesthetic. Common flows:

1. **Album art as background:** open Media Library, find a track cover, click it in the quick-pick.
2. **AI-generated visual:** generate an image via Image Gen, copy the `/output/image/...` URL, paste into the field.
3. **External image:** paste any HTTPS URL (e.g. from ComfyUI's `/view` endpoint).

The field also has a "Show background image" toggle for A/B compare without reloading the texture.

### When to use the Wizard vs Studio

| Goal | Use |
|---|---|
| Final render at 1080p+ with audio sync | **Wizard** (per-section video generation) |
| Quick concept preview, social loops, motion reference | **Studio** (frame export at 24/30/60 fps) |
| Cinematic shot with volumetric lighting | **Unity + Blender pipeline** (vault `music-video-production.md`) |
| Just need a visual for the song on Twitter/Discord | **Visualizer** page (`/visualizer`) — 7 styles, no editing |

### File map (Studio-specific)

- `packages/frontend/src/features/three-js-studio/ThreeJSStudio.tsx` — main editor + animation loop
- `packages/frontend/src/features/three-js-studio/sceneTemplates.ts` — the 6 templates, add new ones here
- `packages/frontend/src/features/three-js-studio/types.ts` — shared `AnimObject`/`SceneConfig`/`ParticleConfig` types
- `packages/frontend/src/hooks/useBeatTimeline.ts` — real-beat timeline hook

## See Also (no duplication)

- **File ops (covers, rename, duplicates):** `FILE_MANAGEMENT.md`
- **3D stage, Blender MCP, EEVEE vs Cycles, VRAM:** `GPU_PIPELINE.md`
- **YouTube titles, thumbnails, Shorts safe zones:** `youtube-optimization.md` (vault)
- **Prompt formula `<75 words`:** `prompt-engineering.md`
- **API:** `docs/api/API_REFERENCE.md` (`POST /audio/analyze`, `POST /video/generate-section` → `GET /jobs/{id}`)
- **Live reactive 3D preview:** "Three.js Studio" section above

*For Classic tabbed workflow details, open `knowledge-library/music-video-production.md` in Obsidian — this guide intentionally does not repeat it.*

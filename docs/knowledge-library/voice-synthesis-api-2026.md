---
tags:
  - technical
  - platform-voice
aliases:
  - Voice API
cssclasses:
  - technical-guide
date: 2026-11-12
type: entity
---

> [!info] Purpose
> Voice Synthesis API (F5-TTS) — zero-shot voice cloning for narration/voiceover generation in the video pipeline. Synthesized speech lands in `output/audio/` and is visible in the media library.

---

## Overview

**Service:** F5-TTS local zero-shot voice cloning  
**Base URL:** `http://127.0.0.1:8004` (local) / `http://100.95.60.73:8004` (tailnet)  
**Weights cache:** `D:\F5TTS\hf-cache` (~1.4 GB)  
**Python env:** `D:\venvs\f5tts` (Python 3.11, torch 2.5.0+cu124, last wheel with sm_61 kernels)  
**Last Verified:** 2026-11-08 (tailnet run: 126 chars → 12.0 s audio in ~35 s)

---

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/voice/synthesize` | Enqueue synthesis job |
| `GET` | `/api/jobs/{job_id}` | Poll job status (0–1 progress) |
| `GET` | `/api/audio/file/{name}` | Download WAV (lands in `output/audio/`) |
| `GET` | `/api/voice/voices` | List voice profiles |
| `GET` | `/api/voice/status` | Install preflight check |

### `POST /api/voice/synthesize`

```json
{
  "text": "Hey Maya, this is a test of the new voice pipeline.",
  "voice_id": "maya"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `text` | yes | What to say (≤4000 chars, ~60–90 s). Chunked at sentence boundaries. |
| `voice_id` | one of | Profile under `voices/` — see `GET /api/voice/voices`. |
| `ref_audio_path` | pair | Rig-local reference clip (<12 s recommended, ~1 s trailing silence). |
| `ref_text` | pair | **Transcript of ref clip — always required.** No auto-transcription (whisper disabled). |
| `output_path` | no | Absolute path; default `output/audio/voice_<voice>_<job8>.wav`. |

**Voice source rule:** `voice_id` **or** (`ref_audio_path` **and** `ref_text`) — never a partial pair.

---

## Voice Profiles

**Location:** `voices/<voice_id>/` on the rig

```
voices/maya/
  ref.wav        # reference clip, <12 s, clean speech
  ref.txt        # exact transcript of ref.wav
  profile.json   # optional {"name", "language", ...}
```

`maya` ships with bundled F5-TTS example — replace `ref.wav` + `ref.txt` with real sample to change voice. Reference-based zero-shot cloning only; no training/fine-tuning.

---

## Limits & VRAM

| Limit | Value |
|-------|-------|
| Text | ≤ 4000 chars (~60–90 s, chunk target 380 chars / ~20–25 s per pass) |
| Reference audio | <12 s with ~1 s trailing silence |
| VRAM budget | 2560 MB declared; vram_manager offloads Ollama/Atomic Chat when tight |
| Precision | fp32 on Pascal (sm_61) — fp16/bf16 requires sm_70+ |
| Runtime | ~realtime on GTX 1070 Ti + ~20 s cold model load per job |
| Model residency | **Not kept resident** — each job spawns fresh process, exits and releases VRAM |

---

## Operational Notes

- **Config:** `config/voice.json` holds python/wrapper/model/cache paths, chunking limits, timeout (1800 s), dev `mock.enabled` flag
- **transformers 5.x** disables PyTorch integration — no ASR path used, whisper auto-transcription unavailable by design
- **Lip-sync pipeline:** pass produced WAV as `audio_path` (or upload via `POST /api/video/lipsync-upload`) with `image_path`/`video_path` — see `docs/guides/LIPSYNC_API.md`

---

## Related

- [[runtime-models-2026]]:see-also — Voice TTS models in `runtime/models/voice/` (0.09 GB total)
- [[comfyui-workflows]]:see-also — ComfyUI model inventory (131.9 GB)
- [[hardware-verified-models]]:see-also — VRAM tier list for 8 GB GPU
- [[ai-music-mastering-stems-2026]]:see-also — Audio/mastering pipeline context
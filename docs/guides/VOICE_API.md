# Voice Synthesis API (F5-TTS)

Local zero-shot voice cloning via F5-TTS. Synthesized speech lands in
`output/audio/` — downloadable through the audio file route and visible in
the media library automatically. The intended pipeline is
**synthesize → lip-sync**: MuseTalk syncs best to isolated vocal audio,
which is exactly what this produces.

Base URL (tailnet, same as lip-sync): `http://100.95.60.73:8004`
Local: `http://127.0.0.1:8004`

## Endpoints

### `POST /api/voice/synthesize`

Enqueue a synthesis job. Returns immediately with a job id — synthesis is
GPU work and runs through the serial queue.

```json
{
  "text": "Hey Maya, this is a test of the new voice pipeline.",
  "voice_id": "maya"
}
```

| Field | Required | Notes |
|---|---|---|
| `text` | yes | What to say. Chunked at sentence boundaries; see Limits. |
| `voice_id` | one of | Profile under `voices/` (`GET /api/voice/voices` lists them). |
| `ref_audio_path` | pair | Rig-local reference clip (`.wav/.mp3/.flac/.m4a/.ogg`, <12 s recommended). |
| `ref_text` | pair | **Transcript of the reference clip — always required.** The F5-TTS ASR fallback (whisper) needs torch≥2.6 and is disabled in this env, so there is no auto-transcription. |
| `output_path` | no | Absolute path; default `output/audio/voice_<voice>_<job8>.wav`. |

Voice source rule: `voice_id` **or** (`ref_audio_path` **and** `ref_text`) —
never a partial pair. Bad input → `400`; missing file → `404`; install not
ready → `503` with setup guidance.

Response:

```json
{
  "success": true,
  "job_id": "56d9655f-1f4b-45b2-ba8d-65a48bd201d6",
  "output_path": "D:\\...\\output\\audio\\voice_maya_56d9655f.wav",
  "voice_id": "maya",
  "chunks": 1,
  "message": "Queued voice synthesis as job 56d9655f (1 chunk(s))"
}
```

### `GET /api/jobs/{job_id}`

Same polling contract as every queued job: `status`, `progress` (0–1),
`message`, `output_path`. Cancel via `POST /api/jobs/{job_id}/cancel` — the
wrapper subprocess is terminated and its VRAM released.

### `GET /api/audio/file/{name}`

Download the WAV (it lives under `output/audio/`). Also appears in the media
library — no extra wiring.

### `GET /api/voice/voices`

List voice profiles: `[{voice_id, name, language, ref_audio, ...}]`.

### `GET /api/voice/status`

Install preflight — `installed`, `missing[]`, `weights_found`, `voices`,
`vram_budget_mb`. Same fail-open shape as the lip-sync check.

## Voice profiles

`voices/<voice_id>/` on the rig:

```
voices/maya/
  ref.wav        # reference clip, <12 s, clean speech, ~1 s trailing silence
  ref.txt        # exact transcript of ref.wav   (or "ref_text" in profile.json)
  profile.json   # optional {"name", "language", ...}
```

`maya` ships with the bundled F5-TTS example voice — replace `ref.wav` +
`ref.txt` with a real sample to change the voice. Reference-based
zero-shot cloning only; no training/fine-tuning.

## Limits

- **Text:** ≤ 4000 chars total (~60–90 s speech). Chunk target 380 chars
  (~20–25 s of audio per inference pass — F5-TTS caps ~30 s including the
  reference). Sentence boundaries are respected; over-long sentences split
  at clause/word boundaries. Intended use: Shorts-length scripts (~30 s).
- **Reference audio:** <12 s, with ~1 s silence at the end (F5-TTS docs).
- **VRAM:** declared budget 2560 MB; the vram_manager offloads Ollama /
  Atomic Chat models when tight and reloads them after. The model runs fp32
  on Pascal (sm_61) — fp16/bf16 paths require sm_70+.
- **Runtime:** ~realtime on the GTX 1070 Ti plus ~20 s cold model load per
  job. The model is **not** kept resident — each job spawns a fresh
  `D:\venvs\f5tts` process that exits and releases VRAM.

## Operational notes

- Install: `D:\venvs\f5tts` (Python 3.11, torch 2.5.0+cu124 — the last
  wheel with sm_61 kernels). Weights cache: `D:\F5TTS\hf-cache`
  (~1.4 GB, downloaded on first run).
- `config/voice.json` holds python/wrapper/model/cache paths, chunking
  limits, timeout (1800 s), and the dev-only `mock.enabled` flag.
- transformers 5.x in this env disables PyTorch integration — irrelevant
  for synthesis (no ASR path is used) but means whisper-based
  auto-transcription is unavailable by design.
- Feeding lip-sync: pass the produced WAV as `audio_path` (or upload it via
  `POST /api/video/lipsync-upload`) with an `image_path`/`video_path` — see
  `docs/guides/LIPSYNC_API.md`.

## Verified

- 2026-11-08 tailnet run: `POST /api/voice/synthesize` (maya, 126 chars) → job
  completed in ~35 s wall → `GET /api/audio/file/voice_maya_56d9655f.wav`
  → 200, 576 KB, pcm_s16le 24 kHz mono, 12.0 s, no NaN/Inf, flat factor 0.
  That WAV was then fed to `POST /api/video/lipsync` and completed.

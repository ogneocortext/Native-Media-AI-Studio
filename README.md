# Native Media AI Studio

![Native Media AI Studio banner](packages/frontend/public/brand/readme-banner.webp)

A local music-video production studio: **Suno v6-mini drafts go in, social-ready
videos come out.** The studio owns everything in between — audio post-production
(mix polish, consistency and arrangement repair, mastering) and the visual edit
(audio-reactive render, final composite). No DAW, no video editor, no timeline
scrubbing for the owner. (Decided: D23 in `docs/architecture/decision-log.md` —
the pipeline is the MVP.)

## For AI agents (read this first)

This repo is built for agent handoff portability — the coding model rotates, so
nothing here assumes a specific provider (D21). Bootstrap order:

1. **`AGENTS.md`** — how to operate in this repo (services, shells, gates, traps)
2. **`docs/README.md`** — documentation index; the fastest way to find the right document
3. **`docs/architecture/decision-log.md`** — decisions D1–D23, **do not re-litigate**; update it when you make or reverse one
4. **`docs/architecture/provider-notes.md`** — per-model behavior notes, append-only

Commits carry the reasoning ("why"), so `git log` is a guidance channel.
Checker scripts under `tools/` are the enforcement layer — run
`python tools/run-gates.py` before pushing.

## What it does

- **Music video wizard** — guided 5-step flow: upload → analyze → style → generate per-section → export 16:9 + 9:16, with beat-synced cuts
- **Real audio analysis** — beat/tempo/onset + energy curves, section labelling, key detection; Demucs stem separation and Whisper transcription
- **Audio-reactive visuals** — 2D canvas visualizer, Three.js/WebGL scenes, Unity and Blender MCP integrations, shader visualizer with key-derived palettes
- **AI generation** — ComfyUI text-to-image / image-to-video, 3D via Hunyuan3D, all tuned for the 8 GB VRAM target below
- **Remotion video editor** — final composite and export
- **Media library** — uploads, cover art, waveforms, duplicate detection, rename/delete/bulk ops
- **Ops** — job queue with SSE status, GPU/VRAM monitoring with trending history, centralized logs and diagnostics
- **`suno-templates/`** — static snapshot of the owner's Suno v6-mini prompting workbench (the owner-side half of the D23 pipeline); see its README

## Hardware targets

| Resource  | Specification                      |
| --------- | ---------------------------------- |
| CPU       | Ryzen 5 5500-class (6 cores)       |
| GPU       | GTX 1070 Ti (8 GB VRAM)            |
| RAM       | 32 GB                              |
| Execution | Serial/queue-based, no heavy parallelism |

## Project structure

```
Native-Media-AI-Studio/
├── packages/frontend/     # React + Vite + TypeScript UI
├── packages/backend/      # FastAPI backend (api, services, queue, diagnostics)
├── tools/                 # MCP bridges, Go sidecars, checkers, demos
├── scripts/               # Service management (PowerShell 7.6+)
├── docs/                  # Guides, API reference, knowledge library, setup — start at docs/README.md
├── config/                # ports.json, settings.json, tracks.json
├── shared/                # Shared TypeScript types
├── unity-project-mcp/     # Unity project for music video generation
├── unity-visualizer/      # Standalone Unity audio visualization project
├── suno-templates/        # Suno v6-mini prompting workbench (static snapshot)
└── output/                # Generative outputs + logs (gitignored)
```

## Quick start

Prerequisites: Node.js 22+, pnpm 11+, Python via the project's conda envs —
see **AGENTS.md → Python Environments** (it also documents the machine-specific
PATH traps; read it before running anything). Full setup: `docs/setup/`.

```powershell
# PowerShell 7.6+ required (pwsh, not powershell 5.1)
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\manage-servers.ps1 -Action status   # check what's already up
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\manage-servers.ps1 -Action start -Services all
```

Do not restart services that are already running — both dev servers hot-reload.
`scripts\start-services.ps1` is currently broken; call `manage-servers.ps1`
directly as above.

| Service      | Port | Description                        |
| ------------ | ---- | ---------------------------------- |
| Backend      | 8000 | FastAPI + SSE + SQLite             |
| Frontend     | 5173 | React + Vite UI                    |
| ComfyUI      | 8188 | AI image/video generation          |
| Video Editor | 8080 | Remotion studio                    |
| go-dashboard | 3847 | SSE stream hub + health            |
| go-gateway   | 3850 | MCP bridge proxy                   |
| go-worker    | 3849 | Async sidecar I/O                   |
| go-media     | 3848 | FFmpeg post-processing worker      |
| go-ports     | 3851 | Port availability checker          |

API reference: `docs/api/`. The route surface is guarded by
`tools/snapshot-audio-routes.py`.

## Changes

- `CHANGELOG.md` — version history
- `git log` — commit messages carry the reasoning behind decisions
- `docs/architecture/decision-log.md` — the decision record (Changelog section)

## Responsibility

Native Media AI Studio is a general-purpose post-production tool. You are
responsible for the audio, video, and images you create with it — including
complying with the terms of service of any platform you source media from.
Suno, Udio, and any other named services appear here only as examples of
input sources; this project is not affiliated with, endorsed by, or sponsored
by any of them.

## License

Public repository, no `LICENSE` file yet. Third-party licenses, model
credits, and the Remotion/madmom conditions are inventoried in
[THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).

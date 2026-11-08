# Native Media AI Studio

![Native Media AI Studio banner](packages/frontend/public/brand/readme-banner.webp)

**Your Suno track in, a finished music video out.**

Native Media AI Studio is a local music-video production suite. Upload a track,
and the studio handles the rest: it analyzes the audio, generates scenes with
AI, composites the final video, and exports ready-to-post 16:9 and 9:16 cuts —
no DAW, no video editor, no timeline scrubbing required.

Everything runs on your own machine — the AI models, the audio analysis, the
rendering. Your media never leaves your computer.

## What you can do

- **Make a music video from a song** — guided 5-step wizard: upload → analyze → pick a style → generate scenes → export. Cuts land on the beat automatically.
- **Separate stems and transcribe** — Demucs splits vocals/drums/bass/other, Whisper produces lyrics and timing.
- **Generate visuals with AI** — images and video clips via ComfyUI, 3D models via Hunyuan3D and TripoSR, all tuned to run on a single 8 GB graphics card.
- **Watch it react to the music** — real-time audio-reactive visualizers in 2D canvas, Three.js/WebGL, and Unity.
- **Edit and export** — Remotion-based video editor for the final composite.
- **Manage your library** — uploads, cover art, waveforms, duplicate detection, bulk operations.
- **Remix tracks** — build mashups from stems of different songs with automatic tempo matching.

## What you need

| Component | Minimum                          |
| --------- | -------------------------------- |
| GPU       | 8 GB VRAM (GTX 1070 Ti class)    |
| RAM       | 32 GB                            |
| CPU       | 6-core Ryzen 5-class             |
| Software  | Windows 11, Node.js 26+, pnpm 12+, Python 3.10+, PowerShell 7.6+ |

The app is deliberately tuned for modest hardware — models are quantized and
jobs run one at a time, so an 8 GB card is a supported target, not a
workaround.

Portability check (2026-11-07): the full stack was installed and run
from a clean checkout on a plain Linux VM (Python 3.12, Node 24,
pnpm 12.17) — CPU feature surface; GPU generation still needs the
Windows setup above. Recipe and known gaps:
`docs/setup/SETUP_SUMMARY.md`.

## Getting started

```powershell
# PowerShell 7.6+ (pwsh — not the older powershell 5.1)
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\manage-servers.ps1 -Action status   # see what's running
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\manage-servers.ps1 -Action start -Services all
```

Then open **http://127.0.0.1:5173** in your browser. Full setup guide:
`docs/setup/` — start with `docs/setup/SETUP_SUMMARY.md`.

Optional services (the app works without them, with reduced AI features):
ComfyUI on port 8188 for image/video/3D generation, Ollama on 11434 for chat and
embeddings. `config/ports.json` is the single source of truth for every port.

## Documentation

- **`docs/README.md`** — index of all documentation; the fastest way to find what you need
- **`docs/guides/`** — user guides: music video workflow, GPU pipeline, file management, API reference
- **`docs/setup/`** — installation and service setup
- **`docs/knowledge-library/`** — research notes on models, hardware limits, and techniques
- **`CHANGELOG.md`** — what's new in each version

## Project layout

```
packages/frontend/   React + Vite + TypeScript user interface
packages/backend/    FastAPI backend — API, job queue, audio analysis
packages/video-editor/  Remotion-based video editor
tools/               MCP bridges, sidecars, helper utilities
scripts/             PowerShell service management
docs/                All documentation (start at docs/README.md)
config/              ports.json, settings.json — service configuration
output/              Your generated media (gitignored)
```

## Contributing & AI agents

Building with an AI coding assistant? **`AGENTS.md`** is the entry point — it
covers repo conventions, service management, quality gates, and per-tool skill
locations. Human and external-agent setup (hooks, gates, commit rules):
**`CONTRIBUTING.md`**. Quality checks run via `python tools/run-gates.py`.

## License

MIT — see [LICENSE](./LICENSE) (© 2026 Intenext Ventures LLC). Third-party
licenses, model credits, and the Remotion/madmom conditions are inventoried in
[THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).

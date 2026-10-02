# Third-Party Notices

This project combines original code with third-party software and assets.
Each item below keeps its own license; nothing here relicenses anyone else's
work. If a license below conflicts with your use, the license wins.

## 3D models (Sketchfab, CC-BY-4.0)

The following models ship in `packages/frontend/public/models/sketchfab/`.
Each is licensed CC-BY-4.0 (commercial use allowed, attribution required).
Full license texts are in each model's `license.txt`.

- "Boombox" by fergasol (https://sketchfab.com/fergasol100) —
  https://sketchfab.com/3d-models/boombox-fb8a583f743a47268a2aaa420624c794 —
  licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- "Simple Concert Stage" by mertart3D (https://sketchfab.com/mertbbicak) —
  https://sketchfab.com/3d-models/simple-concert-stage-d5c7733d06d24947bf60b3a0fe203f69 —
  licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- "Sound system" by yryabchenko (https://sketchfab.com/yryabchenko) —
  https://sketchfab.com/3d-models/sound-system-725273fbdde54a1babaf6ce1c95b96b4 —
  licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- "Turntables" by bronwenalexina (https://sketchfab.com/bronwenalexina) —
  https://sketchfab.com/3d-models/turntables-b7bb537521bd4fa9be15926c24bb4656 —
  licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

## Remotion (custom license, NOT open source)

The video editor (`packages/video-editor/`) is built on Remotion
(`remotion`, `@remotion/*` npm packages), which ships under the
[Remotion License](https://github.com/remotion-dev/remotion/blob/main/packages/core/LICENSE.md) —
source-available, not OSI open source. Two tiers:

- **Free License:** individuals, for-profit orgs up to 3 employees,
  non-profits, and evaluation. Covers commercial and non-commercial video/image
  creation. This project currently qualifies (individual owner).
- **Company License:** required for for-profit organizations above the employee
  threshold. If this project ever moves into such an org, re-check the current
  Remotion license terms before continuing to ship the video editor.

## mediabunny (MPL-2.0)

`mediabunny` (frontend media muxing) is licensed MPL-2.0 — weak, file-level
copyleft. Using it unmodified as a library imposes no source-sharing
obligation on this project. If you modify mediabunny's own files, the MPL
requires those modifications to be shared under MPL-2.0.

## madmom model weights (non-commercial)

`madmom-infer` (neural beat/downbeat tracking, `requirements-experimental.txt`)
ships code under a permissive license, but **its trained model weights are
non-commercial**. Consistent with this project's current non-commercial status;
re-evaluate before any monetized use.

## Everything else (permissive)

- **npm:** `react`, `three`, `@react-three/*`, `zustand`, `zod`,
  `wavesurfer.js`, `recharts`, `lucide-react`, `animejs`, `tailwindcss`,
  `@modelcontextprotocol/*` — MIT; `@theatre/*` — Apache-2.0. Full list in the
  `package.json` files; see each package for its license text.
- **Python:** `fastapi`, `uvicorn`, `pydantic`, `librosa`, `numpy`, `torch`,
  `demucs`, `faster-whisper`, `Pillow`, `httpx`, `requests`, `psutil`,
  `opentelemetry-*`, and the rest — MIT / BSD / Apache-2.0 / ISC family. Full
  lists in `packages/backend/requirements*.txt`, `tools/*/requirements.txt`,
  and `environment.yml`.

## External tools (separate processes, not distributed here)

These are integrated over process/API boundaries (MCP bridges, HTTP, CLI) —
not vendored, not linked, not distributed by this repo. Their licenses govern
their own installations, not this project's code:

- **ComfyUI** (GPL-3.0) — external service, talked to over its API
- **Blender** (GPL) — external, via Blender MCP
- **FFmpeg** (LGPL/GPL depending on build) — external binary, invoked via CLI
- **Unity** (proprietary) — external editor, via Unity MCP bridge
- **Ollama** (MIT) — external service

## Notes

- No GPL/AGPL-licensed code is vendored into this repository (verified
  2026-10-02 by searching `tools/` and `packages/backend/` for copyleft
  license text — none found).
- This file is a good-faith inventory, not legal advice. Dependency licenses
  change; re-check before any commercial use or redistribution beyond this repo.

# Tools

This directory contains scripts, MCP bridges, and demo utilities for the
Native Media AI Studio. It is **not** just the Unity MCP bridge — see the
sections below for everything in here.

## What's in this directory

| Subdirectory / file | Purpose |
|---------------------|---------|
| `mcp/` | MCP server bridges (Unity, Vision, Ollama Tools, Blender, HyperFrames) — see `mcp/README.md` |
| `qwen_subagent/` | Local Qwen sub-agent harness (`config.py`, `subagent.py`, `tools.py`) |
| `model-reliability/` | Model scoring (`score.py`), tier roster (`roster.md`), observed outcomes (`observed.jsonl`) |
| `blender_mcp_addon.py` | Blender MCP addon source (v1.5, protocol 4) |
| `analyze_and_sync.py` | Audio analysis + beat-synced JSON generation |
| `audio_analysis_demo.py` | GPU-accelerated analysis demo (CUDA) |
| `demos/` | Feature demonstration scripts |
| `music-gen/` | ACE-Step music generation service (isolated venv) |
| `fix-subprocess-encoding.py`, `check-path-references.py`, etc. | Repo hygiene and validation scripts |

## MCP servers

The OpenCode project config is `../opencode.json`; other clients have their own
configs. See the client map in `../AGENTS.md` before adding a server. Paths in a
client config must follow that client's working-directory rules; on Windows,
prefer absolute paths for executable and script entries.

Per D54, when a server is launched with `npx`, pin the package version and run
offline (`npx --no --offline <pkg>@<version>`), never `npx -y <pkg>@latest`.
Pre-install the pinned package with `pnpm.cmd add -D <pkg>@<version>` from the repo
root.

## Unity MCP Bridge

Local MCP server that wraps Unity's REST API for Kilo Code integration.

### How It Works

1. Reads Unity's port descriptor (`Library/Pipeline/.unity-pipeline-port`) for auth token and port
2. Registers Unity commands as MCP tools
3. Translates MCP tool calls → Unity REST API (`POST /api/exec`)
4. Returns Unity responses as MCP tool results

### Setup

```powershell
pnpm.cmd install
```

The workspace package and its MCP SDK dependencies are declared in
`package.json`; install workspace dependencies from the repository root.

### Usage

Configured in the OpenCode project file at `../opencode.json` (other clients
use their own configuration files).

### Tools Provided

- `unity_command` — Generic proxy for any Unity command
- `create_gameobject` — Create primitives
- `add_component` — Add components
- `capture_scene_view` — Screenshot Scene view
- `editor_status` — Get Editor state
- `create_scene` — Create new scenes
- `create_animation_clip` — Create animation clips

## Authentication

The bridge auto-reads the bearer token from Unity's port descriptor file. No manual token management needed.

## Headless Unity runtime

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\start-unity-headless.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\start-unity-headless.ps1 -Status
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\start-unity-headless.ps1 -Stop
```

Run these commands from the repository root.

The launcher uses the installed Unity Editor executable, launches `unity-project-mcp` in persistent `-batchmode` with GPU rendering enabled, invokes `NativeMediaStudio.HeadlessPipelineBootstrap.Start`, and waits for `Library/Pipeline/.unity-pipeline-port`. The project remains in Edit mode so shader/material authoring commands are available to the custom frontend. The process remains alive so the frontend can use `/unity` or the backend `/api/unity/command` route.

## Blender MCP

Connects Blender to an MCP client. The `blender_mcp_addon.py` source is v1.5,
protocol 4; install and start the addon in Blender before using this bridge.

### Setup

```text
# Install addon in Blender: Edit -> Preferences -> Add-ons -> Install
# Start MCP Server in Blender sidebar: BlenderMCP tab -> Start MCP Server
```

Per D54, do **not** use `npx -y comfyui-mcp` — pin the configured version and
run it offline instead. The Remotion MCP server is deprecated (D58).

### Tools Provided

- Scene management, object creation/manipulation, materials, animation, lighting, camera, rendering
- 3D model generation via Hunyuan3D-2mini
- Asset downloads from Poly Haven and Sketchfab

#### Sketchfab Setup (offline, replaces banger.show Sketchfab import)

```powershell
# 1. Free token from sketchfab.com/settings/password
setx BLENDERMCP_SKETCHFAB_API_KEY "your_token_here"
# also add to repo .env (gitignored) for future shells
Add-Content .env "BLENDERMCP_SKETCHFAB_API_KEY=your_token_here"
```

See `../.kilo/skills/blender-mcp/SKILL.md` and `../docs/knowledge-library/blender-mcp.md` for full documentation.

## ComfyUI MCP

MCP server for ComfyUI, enabling natural language control of ComfyUI workflows.

### Setup

Per D54, pin the version and run offline. The configured package version is
`0.52.206` (see `../opencode.json`):

```powershell
pnpm.cmd add -D comfyui-mcp@0.52.206
npx.cmd --no --offline comfyui-mcp@0.52.206 --comfyui-url http://127.0.0.1:8188 --force-remote
```

ComfyUI must be running on port 8188.

## Remotion rendering

The Remotion MCP server is deprecated (D58). Programmatic rendering uses the
Remotion CLI service in `../packages/backend/app/services/remotion_cli.py`, exposed
through `GET /api/audio/remix/remotion/status` and
`POST /api/audio/remix/remotion/render`. See D58 in
`../docs/architecture/decision-log.md` for the integration details.

## Audio Analysis & Beat Sync

### Scripts

- `analyze_and_sync.py` — Analyze audio and generate Unity beat-synced animation data (JSON with tempo, beat_times, keyframes)
- `audio_analysis_demo.py` — GPU-accelerated analysis demo using CUDA
- `demos/demo_all_features.py` — Full feature demonstration
- `demos/demo_audio_analysis.py` — Audio analysis demo

### Usage

```powershell
D:\conda-envs\nma-studio-cuda\Scripts\python.exe tools/analyze_and_sync.py <audio_file> [--output <json_file>] [--fps 24]
```

## Testing

- `pnpm.cmd --filter tools test` — syntax checks for the MCP bridge entry points; this does not exercise live tools
- `tests/test_vision_mcp.mjs` and `tests/smoke_mcp_v2.mjs` — ad hoc protocol probes. They expect root-level image fixtures (`threejs-studio-initial.png` and `viewport-check.png`) that are absent from this checkout, plus a local vision model.
- `validate-knowledge-tags.py` — Validate knowledge-library frontmatter, the tag taxonomy, `index.md` counts, and the migration tracker.

```powershell
D:\conda-envs\nma-studio-cuda\Scripts\python.exe tools/validate-knowledge-tags.py
```

- `tests/test_doc_checkers.py` — Self-tests for the doc checkers.
- `check-all.py` — All doc/repo checks. This is what the pre-commit hook invokes.

## Doc and repo checks

One command runs every documentation and repository-hygiene check:

```powershell
D:\conda-envs\nma-studio-cuda\Scripts\python.exe tools/check-all.py
D:\conda-envs\nma-studio-cuda\Scripts\python.exe tools/check-all.py -v
```

The broader project gates (backend lint, frontend type/lint, unit tests, and
other checks) run through `run-gates.py`; see `../AGENTS.md` for the scoped
gate policy.

## Git Hooks

This repo has **no CI** (D10 in `../docs/architecture/decision-log.md`). Hook
sources are versioned under `../scripts/git-hooks/`; installed hooks live in
`.git/hooks` and are local to each clone. Check hook installation rather than
assuming hooks are active in a fresh clone.

`../scripts/git-hooks/pre-commit` runs applicable docs/repo checks;
`../scripts/git-hooks/pre-push` runs the fast project gates and checks agent
attribution. Hook installation is local to each clone; see `../AGENTS.md` and
`check-hooks-installed.py` for the Windows workflow and current state.
The installer (`../scripts/install-git-hooks.sh`) is idempotent, backs up any
hook it replaces, and preserves a pre-existing `pre-commit`. Do not run bare
`bash` in PowerShell on this machine; it resolves to the WSL launcher.
- Bypass for a deliberate one-off: `git commit --no-verify`.

> [!note] Git LFS hooks
> `.git/hooks` also contains four Git LFS hooks (`pre-push`, `post-commit`,
> `post-merge`, `post-checkout`) that currently track nothing (D11). They exit
> non-zero if `git-lfs` is missing from PATH, which would block commits. The
> installer lists unmanaged hooks on each run.

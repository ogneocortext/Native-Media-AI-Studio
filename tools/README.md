# Unity MCP Bridge

Local MCP server that wraps Unity's REST API for Kilo Code integration.

## How It Works

1. Reads Unity's port descriptor (`Library/Pipeline/.unity-pipeline-port`) for auth token and port
2. Registers Unity commands as MCP tools
3. Translates MCP tool calls → Unity REST API (`POST /api/exec`)
4. Returns Unity responses as MCP tool results

## Setup

```bash
cd tools
npm install @modelcontextprotocol/server zod
```

> [!note] MCP SDK v2
> These servers run on **@modelcontextprotocol/server v2.0.0** (ESM-first). The v1→v2 migration was applied via codemod + manual optimizations: `Server()` + `setRequestHandler` for stdio servers, `McpServer` + `registerTool` for the Unity bridge, structured logging, request correlation IDs, and tightened timeouts.

## Usage

Configured automatically via `opencode.json`:
```json
{
  "mcp": {
    "unity": {
      "type": "local",
      "command": ["node", "tools/mcp/unity-mcp-bridge.mjs"],
      "environment": {
        "UNITY_PROJECT_PATH": "D:\\path\\to\\unity-project"
      }
    }
  }
}
```

## Tools Provided

- `unity_command` — Generic proxy for any Unity command
- `create_gameobject` — Create primitives
- `add_component` — Add components
- `capture_scene_view` — Screenshot Scene view
- `editor_status` — Get Editor state
- `create_scene` — Create new scenes
- `create_animation_clip` — Create animation clips

## Authentication

The bridge auto-reads the bearer token from Unity's port descriptor file. No manual token management needed.

---

## Headless Unity runtime

The Unity Pipeline can be started without keeping the Unity Editor GUI open:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\start-unity-headless.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\start-unity-headless.ps1 -Status
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\start-unity-headless.ps1 -Stop
```

The launcher uses the installed Unity Editor executable, launches `unity-project-mcp` in persistent `-batchmode` with GPU rendering enabled, invokes `NativeMediaStudio.HeadlessPipelineBootstrap.Start`, and waits for `Library/Pipeline/.unity-pipeline-port`. The project remains in Edit mode so shader/material authoring commands are available to the custom frontend. The process remains alive so the frontend can use `/unity` or the backend `/api/unity/command` route.

Verified workflow:

```json
{"command":"create_asset","parameters":{"path":"Materials/NMA_ShaderDemo.mat","type":"Material","shader":"Universal Render Pipeline/Lit"}}
{"command":"set_material_properties","parameters":{"material":"Assets/Materials/NMA_ShaderDemo.mat","properties":{"_BaseColor":[0.1,0.8,1.0,1.0],"_EmissionColor":[0.1,0.8,1.0,1.0]},"enableKeywords":["_EMISSION"]}}
{"command":"set_component_properties","parameters":{"target":"/NMA_ShaderTarget","type":"MeshRenderer","properties":{"m_Materials":["Assets/Materials/NMA_ShaderDemo.mat"]}}}
{"command":"capture_game_view","parameters":{"source":"camera","width":800,"height":450,"save_path":"output/unity_headless_shader.png"}}
```

The `m_Materials` field is the Unity `MeshRenderer` serialized material array. `capture_game_view` requires a camera; create one with `create_gameobject` + `add_component` (`Camera`) and position it with `set_transform` when rendering a new scene.

The bootstrap currently keeps the Unity project alive in Edit mode. It does not remove the need for a running Unity project process; the web interface removes the need to interact with the Editor GUI. Fully eliminating Unity requires building a standalone player with a custom runtime command server.


This directory contains MCP bridge servers and demo scripts for AI-driven music video creation. All MCP servers are configured in `opencode.json` at the repo root.

| Server | Command | Port | Status |
|--------|---------|------|--------|
| **Unity MCP** | `node tools/mcp/unity-mcp-bridge.mjs` | 7800 (REST) | Running (Unity 6000.5.1f1) |
| **Blender MCP** | `uvx blender-mcp` | 9876 (socket) | Running (Blender 5.2) |
| **ComfyUI MCP** | `npx comfyui-mcp --comfyui-url http://localhost:8188` | 8188 | Running |
| **Remotion MCP** | `npx -y @remotion/mcp@latest` | stdio | Configured |

---

## Blender MCP

Connects Blender to Kilo Code via MCP. The `blender_mcp_addon.py` addon (v1.5, protocol 4) must be installed in Blender.

### Setup
```bash
# Install addon in Blender: Edit -> Preferences -> Add-ons -> Install
# Start MCP Server in Blender sidebar: BlenderMCP tab -> Start MCP Server
uvx blender-mcp --version  # Verify connection
```

### Tools Provided
- Scene management, object creation/manipulation, materials, animation, lighting, camera, rendering
- 3D model generation via Hunyuan3D-2mini
- Asset downloads from Poly Haven and Sketchfab (1M+ free CC — Data API `v3` search public, Download API `/v3/models/{uid}/download` requires free `Token`; free `basic` plan suffices)

#### Sketchfab Setup (offline, replaces banger.show Sketchfab import)
```powershell
# 1. Free token from sketchfab.com/settings/password
setx BLENDERMCP_SKETCHFAB_API_KEY "your_token_here"
# also add to repo .env (gitignored) for future shells
Add-Content .env "BLENDERMCP_SKETCHFAB_API_KEY=your_token_here"

# 2. Or paste in Blender: N-panel → BlenderMCP → Use assets from Sketchfab
#    + Addon Preferences → sketchfab_api_key + Scene.blendermcp_sketchfab_api_key, then bpy.ops.wm.save_userpref()
# 3. Verify (should show Logged in as: <user>)
#    blender_get_sketchfab_status  -> Data API v3 /v3/me (tools/blender_mcp_addon.py:2302)
```

See `.kilo/skills/blender-mcp/SKILL.md` and `docs/knowledge-library/blender-mcp.md` for full documentation.

---

## ComfyUI MCP

MCP server for ComfyUI, enabling natural language control of ComfyUI workflows.

### Setup
```bash
# ComfyUI must be running on port 8188
npx -y comfyui-mcp --comfyui-url http://localhost:8188 --force-remote
```

---

## Remotion MCP

Documentation and best-practices integration for Remotion (video compositing library).

### Setup
```bash
npx -y @remotion/mcp@latest
```

---

## Audio Analysis & Beat Sync

### Scripts
- `analyze_and_sync.py` — Analyze audio and generate Unity beat-synced animation data (JSON with tempo, beat_times, keyframes)
- `audio_analysis_demo.py` — GPU-accelerated analysis demo using CUDA
- `demos/demo_all_features.py` — Full feature demonstration
- `demos/demo_audio_analysis.py` — Audio analysis demo

### Usage
```bash
python tools/analyze_and_sync.py <audio_file> [--output <json_file>] [--fps 24]
```

---

## Testing

- `tests/test_mcp.py` — Test MCP server via HTTP (port 9876)
- `tests/test_mcp_stdio.py` — Test Blender MCP via stdio
- `validate-knowledge-tags.py` — Validate knowledge-library frontmatter, the tag
  taxonomy, `index.md` counts, and the migration tracker. Exits non-zero on
  problems:

  ```bash
  python tools/validate-knowledge-tags.py
  ```

  Checks that every library document has YAML frontmatter whose **first** tag is
  a primary category, that required keys (`aliases`, `cssclasses`, `date`) are
  present with no duplicate keys, that no mojibake remains, that the tracker
  lists each document in the right section with correct counts, and that line
  endings are LF.

  It also warns about **duplicate markdown basenames** across directories, which
  make `[[wiki-links]]` ambiguous and let copies drift apart. This is currently
  reporting 7, including a genuine collision:
  `docs/knowledge/three-js-studio.md` vs
  `docs/knowledge-library/three-js-studio.md` are different documents with the
  same name.

  To inventory markdown **outside** the library, which the tag checks never see:

  ```bash
  python tools/validate-knowledge-tags.py --scope=all
  ```

  This is report-only. It applies no checks and never changes the exit code —
  65 of the 68 tracked markdown files outside the library have no frontmatter at
  all, and failing them would block every commit until each was triaged. That
  triage (migrate, keep as a separate doc set, or archive) is a deliberate
  decision, not a lint fix.

- `check-repo-layout.py` checks repository organisation: tracked files that look
  like generated output (caches, scratch, Unity per-user `UserSettings/`, large
  render artifacts), byte-identical files duplicated across the tree, and
  case-insensitive path collisions that would break on Linux. Reports only.

  ```bash
  python tools/check-repo-layout.py
  ```

  It found the repo tracking 273 files of agent scratch under
  `packages/frontend/tests/browser/out/` (which `AGENTS.md` had claimed was
  gitignored), 12 Unity `UserSettings/` files that Unity's own template
  gitignores, an unreferenced 75 MB render, and two byte-identical Unity scenes.

- `check-docs-map.py` verifies `docs/README.md` is an accurate map of `docs/`:
  every directory it names exists, every real directory it omits, the library's
  JSON data files are mentioned, and `AGENTS.md` actually points agents at the
  map. Runs in the pre-commit hook whenever anything under `docs/` is staged.

  ```bash
  python tools/check-docs-map.py
  ```

  This exists because the map had drifted: it listed `api-database/` and
  `archive/`, which do not exist, omitted `plans/`, never mentioned the 9 JSON
  data files in the library, and was not referenced from `AGENTS.md` — so an
  agent following it would have been sent to a directory that isn't there, and
  no agent would have read it first. A stale map is worse than none.

- `docs-triage.py` groups the untagged markdown outside the library by
  disposition, so triage is six decisions rather than 65 filenames:

  ```bash
  python tools/docs-triage.py
  ```

  This exists because `docs/knowledge/` is **application content**, not
  migration debt (D12): `docs.py` serves `DOCS_ROOT.rglob("*.md")` over all of
  `docs/`, and the frontend `DocsPage` displays and searches each document's
  `tags`. A document there without frontmatter renders with an empty tag list and
  cannot be found by tag search in the app - a user-visible cost, not just
  untidy metadata. Report-only: it changes no files and no exit code.

## Git Hooks

This repo has **no CI** (D10 in `docs/architecture/decision-log.md`), so local
git hooks are the only automated guard. `.git/hooks` is not tracked by git, so
install them once after cloning:

```bash
bash scripts/install-git-hooks.sh
```

- `scripts/git-hooks/pre-commit` — runs `validate-knowledge-tags.py` when staged
  changes touch `docs/knowledge-library/`. Silent and instant (~250ms) on every
  other commit; does not run pytest/pnpm/ruff.
- The installer is idempotent, backs up any hook it replaces, and preserves a
  pre-existing `pre-commit` (the new hook calls it).
- Bypass for a deliberate one-off: `git commit --no-verify`.

> [!note] Git LFS hooks
> `.git/hooks` also contains four Git LFS hooks (`pre-push`, `post-commit`,
> `post-merge`, `post-checkout`) that currently track nothing (D11). They exit
> non-zero if `git-lfs` is missing from PATH, which would block commits. The
> installer lists unmanaged hooks on each run.

---

## Generated Assets

### Unity Renders
- `unity-project-mcp/Assets/Textures/auto_frame_0001-0240.png` — 240 frames (10s @ 24fps)
- `beat_001.png` through `beat_005.png` — Beat marker captures
- `scene_preview.png`, `scene_preview2.png` — Scene previews
- `game_view.png` — Game view capture
- `unity_scene_setup.png` — Scene setup overview

### Blender Renders
- `output/blender_render.png` through `output/blender_render4.png` — Render iterations
- `output/architects_ghost_stage.png` — Stage preview
- `output/demo_stage.png` — Demo stage overview

### Audio Analysis Output
- `output/beat_data.json` — Beat data for "Take the Crown" by NeoCortext (152 BPM, 298 beats, 124s)

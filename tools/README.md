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

## Doc and repo checks

One command runs everything:

```bash
python tools/check-all.py            # all checks, ~900ms
python tools/check-all.py -v         # show each check's last line
```

It is what the pre-commit hook invokes, so running it by hand before committing
gives the same verdict the hook will.

The individual checkers are still runnable alone and are documented below.

- `check-all.py` — runs `check-docs-map.py`, `validate-knowledge-tags.py`,
  `check-repo-layout.py`, and the report-only `docs-triage.py`, cheapest first so
  a fast failure surfaces early. Exits non-zero if any check fails. This exists
  so there is one command to remember and one list that cannot silently fall
  behind the set of checkers.

- `tests/test_doc_checkers.py` — self-tests for the checkers. Introduces each
  defect, confirms the right checker notices, then restores the file
  byte-for-byte. A checker that silently stops failing is worse than no checker,
  and this is what catches that:

  ```bash
  python tools/tests/test_doc_checkers.py
  ```

  It mutates the working tree in place and restores from memory rather than
  cloning, because this repository's `.git` is several gigabytes and a
  `git checkout` would discard unrelated in-flight work. Run it before changing
  a checker's logic, and expect a failure if a check no longer fires.

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

- `report-missing-audio.py` is the read-only counterpart to the two audio
  cleanup tools. `dedupe-audio-uploads.py` retires duplicate *rows* and
  `prune-orphan-audio.py` deletes unreferenced *files*; neither reports rows that
  still exist but point at a file which is gone:

  ```bash
  python tools/report-missing-audio.py          # table
  python tools/report-missing-audio.py --json   # machine-readable
  ```

  It sorts every such row into two categories: **relinkable** (the file exists
  under another name, usually because it moved into a subdirectory, so no bytes
  are lost) and **no trace on this machine** (nothing matches, so the row needs
  a restore from backup or a deliberate retire). It never writes.

  This exists because those rows are not inert — they appear in the media library
  and every request for them fails. It also surfaced that `audio_files.file_size`
  is `0` for all 58 rows, because the uploader never populated it, so content
  cannot be matched by size; matching is by path/basename only, and the report
  says so rather than implying it verified file identity.

- `repair-audio-db.py` fixes `audio_files` rows whose stored file cannot be
  found, and `audit-audio-db.py` reports the same picture read-only:

  ```bash
  python tools/audit-audio-db.py                     # read-only health check
  python tools/repair-audio-db.py                    # dry run (default)
  python tools/repair-audio-db.py --apply
  python tools/repair-audio-db.py --apply --retire-missing
  ```

  `repair-audio-db.py` only relinks when it has exactly one defensible target: an
  exact path match, a path that resolves after stripping stale `<8hex>_`
  prefixes, or a basename that is **unique** on disk. Anything ambiguous is
  reported and left alone. `--retire-missing` deletes a row only when a surviving
  file matches it after prefix-stripping, so no audio is ever lost to a guess —
  and it prints how many rows it declined to touch for that reason. It backs up
  before writing.

  This exists because rows outlived the files they named. Under the old
  `uuid4()[:8]_` naming, re-uploading produced a new row and a new copy each
  time, so filenames accumulated stale prefixes, rows were retired, and some
  were left pointing at files that were since renamed or deleted. The result was
  entries every selector advertised and no endpoint could serve. `file_size` was
  `0` on all 58 rows because `update_audio_analysis` never listed the column when
  inserting, which made size-based duplicate detection impossible.

- `report-db-size.py` answers "why is the database this big?" and
  `compact-studio-db.py` applies the retention policy:

  ```bash
  python tools/report-db-size.py          # attribute the size
  python tools/compact-studio-db.py       # dry run (default)
  python tools/compact-studio-db.py --apply
  ```

  `report-db-size.py` uses the `dbstat` vtab when the sqlite3 build has it and
  otherwise estimates from stored column lengths, so it works on the bundled
  interpreter (which lacks `dbstat`).

  `compact-studio-db.py` compacts with `VACUUM INTO`, verifies the new file
  passes `integrity_check` and holds the expected row count, and only then swaps
  it in. An in-place `VACUUM` cannot make that promise on a half-gigabyte file —
  an interrupted run leaves a truncated database. Stop the backend first: it
  writes a telemetry row every 30 seconds.

  These exist because `gpu_telemetry` reached 125,889 rows / 392.8 MB while the
  freelist showed only 1.2 MB, so the file looked irreclaimable. It was not — the
  retention guard fired on ~1.7% of cycles and its `VACUUM` was inside a
  transaction, where SQLite refuses to run (see D17).

- `report-nesting.py` measures control-flow nesting depth per function by AST, so
  "too nested" is a number rather than an opinion. It also flags the
  anti-patterns nesting hides: broad excepts that neither log nor re-raise,
  deeply nested returns, and `try` inside a loop. Two of the worst offenders were
  flattened (see D19); the tool is how the next ones are found:

  ```bash
  python tools/report-nesting.py packages/backend/app --min-depth 4
  python tools/report-nesting.py packages/frontend/src --min-depth 5
  ```

  It is read-only in report mode, and a gate in `--baseline` mode. Three
  silent-failure modes had to be closed before it could be trusted, each found by
  testing it rather than assuming: a baseline for a different root matched
  nothing and passed, unparseable files were skipped so a syntax error *lowered*
  the score, and keys were path-dependent so a relative versus absolute root
  disagreed. All three now fail loudly.

  ```bash
  python tools/report-nesting.py packages/backend/app --min-depth 4
  python tools/report-nesting.py --write-baseline tools/nesting-baseline.json \
      packages/backend/app
  python tools/report-nesting.py --baseline tools/nesting-baseline.json \
      packages/backend/app
  ```

  It is wired into `check-all.py` (and so into the `docs` gate and the pre-commit
  hook), so a function that gets *deeper* fails the build. Flattening is never
  required to make it pass; only a regression is. `tools/verify-nesting-gate.py`
  is the mutation check that proves the gate can fail at all.

- `probe-ollama.py` records what a live Ollama actually does, so a change in
  server behaviour can be told apart from a change in our code:

  ```bash
  python tools/probe-ollama.py
  python tools/probe-ollama.py --model qwen3.5:4b --fast
  ```

  It is the tool to reach for first when "Ollama is acting up", and it is where
  `tests/test_ollama_live.py` gets its expectations from. It prefers the
  smallest **local** model, and skips `:cloud` entries deliberately: they report
  `size: 0` and return HTTP 402 without a paid key, so probing them would measure
  the network rather than the adapter.

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

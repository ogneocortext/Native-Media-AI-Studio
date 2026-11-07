# Unity MCP Integration

## Overview

Unity MCP allows AI agents to control Unity Editor for scene creation, GameObject management, animation, rendering, and asset maintenance. This skill documents the complete workflow for AI-driven Unity development inside Kilo Code.

## Architecture

```
AI Agent (Kilo Code) → MCP Bridge (unity-mcp-bridge.mjs) → Unity Pipeline HTTP API (port 7800) → Unity Editor
```

The bridge is a local stdio MCP server. It reads auth state from `Library/Pipeline/.unity-pipeline-port`, forwards tool calls to `http://127.0.0.1:7800/api/exec`, and returns JSON results.

## Prerequisites

1. **Unity Editor** running with project open
2. **Pipeline package** installed (`com.unity.pipeline` matching the installed Unity version)
3. **Pipeline HTTP server** running and port file present under `Library/Pipeline/.unity-pipeline-port`
4. **MCP Bridge** configured in Kilo Code / `opencode.json`

## Kilo Code Tool Mapping

Use these Kilo-side tools instead of raw shell commands:

| Kilo Tool | What It Does |
|-----------|--------------|
| `unity_editor_status` | Check whether the Pipeline server is ready, compiling, or in play mode |
| `unity_unity_command` | Execute any Unity Pipeline command by name with parameters |
| `unity_list_pipeline_commands` | Discover available commands, tags, and packages |
| `unity_get_console_logs` | Read recent captured console logs by level/count |
| `unity_find_assets` | Find assets by type/name/label |
| `unity_create_*` / `unity_set_*` / `unity_play_animation` / `unity_stop_animation` | Convenience wrappers for common ops |

Typical pattern:
```text
1. Call unity_editor_status.
2. If ready, call unity_unity_command with the desired command.
3. For asset mutations, prefer editor-script execution over raw file edits.
```

## Connection Verification

### 1. Check server status
```text
unity_editor_status
```
Expected: `{"success": true, "result": {"status": "ready", ...}}`

### 2. Read port descriptor
```text
Library/Pipeline/.unity-pipeline-port
```
Returns JSON with: `pid`, `port`, `projectPath`, `unityVersion`, `evalToken`, `capabilities`

### 3. Health behavior notes
- If Unity is still starting or reimporting, expect `Unity API request timed out (30000ms)`. Back off and retry instead of hammering it.
- If the port file is missing, the bridge returns `Unity MCP server not running (no port file)`.

## Project Structure

```
unity-project-mcp/
├── Assets/
│   ├── Settings/
│   │   ├── UniversalRenderPipelineAsset.asset
│   │   └── UniversalRendererData.asset
│   ├── Scenes/
│   ├── Scripts/
│   ├── Editor/
│   └── ...
├── Library/
│   └── Pipeline/
│       └── .unity-pipeline-port
└── Packages/
    └── manifest.json
```

Current environment specifics for this project:
- Unity version: `6000.6.0f1`
- Pipeline package: `com.unity.pipeline 0.6.0-exp.1`
- URP package: `com.unity.render-pipelines.universal 17.0.0`
- MCP bridge default project path: `tools/../../unity-project-mcp`

## Available Commands

Use `unity_list_pipeline_commands` for the full list. Commonly useful commands include:

| Command | Description | Key Parameters |
|---------|-------------|----------------|
| `create_scene` | Create new scene | `path` |
| `create_gameobject` | Create GameObject/primitive | `name`, `primitive` |
| `add_component` | Add component to object | `target`, `type` |
| `capture_scene_view` | Screenshot Scene view | `save_path`, `width`, `height` |
| `capture_game_view` | Screenshot Game view | `source`, `save_path`, `width`, `height` |
| `editor_status` | Get Editor state | - |
| `create_animation_clip` | Create AnimationClip | `path`, `frameRate`, `loop` |
| `create_animator_controller` | Create AnimatorController | `path` |
| `add_animator_state` | Add state to Animator | `controller`, `layer`, `name` |
| `add_animator_transition` | Add transition between states | `controller`, `layer`, `fromState`, `toState` |
| `bake_lighting` | Bake lightmaps | `confirm` |
| `create_prefab` | Save GameObject as prefab | `source`, `path` |
| `build` | Build project | `target`, `outputPath` |
| `get_console_logs` | Read console logs | `level`, `count` |
| `get_graphics_settings` | Read default render pipeline | - |
| `set_graphics_settings` | Set default render pipeline | `renderPipelineAsset`, `confirm` |
| `get_serialized_fields` | Read serialized fields | `assetPath` or object ref |
| `set_serialized_field` | Set serialized fields | `assetPath`, `field`, `value` |
| `find_assets` | Find assets by type/name | `type`, `name`, `label` |
| `recompile` | Force script recompile | - |
| `recompile_status` | Poll recompile result | - |
| `run_script` | Run compiled C# static method | `file`, `method` |
| `eval_file` | Compile and run a .cs file | `file` |
| `eval` | Evaluate inline C# code | code body |
| `menu` | Execute Editor menu item | `path` |

## Common Workflows

### Create a Scene with Objects
```
1. create_scene {path: "Assets/Scenes/MyScene.unity"}
2. create_gameobject {name: "Cube", primitive: "cube"}
3. create_gameobject {name: "Light", primitive: "quad"}
4. add_component {target: "Cube", type: "UnityEngine.Rigidbody"}
5. capture_scene_view {save_path: "Assets/Textures/preview.png", width: 1280, height: 720}
```

### Animate to Beat
```
1. create_animation_clip {path: "Assets/beat_anim.anim", frameRate: 24}
2. create_animator_controller {path: "Assets/controller.controller"}
3. add_animator_state {controller: "controller", layer: "Base Layer", name: "BeatPulse"}
4. add_animator_transition {controller: "controller", layer: "Base Layer", fromState: "Entry", toState: "BeatPulse"}
```

### Build Project
```
1. build {target: "Windows", outputPath: "Builds/MyGame.exe"}
```

### Music Video Production
```
1. get_beat_data
2. create_scene {path: "Assets/Scenes/MusicVideo.unity"}
3. create_gameobject {name: "BeatObject", primitive: "sphere"}
4. create_beat_animation {object_name: "BeatObject", clip_path: "Assets/Animations/beat_anim.anim"}
5. capture_frame_sequence {output_dir: "Assets/Textures/auto_frame", fps: 24, duration_seconds: 15}
6. Add AutoCapture.cs to a GameObject and start Play mode to capture frames
```

## Kilo-Specific Operational Knowledge

### Connection lifecycle
- Always probe with `unity_editor_status` before heavy work.
- After project upgrades, large asset imports, or Library changes, Unity can take minutes before `/api/exec` responds. Use longer waits/backoff rather than immediate retries.
- If the port file disappears, the Editor may need to be relaunched with the Pipeline package active.

### Editing assets safely
- **Do not** hand-edit `.asset` YAML and expect immediate effect. Unity imports assets into `Library/` and the cached copy wins.
- If you must modify an asset from automation, use an editor script executed through the runtime bridge:
  1. Write a C# file under `Assets/Editor/`.
  2. Trigger `recompile`.
  3. Poll `recompile_status`.
  4. Execute with `run_script { file: "Assets/Editor/YourScript.cs", method: "YourClass.Method" }`.
- `eval_file` compiles code inline, but it is stricter about parameter names and compilation context than `run_script`. If `eval_file` returns compile errors from wrapper code, prefer `run_script`.
- `set_serialized_field` supports object references using `ObjectRef` form: `{"fileId": ..., "guid": ...}`. Some asset paths/properties still reject writes; in those cases, `SerializedObject` in an editor script is the reliable path.

### Script execution gotchas
- `run_script` needs `file` and `method`.
- `eval_file` needs `file`, not `path`.
- Inline `eval` often fails on namespace imports or multi-line class bodies; keep it to small expressions or use `run_script` instead.
- After `recompile`, wait for `recompile_status` to return `completed` before executing.

### Console and diagnostics
- Use `get_console_logs` for recent captured logs.
- For errors that survive a fix, check the project's actual Editor log path, which under this project is `unity-project-mcp/Logs/Editor.log`.
- Errors that mention `ExecuteCommandByName: Required parameter 'file' is missing or empty` are bridge/probe noise from earlier failed `eval_file` attempts, not Unity project errors.

### Render pipeline and package migrations
- This project migrated from Built-in Render Pipeline to URP 17.0.0 on Unity 6.6.
- After changing `Packages/manifest.json` or `ProjectSettings/ProjectVersion.txt`, expect a full reimport.
- A URP `UniversalRenderPipelineAsset` requires a non-empty `m_RendererDataList`; otherwise the Console floods with `Default Renderer is missing` errors.
- The reliable fix is a short editor script using `SerializedObject`/`SerializedProperty`, not YAML patching.

### PowerShell host notes
- Kilo Code runs on PowerShell. Avoid embedding complex shell control flow inside tool args.
- If a tool keeps failing with parser/CLIXML issues, fall back to a small `.ps1` script or a direct tool call instead of retrying shell variations.

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `Unity MCP server not running (no port file)` | Editor not running, or Pipeline server did not start | Open the project, wait for reimport, then retry |
| `Unity API request timed out (30000ms)` | Unity is loading/reimporting | Back off and retry; do not spam the API |
| `400 Bad Request` | Wrong parameter names or missing required params | Use `unity_list_pipeline_commands` and exact schema |
| `Parameter validation failed: Required parameter 'file' is missing or empty` | Wrong param name for `eval_file` / `run_script` | Use `file`, not `path`; for `run_script` also pass `method` |
| `eval_file` compile errors on namespaces/classes | Inline compilation wrapper limitation | Use `run_script` with a compiled `Assets/Editor/*.cs` file instead |
| `set_serialized_field` / `get_serialized_fields` 400 on assets | API rejected asset path/property access | Use an editor script with `SerializedObject` instead |
| YAML edit has no effect | Unity Library cache overrides `.asset` text | Do not patch assets by text; use editor script |
| Missing `.unity-pipeline-port` after Library deletion | Cache wipe removed port descriptor | Restart Unity; wait for Pipeline server to recreate the file |
| `compiling: true` / `domainReloadInProgress: true` | Domain reload after package change | Wait until `editor_status` reports ready |

## File Path Rules

- **Capture paths** must be within the Unity project root: `Assets/Textures/preview.png`
- **Scene paths** go under `Assets/Scenes/`
- **Asset paths** go under `Assets/`
- **Editor scripts** go under `Assets/Editor/`

## MCP Bridge Details

The bridge server (`tools/mcp/unity-mcp-bridge.mjs`) wraps the Unity Pipeline HTTP API:

```javascript
// Reads auth token from Library/Pipeline/.unity-pipeline-port
// Translates MCP tool → POST http://127.0.0.1:7800/api/exec
// Returns Unity response as MCP tool result
```

Bridge dependencies live under `.kilo/node_modules/` and `tools/mcp/`.

## See Also

- [Unity Pipeline Connectivity](Documentation~/connectivity.md)
- [Creating Commands](Documentation~/creating-commands.md)
- [Runtime Connection](Documentation~/runtime-setup.md)
- `unity-project-mcp/Assets/Editor/FixURPAsset.cs` — example editor script for asset repair via `run_script`

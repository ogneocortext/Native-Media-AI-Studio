# Skill: open-computer-use

## open-computer-use — Cross-Platform Desktop Automation via MCP

**Purpose**: Enable LLMs/agents to see, click, type, and interact with any desktop application on Windows through a standardized MCP interface. Works with Blender, Unity, browsers, custom apps, video players, etc.

**When to use**:
- Interactive debugging of desktop apps (Blender, Unity, custom frontends)
- Frame-by-frame video analysis of application behavior
- UX auditing by walking through UI flows
- Automated testing of desktop applications
- Cross-app workflows (e.g., Blender → Unity → Browser)
- Visual regression testing of desktop UIs

**Not for**: Web-only tasks (use Playwright/browser automation instead)

---

## Installation (Windows)

```powershell
# Global install via npm (requires Node.js)
npm i -g open-computer-use

# Verify installation
open-computer-use call list_apps
```

**Requirements**: Node.js 18+, npm

---

## MCP Server Configuration

### For Atomic Chat (STDIO transport)

**Config location**: `%USERPROFILE%\.config\atomic-chat\mcp\open-computer-use.json`

```json
{
  "mcpServers": {
    "open-computer-use": {
      "command": "open-computer-use",
      "args": ["mcp"],
      "transport": "stdio"
    }
  }
}
```

**Atomic Chat Settings UI**:
1. Open Settings → MCP Servers
2. Add Server → Name: `open-computer-use`
3. Transport: `STDIO`
4. Command: `open-computer-use`
5. Arguments: `mcp`
6. Save & Restart Atomic Chat

---

## Available Tools (via MCP)

| Tool | Description |
|------|-------------|
| `list_apps` | List running applications with PIDs and window titles |
| `focus_app` | Bring an application to foreground by name/PID |
| `click` | Click at coordinates (x, y) relative to window/app |
| `type_text` | Type text into focused element |
| `key_press` | Press key combinations (e.g., `ctrl+s`, `f5`) |
| `scroll` | Scroll in focused window |
| `screenshot` | Capture screenshot of app/window/screen |
| `get_window_info` | Get window bounds, title, PID |
| `wait_for_window` | Wait for window to appear |
| `drag_drop` | Drag from (x1,y1) to (x2,y2) |
| `get_element` | Find UI element by text/role/attributes |
| `hover` | Hover over element |

---

## Usage Examples

### 1. List Running Apps (Health Check)
```javascript
// In Atomic Chat or via agent
await mcp.call("open-computer-use", "list_apps");
```

### 2. Focus Blender & Take Screenshot
```javascript
await mcp.call("open-computer-use", "focus_app", { name: "blender" });
await mcp.call("open-computer-use", "screenshot", { app: "blender" });
```

### 3. Unity Editor Automation
```javascript
await mcp.call("open-computer-use", "focus_app", { name: "unity" });
await mcp.call("open-computer-use", "click", { x: 100, y: 200 }); // Click GameObject
await mcp.call("open-computer-use", "key_press", { keys: ["ctrl", "s"] }); // Save scene
```

### 4. Frame-by-Frame Video Analysis
```javascript
// Focus video player (VLC, MPV, etc.)
await mcp.call("open-computer-use", "focus_app", { name: "vlc" });
for (let i = 0; i < 100; i++) {
  await mcp.call("open-computer-use", "key_press", { keys: ["right"] }); // Next frame
  const shot = await mcp.call("open-computer-use", "screenshot");
  await analyzeFrame(shot); // Your analysis logic
}
```

### 5. UX Audit Walkthrough
```javascript
await mcp.call("open-computer-use", "focus_app", { name: "my-frontend" });
const flow = [
  { action: "click", target: "login-button" },
  { action: "type_text", target: "email", text: "test@example.com" },
  { action: "type_text", target: "password", text: "password123" },
  { action: "click", target: "submit" },
  { action: "screenshot", name: "dashboard" },
  { action: "click", target: "settings-tab" },
  { action: "screenshot", name: "settings" },
];
for (const step of flow) {
  await mcp.call("open-computer-use", step.action, step);
}
```

### 6. Cross-App Workflow (Blender → Unity)
```javascript
// Export from Blender
await mcp.call("open-computer-use", "focus_app", { name: "blender" });
await mcp.call("open-computer-use", "key_press", { keys: ["ctrl", "e"] }); // Export
await mcp.call("open-computer-use", "type_text", { text: "/tmp/export.fbx" });
await mcp.call("open-computer-use", "key_press", { keys: ["enter"] });

// Import to Unity
await mcp.call("open-computer-use", "focus_app", { name: "unity" });
await mcp.call("open-computer-use", "key_press", { keys: ["ctrl", "i"] }); // Import
await mcp.call("open-computer-use", "type_text", { text: "/tmp/export.fbx" });
await mcp.call("open-computer-use", "key_press", { keys: ["enter"] });
```

---

## Best Practices for Agents

1. **Start Safe**: Always `list_apps` first, then `focus_app` before acting
2. **Non-Destructive First**: Use `screenshot` and `get_element` before `click`/`type`
3. **Verify State**: `screenshot` after each major action to confirm
4. **Use Coordinates Carefully**: Prefer `get_element` by text/role over raw coordinates
5. **Clean Up**: Close apps you opened, restore window positions
6. **Error Handling**: Wrap in try/catch, log screenshots on failure

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `command not found` | Reinstall: `npm i -g open-computer-use` |
| MCP connection fails | Check Atomic Chat logs; ensure config path is correct |
| App not found in `list_apps` | Use exact window title substring; check PID |
| Click/Type not working | Ensure app is focused first; try `wait_for_window` |
| Screenshot blank | App may be minimized or on different monitor |

---

## Advanced: Video Frame Analysis Pipeline

```python
# Agent-side pseudo-code for frame analysis
async def analyze_video_frames(app_name, frame_count=60):
    await mcp.call("open-computer-use", "focus_app", { "name": app_name })
    frames = []
    for i in range(frame_count):
        await mcp.call("open-computer-use", "key_press", { "keys": ["right"] })
        await asyncio.sleep(0.05)  # ~20fps
        shot = await mcp.call("open-computer-use", "screenshot")
        analysis = await vision_model.analyze(shot, prompt=f"Frame {i}: describe UI changes, anomalies, loading states")
        frames.append({"frame": i, "analysis": analysis})
    return frames
```

---

## Security Notes

- The MCP server runs with your user permissions
- Only grant access to trusted agents/sessions
- Monitor Atomic Chat's MCP activity log
- Use `list_apps` to audit what's accessible
- Consider running in a VM for untrusted agent code

---

## Integration with Existing Skills

| Skill | Complements |
|-------|-------------|
| `blender-mcp` | Blender-specific ops via open-computer-use fallback |
| `unity-mcp` | Unity Editor automation when MCP not available |
| `vision-page-analysis` | Analyze screenshots from open-computer-use |
| `visual-qa-loop` | Automated visual regression testing |
| `browser-automation` | For web parts of hybrid desktop/web apps |

---

## Verification Checklist

After setup, verify with Atomic Chat:
1. "Use open-computer-use to list my open applications"
2. "Focus Notepad and type 'test' then screenshot"
3. "Focus Blender and take a screenshot of the viewport"
4. "Record 10 frames from VLC playing a video"

If all pass → ready for agent use.
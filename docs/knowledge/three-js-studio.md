# Three.js Studio — Route Documentation

> Compiled: 2026-09-15
> Context: Native Media AI Studio — `/three-js-studio` route reference

## Overview

`/three-js-studio` is the project's **scene-authoring and 3D-preview environment**. It lives at `packages/frontend/src/features/three-js-studio/ThreeJSStudio.tsx` and provides:
- 6 production-ready scene templates (Concert Stage, Cosmic Void, Equalizer Wall, Geometric City, Vinyl Spin, Pulse Orb)
- Object/track managers for adding/removing scene elements
- AI scene generator (driven by Ollama VLM or text prompt)
- Code panel for inspecting/editing generated scene JSON
- HUD overlay with camera, render, and export controls
- Bottom drawer for asset library (Poly Haven, Sketchfab, Poly Pizza, Hyper3D Rodin, Hunyuan3D)

## Architecture

### Core Components
- **ThreeJSStudio.tsx** — top-level page component; manages active template, mode state, and sidebar tabs
- **SceneTemplates/** — declarative template definitions (geometry, lighting, post-processing)
- **ObjectManager.tsx** — add/remove/toggle GameObjects in the active scene
- **TrackManager.tsx** — audio-track binding for beat-synced camera/object animation
- **AISceneGenerator.tsx** — natural-language → Three.js scene via Ollama VLM + code execution
- **SceneCodePanel.tsx** — syntax-highlighted scene JSON editor with live-apply
- **StudioHUD.tsx** — floating toolbar (orbit controls, render settings, export GLB/FBX)
- **AssetDrawer.tsx** — tabbed asset browser for external model sources

### Render Pipeline
- Uses the same R3F `<Canvas>` as the main visualizer (single-canvas pattern)
- Post-processing via `EffectComposer` + `OutputPass` (WebGL2 forced)
- Template switching replaces scene graph children inside a `<group>` — does NOT remount `<Canvas>`
- Export path: `blender_export_scene` for GLB/FBX, `unity_capture_scene_view` for PNG stills

## Key Patterns

### Template Selection
```tsx
const [activeTemplate, setActiveTemplate] = useState<string>("concert-stage");
// Templates are keyed by id; each exports { setup(scene, tracks) => void }
```

### Beat-Synced Animation
- `get_beat_data()` reads `beat_data.json` (written by `analyze_and_sync.py`)
- Keyframe intervals computed at 24fps; animation clips created via `unity_create_beat_animation`
- Camera moves: orbit, dolly, crane — interpolated with `anime.js` for smooth easing

### Asset Import Flow
1. Search external library (Poly Haven / Sketchfab / Poly Pizza)
2. Download to cache (`blender_download_*` tools)
3. Import into scene (`blender_import_*`)
4. Scale/normalize to scene units
5. Optional: assign material preset based on template

## Known Limitations
- GLTF/FBX export from R3F is single-material only; complex Blender-node materials must be exported from Blender directly
- Hyper3D Rodin / Hunyuan3D generations require API keys configured on the ComfyUI server
- Scene templates are currently hardcoded; runtime serialization to `scene.json` is partial

## Related Files
- `packages/frontend/src/features/three-js-studio/ThreeJSStudio.tsx`
- `packages/frontend/src/features/three-js-studio/templates/*.ts`
- `packages/frontend/src/features/three-js-studio/hooks/useBeatSync.ts`
- `tools/vision/analyze.mjs` — VLM analysis for AI scene generation
- `docs/knowledge/unity-audio-visualization-2026.md` — Unity-side beat reactivity reference
- `docs/knowledge/audio-visualization-techniques-2026.md` — FFT banding, particle systems, genre mapping

# Three.js Studio — Route Documentation

> Compiled: 2026-09-15
> Updated: 2026-09-29 — UX audit F1-F9 behaviours added, component/export/beat references corrected to match source
> Context: Native Media AI Studio — `/three-js-studio` route reference

## Overview

`/three-js-studio` is the project's **scene-authoring and 3D-preview environment**. It lives at `packages/frontend/src/features/three-js-studio/ThreeJSStudio.tsx` and provides:
- 6 production-ready scene templates (Concert Stage, Cosmic Void, Equalizer Wall, Geometric City, Vinyl Spin, Pulse Orb)
- Object/track managers for adding/removing scene elements
- AI scene generator (driven by Ollama VLM or text prompt)
- Code panel for inspecting/editing generated scene JSON
- HUD overlay with camera, render, and export controls
- Bottom drawer with **Scene / Objects / Inspector** tabs (palette, object list, transform & GLB drop-target, post-processing sliders); the code editor is a separate header toggle

## Interaction Model (updated 2026-09-29, UX audit F1-F9)

- **Add** objects from the header palette (Crown, Sphere, Box, Character) or the
  drawer's quick-add row (also Cylinder, Cone, Torus). New objects take a
  **golden-angle spiral slot** so they never stack at the origin, are selected
  immediately, and confirm with a toast.
- **Select** by clicking an object in the canvas (a drag still orbits the
  camera; clicking empty space deselects). **Delete / Backspace** removes the
  selection, ignored while typing in an input.
- **Playback** has two clearly-separated words: **Preview** (live canvas, no
  file written) vs **Export frame as PNG** (the only file output today — there
  is no frame-sequence recorder).
- **Disposal**: removing an object runs `geometry.dispose()` /
  `material.dispose()` and stops its mixer, so long sessions do not leak GPU
  resources (verified by `three-studio-dispose-check.mjs`).
- **Post-processing**: custom vignette darkens toward **black** (three's stock
  `VignetteShader` mixes toward grey and hazes out the background — audit F8),
  plus film grain, chromatic aberration and selective (hero-glow) bloom.

Source of truth for the findings and their verification:
`docs/ux-audit/three-js-visualizer-review-2026-09-29.md`.

Browser checks (dev server on `127.0.0.1:5173`):

```bash
node packages/frontend/tests/browser/three-studio-audit-checks.mjs   # F2-F6/F9
node packages/frontend/tests/browser/three-studio-dispose-check.mjs  # F1
```

Headless hook: `window.__renderer` (live `WebGLRenderer`, removed on unmount)
exposes `renderer.info.memory.*` for leak assertions.

## Architecture

### Core Components
- **ThreeJSStudio.tsx** — top-level page component; owns template/mode/selection state and composes the header, HUD, drawer and canvas
- **sceneTemplates.ts** — `SCENE_TEMPLATES: SceneTemplate[]` declarative presets (objects, lighting, particles, camera mode, `sceneConfig` overrides)
- **threeStudioConfig.ts** — `DEFAULT_SCENE` / `DEFAULT_PARTICLES` / `DEFAULT_OBJECTS` defaults and `BLOOM_LAYER`
- **hooks/useThreeScene.ts** — renderer, scene graph, raycast selection, animation loop, dispose; exposes `window.__renderer`
- **hooks/useObjectManager.ts** — add (spiral slot + select + toast), remove (with GPU dispose), template apply
- **hooks/useTrackManager.ts / useTrackMetadata.ts** — audio track binding, BPM/duration metadata, beat data
- **hooks/useCodeApplier.ts** — applies edited scene JSON back onto the live scene
- **components/** — `StudioHeader` (palette, track selector, export PNG, drawer toggle), `StudioHUD` (counters with tooltips), `PlaybackControls` (Preview + scrub), `BottomDrawer` / `SceneTab` / `ObjectsTab` / `InspectorTab` / `CodePanel` / `AISceneGenerator` / `TrackInfoBar` / `SliderRow`

### Render Pipeline
- Raw **three.js** (`WebGLRenderer` on a plain `<canvas>`, no R3F) — it does *not* share the visualizer's React-Three-Fiber `<Canvas>`
- Post-processing chain: selective bloom (hero-glow layer) → chromatic aberration → film grain → custom vignette → `OutputPass`
- Template switching replaces scene graph children inside a `<group>` — does NOT recreate the renderer
- **Export**: PNG still via `canvas.toDataURL()` (header download icon). GLB/FBX *import* is supported in the Inspector (drag-drop `.glb`); there is no studio-side mesh export or frame-sequence recorder
- TSL note: new shader work should use `MeshStandardNodeMaterial` / `MeshPhysicalNodeMaterial` node slots rather than raw `ShaderMaterial` so scenes can preview under both WebGPU and WebGL2.

## TSL Integration Points

### Material Nodes
- All visualizer materials should prefer `*NodeMaterial` with `colorNode`, `positionNode`, `roughnessNode`, `metalnessNode`, `emissiveNode`, `opacityNode`, `scaleNode`, and `fragmentNode` slots for audio-reactive behavior.
- The project already uses `MeshStandardNodeMaterial` / `MeshPhysicalNodeMaterial` in the visualizer; carry the same pattern into scene templates.

### Compute Shaders (WebGPU)
- `instancedArray(count, 'vec3')` + `.toAttribute()` is the canonical way to drive particle / point systems from compute.
- Use `Fn().compute(count)` for per-object compute when the count is known at init.
- Use `renderer.compute(computeNode)` in animation loops for explicit dispatch.
- Use `await renderer.computeAsync(computeNode)` when the CPU needs the result in the same frame.

### Audio-Driven TSL Pattern
- Upload CPU-side `AnalyserNode` frequency data to a `DataTexture` each frame.
- Sample it inside `fragmentNode` / `vertexNode` with `texture(analyserTexture, screenUV.x).x`.
- For heavy DSP (large FFT, onset detection), offload to a TSL compute shader writing into a `StorageInstancedBufferAttribute`, then read back only the reduced band energies.

### Post-Processing
- `EffectComposer` + `OutputPass` is the current baseline.
- For WebGPU-native post-processing, use TSL `fragmentNode` overrides on a full-screen mesh or `StorageTexture` + compute passes for edge/depth-based effects.

## Key Patterns

### Template Selection
```tsx
const [activeTemplateId, setActiveTemplateId] = useState<string>("concert");
// SCENE_TEMPLATES lives in sceneTemplates.ts — keyed by id
// ("concert" | "cosmic-void" | "equalizer" | "geometric-city" | ...);
// useObjectManager.applyTemplate() copies objects/particles/camera mode in.
```

### Beat-Synced Animation
- `useTrackManager` reads analysis from `useBeatTimeline` (shared hook) /
  `getAnalysis()` — `beatAnalysis.tempo_bpm` seeds the BPM field
- A WebAudio `AnalyserNode` (fftSize 256) on the selected track drives
  `beatActive`; when beat sync is on, `sceneConfig.beatPunch` scales the scene
  on transients
- `useThreeScene` receives a **stub** `getCurrentBeat()` today — per-beat
  callbacks in the scene engine are not wired to the timeline (open item)

### Asset Import Flow
1. Drop a `.glb`/`.gltf` on the Inspector's model field (or browse)
2. `useMeshFactory` loads it via `GLTFLoader` and picks an animation clip
3. Scale/normalize to scene units
4. Optional: assign material preset based on template

## Known Limitations
- There is no mesh export path from the studio — PNG stills only; complex
  Blender-node materials must be exported from Blender directly
- No frame-sequence recorder; use the Unity/Blender capture paths
- Hyper3D Rodin / Hunyuan3D generations require API keys configured on the ComfyUI server
- Scene templates are currently hardcoded; runtime serialization to `scene.json` is partial
- `Apply to Scene` in the code panel is a no-op — `ThreeJSStudio` passes
  `useCodeApplier({ sceneRef: { current: null } })` (UX audit observation O1)

## Related Files
- `packages/frontend/src/features/three-js-studio/ThreeJSStudio.tsx`
- `packages/frontend/src/features/three-js-studio/sceneTemplates.ts`
- `packages/frontend/src/features/three-js-studio/threeStudioConfig.ts`
- `packages/frontend/src/features/three-js-studio/hooks/useThreeScene.ts` — renderer, raycast, dispose, post-processing
- `packages/frontend/src/features/three-js-studio/hooks/useObjectManager.ts` — add/remove/template apply
- `packages/frontend/src/features/three-js-studio/hooks/useTrackManager.ts` — track + beat wiring
- `packages/frontend/src/hooks/useBeatTimeline.ts` — shared beat analysis/getCurrentBeat
- `packages/frontend/tests/browser/three-studio-audit-checks.mjs` — UX audit regression (F2-F6/F9)
- `packages/frontend/tests/browser/three-studio-dispose-check.mjs` — GPU dispose regression (F1)
- `docs/ux-audit/three-js-visualizer-review-2026-09-29.md` — findings F1-F11 + triage
- `tools/vision/analyze.mjs` — VLM analysis for AI scene generation
- `docs/knowledge/unity-audio-visualization-2026.md` — Unity-side beat reactivity reference
- `docs/knowledge/audio-visualization-techniques-2026.md` — FFT banding, particle systems, genre mapping

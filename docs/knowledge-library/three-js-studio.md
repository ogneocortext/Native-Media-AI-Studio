---
tags:
  - platform
  - 3d
aliases:
  - Three.js Studio
  - Browser 3D
  - WebGL Studio
cssclasses:
  - platform-guide
date: 2026-09-29
type: entity
---

# 🌐 Three.js Studio

> [!info] Purpose
> Browser-based 3D scene builder for music video production.
> Runs entirely in the browser using WebGL - no external software needed.
> Perfect for creating animated 3D scenes with particles, reflections, and beat sync.

---

## Features

### Core Capabilities

- **Real-time 3D rendering** via WebGL (Three.js)
- **Particle systems** with customizable count, size, color, speed
- **Reflective materials** (metalness, roughness, emissive)
- **Multiple light types** (ambient, directional, spot, point)
- **Camera modes** (static, orbit, dolly, handheld)
- **Post-processing** (bloom/glow effects)
- **Frame export** as PNG
- **Video recording** (frame sequence capture)

### Music Video Specific

- **Beat sync animation** hooks for synchronizing to audio
- **Camera movement presets** for different song sections
- **Color palette control** for mood consistency
- **Particle effects** for energy and atmosphere
- **Reflective floor** for professional look

---

## Scene Objects

### Crown (Music Video Prop)

The default scene includes a stylized crown with:

- Gold metallic band (high metalness, low roughness)
- 8 spikes around the band
- Glowing purple gem center (emissive)
- Gentle rotation and bob animation

### Adding Objects

Objects come from two places:

- **Header palette** — 👑 Crown, Sphere, Box, Character
- **Drawer quick-add row** — the same palette plus Cylinder, Cone, Torus

Each new object gets its **own golden-angle spiral slot** instead of stacking at
the origin, is selected immediately, and confirms with a toast — so the new
object is always visible and reachable even when the scene already has objects.

### Selecting & Removing Objects

- **Click an object in the canvas** to select it (dragging still orbits the
  camera; clicking empty space deselects)
- **Delete / Backspace** removes the selected object — ignored while focus is
  in an input/textarea
- The **Objects list** in the bottom drawer shows every object with visibility,
  hero-glow (bloom) and per-row remove controls
- Removing an object releases its GPU resources (`geometry.dispose()`,
  `material.dispose()`, mixer stop) so long sessions do not leak

---

## Particle System

| Property | Range     | Default | Effect                       |
| -------- | --------- | ------- | ---------------------------- |
| Count    | 100-10000 | 150     | Number of particles          |
| Size     | 0.01-0.1  | 0.018   | Particle size in world units |
| Color    | Any       | #8b5cf6 | Particle color               |
| Speed    | 0-5       | 0.4     | Rise speed                   |
| Spread   | 1-20      | 6       | Spread radius                |
| Opacity  | 0-1       | 0.6     | Particle transparency        |

> [!tip] Music Video Particles
>
> - **Chorus**: Fast, many particles, bright colors
> - **Verse**: Slow, few particles, muted colors
> - **Bridge**: Unique colors, medium speed

---

## Reflections & Materials

### Material Properties

| Property           | Range | Effect                           |
| ------------------ | ----- | -------------------------------- |
| Metalness          | 0-1   | How metallic the surface appears |
| Roughness          | 0-1   | How rough/smooth the surface is  |
| Emissive           | Color | Self-illumination color          |
| Emissive Intensity | 0-5   | Glow strength                    |

### Preset Materials

| Material | Metalness | Roughness | Emissive | Use For            |
| -------- | --------- | --------- | -------- | ------------------ |
| Gold     | 0.9       | 0.1       | #ff8c00  | Crown, jewelry     |
| Chrome   | 1.0       | 0.05      | none     | Modern props       |
| Glass    | 0.0       | 0.0       | #8b5cf6  | Glowing gems       |
| Matte    | 0.0       | 1.0       | none     | Background objects |

---

## Lighting Setup

### Four-Point Lighting

1. **Ambient** - Base illumination (low intensity, cool color)
2. **Directional** - Main light source (white, casts shadows)
3. **Spot** - Dramatic accent (colored, focused beam)
4. **Point** - Fill light (warm/cool accent)

### Music Video Lighting Moods

| Mood      | Ambient      | Directional | Spot    | Point  |
| --------- | ------------ | ----------- | ------- | ------ |
| Happy     | Warm, medium | Bright      | Yellow  | Pink   |
| Sad       | Cool, low    | Soft        | Blue    | Purple |
| Energetic | Low          | Harsh       | Magenta | Cyan   |
| Calm      | Warm, high   | Soft        | Orange  | Pink   |

---

## Camera Modes

| Mode     | Description            | Best For            |
| -------- | ---------------------- | ------------------- |
| Static   | Fixed position         | Performance shots   |
| Orbit    | Circles around subject | Showcase, drama     |
| Dolly    | Moves toward/away      | Build intensity     |
| Handheld | Slight random movement | Energy, documentary |

### Camera Movement by Section

| Section    | Mode              | Speed  |
| ---------- | ----------------- | ------ |
| Intro      | Dolly (in)        | Slow   |
| Verse      | Static or orbit   | Slow   |
| Pre-Chorus | Dolly (in)        | Medium |
| Chorus     | Orbit or handheld | Fast   |
| Bridge     | Orbit             | Medium |
| Outro      | Dolly (out)       | Slow   |

---

## Post-Processing

### Bloom/Glow

The scene includes Unreal Bloom post-processing for:

- Glowing emissive objects
- Light bleed effects
- Dreamy atmosphere

| Parameter | Range | Default | Effect                         |
| --------- | ----- | ------- | ------------------------------ |
| Strength  | 0-2   | 0.45    | Intensity of bloom             |
| Radius    | 0-1   | 0.35    | Spread of glow                 |
| Threshold | 0-1   | 0.9     | What brightness triggers bloom |

Bloom is **selective**: only objects flagged as hero-glow contribute, so dark
materials stay dark. The HUD's `Bloom 1/1` counter shows how many objects are
currently in that layer.

### Vignette, grain & chromatic aberration

| Pass                 | Config key             | Default | Effect                             |
| -------------------- | ---------------------- | ------- | ---------------------------------- |
| Vignette             | `vignetteStrength`     | 0.35    | Darkens frame edges toward **black** |
| Vignette radius      | `vignetteRadius`       | 0.7     | How far in the darkening starts    |
| Film grain           | `filmGrain`            | 0.04    | Subtle animated noise              |
| Chromatic aberration | `chromaticAberration`  | 0.0015  | Edge fringing                      |

> [!note] Why a custom vignette
> Three's stock `VignetteShader` mixes toward `vec3(1.0 - darkness)` — a *grey*
> wash — which turned the studio background `(78,77,78)` into a flat grey haze.
> The studio ships its own vignette pass that darkens toward black instead
> (UX audit finding F8, 2026-09-29). Replacing it re-introduces the haze.

Scene templates override these defaults per preset (`sceneTemplates.ts`), e.g.
Equalizer Wall sets `bloomStrength: 1.2`, Cosmic Void `vignetteStrength: 0.7`.

---

## Export Options

### Preview vs. render

- **Preview** (play button under the canvas) runs the live canvas animation —
  camera modes, beat pulse, timeline scrub. It writes **no file**.
- File output is **Export Frame**. Keep the words *render* / *export* for
  actions that actually produce a file (UX audit finding F9, 2026-09-29).

### Frame Export

- Click the **download icon** in the header to save the current view as PNG
- Resolution matches canvas size
- Useful for thumbnails or still renders

> [!warning] Frame-sequence recording is not implemented
> The older docs described a **Record** button capturing an FPS-selective PNG
> sequence — there is no such control in the studio. For frame sequences use
> the Unity/Blender capture paths (`docs/guides/MUSIC_VIDEO_GUIDE.md`).

---

## Beat Synchronization

### Hook System

The studio provides a `beatCallback` that fires every frame:

```javascript
beatCallbackRef.current = (elapsedTime) => {
  // Sync animations to audio beats
  // Example: trigger effect on beat
};
```

### Sync Strategies

| Strategy       | Implementation                    |
| -------------- | --------------------------------- |
| Cut on beat    | Change camera angle at beat times |
| Pulse on beat  | Scale objects to beat             |
| Color shift    | Change light color on chorus      |
| Particle burst | Emit particles on drops           |

---

## Performance Tips

### For 8GB VRAM (GTX 1070 Ti)

- Keep particle count under 2000
- Use moderate bloom settings
- Limit reflective objects to 3-5
- Use 1920x1080 or lower resolution

### Optimization

- Disable shadows if not needed
- Reduce particle count for faster export
- Lower bloom quality for real-time preview
- Increase for final render

---

## Technical Details

### Stack

- **Three.js** - WebGL rendering library
- **React** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool

### Browser Requirements

- WebGL 2.0 support
- Modern browser (Chrome, Firefox, Edge)
- Hardware acceleration enabled

### Dependencies

```json
{
  "three": "^0.160.0",
  "@types/three": "^0.160.0"
}
```

### Headless hooks

`window.__renderer` — the live `WebGLRenderer` while the studio is mounted
(assigned in `useThreeScene`, removed on unmount). Browser checks read
`renderer.info.memory.{geometries,textures}` and `renderer.info.programs.length`
to prove GPU disposal; everything else is driven through the real UI (HUD
counters, add toasts, canvas hit-testing, panel selects).

### Regression checks

```bash
node packages/frontend/tests/browser/audit/three-studio-audit-checks.mjs   # audit F2-F6/F9 (10 checks)
node packages/frontend/tests/browser/audit/three-studio-dispose-check.mjs  # audit F1 (GPU dispose on removal)
```

Both scripts need a dev server on `127.0.0.1:5173` and assert **zero console
errors**. The vignette change alters `/three-js-studio` pixels — re-capture
`tests/visual/baselines/` when post-processing defaults change.

---

## Interaction Model (UX audit F1–F9, 2026-09-29)

- **Add** objects from the header palette (Crown, Sphere, Box, Character) or the drawer's quick-add row (also Cylinder, Cone, Torus). New objects take a golden-angle spiral slot so they never stack at the origin, are selected immediately, and confirm with a toast.
- **Select** by clicking an object in the canvas (a drag still orbits the camera; clicking empty space deselects). **Delete / Backspace** removes the selection, ignored while typing in an input.
- **Preview** (live canvas, no file written) vs **Export frame as PNG** (the only file output today — no frame-sequence recorder).
- **Disposal**: removing an object runs `geometry.dispose()` / `material.dispose()` and stops its mixer; verified by `three-studio-dispose-check.mjs`.
- **Post-processing**: custom vignette darkens toward **black** (three's stock `VignetteShader` mixes toward grey), plus film grain, chromatic aberration and selective (hero-glow) bloom.

Source of truth: `docs/ux/three-js-visualizer-review-2026-09-29.md`.

## Architecture

Core components: `ThreeJSStudio.tsx` (top-level), `sceneTemplates.ts` (`SCENE_TEMPLATES`), `threeStudioConfig.ts` (`DEFAULT_SCENE`/`DEFAULT_PARTICLES`/`DEFAULT_OBJECTS`, `BLOOM_LAYER`), `hooks/useThreeScene.ts` (renderer, raycast, dispose, post-processing, `window.__renderer`), `hooks/useObjectManager.ts` (add/remove/template apply), `hooks/useTrackManager.ts`/`useTrackMetadata.ts`, `hooks/useCodeApplier.ts`, and `components/` (header, HUD, playback, drawer tabs, code panel, AI generator).

Render pipeline: raw three.js (`WebGLRenderer` on a plain `<canvas>`, no R3F); post-processing chain selective bloom → chromatic aberration → film grain → custom vignette → `OutputPass`; template switching replaces scene-graph children inside a `<group>` without recreating the renderer. Export: PNG still via `canvas.toDataURL()`. GLB/FBX **import** supported in Inspector; no studio-side mesh export or frame-sequence recorder. New shader work should use `MeshStandardNodeMaterial`/`MeshPhysicalNodeMaterial` node slots so scenes preview under WebGPU and WebGL2.

## TSL Integration Points

- Materials: prefer `*NodeMaterial` with `colorNode`, `positionNode`, `roughnessNode`, `metalnessNode`, `emissiveNode`, `opacityNode`, `scaleNode`, `fragmentNode`.
- Compute: `instancedArray(count, 'vec3')` + `.toAttribute()`; `Fn().compute(count)`; `renderer.compute(computeNode)` in loops; `await renderer.computeAsync(computeNode)` when CPU needs the result same frame.
- Audio-driven: upload `AnalyserNode` frequency data to a `DataTexture` each frame; sample in `fragmentNode`/`vertexNode`; offload heavy DSP to a TSL compute shader writing a `StorageInstancedBufferAttribute`, read back only reduced band energies.
- Post-processing: `EffectComposer` + `OutputPass` baseline; WebGPU-native uses TSL `fragmentNode` overrides or `StorageTexture` + compute passes.

## Key Patterns

- Template selection: `useState<string>("concert")`; `useObjectManager.applyTemplate()` copies objects/particles/camera mode.
- Beat sync: `useTrackManager` reads `useBeatTimeline`/`getAnalysis()`; `beatAnalysis.tempo_bpm` seeds BPM; WebAudio `AnalyserNode` (fftSize 256) drives `beatActive`; `sceneConfig.beatPunch` scales on transients. `useThreeScene` receives a stub `getCurrentBeat()` today — per-beat callbacks not yet wired (open item).
- Asset import: drop `.glb`/`.gltf` on Inspector model field → `useMeshFactory` loads via `GLTFLoader`, picks a clip, normalizes to scene units, optional material preset.

## Known Limitations

- No mesh export path from the studio — PNG stills only; complex Blender-node materials must be exported from Blender.
- No frame-sequence recorder; use Unity/Blender capture paths.
- Hyper3D Rodin / Hunyuan3D generations require API keys on the ComfyUI server.
- Scene templates are hardcoded; runtime serialization to `scene.json` is partial.
- `Apply to Scene` in the code panel is a no-op (`useCodeApplier({ sceneRef: { current: null } })`).

## Related Files

- `packages/frontend/src/features/three-js-studio/ThreeJSStudio.tsx`
- `packages/frontend/src/features/three-js-studio/sceneTemplates.ts`
- `packages/frontend/src/features/three-js-studio/threeStudioConfig.ts`
- `packages/frontend/src/features/three-js-studio/hooks/useThreeScene.ts`
- `packages/frontend/src/features/three-js-studio/hooks/useObjectManager.ts`
- `packages/frontend/src/features/three-js-studio/hooks/useTrackManager.ts`
- `packages/frontend/src/features/three-js-studio/hooks/useTrackMetadata.ts`
- `packages/frontend/src/features/three-js-studio/hooks/useCodeApplier.ts`
- `packages/frontend/src/hooks/useBeatTimeline.ts`
- `packages/frontend/tests/browser/audit/three-studio-audit-checks.mjs`
- `packages/frontend/tests/browser/audit/three-studio-dispose-check.mjs`
- `docs/ux/three-js-visualizer-review-2026-09-29.md`
- `tools/vision/analyze.mjs`
- `docs/knowledge-library/unity-audio-visualization-2026.md`
- `docs/knowledge/audio-visualization-techniques-2026.md`

## See Also

- [[music-video-production]] - Full production workflow
- [[3d-rendering]] - GPU rendering optimization
- [[blender-mcp]] - Blender integration for advanced scenes
- [[prompt-engineering]] - Visual style prompts
- [[youtube-optimization]] - Export settings for platforms

---

_Last updated: 2026-09-29_

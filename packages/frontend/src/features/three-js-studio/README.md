# Three.js Studio Feature

Three.js 3D studio integration: scene creation, camera transitions, beat-driven animation, object management, and code-driven 3D generation for music videos.

## Entry Points

| File | Purpose |
|------|---------|
| `ThreeJSStudio.tsx` | Main Three.js Studio component: studio shell, tabs, HUD, playback controls |
| `threeStudioConfig.ts` | Studio configuration |
| `types.ts` | TypeScript type definitions for Three.js Studio |
| `sceneTemplates.ts` | Scene templates |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `components/` | Studio UI components: `AISceneGenerator.tsx`, `StudioHUD.tsx`, `PlaybackControls.tsx`, `SceneTab.tsx`, `ObjectsTab.tsx`, `InspectorTab.tsx`, `BottomDrawer.tsx`, `CodePanel.tsx`, `StudioHeader.tsx`, `TrackInfoBar.tsx`, `SliderRow.tsx` |
| `services/` | 3D services: beat phrasing, camera transitions, easing, section driver, scene guidelines, video export |
| `hooks/` | React hooks: `useThreeScene.ts`, `useMeshFactory.ts`, `useObjectManager.ts`, `useTrackManager.ts`, `useTrackMetadata.ts`, `useCodeApplier.ts`, `useOllamaStream.ts` |

## Key Services

| File | Purpose |
|------|---------|
| `beatPhrasing.ts` | Beat phrasing: anticipation, hold, landing windows per beat |
| `cameraTransitions.ts` | Camera transitions: blend between poses, travel-balanced anchors |
| `sectionDriver.ts` | Section-driven transitions: cut on snare, else wipe; boundary-aware |
| `easing.ts` | Easing functions for camera and object animation |
| `sceneGuidelines.ts` | Scene composition guidelines |
| `videoExport.ts` | Video export for Three.js scenes |

## Key Hooks

| File | Purpose |
|------|---------|
| `useThreeScene.ts` | Three.js scene management: camera, renderer, objects |
| `useMeshFactory.ts` | Mesh factory: create 3D objects |
| `useObjectManager.ts` | Object manager: add/remove/update 3D objects |
| `useTrackManager.ts` | Track manager: audio track state for 3D sync |
| `useTrackMetadata.ts` | Track metadata: BPM, key, sections |
| `useCodeApplier.ts` | Code applier: apply generated code to scene |
| `useOllamaStream.ts` | Ollama stream: LLM-driven scene generation |

## Tests

Test files are colocated in `services/`:
- `beatPhrasing.test.ts`, `cameraTransitions.test.ts`, `easing.test.ts`
- `sectionDriver.test.ts`, `videoExport.test.ts`

## Related Docs

- `docs/architecture/visualizer.md` — visualizer module map and refactor rules (D14)
- `unity-visualizer/` — standalone Unity audio visualization project (do not delete/move during cleanup)

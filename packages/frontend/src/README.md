# Frontend Source

This directory groups the React + Vite + TypeScript UI by **responsibility domain** so agents can locate components, hooks, state, and services quickly.

## Module Layout

| Directory | Purpose |
|-----------|---------|
| `App.tsx` | Application root: router, routes, lazy page boundaries, error boundaries |
| `main.tsx` | React entry point: mounts `App` into the DOM, registers providers |
| `vite-env.d.ts` | Vite client type declarations |
| `components/` | Reusable UI components: `common/`, `layout/`, `debug/`, `audio/`, `ai/`, `notifications/`, `tracks/` |
| `features/` | Feature domains (36 subdirectories): `visualizer/`, `remix/`, `three-js-studio/`, `music-video/`, `ollama-chat/`, etc. Each feature owns its pages, components, and local state |
| `hooks/` | Shared React hooks: `useAudioLibrary.ts`, `useBeatTimeline.ts`, `useJobs.ts`, `usePolling.ts`, `useWebSocket.ts`, etc. |
| `services/` | API and adapter clients: `api/` (generated API client), `comfyui.ts`, `sseService.ts`, `fetchWithTimeout.ts`, `portConfig.ts`, `logger.ts`, etc. |
| `state/` | Zustand/global state: `audioLibraryStore.ts`, `jobStore.ts`, `gpuStore.ts`, `healthStore.ts`, `uiStore.ts`, `notificationStore.ts`, `outputStore.ts` |
| `shared/` | Shared types and utilities used across features |
| `styles/` | Global CSS and Tailwind layers |
| `types/` | TypeScript type definitions |
| `utils/` | Pure utility functions: formatting, URL building, audio probing, prompt linting, etc. |
| `assets/` | Static assets: images, fonts, brand |

## Entry Point

- `main.tsx` — React application entry: mounts `App`, registers providers.
- `App.tsx` — Router and route definitions; lazy-loads page components via `lazyNamed()`.

## Conventions

- **Audio selectors read one store** (D16): `useAudioLibrary()` from `hooks/useAudioLibrary`, backed by `state/audioLibraryStore.ts`. Do **not** call `listAudioFiles()` from a component — it now has exactly one caller (the store). Render `optionLabel` and never re-derive a track name with a local regex.
- **`/api/audio` is four modules, not one** (D15): `audio.py` (upload, analysis, cache, JSON index), `audio_stems.py` (separation), `audio_edit.py` (extract/rename/trim/file serving), `audio_analysis.py` (result builder, suggestions, section labelling — no routes). Plus `audio_remix.py` (`/api/audio/remix/*`). Put a new endpoint in the module matching its responsibility.
- **Dependency direction** (backend): `api -> services -> adapters`, only downward. Frontend services call the API client; features call services; components call hooks.
- **Tests**: Unit tests are `src/**/*.test.ts` (vitest, colocated next to the module). Playwright E2E specs live in `tests/` and `packages/frontend/tests/`.
- **Feature directories**: Each subdirectory under `features/` is a self-contained domain. Start at `features/README.md` for the full list, then read the feature's own README if one exists.

## Cross-Cutting Paths

| Concern | Location |
|---------|----------|
| Audio library store | `state/audioLibraryStore.ts` + `hooks/useAudioLibrary.ts` |
| Audio naming/dedup | `state/audioNaming.ts` + `utils/cleanTrackName()` |
| API client | `services/api/` |
| SSE events | `services/sseService.ts` |
| Job queue UI | `features/queue/` |
| Visualizer | `features/visualizer/` |
| Remix / mashup | `features/remix/` |
| Three.js studio | `features/three-js-studio/` |
| Settings | `features/settings/` |

## Related Docs

- `packages/README.md` — package-level layout and entry points
- `../AGENTS.md` — project agent rules, shell rules, Python environment notes
- `docs/architecture/decision-log.md` — architecture decisions (D1–D54), do not re-litigate
- `docs/README.md` — documentation map
- `features/README.md` — feature module overview

# Nav-by-Job Reorganization — Design

**Status:** Proposed  
**Area:** Integrations (T-INT-01)  
**Principle:** Integrate at arm's length, never in-place; nav by job, not  
by vendor. Engines (Remotion, HyperFrames, ComfyUI UI) demoted behind  
their workflow.  
**Last Updated:** 2026-10-27

## Current Nav Destinations

28 routes across `App.tsx` (plus 4 redirect routes for removed/merged):

| Route | Title | Engine/Workflow |
|-------|-------|-----------------|
| `/` | Dashboard | System |
| `/onboarding` | Quick Start | System |
| `/queue` | Queue | System |
| `/music-video-wizard` | Music Video Wizard | Create (Remotion) |
| `/three-js-studio` | Three.js Studio | Create (Three.js) |
| `/audio-analysis` | Audio Analysis | Analyze |
| `/video-generation` | Video Generation | Create (Remotion) |
| `/generate-3d` | 3D Generation | Create (Blender/Unity) |
| `/ai-tools` | AI Tools | Analyze |
| `/ollama-chat` | Ollama Chat | Analyze |
| `/docs` | Documentation | System |
| `/storyboards` | Storyboards | Library |
| `/image-generation` | Image Generation | Create (ComfyUI) |
| `/visualizer` | Visualizer | Render |
| `/hyperframes` | HyperFrames | Create (HyperFrames engine) |
| `/music-prompts` | Music Prompts | Render |
| `/music-gen` | Music Gen | Create (ACE-Step) |
| `/library` | Media Library | Library |
| `/settings` | Settings | System |
| `/log-analytics` | Log Analytics | System |
| `/health` | Health | System |
| `/data-management` | Data Management | System |
| `/database` | Database | System |
| `/kinetic-typography` | Kinetic Typography | Create (Remotion) |
| `/gpu` | GPU Monitor | System |
| `/unity` | Unity Control | Create (Unity) |
| `/preview` | Preview | Render |
| `/notifications` | Notifications | System |
| `/animation-studio` | Animation Studio | Create (Remotion/HyperFrames) |

Redirects:
- `/music-video` → `/music-video-wizard`
- `/studio-3d` → `/generate-3d`
- `/video-editor` → `/video-generation`
- `/diagnostics` → `/health`

## Proposed Job-Based Grouping

### Create — making new media

| Route | Title | Notes |
|-------|-------|-------|
| `/create/music-video` | Music Video Wizard | Remotion engine, demoted behind workflow |
| `/create/video` | Video Generation | Remotion engine, demoted behind workflow |
| `/create/3d` | 3D Generation | Blender/Unity engine, demoted behind workflow |
| `/create/image` | Image Generation | ComfyUI engine, demoted behind workflow |
| `/create/typography` | Kinetic Typography | Remotion engine, demoted behind workflow |
| `/create/music` | Music Gen | ACE-Step engine, demoted behind workflow |
| `/create/animation` | Animation Studio | Remotion/HyperFrames engine |
| `/create/unity` | Unity Control | Unity engine, demoted behind workflow |
| `/create/hyperframes` | HyperFrames | HyperFrames engine, demoted behind workflow |

### Library — managing media assets

| Route | Title | Notes |
|-------|-------|-------|
| `/library` | Media Library | — |
| `/library/storyboards` | Storyboards | — |

### Analyze — analyzing content

| Route | Title | Notes |
|-------|-------|-------|
| `/analyze/audio` | Audio Analysis | — |
| `/analyze/ai` | AI Tools | — |
| `/analyze/chat` | Ollama Chat | — |

### Render — rendering and preview

| Route | Title | Notes |
|-------|-------|-------|
| `/render/visualizer` | Visualizer | — |
| `/render/preview` | Preview | — |
| `/render/prompts` | Music Prompts | — |

### System — system administration

| Route | Title | Notes |
|-------|-------|-------|
| `/system` | Dashboard | — |
| `/system/queue` | Queue | — |
| `/system/settings` | Settings | — |
| `/system/health` | Health | — |
| `/system/data-management` | Data Management | — |
| `/system/database` | Database | — |
| `/system/log-analytics` | Log Analytics | — |
| `/system/gpu` | GPU Monitor | — |
| `/system/notifications` | Notifications | — |
| `/system/docs` | Documentation | — |
| `/system/onboarding` | Quick Start | — |

## Route Changes

### Moved routes (path changes)

| Old | New | Reason |
|-----|-----|--------|
| `/music-video-wizard` | `/create/music-video` | Job-based grouping |
| `/three-js-studio` | `/create/3d` | Job-based grouping |
| `/video-generation` | `/create/video` | Job-based grouping |
| `/generate-3d` | `/create/3d` | Job-based grouping |
| `/image-generation` | `/create/image` | Job-based grouping |
| `/kinetic-typography` | `/create/typography` | Job-based grouping |
| `/music-gen` | `/create/music` | Job-based grouping |
| `/animation-studio` | `/create/animation` | Job-based grouping |
| `/unity` | `/create/unity` | Job-based grouping |
| `/hyperframes` | `/create/hyperframes` | Job-based grouping |
| `/storyboards` | `/library/storyboards` | Job-based grouping |
| `/audio-analysis` | `/analyze/audio` | Job-based grouping |
| `/ai-tools` | `/analyze/ai` | Job-based grouping |
| `/ollama-chat` | `/analyze/chat` | Job-based grouping |
| `/visualizer` | `/render/visualizer` | Job-based grouping |
| `/preview` | `/render/preview` | Job-based grouping |
| `/music-prompts` | `/render/prompts` | Job-based grouping |
| `/` | `/system` | Job-based grouping (Dashboard) |
| `/queue` | `/system/queue` | Job-based grouping |
| `/settings` | `/system/settings` | Job-based grouping |
| `/health` | `/system/health` | Job-based grouping |
| `/data-management` | `/system/data-management` | Job-based grouping |
| `/database` | `/system/database` | Job-based grouping |
| `/log-analytics` | `/system/log-analytics` | Job-based grouping |
| `/gpu` | `/system/gpu` | Job-based grouping |
| `/notifications` | `/system/notifications` | Job-based grouping |
| `/docs` | `/system/docs` | Job-based grouping |
| `/onboarding` | `/system/onboarding` | Job-based grouping |

### Unchanged routes

| Route | Title |
|-------|-------|
| `/library` | Media Library |

### Redirects (added for backward compatibility)

All old routes redirect to their new equivalents:
- `/music-video-wizard` → `/create/music-video`
- `/three-js-studio` → `/create/3d`
- `/video-generation` → `/create/video`
- `/generate-3d` → `/create/3d`
- `/image-generation` → `/create/image`
- `/kinetic-typography` → `/create/typography`
- `/music-gen` → `/create/music`
- `/animation-studio` → `/create/animation`
- `/unity` → `/create/unity`
- `/hyperframes` → `/create/hyperframes`
- `/storyboards` → `/library/storyboards`
- `/audio-analysis` → `/analyze/audio`
- `/ai-tools` → `/analyze/ai`
- `/ollama-chat` → `/analyze/chat`
- `/visualizer` → `/render/visualizer`
- `/preview` → `/render/preview`
- `/music-prompts` → `/render/prompts`
- `/` → `/system` (Dashboard at `/system`)

Existing redirects remain:
- `/music-video` → `/create/music-video` (was → `/music-video-wizard`)
- `/studio-3d` → `/create/3d` (was → `/generate-3d`)
- `/video-editor` → `/create/video` (was → `/video-generation`)
- `/diagnostics` → `/system/health` (was → `/health`)
- `/media-library` → `/library` (unchanged)
- `/logs` → `/system/log-analytics` (was → `/log-analytics`)

## Engine Demotion

Engines are named in route titles or descriptions but **not** in the URL path:
- Remotion → behind `/create/music-video`, `/create/video`, `/create/typography`, `/create/animation`
- HyperFrames → behind `/create/hyperframes`
- ComfyUI → behind `/create/image`
- Blender/Unity → behind `/create/3d`, `/create/unity`
- ACE-Step → behind `/create/music`

This ensures nav is organized by **what the user wants to do** (Create / Library / Analyze / Render / System), not by **which engine powers it**.

## Files

| File | Change |
|------|--------|
| `docs/ux/nav-by-job-reorganization-2026-10.md` | This design note |
| `packages/frontend/src/App.tsx` | Read-only for T-INT-01; route inventory taken from here |
| `packages/frontend/src/components/layout/Layout.tsx` | Sidebar/nav component (read-only for T-INT-01) |

## Acceptance

- All 28 routes + 4 redirects accounted for in the mapping
- No destination lost (every old route maps to exactly one new route)
- Owner approves before T-INT-02 starts

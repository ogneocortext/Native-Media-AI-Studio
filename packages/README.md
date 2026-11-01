# Packages

Top-level source packages for the Native Media AI Studio.

## Layout

| Directory | Purpose |
|-----------|---------|
| `backend/` | FastAPI backend (`app/api/`, `app/core/`, `app/services/`, `app/adapters/`, `app/queue/`, `app/models/`, `app/agents/`) |
| `frontend/` | React + Vite + TypeScript + Remotion frontend (`src/`) |
| `../shared/` | Repository-root shared TypeScript types between frontend and backend; not a child of `packages/` |

## Entry points

| Directory | Entry point | Purpose |
|-----------|-------------|---------|
| `backend/` | `app/main.py` | FastAPI app factory and startup wiring |
| `frontend/` | `src/main.tsx` | React application entry |
| `../shared/` | (types only) | Cross-package TypeScript type definitions |

## Conventions

- Keep API routes thin in `backend/app/api/`; place business logic in `backend/app/services/`.
- The dependency direction is **api → services → adapters**, and only downward. `services`/`adapters` must never import `api`.
- Shared Pydantic models live in `backend/app/models/`; some endpoint-specific request and response models are defined beside their routes in `backend/app/api/`.
- Frontend audio selectors read one store: `useAudioLibrary()` from `hooks/useAudioLibrary`, backed by `state/audioLibraryStore.ts`. Do not call `listAudioFiles()` from a component.

## Related docs

- `../AGENTS.md` — project agent rules and shell rules
- `../docs/architecture/decision-log.md` — architecture decisions (D1–D58)
- `../docs/README.md` — documentation map

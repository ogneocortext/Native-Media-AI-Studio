# Project Refactoring Notes — April 2026

> **Commit:** `d956783` — `refactor: consolidate project structure, upgrade dependencies, modernize patterns`  
> **Date:** April 23, 2026  
> **Previous commit (for rollback):** `62b47b7`

---

## Why This Refactoring Happened

The project had accumulated structural issues over multiple recovery attempts:

- **Duplicate frontend/backend projects** under `/apps/` conflicting with the real ones at root level
- **Outdated dependencies** (React 18, TypeScript 5.3, Tailwind 3.4, FastAPI 0.109)
- **Broken language server configuration** causing IDE errors and missing IntelliSense
- **Missing modern tooling** (no pyproject.toml, no workspace config, no editor settings)

This refactoring consolidated the codebase onto a single, clean foundation with latest dependencies and modern patterns.

---

## To Restore to Pre-Refactor State

If anything breaks and you need to go back:

```bash
git reset --hard 62b47b7
```

This restores the project to its state before restructuring (with the old `/apps/frontend/` and `/apps/backend/` directories). From there, you can selectively re-apply changes.

---

## Structural Changes

| Before | After | Reason |
|--------|-------|--------|
| `/apps/frontend/` | `/frontend/` | Removed duplicate; real project was always at root |
| `/apps/backend/` | `/backend/` | Same — duplicate removed |
| No root `package.json` | Root `package.json` with npm workspaces | Enables workspace-aware tooling |
| No `pyproject.toml` | `pyproject.toml` | Python LSP (Pyright, mypy, ruff) configuration |
| `tailwind.config.js` | Deleted | Tailwind v4 is CSS-first; config lives in `globals.css` |
| `postcss.config.js` | Deleted | Tailwind v4 handles CSS processing internally |

---

## Dependency Upgrades

### Frontend
| Package | Before | After |
|---------|--------|-------|
| React | 18.2.0 | 19.2.5 |
| TypeScript | 5.3.0 | 6.0.3 |
| Vite | 5.0.0 | 8.0.10 |
| Tailwind CSS | 3.4.0 | 4.2.4 |
| @tailwindcss/vite | — | 4.2.4 |
| @vitejs/plugin-react | 4.2.0 | 6.0.1 |
| ESLint | 9.x | 10.2.1 |
| react-router-dom | 6.21.0 | 7.14.2 |
| zustand | 4.5.7 | 5.0.12 |
| three | 0.160.0 | 0.184.0 |
| @react-three/fiber | 8.15.0 | 9.6.0 |
| @react-three/drei | 9.92.0 | 10.7.7 |
| lucide-react | 0.303.0 | 1.8.0 |

### Backend
| Package | Before | After |
|---------|--------|-------|
| fastapi | 0.109.0 | 0.136.0 |
| uvicorn | 0.27.0 | 0.45.0 |
| pydantic | 2.5.0 | 2.13.3 |
| python-multipart | 0.0.6 | 0.0.26 |
| Pillow | 10.0.0 | 12.2.0 |
| aiohttp | 3.9.0 | 3.13.5 |
| psutil | 5.9.0 | 7.2.2 |
| python-socketio | 5.10.0 | 5.16.1 |
| librosa | 0.10.0 | 0.11.0 |
| soundfile | 0.12.0 | 0.13.1 |

---

## New Patterns Available

### 1. Pydantic `computed_field` (Backend)

The `Job` and `QueueStats` models now expose computed properties that auto-serialize with `model_dump()`:

```python
from backend.app.models.job import Job, JobStatus, QueueStats

job = Job(job_type="image_generation", status=JobStatus.RUNNING)
print(job.is_active)      # True
print(job.can_cancel)     # True
print(job.duration_seconds)  # elapsed time in seconds

stats = QueueStats(completed=5, failed=1)
print(stats.success_rate)  # 83.3
print(stats.is_healthy)    # True
```

**Full list of computed fields:**

| Model | Field | Description |
|-------|-------|-------------|
| `Job` | `is_active` | Pending, queued, running, or retrying |
| `Job` | `is_terminal` | Completed, failed, or cancelled |
| `Job` | `has_error` | Failed status or error message set |
| `Job` | `duration_seconds` | Elapsed time from start to now/complete |
| `Job` | `can_retry` | Failed and under max retries |
| `Job` | `can_cancel` | In a cancellable state |
| `QueueStats` | `active_jobs` | pending + running |
| `QueueStats` | `terminal_jobs` | completed + failed + cancelled |
| `QueueStats` | `success_rate` | Percentage completed vs terminal |
| `QueueStats` | `is_healthy` | Failures are < 50% of terminal jobs |

### 2. Zustand v5 Selectors (Frontend)

Instead of subscribing to the entire store (causing unnecessary re-renders), use the new selector hooks:

```tsx
// ❌ Old way — re-renders on ANY state change
const { jobs, stats, isLoading } = useJobStore();

// ✅ New way — only re-renders when jobs array changes
const jobs = useJobs();
const stats = useQueueStats();
const isLoading = useJobLoading();
```

**Available selectors:**

| Store | Selectors |
|-------|-----------|
| `jobStore` | `useJobs`, `useCurrentJob`, `useQueueStats`, `useJobLoading`, `useJobError`, `useJobWsConnected`, `useJobActions` |
| `healthStore` | `useOverallHealth`, `useBackendStatus`, `useAdapterHealth`, `useHealthLoading`, `useHealthError`, `useHealthWsConnected`, `useHealthActions` |
| `outputStore` | `useOutputs`, `useRecentOutputs`, `useSelectedOutput`, `useOutputCounts`, `useOutputFilter`, `useOutputLoading`, `useOutputError`, `useOutputActions` |

The `use*Actions` selectors return stable function references that never change, so components using only actions never re-render.

### 3. React 19 `use()` Hook (Frontend)

A new Suspense-based data fetching pattern is available in `frontend/src/hooks/useSuspenseData.ts`:

```tsx
import { Suspense } from "react";
import { useJobsSuspense, preloadJobs } from "@/hooks/useSuspenseData";

// Preload before rendering to avoid waterfalls
preloadJobs();

function JobsPanel() {
  const { jobs, stats } = useJobsSuspense(); // Uses React 19 use()
  return <JobList jobs={jobs} stats={stats} />;
}

// Parent provides Suspense boundary
<Suspense fallback={<JobSkeleton />}>
  <JobsPanel />
</Suspense>
```

**Available hooks:**
- `useJobsSuspense()` — Returns `{ jobs, stats }`
- `useHealthSuspense()` — Returns `{ health, services }`
- `preloadJobs()` — Preload jobs data before mount
- `preloadHealth()` — Preload health data before mount
- `invalidateJobsCache()` — Force fresh fetch
- `invalidateHealthCache()` — Force fresh fetch

---

## Editor / Language Server Setup

### Zed
Configuration lives in `.zed/settings.json`. Already configured for:
- ESLint (flat config, both frontend directories)
- TypeScript language server (inlay hints enabled)
- Pyright (Python type checking)

### VS Code
Configuration lives in `.vscode/settings.json` and `.vscode/extensions.json`. Recommended extensions are listed — install them for full LSP support.

### Tailwind CSS IntelliSense
For Tailwind v4, the CSS config file is at `frontend/src/styles/globals.css`. The `@theme` block inside defines custom colors:
```css
@theme {
  --color-background: #0f0f0f;
  --color-surface: #1a1a1a;
  --color-primary: #6366f1;
  /* ... */
}
```

---

## Known Issues & Fixes Applied

| Issue | Fix |
|-------|-----|
| `lucide-react@0.184.0` doesn't exist | Upgraded to `^1.8.0` (latest with React 19 support) |
| TypeScript 6.0 `baseUrl` deprecation warning | Added `"ignoreDeprecations": "6.0"` to tsconfig.json |
| R3F v9 `bufferAttribute` API change | Changed from `count/array/itemSize` props to `args={[positions, 3]}` |
| Missing `vite-env.d.ts` | Created in `frontend/src/vite-env.d.ts` |

---

## File Removals (Not Recoverable from Git)

The following files were deleted from disk and are NOT tracked by git. They exist only in commit `62b47b7` if you need them:

- `/frontend/tailwind.config.js`
- `/frontend/postcss.config.js`
- `/apps/frontend/` (entire directory)
- `/apps/backend/` (entire directory)

---

## Reinstalling Dependencies

After any clone or reset:

```bash
# Frontend
cd frontend && npm install

# Backend (use the correct venv)
.\runtime\venvs\.venvs\venv_backend\Scripts\python.exe -m pip install -r backend\requirements.txt
```

---

## Building

```bash
# TypeScript check (0 errors expected)
cd frontend && npx tsc --noEmit

# Production build
cd frontend && npm run build
# or from root:
npm run build --workspace=frontend
```

---

*For questions about this refactoring, check the git log or the original `LANGUAGE_SERVER_ISSUES.md` report.*

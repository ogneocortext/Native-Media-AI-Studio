# Vite Dev Server Stability Guide

## Overview

This document describes the stability improvements made to the Vite 8 dev server to prevent corruption, stale state, and "Failed to fetch dynamically imported module" errors.

## Root Causes of Dev Server Instability

Based on research of Vite 8 issues (2026), the primary causes are:

| Issue | Cause | Symptom |
|-------|-------|---------|
| **Cache corruption** | `node_modules/.vite` holds stale module graph | Module not found, stale transforms |
| **Dep mismatch** | esbuild pre-bundles out of sync with lockfile | "Outdated optimize dep" errors |
| **Race condition** | Module graph not settled before first browser fetch | "Failed to fetch dynamically imported module" |
| **HMR failures** | WebSocket issues, stale cache | Updates not reflected, full reload needed |
| **File watcher issues** | Windows/WSL native events unreliable | Missed file changes |

## Implemented Fixes

### 1. Vite Config Improvements (`vite.config.ts`)

```typescript
// server.warmup - Pre-transform critical files to prevent waterfalls
warmup: {
  clientFiles: [
    './src/main.tsx',
    './src/App.tsx',
    './src/features/vst/VSTPage.tsx',
    // ... other critical entry points
  ],
  ssrFiles: ['./src/entry-server.tsx'],
},

// optimizeDeps.force - Ensure fresh deps on config changes
optimizeDeps: {
  include: ['react', 'react-dom', 'three', ...],
  force: !isProd && process.env.VITE_FORCE_REOPTIMIZE !== "false",
  esbuildOptions: { target: 'es2022' },
},

// hmr.port - Explicit HMR WebSocket port
hmr: { overlay: true, port: portConfig.frontend_port },

// watch.usePolling - Stable file watching on Windows
watch: { usePolling: process.platform === 'win32', interval: 1000 },
```

### 2. Startup Scripts

#### Node.js Script (`packages/frontend/scripts/start-dev-server.ts`)
- Cleans Vite cache (`--clean`)
- Forces dependency re-optimization (`--force-reoptimize`)
- Verifies `node_modules` integrity before startup
- Proper signal handling (SIGINT/SIGTERM)
- Colored logging for visibility

#### PowerShell Script (`packages/frontend/scripts/start-dev-server.ps1`)
- Native Windows experience
- Same features as Node.js script
- Better error handling for Windows paths

### 3. NPM Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Standard Vite dev server |
| `pnpm dev:clean` | Clean cache + start |
| `pnpm dev:force` | Force re-optimize + start |
| `pnpm dev:full-reset` | Clean + force re-optimize + start |
| `pnpm dev:ps` | PowerShell wrapper |
| `pnpm dev:ps:clean` | PowerShell with cache clean |
| `pnpm dev:ps:full-reset` | PowerShell full reset |
| `pnpm clean:all` | Remove dist, .vite, .turbo caches |

## When to Use Each Command

| Scenario | Command |
|----------|---------|
| Normal daily development | `pnpm dev` |
| After `git checkout` / branch switch | `pnpm dev:clean` |
| After `pnpm install` / package.json changes | `pnpm dev:force` |
| After major refactors / corrupted state | `pnpm dev:full-reset` |
| Windows users wanting native PS experience | `pnpm dev:ps:*` |
| Complete environment reset | `pnpm clean:all && pnpm install && pnpm dev:full-reset` |

## Troubleshooting Checklist

### "Failed to fetch dynamically imported module"
1. Run `pnpm dev:clean` - clears stale module graph
2. If persists, run `pnpm dev:full-reset` - forces fresh dep optimization
3. Check browser DevTools "Disable cache" is OFF

### "Outdated optimize dep" / "Pre-transform error"
1. Run `pnpm dev:force` - forces re-optimization
2. If persists, run `pnpm clean:all && pnpm install && pnpm dev:force`

### HMR not working / updates not reflecting
1. Hard refresh browser (Ctrl+Shift+R)
2. Run `pnpm dev:clean`
3. Check browser extensions aren't blocking WebSocket

### Module not found after rename/delete
1. Run `pnpm dev:clean` - clears stale module graph cache
2. Verify import paths include extensions (`.tsx`, `.ts`)

### Slow startup / transform waterfalls
- The `server.warmup` config pre-transforms critical files
- Run `vite --debug transform` to identify slow transforms
- Add slow files to `WARMUP_CLIENT_FILES` in vite.config.ts

### Windows-specific issues
- File watching uses polling (`usePolling: true`, interval: 1000ms)
- Use PowerShell scripts (`pnpm dev:ps:*`) for better signal handling
- Ensure `node_modules/.vite` is excluded from antivirus scans

## Architecture Decisions

### Why not just use `vite --force`?
- `--force` only forces re-optimization, doesn't clear module graph cache
- Our scripts clean both `.vite` cache AND deps cache
- Verification step catches missing packages before startup

### Why warmup specific files?
- Prevents transform waterfalls (main.tsx → App.tsx → VSTPage.tsx → components)
- Only warms up files that are actually slow (measured via `vite --debug transform`)
- Avoids overloading server startup with unnecessary transforms

### Why explicit HMR port?
- Avoids port conflicts when running multiple dev servers
- Ensures WebSocket connects to correct port even with proxy

### Why polling on Windows?
- Native file watchers (chokidar) unreliable in WSL/Docker
- Polling interval of 1000ms balances responsiveness with CPU usage

## Monitoring Dev Server Health

### Forwarded Console Errors
Vite 8 forwards browser console errors to terminal:
```typescript
forwardConsole: {
  unhandledErrors: true,
  logLevels: ["warn", "error"],
}
```

### Debug Transform Times
```bash
vite --debug transform
# Output shows:
# vite:transform  62.95ms  /src/components/BigComponent.vue
# vite:transform 102.54ms  /src/utils/big-utils.js
```

### Vite DevTools
Built-in DevTools at `http://localhost:5173/__devtools__` (Vite 8 feature)

## Recovery Procedures

### Complete Environment Reset (Nuclear Option)
```bash
# 1. Stop all node processes
taskkill /F /IM node.exe

# 2. Clean everything
pnpm clean:all

# 3. Reinstall dependencies
pnpm install

# 4. Fresh start with full reset
pnpm dev:full-reset
```

### CI/CD Considerations
- `optimizeDeps.force` controlled by `VITE_FORCE_REOPTIMIZE` env var
- Set `VITE_FORCE_REOPTIMIZE=false` in CI for faster builds
- `warmup` only applies to dev server, not production builds

## References

- [Vite Performance Guide](https://vite.dev/guide/performance)
- [Vite Server Options](https://vite.dev/config/server-options.md)
- [Vite 8 Migration Guide](https://vite.dev/guide/migration)
- [es-module-lexer Issue #208](https://github.com/guybedford/es-module-lexer/issues/208)
- [Cypress Vite DevServer Warmup PR](https://github.com/cypress-io/cypress/pull/33755)
- [Buglyst Vite Cache Checklists](https://buglyst.com/learn/checklists/clarity-checklist-vite-stale)
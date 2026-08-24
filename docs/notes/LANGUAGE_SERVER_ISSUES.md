# Language Server Issues Report

> Generated for: Native Media AI Studio  
> This document identifies configuration problems that affect IDE language servers (TypeScript, ESLint, Python LSP, Tailwind CSS IntelliSense, etc.)

---

## 🔴 Critical Issues

### 1. Duplicate/Conflicting Frontend Projects

**Location:** `/frontend/` and `/apps/frontend/`

**Problem:** Two separate frontend projects exist with **wildly different dependency versions**:

| Package | `/frontend/` | `/apps/frontend/` |
|---------|-------------|-------------------|
| React | `^18.2.0` | `^19.2.5` |
| TypeScript | `^5.3.0` | `^6.0.3` |
| Vite | `^5.0.0` | `^8.0.9` |
| Tailwind CSS | `^3.4.0` | `^4.2.2` |
| @vitejs/plugin-react | `^4.2.0` | `^6.0.1` |

**Impact on Language Servers:**
- TypeScript language server may pick up the wrong `tsconfig.json` or type definitions
- Auto-imports may resolve to the wrong project
- Type errors in one project may leak into the other
- IntelliSense may show conflicting type information

**Recommendation:** Decide which frontend is the "real" one and remove or archive the other. If both must exist, use a workspace/monorepo tool to isolate them.

---

### 2. Tailwind CSS v4 Misconfiguration (`apps/frontend`)

**Location:** `apps/frontend/tailwind.config.js`

**Problem:** `apps/frontend` uses Tailwind CSS v4 (`"tailwindcss": "^4.2.2"`), but includes a `tailwind.config.js` file. Tailwind v4 is **CSS-based** and does not use `tailwind.config.js` by default. The v4 configuration is done via CSS imports and `@theme` directives.

**Impact:**
- Tailwind CSS language server may fail to provide IntelliSense
- Class name autocompletion may not work
- Color/value previews may be broken

**Recommendation:** Remove `apps/frontend/tailwind.config.js` and migrate configuration to `apps/frontend/src/styles/globals.css` using the v4 `@theme` syntax, OR downgrade to Tailwind v3 if you need the JS config file.

---

### 3. Missing Root `package.json` / Workspace Configuration

**Location:** Project root

**Problem:** No root `package.json` exists with workspace configuration (npm workspaces, pnpm workspaces, or yarn workspaces).

**Impact:**
- Language servers don't understand project boundaries
- TypeScript may scan all `node_modules` twice (once per frontend)
- ESLint may not resolve dependencies correctly
- No centralized dependency management

**Recommendation:** Create a root `package.json` with workspace configuration:

```json
{
  "name": "native-media-ai-studio",
  "private": true,
  "workspaces": [
    "frontend",
    "apps/*",
    "shared/*"
  ]
}
```

---

## 🟡 Medium Issues

### 4. TypeScript `tsconfig.node.json` Missing Essential Options

**Location:** `frontend/tsconfig.node.json` and `apps/frontend/tsconfig.node.json`

**Problem:** Both `tsconfig.node.json` files are missing critical compiler options:

- Missing `"lib": ["ES2020"]` - Node.js built-ins may show type errors
- Missing `"types": ["node"]` - Node.js type definitions not loaded
- Missing `"strict": true` - Inconsistent type checking with main `tsconfig.json`

**Impact:**
- `vite.config.ts` files show spurious errors for `process`, `__dirname`, etc.
- Type checking is inconsistent between main source and config files

**Recommendation:** Update both `tsconfig.node.json` files:

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "lib": ["ES2020"],
    "types": ["node"],
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

---

### 5. `apps/frontend/tsconfig.json` Missing Path Aliases

**Location:** `apps/frontend/tsconfig.json`

**Problem:** Missing `baseUrl` and `paths` configuration, but `vite.config.ts` in that project likely defines `@/` alias (standard Vite convention).

**Impact:**
- TypeScript language server cannot resolve `@/components/...` imports
- Auto-imports may use relative paths instead of aliases

**Recommendation:** Add to `apps/frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

---

### 6. Python LSP Configuration Missing

**Location:** Entire project

**Problem:** 
- No `pyproject.toml` for Python project metadata (aids Pyright, Pylance, pylsp)
- No Python LSP configuration in `.zed/settings.json` or `.vscode/settings.json`
- Two different `requirements.txt` files (`backend/requirements.txt` vs `apps/backend/requirements.txt`)

**Impact:**
- Python language servers may not find imports correctly
- No consistent type checking configuration (Pyright/pylance)
- Editor may not know which Python interpreter to use

**Recommendation:**
1. Create a `pyproject.toml` at project root:

```toml
[project]
name = "native-media-ai-studio"
version = "1.0.0"
requires-python = ">=3.10"

dependencies = [
    "fastapi>=0.109.0",
    "uvicorn[standard]>=0.27.0",
    "pydantic>=2.5.0",
    "python-multipart>=0.0.6",
    "aiohttp>=3.9.0",
    "psutil>=5.9.0",
    "python-socketio>=5.10.0",
    "Pillow>=10.0.0",
    "librosa>=0.10.0",
    "soundfile>=0.12.0",
]

[tool.pyright]
include = ["backend", "apps/backend"]
exclude = ["**/__pycache__", "**/node_modules"]
pythonVersion = "3.10"
strict = ["backend"]
```

2. Add Python LSP settings to `.zed/settings.json`.

---

### 7. Zed Editor Settings Incomplete

**Location:** `.zed/settings.json`

**Problem:** Only ESLint is configured, and only for the root `frontend/` directory.

**Impact:**
- `apps/frontend/` gets no ESLint language server support in Zed
- No TypeScript language server settings (formatting, inlay hints, etc.)
- No Python language server configured

**Recommendation:** Update `.zed/settings.json`:

```json
{
  "lsp": {
    "eslint": {
      "settings": {
        "eslint": {
          "useFlatConfig": true,
          "nodePath": "frontend/node_modules",
          "workingDirectories": [
            { "directory": "frontend", "changeProcessCWD": true },
            { "directory": "apps/frontend", "changeProcessCWD": true }
          ]
        }
      }
    },
    "typescript-language-server": {
      "settings": {
        "typescript": {
          "inlayHints": {
            "parameterNames": {
              "enabled": "all"
            },
            "parameterTypes": {
              "enabled": true
            },
            "variableTypes": {
              "enabled": true
            },
            "functionLikeReturnTypes": {
              "enabled": true
            }
          }
        }
      }
    },
    "pyright": {
      "settings": {
        "python": {
          "pythonPath": ".venv/bin/python"
        }
      }
    }
  }
}
```

---

## 🟢 Minor Issues

### 8. Inconsistent ESLint Strictness

**Location:** `frontend/tsconfig.json` vs `apps/frontend/tsconfig.json`

**Problem:**
- Root frontend: `noUnusedLocals: false`, `noUnusedParameters: false`
- Apps frontend: `noUnusedLocals: true`, `noUnusedParameters: true`

**Impact:** Different error behavior between projects; confusing for developers working across both.

**Recommendation:** Standardize on one setting (recommend `false` with ESLint handling unused vars via `@typescript-eslint/no-unused-vars`).

---

### 9. Missing VS Code Configuration

**Location:** `.vscode/`

**Problem:** No `.vscode/settings.json` or `.vscode/extensions.json` exists.

**Impact:** VS Code users have no standardized language server configuration, formatter settings, or extension recommendations.

**Recommendation:** Create `.vscode/settings.json` and `.vscode/extensions.json`.

---

### 10. Empty `config/settings.json`

**Location:** `config/settings.json`

**Problem:** File exists but is empty `{}`. If this is meant for application settings, it's fine. If it was intended for editor/IDE settings, it's in the wrong location.

**Recommendation:** Clarify purpose or remove if unused.

---

## Summary of Recommended Actions

| Priority | Action |
|----------|--------|
| 🔴 High | Decide on single frontend project or properly configure monorepo workspaces |
| 🔴 High | Fix Tailwind v4 config in `apps/frontend` (remove `tailwind.config.js` or downgrade) |
| 🔴 High | Create root `package.json` with workspace configuration |
| 🟡 Medium | Fix `tsconfig.node.json` files (add `lib`, `types`, `strict`) |
| 🟡 Medium | Add path aliases to `apps/frontend/tsconfig.json` |
| 🟡 Medium | Create `pyproject.toml` for Python LSP configuration |
| 🟡 Medium | Update `.zed/settings.json` with full LSP configuration |
| 🟢 Low | Standardize `noUnusedLocals`/`noUnusedParameters` settings |
| 🟢 Low | Add `.vscode/` configuration for VS Code users |

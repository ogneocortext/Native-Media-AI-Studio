---
name: dependency-management
description: >-
  Audit and upgrade monorepo dependencies with tools/check-deps.py:
  outdated packages, peer conflicts, breaking changes, security audit,
  CI mode, JSON output. Use before feature work that may need new deps,
  weekly maintenance, CI failures from peer conflicts, or supply-chain
  audits — not for application code changes.
---

# Dependency Management Skill

**Purpose:** Automated dependency checking, upgrading, and compatibility validation for the Native Media AI Studio monorepo.

## When to Use

- Before starting a new feature that may need updated dependencies
- Weekly/bi-weekly maintenance to catch performance improvements
- When CI fails due to peer dependency conflicts
- Before major releases to audit breaking changes
- When experiencing runtime issues that may be version-related
- Security audits (supply chain)

## Workflow

### 1. Quick Check (Read-Only)
```bash
python tools/check-deps.py
```
Shows outdated packages, catalog versions, peer conflicts, breaking changes, deprecated packages, and missing catalog entries.

### 2. Table Format (For Terminals)
```bash
python tools/check-deps.py --table
```
Compact table view for quick scanning.

### 3. CI Mode (For Automation)
```bash
python tools/check-deps.py --ci
```
Exits with code 1 if any updates available. Use in CI pipelines.

### 4. JSON Output (For Tooling/Dashboards)
```bash
python tools/check-deps.py --json > deps-report.json
```
Machine-readable output for dashboards/alerts.

### 5. Security Audit
```bash
python tools/check-deps.py --audit
```
Runs `pnpm audit` and reports security vulnerabilities with severity levels.

### 6. Safe Auto-Upgrade
```bash
python tools/check-deps.py --fix
```
Interactively updates `pnpm-workspace.yaml` catalog entries for **non-breaking** patches/minor versions only. Never auto-upgrades major versions or deprecated packages.

### 7. No-Color Mode (For Logs/CI)
```bash
python tools/check-deps.py --no-color
```
Disables ANSI color codes for clean log files.

## What It Checks

| Check | Description | Flag |
|-------|-------------|------|
| **Workspace outdated** | `pnpm outdated --json` across all workspace packages | Default |
| **Catalog outdated** | Queries npm registry, respects version ranges (`^5.9.3` vs `7.0.2`) | Default |
| **Peer conflicts** | Dry-run install to detect unmet peer dependencies | Default |
| **Breaking changes** | Detects major version bumps, provides changelog URLs | Default |
| **Deprecated packages** | Checks npm `deprecated` field | Default |
| **Security vulnerabilities** | Runs `pnpm audit --json` | `--audit` |
| **Catalog sync** | Finds packages that should be in catalog but aren't | Default |
| **Lockfile drift** | Detects if `pnpm-lock.yaml` is out of sync | Default |

## Catalog Management

The catalog in `pnpm-workspace.yaml` is the **single source of truth** for versions. All workspace packages should reference catalog versions:

```yaml
catalog:
  react: ^19.3.0
  vite: 8.3.6
  typescript: ^5.9.3
```

Package.json in workspace packages:
```json
{
  "dependencies": {
    "react": "catalog:",
    "vite": "catalog:"
  }
}
```

## Upgrade Strategy

### Safe (Auto-approved by --fix)
- Patch versions: `8.3.5` → `8.3.6`
- Minor versions: `5.9.2` → `5.9.3` (if no breaking changes noted)
- Only if package is NOT deprecated

### Manual Review Required
- Major versions: `8.x` → `9.x`
- Peer dependency changes
- Packages with known breaking changes in changelog
- Deprecated packages

## Breaking Change Detection

The script checks:
1. Major version number increment
2. Known problematic packages (React, Vite, TypeScript, Tailwind, Playwright, Remotion, pnpm, Zod, TanStack Query)
3. Provides direct changelog URLs for review

## Security Audit

With `--audit` flag:
- Runs `pnpm audit --json`
- Reports severity: Critical, High, Moderate, Low
- Shows CWE identifiers, affected versions, advisory URLs

## Common Issues & Fixes

### "Peer dependency conflict" on install
```bash
# Check what's conflicting
python tools/check-deps.py

# Usually fixed by updating catalog to compatible versions
# Or adding peerDependenciesMeta in pnpm-workspace.yaml:
overrides:
  "react@19": { "peerDependenciesMeta": { "scheduler": "optional" } }
```

### "Vite chunk size warning"
```bash
# Update vite in catalog
vite: 8.3.6  # in pnpm-workspace.yaml
# Then run: pnpm install && pnpm build
```

### TypeScript/ESLint version mismatch
```bash
# Ensure typescript and typescript-eslint are compatible:
# typescript: ^5.9.3
# typescript-eslint: 8.72.1  # in overrides
```

### Lockfile drift
```bash
python tools/check-deps.py
# If "Lockfile drift detected" appears:
pnpm install
```

## CI Integration

Create `.github/workflows/deps.yml`:
```yaml
name: Dependency Check
on:
  schedule:
    - cron: '0 6 * * 1'  # Weekly Monday 6am
  workflow_dispatch:

jobs:
  check:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 12 }
      - uses: actions/setup-node@v4
        with: { node-version: 26, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: python tools/check-deps.py --ci --audit
```

### Weekly Audit Workflow
```yaml
name: Weekly Security Audit
on:
  schedule:
    - cron: '0 2 * * 0'  # Sunday 2am
jobs:
  audit:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 26, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: python tools/check-deps.py --audit --json > audit-report.json
      - uses: actions/upload-artifact@v4
        with:
          name: security-audit
          path: audit-report.json
```

## Quick Reference Commands

```bash
# Full check with all features
python tools/check-deps.py

# Table format for quick reading
python tools/check-deps.py --table

# CI-friendly (exit code 1 if updates)
python tools/check-deps.py --ci

# JSON for dashboards
python tools/check-deps.py --json

# Security audit
python tools/check-deps.py --audit

# Combined CI + audit
python tools/check-deps.py --ci --audit

# Safe catalog updates only (interactive)
python tools/check-deps.py --fix

# No colors for logs
python tools/check-deps.py --no-color

# Check specific package
pnpm outdated <package-name>

# View latest version
pnpm view <package-name> version

# View changelog
pnpm view <package-name> repository.url

# View deprecated status
pnpm view <package-name> deprecated
```

## Output Examples

### Default Summary
```
======================================================================
Dependency Check Summary
======================================================================
  Total packages checked: 23
  Outdated (workspace):   1
  Outdated (catalog):     22
  Peer conflicts:         0
  Breaking changes:       1
  Deprecated packages:    0
  Security issues:        0

  [BREAKING CHANGES]
    typescript: 5.9.3 -> 7.0.2 [BREAKING] [MAJOR]
      Changelog: https://github.com/microsoft/TypeScript/blob/main/CHANGELOG.md

  [MISSING CATALOG ENTRIES]
    pnpm (should be added to pnpm-workspace.yaml)

  [UPGRADABLE]
    @playwright/mcp: 0.0.83 -> 0.0.84 [CATALOG]
    @playwright/test: 1.64.1 -> 1.65.0 [CATALOG]
    ...
```

### Table Format (`--table`)
```
Package                             Current         Latest          Type         Flags
--------------------------------------------------------------------------------
@playwright/mcp                     0.0.83          0.0.84          catalog      CATALOG
@playwright/test                    1.64.1          1.65.0          catalog      CATALOG
typescript                          5.9.3           7.0.2           catalog      CATALOG BREAKING MAJOR
pnpm                                12.17.0         12.18.0         workspace    
...
Total: 23 | Outdated: 1 | Catalog: 22 | Breaking: 1 | Deprecated: 0 | Security: 0
```

### JSON Output (`--json`)
```json
{
  "timestamp": "2026-11-06T21:03:02.887061",
  "total_packages": 23,
  "outdated": 1,
  "catalog_outdated": 22,
  "peer_conflicts": 0,
  "breaking_changes": 1,
  "deprecated_count": 0,
  "security_issues": 0,
  "packages": [
    {
      "name": "typescript",
      "current": "5.9.3",
      "latest": "7.0.2",
      "wanted": "5.9.3",
      "location": "",
      "is_catalog": true,
      "peer_conflict": false,
      "breaking": true,
      "deprecated": false,
      "security": false,
      "changelog_url": "https://github.com/microsoft/TypeScript/blob/main/CHANGELOG.md",
      "major_bump": true
    }
  ]
}
```
## Toolchain & supply-chain configuration (verified 2026-11)

`pnpm-workspace.yaml` is the source of truth for toolchain policy —
`.npmrc` only carries registry/auth/TLS keys for pnpm (settings like
`engine-strict` placed there are **dead config**). Current enforced
settings:

- `engineStrict: true` — packages must satisfy `engines`.
- `devEngines.runtime` pins Node (currently 26.13.0, `onFail:download`)
  so `pnpm run`/`pnpm exec` never pick up the ambient fnm Node. The old
  `useNodeVersion` setting was removed in pnpm 12 — do not re-add it.
- `minimumReleaseAge: 10080` (7 days) with `minimumReleaseAgeExclude`
  entries that are **version-scoped** (`pkg@x.y.z`) — they exempt only
  those exact versions. When the gate rejects an existing lockfile,
  add the locked versions as excludes and mark them "prune as they age
  past the window"; they go inert automatically.
- `preinstall` runs `pnpm dlx -y only-allow@1.2.2` — **pinned**. Never
  unpin a `dlx`/`npx` remote-exec in the install path.
- `peerDependencyRules.allowedVersions` is the allowlist for tolerated
  peer mismatches — each entry needs a comment justifying it. Prefer
  fixing the dep over allowlisting; `tabler-react` was removed entirely
  rather than allowlisted. TypeScript stays on 5.x because
  typescript-eslint peer-caps `<6.1.0` — bumping TS breaks `pnpm lint`
  at import time, not just at peer-check.

Verify after touching any of this: `pnpm install` must pass supply-chain
policy on the whole lockfile, `pnpm exec node --version` must print the
pinned runtime, and `pnpm peers check` should report zero issues.

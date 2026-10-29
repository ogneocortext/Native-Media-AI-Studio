---
tags:
  - technical
  - security
  - nodejs
  - npx
  - supply-chain
aliases:
  - npx Best Practices
  - NPM Security Hardening
cssclasses:
  - technical-guide
date: 2026-10-29
type: concept
---

# npx Best Practices (Oct 2026)

## Why npx is a security risk

`npx` resolves, downloads, and executes packages from the npm registry in a
single step — with **no lockfile, no hash verification, and no cooldown**.
Every invocation can silently pull in a newly published, potentially malicious
version of a package. The [OWASP NPM Security Cheat Sheet] and
[lirantal/npm-security-best-practices] both list "Harden npx execution" as a
critical control.

The [Model Context Protocol security guidance] specifically calls out MCP
servers launched via `npx malicious-package` as an attack vector for remote
code execution with user privileges.

## Mandatory rules for this repo

### 1. Never use unpinned `npx` in scripts or CI

**Anti-pattern:**
```bash
npx some-package              # Downloads and executes latest version
npx @scope/mcp-server         # No lockfile, no hash check
npx -y @remotion/mcp@latest   # -y suppresses the install prompt; @latest is unpinned
```

**Correct:**
```bash
npx --no --offline some-package@1.0.0   # Refuses to download; runs only pre-installed
pnpm exec some-package                   # Project-local, lockfile-pinned, zero network
```

### 2. Pre-install, then run offline (gold standard)

Pre-install packages in a dedicated workspace with a lockfile, then force
`npx` to run in offline mode using only pre-vetted packages:

```bash
# Step 1: Create a workspace and install with lockfile
mkdir -p $HOME/npx-workspace && cd $HOME/npx-workspace
npm init -y
npm install @remotion/mcp@1.0.0 comfyui-mcp@1.0.0 localtunnel@2.0.2

# Step 2: Run npx offline — refuses to download anything not installed
npx --no --offline @remotion/mcp@1.0.0
npx --no --offline comfyui-mcp@1.0.0 --comfyui-url http://localhost:8188
npx --no --offline localtunnel@2.0.2 --port 5173
```

The `--no` flag refuses to download packages not already installed.
`--offline` prevents any network requests.

### 3. Use `pnpm exec` for project-local binaries

This repo uses **pnpm** as its package manager (`packageManager: pnpm@11.24.0`).
For packages already in `package.json` devDependencies, prefer
`pnpm exec <bin>` over `npx <bin>`:

```bash
# Instead of:
npx tsc --noEmit
npx playwright test

# Use:
pnpm exec tsc --noEmit
pnpm exec playwright test
```

`pnpm exec` resolves from `node_modules/.bin`, uses the lockfile, and never
touches the network. The root `package.json` explicitly states that bare
`npx tsc` at the repository root is unsupported because there is no root
`tsconfig.json`.

### 4. Pin versions — never `@latest`

```bash
# Anti-pattern:
npx @remotion/mcp@latest

# Correct:
npx --no --offline @remotion/mcp@1.0.0
```

Without a version pin, a package release overnight can change build output or
break a pipeline entirely.

### 5. MCP servers need extra caution

MCP servers have broad system access (filesystem, network, subprocesses).
Launching them via unpinned `npx` is especially dangerous:

```bash
# Anti-pattern — used in this repo before this document:
npx -y @remotion/mcp@latest      # -y + @latest = maximum risk
npx -y comfyui-mcp               # -y suppresses the install prompt
```

**Correct pattern (used in `opencode.json` and `mcp-registry.json`):**
```json
"command": ["npx", "--no", "--offline", "@remotion/mcp@1.0.0"]
```

Pre-install the MCP package in a workspace with a lockfile, then run offline.
The `--no --offline` flags guarantee npx cannot fetch from the registry at
runtime.

### 6. `-y` / `--yes` flag

The `-y` flag suppresses the interactive install prompt. It is safe **only**
when combined with a version pin (`@1.0.0`, not `@latest`). Without a pin,
`-y` means "download and execute whatever is latest without asking."

In this repo, `-y` has been removed from all MCP server configs and replaced
with `--no --offline` + pinned versions. The tunnel script (`start-tunnel.ps1`)
keeps `-y` only because it runs unattended **and** the version is pinned
(`localtunnel@2.0.2`).

## Repo-specific changes

| File | Before | After |
|------|--------|-------|
| `packages/backend/app/api/hyperframes.py` | `npx hyperframes` (unpinned, network fetch) | `pnpm exec hyperframes` + `npx --no --offline` fallback, version pinned to `0.8.73` |
| `scripts/start-tunnel.ps1` | `npx localtunnel --port $Port` (unpinned, interactive) | `npx -y localtunnel@2.0.2 --port $Port` (pinned, unattended-safe) |
| `opencode.json` (root) | `npx -y @remotion/mcp@latest`, `npx -y comfyui-mcp` | `npx --no --offline @remotion/mcp@1.0.0`, `npx --no --offline comfyui-mcp@1.0.0` |
| `packages/video-editor/opencode.json` | `npx -y @remotion/mcp@latest` | `npx --no --offline @remotion/mcp@1.0.0` |
| `docs/knowledge-library/mcp-registry.json` | `npx comfyui-mcp ...`, `npx -y @remotion/mcp@latest` | `npx --no --offline comfyui-mcp@1.0.0 ...`, `npx --no --offline @remotion/mcp@1.0.0` |

## Remotion Agent Skills

The deprecated `@remotion/mcp` MCP server (shut down Oct 26, 2026) has been replaced with Remotion Agent Skills. See [[remotion-agent-skills-2026]] for the full migration guide and skill reference.

## ESLint MCP server (AI agent lint access)

ESLint v10 supports `--mcp` (added in v9.26.0), which exposes ESLint as a
Model Context Protocol server. This lets AI agents run lint directly through
MCP tool calls instead of shelling out.

Since ESLint is already a devDependency in this repo, use `pnpm exec` rather
than `npx` (which would violate our npx hardening):

```bash
# Secure: uses locally installed ESLint, no network fetch
pnpm exec eslint --mcp

# Anti-pattern: npx would download eslint from the registry at runtime
npx eslint --mcp
```

Add to `opencode.json` MCP server config if you want AI agents to invoke lint
through MCP:

```json
"eslint-lint": {
  "type": "local",
  "command": ["pnpm", "exec", "eslint", "--mcp"],
  "enabled": true
}
```

## Pre-install checklist

Before running any `npx --no --offline` command, the package must be
pre-installed:

```bash
# In the repo root:
pnpm add -D @remotion/mcp@1.0.0 comfyui-mcp@1.0.0 localtunnel@2.0.2 hyperframes@0.8.73

# Verify the binaries are available:
pnpm exec @remotion/mcp --version
pnpm exec comfyui-mcp --version
npx --no --offline localtunnel@2.0.2 --version
```

## References

- [OWASP NPM Security Cheat Sheet] — "Prevent dependency confusion attacks", "Harden npx execution"
- [lirantal/npm-security-best-practices] — Rule 8: Harden npx execution
- [npm docs: npx] — `--no`, `--offline`, `-y`/`--yes` behavior
- [npm docs: npm-exec] — `npx` vs `npm exec` semantics
- [Model Context Protocol security best practices] — MCP server attack vectors
- [docs/architecture/decision-log.md] — D-line entries on tool security

[OWASP NPM Security Cheat Sheet]: https://cheatsheetseries.owasp.org/cheatsheets/NPM_Security_Cheat_Sheet.html
[lirantal/npm-security-best-practices]: https://github.com/lirantal/npm-security-best-practices
[npm docs: npx]: https://docs.npmjs.com/cli/v12/commands/npx/
[npm docs: npm-exec]: https://docs.npmjs.com/cli/v12/commands/npm-exec/
[Model Context Protocol security best practices]: https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices

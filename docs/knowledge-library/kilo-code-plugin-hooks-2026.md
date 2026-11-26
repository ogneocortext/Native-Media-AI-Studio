---
tags:
  - technical
  - integration
aliases:
  - kilo hooks
  - kilo plugin
  - exec guard kilo
cssclasses:
  - technical-guide
date: 2026-11-25
type: concept
---

> [!info] Purpose
> How agent-loop interception works in Kilo Code (verified against Kilo CLI 7.8.32, 2026-11-25), and how this repo ports the `tools/hooks/check-exec-command.py` pwsh guard to it.

---

## Overview

Kilo Code has **no shell-command hook system** equivalent to Claude Code's `PreToolUse`/`PostToolUse` JSON-on-stdin hooks. A Claude-Code-compatible hooks feature was proposed in [Kilo-Org/kilocode#15160](https://github.com/Kilo-Org/kilocode/issues/15160) (open as of 2026-11-25); until it ships, the extension point is **plugins** — TypeScript/JavaScript modules.

## Plugin loading

Every `.ts`/`.js` file in a `plugin/` (or `plugins/`) directory inside a config dir is auto-registered at startup — no config entry needed:

- Global: `~/.config/kilo/plugin/`
- Project: `.kilo/plugin/` (legacy `.kilocode/plugin/`)

Plugins can also be listed in the `plugin` array of `kilo.json`/`kilo.jsonc` (npm specifiers, pinned versions, or `file:` URLs). Load order: built-ins → global config → global plugin dir → project config → **project plugin dir**. `KILO_PURE=1` disables all external plugins.

Module shape:

```ts
import type { Plugin } from "@kilocode/plugin"

const MyPlugin: Plugin = async ({ project, client, $, directory, worktree }) => ({
  // hooks here
})
export default { id: "my-plugin", server: MyPlugin }
```

`@kilocode/plugin` is a virtual package Kilo provides at runtime — `import type` is erased, so plugins need no `node_modules` for it. Plugins run under Bun (Bun 1.4.x on this machine), so `import.meta.url`, `node:*` builtins, and top-level await all work.

## Relevant hooks

| Hook | Fires | Can block? |
| --- | --- | --- |
| `tool.execute.before` | Before any tool runs | Yes — `throw` aborts the call; agent sees the error message |
| `tool.execute.after` | After a tool returns | Rewrites `output.title`/`output.output`/`output.metadata` |
| `tool.definition` | Before tool schema sent to model | Mutate description/parameters |
| `permission.ask` | On permission prompts | Auto-allow/deny |
| `chat.message`, `chat.params`, `chat.headers` | Chat lifecycle | Mutate |
| `event` | Every internal event (`session.idle`, `permission.asked`, …) | Observe |
| `shell.env` | Shell env injection | Mutate `output.env` |
| `experimental.session.compacting` | Before compaction | Push context into `output.context` |

`tool.execute.before` signature: `async (input, output) => {}` where `input.tool` is the tool id (`"bash"`, `"read"`, …) and `output.args` holds the call arguments — for the shell tool, `output.args.command`. Docs example mutates `output.args.command` in place; throwing an `Error` blocks execution.

## This repo's implementation

`.kilo/plugin/exec-command-guard.ts` (committed; `.gitignore` un-ignores `.kilo/plugin/`) intercepts `tool.execute.before` for the `bash` tool, pipes `output.args.command` as `{"tool_input":{"command": …}}` JSON into `tools/hooks/check-exec-command.py` via `spawnSync`, and throws `[exec-command-guard] <reason>` when the guard prints `{"decision":"block",…}`. The Python script stays the single source of truth — its 90-test suite covers the rules; the plugin is a ~70-line adapter.

Design points:

- **Fail-open**: missing guard script, python failure, non-zero exit, or unparseable output all allow the command — a broken guard never wedges the session (same contract as the Python hook's always-exit-0).
- **cwd = repo root** (resolved from `import.meta.url`, two levels up from `.kilo/plugin/`), so `DEVIN_PROJECT_DIR`/`.devin/.allow-destructive` resolution in the guard is unchanged.
- 15 s `spawnSync` timeout; guard warnings go through `client.app.log` when available.

Verified 2026-11-25 on Kilo CLI 7.8.32: `bun` loads the module (`{id:"exec-command-guard", server:fn}`); direct invocation of `tool.execute.before` blocks `git push --force` and heredoc payloads with the guard's reason text and allows clean commands and non-shell tools (`docs/scratch/test-kilo-plugin.ts`).

## Caveats

- **Project plugins are trusted code** — `.kilo/plugin/*.ts` executes with the user's permissions at session start. Kilo's proposed Claude-hooks compatibility (#15160) plans global-only hook loading for security; project *plugins* currently load unconditionally, so committing this file means every Kilo session in this repo runs it (intended here — it only narrows what the agent may execute).
- The guard's pwsh rules are Windows-scoped inside the Python script (`os.name == "nt"`), so the same plugin is safe on POSIX clones — only the destructive-git rule applies there.
- Kilo's permission config (`permission.bash` in `~/.config/kilo/kilo.jsonc`) is a separate, coarser gate — the plugin adds the repo's syntax/destructive rules on top; neither replaces the other.
- Claude Code and Devin keep using the original stdin/stdout PreToolUse registration (`.claude/settings.json`, `.devin/hooks.v1.json`); only Kilo needed the plugin adapter.

## Related

- [[kilo-code-subagent-optimization|kilo-code-subagent-optimization]] :see-also
- [[kilo-code-subagent-orchestration|kilo-code-subagent-orchestration]] :see-also
- `tools/hooks/check-exec-command.py` + `tools/hooks/test-check-exec-command.py` (canonical rules + tests)
- `docs/powershell-command-sheet.md` §0 (the patterns the guard enforces)
- https://kilo.ai/docs/automate/extending/plugins (official plugin docs)
- https://github.com/Kilo-Org/kilocode/issues/15160 (proposed Claude-Code-compatible hooks — not shipped as of 2026-11-25)

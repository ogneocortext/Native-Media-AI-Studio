// Exec-command guard — Kilo Code project plugin.
//
// Kilo has no shell-command PreToolUse hook system; the extension point is
// plugins (.kilo/plugin/*.ts auto-registers at startup). This plugin is the
// Kilo adapter for the repo's existing guard, tools/hooks/check-exec-command.py
// — the Python script remains the single source of truth for the banned
// patterns (pwsh-only rules, heredocs, destructive git, etc.). This file only
// translates Kilo's tool.execute.before hook into the guard's stdin JSON and
// turns a "block" decision into a thrown error, which aborts the tool call.
//
// Fail-open by design: if the guard script is missing, python is unavailable,
// or the guard crashes, the command is allowed — a broken guard must never
// wedge the session (same contract as the Python hook itself).
import type { Plugin } from "@kilocode/plugin"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// .kilo/plugin/<this file> -> repo root is two levels up.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const GUARD = path.join(REPO_ROOT, "tools", "hooks", "check-exec-command.py")

// Kilo's shell tool id is "bash" (see permission config). "shell" is kept as a
// defensive alias in case the id ever differs.
const SHELL_TOOLS = new Set(["bash", "shell"])

const ExecCommandGuard: Plugin = async ({ client }) => ({
  "tool.execute.before": async (input, output) => {
    const tool = typeof input?.tool === "string" ? input.tool : ""
    if (!SHELL_TOOLS.has(tool)) return

    const args = (output as { args?: Record<string, unknown> } | undefined)?.args
    const command = args?.command
    if (typeof command !== "string" || command.length === 0) return
    if (!existsSync(GUARD)) return

    const res = spawnSync("python", [GUARD], {
      input: JSON.stringify({ tool_input: { command } }),
      cwd: REPO_ROOT,
      encoding: "utf-8",
      timeout: 15_000,
      windowsHide: true,
    })

    if (res.error || res.status !== 0) {
      try {
        await client?.app?.log?.({
          body: {
            service: "exec-command-guard",
            level: "warn",
            message: `guard invocation failed: ${res.error ? String(res.error) : `exit ${res.status}`}`,
          },
        })
      } catch {
        // logging must never break the hook
      }
      return
    }

    let decision: { decision?: string; reason?: string } | null = null
    try {
      decision = JSON.parse((res.stdout ?? "").trim() || "null")
    } catch {
      return
    }
    if (decision?.decision === "block" && typeof decision.reason === "string") {
      throw new Error(`[exec-command-guard] ${decision.reason}`)
    }
  },
})

export default { id: "exec-command-guard", server: ExecCommandGuard }

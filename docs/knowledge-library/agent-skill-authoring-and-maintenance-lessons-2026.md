---
tags:
  - ai
  - documentation
  - testing
aliases:
  - Agent Skills Best Practices
  - SKILL.md Audit
  - Agent Skill Maintenance
cssclasses:
  - ai-guide
date: 2026-11-20
type: concept
---

> [!info] Purpose
> What a 2026-11-20 audit of this repo's 27 agent skills found, what was
> fixed (commits `a2461835`, `791b5fee`), and the checklist future agents
> should run before trusting or editing a SKILL.md. Distilled from a real
> session where stale skill content caused wrong ports, wrong tool names,
> and a missed "do not push" constraint.

---

## Overview

Skills are loaded on demand, so their `description` is the *only* routing
signal — a thin description means the skill never triggers; a wrong body
means it triggers and then misleads. This repo keeps 52 canonical skills in
`.claude/skills/`, mirrored byte-identical to the repo hosts (`.kilo/`,
`.devin/`, `.agents/`) and to every home-level host (`~/.claude`, `~/.codex`,
`~/.gemini`, `~/.copilot`, `~/.continue`, `~/.factory`, `~/.openclaw`,
`~/.kilocode`, `~/.kilo`, `~/.codeium/windsurf`,
`~/.gemini/antigravity`). Two gates enforce it: `tools/check-skill-mirrors.py`
(repo mirrors, pre-commit) and `tools/sync-user-skills.py --check` (home
hosts, wired into `tools/check-all.py`). The audit combined the agentskills.io
spec, Anthropic's skill authoring guidance, and a line-by-line read of the
skills exercised in one real multi-hour session.

## What the spec actually requires (agentskills.io, 2026)

- `name`: ≤64 chars, lowercase letters/numbers/hyphens only, no leading or
  trailing hyphen. **The directory name should match** — `sub_agent_orchestration`
  with an underscore was renamed to `sub-agent-orchestration` for this.
- `description`: ≤1024 chars, non-empty, imperative ("Use this skill when…"),
  focused on user intent and explicit trigger contexts — it is the skill's
  only discovery mechanism.
- `SKILL.md` body: keep under ~500 lines / ~5k tokens; split detail into
  `references/`, `scripts/`, `assets/` for progressive disclosure.
- Third person, concise, only what the agent doesn't already know —
  project conventions, non-obvious edge cases, exact commands.

## Findings from the audit (all fixed)

| Skill | Defect | Fix |
|---|---|---|
| `gates-commit-push` | Backend port hardcoded `localhost:8000`; real port is **8004** (`config/ports.json`) | Corrected + pointer to ports.json |
| `gates-commit-push` | Assumed Kilo-only `background_process` tool; step 4 pushed unconditionally | Host-agnostic tool wording; "push only when asked" |
| `test-measure-improve` | Same stale port/tool issues; `%TEMP%\kilo\` scratch path | Same fixes |
| `autonomous-session` | Missing guardrails for incidents that actually happened | Added: commit-sweep absorbing uncommitted hunks, secrets env-only, tailscaled port-check false positive |
| `remotion-best-practices` | Description was 30 chars — too thin to trigger reliably | Expanded imperative description |
| `visual-qa-loop` | Same stale `background_process`/`%TEMP%\kilo\` references | Host-agnostic rewrite |
| `sub_agent_orchestration` | Underscore dir name violates spec | Renamed across all 4 mirrors |

## Session-derived guardrails now in `autonomous-session`

These cost real time in the session that prompted the audit — they are the
kind of thing only a real incident teaches:

1. **Concurrent agents' commits can absorb your uncommitted edits.** A
   `git add <shared-file>` by another agent swept this session's
   `/voice-live` route+nav hunks into an unrelated NSFW commit. After any
   surprise: `git log --oneline -10`, `git status`, and
   `git show HEAD:<file>` before re-applying work.
2. **Secrets are env-var/file-only.** Tokens never go inline in commands,
   config, code, commit messages, or reports — a temp script reads the
   value from its local source and sets the env var without printing it.
3. **`manage-servers.ps1` port check is address-blind.** It counts
   `tailscaled.exe` holding the tailnet-side `tailscale serve` bind as
   "port occupied" and refuses to start the backend. Fallback: launch
   `python -m uvicorn app.main:app --host 127.0.0.1 --port <backend_port>`
   from `packages/backend` directly.

## Checklist for the next skill audit

1. `python tools/check-skill-mirrors.py` — mirrors must be byte-identical.
2. Scan frontmatter: name matches dir + hyphen rule, description length and
   imperative phrasing (a throwaway script over `.claude/skills/*/SKILL.md`
   works — see the audit approach in git history of this doc's session).
3. Grep bodies for stale facts: ports (`8000` vs ports.json's **8004**),
   host-specific tool names (`background_process` is Kilo-only), scratch
   paths (`%TEMP%\kilo\`), and hardcoded "always push" instructions.
4. Every claim in a skill should be verifiable in-repo — if it names a
   port, file, or command, check it still exists.
5. After editing canonical `.claude/skills/<name>/SKILL.md`, run
   `python tools/sync-skill-mirrors.py` (repo mirrors) **and**
   `python tools/sync-user-skills.py` (home-level hosts), then re-run both
   checks before committing. Never copy by hand.

## Related

- [[playwright-e2e-2026|playwright-e2e-2026]] :see-also
- [[agent-chat-architecture-2026|agent-chat-architecture-2026]] :see-also
- [[agent-llm-loop-spec-2026-10|agent-llm-loop-spec-2026-10]] :see-also
- [[custom-agent-design|custom-agent-design]] :see-also
- [[skill-eval-harness-spec-2026-11|skill-eval-harness-spec-2026-11]] :see-also

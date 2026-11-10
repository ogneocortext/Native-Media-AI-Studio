# Quarantined skills

Skills in this directory are **NOT loadable**. They were moved out of the
agent skills roots (`.claude/skills/` canonical, `.kilo/skills/`,
`.devin/skills/`, `.agents/skills/` mirrors) because they failed repo
policy review. They are kept here for the record only.

**They must not be mirrored back** into any `skills/` path without an
owner-approved rewrite.

## open-computer-use

- **Why quarantined (owner decision, 2026-11-09):**
  - Grants an agent full desktop control (see, click, type into any
    application) through an MCP server — capability far beyond what any
    proportional guardrail set in this repo covers.
  - Install-first instructions (`npm i -g open-computer-use`, global MCP
    server registration) conflict with repo installation policy: agents
    do not install global software or register new MCP servers as a side
    effect of loading a skill.
  - No proportional guardrails: its own usage example types a password
    into a login form (`type_text` into a `password` target).
- **Rewrite requirements before it can return:**
  - Read-only by default (screenshot / UI-tree inspection only).
  - Write actions only against an owner-set per-app allow-list, each
    requiring per-session confirmation.
  - Hard prohibitions on typing into credential fields, terminals, or
    password prompts.
  - No install steps anywhere in the skill.
  - Every session starts with `list_apps` and ends with a
    screenshot-verified state report.

## sub_agent_orchestration

- **Why quarantined (2026-11-09):** present only in the `.kilo/` mirror,
  absent from canonical `.claude/skills/`. Mirror roots must equal the
  canonical set exactly (enforced by `tools/check-skill-mirrors.py`), so
  it could not stay in `.kilo/skills/`. A v2 replacement is a separate
  owner handoff; until it lands in canonical, this copy is parked here
  as mirror-pending — do not mirror it back; wait for the replacement.

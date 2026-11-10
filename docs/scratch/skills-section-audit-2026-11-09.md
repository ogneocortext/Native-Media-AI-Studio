# Skills-section audit - Native Media AI Studio

**Reviewer:** Maya (planner lane, static review) - 2026-11-09
**Scope:** all 28 skill directories in the tracked repo:
26 in `.claude/skills/`, 5 in `.kilo/skills/` (3 mirrored, 2 Kilo-only).
**Method:** full inventory + mirror diff, mechanical red-flag scan
(mocks, placeholders, duplicate definitions, stale agent names), deep
reads of everything flagged plus the router and hygiene skills, header
review of the remainder. Static review only - nothing was executed on
the rig.

## Headline

The chaos is concentrated, not general. **24 of 28 skills are healthy** -
repo-native, incident-distilled, measurement-first. The damage sits in
exactly three places: one fake runtime (already reviewed separately),
one guardrail-free desktop-control skill hiding outside the canonical
set, and a mirror system that exists on paper only - which is *how*
the first two stayed invisible.

## Structural findings

### S1. The mirror system does not exist as documented (major)

AGENTS.md: skills live in `.claude/skills/` (tracked canonical;
mirrored to `.kilo/`, `.devin/`, `.agents/` - keep copies in sync).

Measured state of the tracked repo:

- `.claude/skills/`: 26 skills.
- `.kilo/skills/`: 5 skills. Three are byte-identical mirrors of
  canonical skills (current-best-practices, line-by-line-review,
  vendor-drift - mirroring, where done, was done right). Two are
  Kilo-only and exist nowhere else (S2).
- `.devin/skills/`: **does not exist.** `.agents/skills/`: **does not
  exist.** Devin - a Tier A executor who lands a large share of this
  repo's commits - has zero skill discovery in the tracked tree. Every
  Devin session works from AGENTS.md and the task files alone, while
  Kilo sessions get the router and guardrail layer. That asymmetry is
  a plausible root cause for "the agents cause chaos at different
  rates": they are not reading the same instructions.

**Redesign spec:** (a) create `.devin/skills/` and `.agents/skills/`
mirrors for the full canonical set, or formally amend AGENTS.md to say
mirrors are Kilo-only and Devin sessions must load skills from
`.claude/skills/` by path - one rule, stated once, true in the tree;
(b) add a checker (`tools/check-skill-mirrors.py`) that fails the docs
gate when a canonical skill is missing from a required mirror or a
mirror copy differs, the same shape as the knowledge-library
consistency checker; (c) register as a task item in the agents area
file.

### S2. Two Kilo-only skills bypass canonical review (major)

`sub_agent_orchestration` and `open-computer-use` exist only in
`.kilo/skills/`. Anything reviewing the canonical set (the owner, a
planner pass, this audit's first sweep) does not see them. Both turned
out to be the two problem skills in the repo. That is not a
coincidence-shaped fact: unreviewed surface is where problems live.

**Redesign spec:** rule, stated in AGENTS.md next to the mirror rule:
a skill that exists in any mirror but not in canonical is a docs-gate
failure. The S1 checker enforces it mechanically.

## Problem skills

### P1. `sub_agent_orchestration` (critical) - reviewed separately

Mock execution dressed as real results; fabricated confidence (0.8
hardcoded); mock outcomes auto-logged to the trust roster's
`observed.jsonl`; 3 of 6 patterns unimplemented yet reporting success;
topic-level dedup that silently discards findings; duplicated
definitions; stale routing (opencode, front-line Cline).
Full review: `sub-agent-orchestration-review-2026-11-09.md`.
**Fix delivered:** v2 SKILL.md replacement draft (protocol-first,
evidence contract, host dialects for Kilo and Devin, sweep waves) in
`sub-agent-orchestration-SKILL-v2-draft-2026-11-09.md`, including
executor instructions to quarantine the runtime (strip the
observed.jsonl writer, mark SIMULATION ONLY, make unimplemented
patterns raise).

### P2. `open-computer-use` (critical) - quarantine and rewrite

A 216-line skill instructing agents to take full desktop control
(click, type, key-press, drag) via a globally npm-installed MCP server
wired into Atomic Chat.

- **Install-first instruction conflicts with repo policy.** Step one
  is `npm i -g open-computer-use`. AGENTS.md's installation policy:
  agents install only what the user explicitly requested, and must
  check what is already installed first. The skill never mentions it.
- **No guardrails proportional to the capability.** Its "Security
  Notes" are four generic bullets ("only grant access to trusted
  agents"). No per-app approval, no prohibited surfaces, no
  screenshot-first read-only default with teeth. Usage example 5 has
  an agent typing an email and password into a login form - the exact
  pattern that must never be normalized for an agent holding the
  owner's desktop.
- **Dormant today, loaded tomorrow.** Verified 2026-11-07: Atomic
  Chat's active MCP servers are the filesystem server and Exa only -
  this server is not connected. The risk is prospective: any agent
  that loads the skill gets a take-the-desktop protocol with the
  safety section written as decoration.
- **Invisible to canonical review** (see S2).

**Redesign spec:** quarantine now (move out of `.kilo/skills/` into
`docs/scratch/` or delete; it is tracked, so history preserves it).
Rewrite before any return, with: read-only default (screenshot /
get_element / list_apps only); write actions (click, type, drag)
require a named app allow-list set by the owner and per-session
confirmation for anything outside it; hard prohibitions - never type
into credential fields, terminals, or browser password prompts, never
install anything (repo installation policy), never act on another
user's windows on a shared machine; every session starts with
`list_apps` and ends with a screenshot-verified state report. Until
that rewrite exists, the correct number of desktop-control skills in
this repo is zero.

### P3. The generic design cluster (minor) - scope or shelve

`design-tokens-system` (486 lines), `layout-structures` (438),
`desktop-layout-patterns` (414), `mobile-first-design` (256),
`responsive-design-patterns` (189): competent, mutually
cross-referenced, generic web-design guidance (Tailwind breakpoints,
Figma sync, 320px-first methodology). Two issues:

- **Wrong product.** The studio is a desktop power-user tool.
  `mobile-first-design` teaches designing from 320px upward, and
  `desktop-layout-patterns` defers to it "for the small-viewport
  story" - a story this product barely has. An agent chaining these
  for studio chrome gets imported instincts, not studio ones. (The
  cluster's natural home is the owner's future public website, which
  does need responsive design.)
- **No connection to the studio's own visual system.** None of the
  five references the 9-look visual style system, the brand palette
  kit, or the anti-slop rule - unlike `visual-hierarchy`, which is
  distilled from actual T-VIZ fixes and reads like it.

**Redesign spec:** do not delete; re-scope. Add a scope banner to each
("Reference pack - imported guidance. For studio surfaces, the visual
style system and `visual-hierarchy` win on any conflict; mobile-first
applies to public-web surfaces, not studio chrome"), and file them
mentally as reference, not workflow. If the set ever gets a
front-door index, these five sit below the repo-native skills.

## Verified healthy (deep-read or header + scan)

- **autonomous-session** - the router/guardrail layer; incident-
  distilled, board-aware, "verify, don't assert", destructive ops
  need the user. One fix: its See Also blesses
  `.kilo/skills/sub_agent_orchestration` as "deeper sub-agent
  patterns" - update to the v2 canonical path in the P1 commit.
- **storage-sweep** - exemplary: live-paths table, reference-check
  before any delete, newest-only backups, never merge DBs, ambiguous
  assets go to the user. No changes.
- **Vision cluster** - visual-qa-loop, vision-page-analysis,
  visualizer-mode-qa, music-video-vision: distinct scopes, explicit
  cross-references, mode-specific prompts, hallucination-aware
  (vision-page-analysis even documents a gemma4 hallucination
  incident). No changes.
- **Workflow core** - test-measure-improve, line-by-line-review,
  gates-commit-push, vendor-drift, dependency-management,
  media-output-contract: the evidence culture, correctly encoded.
  No changes.
- **current-best-practices + research.py** - the honest counterexample
  to orchestrator.py: the search function is dependency-injected; with
  no search function provided it returns queries plus an explicit
  "execute these yourself" note and fabricates nothing. One cosmetic
  bug: `get_domain_queries` return annotation says list[list[str]],
  returns list[str]. Fix opportunistically.
- **Platform skills** - gpu-optimizer (Pascal-specific, grounded in
  the kb doc), ollama-model-ops (measured tok/s, tier table
  consistent with AGENTS.md), blender-mcp, comfyui-mcp, unity-mcp
  (setup docs; their `opencode.json` mentions are the shared MCP
  config filename, not the retired agent). No changes.
- **remotion-best-practices** - external vendor router (v4.0.539);
  fine as reference, same mental shelf as P3.

## Recommended landing order

1. P1 v2 draft lands + runtime quarantine + autonomous-session
   cross-ref fix (one commit; draft file has the instructions).
2. P2 quarantine (one small commit; rewrite is a separate, later,
   owner-gated item - do not let an executor "improve" it back into
   the live set unsupervised).
3. S1/S2: mirror policy decision (owner), then the checker +
   mirrors (executor).
4. P3 scope banners (one commit, any executor).

Items 1-2 remove the active hazards. Items 3-4 remove the conditions
that let hazards hide.

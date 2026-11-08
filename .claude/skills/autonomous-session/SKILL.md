---
name: autonomous-session
description: >-
  The unattended-operation protocol for this repo: pre-flight checks, the
  skill-chaining router (which skills to load in sequence for a given task),
  consolidated guardrails for things agents have already broken before, and
  the blocked-work rules that let a session run 30+ minutes without
  supervision. Load at session start for any multi-step task, and whenever
  chaining more than one skill.
---

# Autonomous Session

The goal: a session that can run **30+ minutes unsupervised** without
repeating a mistake that was already guarded against. This skill is the
router + the guardrail layer. Domain skills (`visual-qa-loop`,
`test-measure-improve`, `vendor-drift`, `storage-sweep`, …) do the work;
this skill decides which ones chain and what is never allowed to happen
while nobody is watching.

## Pre-flight (before the first edit)

1. `git status` + `git log --oneline -5` — learn what is **yours** vs other
   agents' uncommitted work. You cannot push past their broken files; you
   also must not "fix" files they are actively rewriting.
2. **Check the agent board** — other live sessions may hold claims on the
   paths you need:
   ```powershell
   python tools/orchestration/board.py status
   python tools/orchestration/board.py conflicts --paths "<your paths>"
   ```
   Protocol: `docs/plans/orchestration.md`. Claim before editing
   (`board.py claim --agent <id> --paths ... --task T-XXX`), heartbeat at
   commit checkpoints, `board.py check` before committing when others are
   live, `release`/`handoff` when done. Fail-open — if it errors, proceed.
3. Read the task ledger for the area you're touching
   (`docs/plans/tasks/*.md`) — status and acceptance criteria live there,
   not in your head.
4. If the task spans services, confirm they're up
   (`scripts/manage-servers.ps1 -Action status` or the health endpoints).
5. Write the todo list with one in-progress item — it is your resume point
   if the session is interrupted.

## Chaining router

Load skills in this order for common task shapes. Later skills assume
earlier ones ran.

| Task shape | Chain |
|---|---|
| New/changed rendered output (UI, visualizer, 3D) | `visual-qa-loop` → `vision-page-analysis` (capture half) → fix → `gates-commit-push` |
| Visualizer mode audit/redesign | `visualizer-mode-qa` → knowledge-library rubric → `visual-qa-loop` on weakest → `gates-commit-push` |
| Backend/frontend feature or bugfix | `test-measure-improve` (implement→measure→verify) → `line-by-line-review` if >~300 lines or high-risk → `gates-commit-push` |
| "Review / audit / double-check" request | `line-by-line-review` (it already chains to `visual-qa-loop` for rendered output) |
| Fresh vendor pull / dep upgrade / "it worked before" | `vendor-drift` → smoke probes → `gates-commit-push` |
| Generated media "missing from library" | `media-output-contract` (diagnose path) → fix producer → verify via `GET /api/outputs?refresh=true` |
| Blender scene/asset work | `blender-mcp` (interactive) **or** headless `blender --background --python` (batch) → render → `music-video-vision`/`visual-qa-loop` for QA → `media-output-contract` if it ships |
| Local model/vision work or timeout | `ollama-model-ops` first (model tier + pre-warm) → then the analysis skill |
| Dependency additions/upgrades | `dependency-management` → `vendor-drift` if it touches bridged packages |
| Periodic hygiene / "storage is messy" | `storage-sweep` |
| Multi-file refactor across layers | `line-by-line-review` on the plan → implement → `test-measure-improve` → `gates-commit-push` |

Two skills are **always-on context**, not chained steps: this one and
`gates-commit-push` (which runs at every commit regardless).

Vision model tiers (from `ollama-model-ops`, measured): `moondream` for
sub-2s smoke checks only — it hallucinates details; `gemma4:e2b-it-qat`
workhorse for QA loops; `qwen3.5:4b` for deep defect hunts. Pick per task,
never default to the biggest model.

## Guardrails — things already broken once, never again

These are distilled from real incidents in this repo. An unattended agent
must not do any of them:

- **PowerShell 7 for repo commands — and §0 of the command sheet is
  mandatory.** The #1 recurring failure is escaping: heredocs
  (`git commit -m "$(cat <<'EOF' …)"`, `python - <<'PY'`) do not exist in
  pwsh and fail every time; backticks/`$` inside `"..."` get mangled;
  mid-line `@'...'@` here-strings misparse. **Rule: newline, backtick,
  `$`, or both quote types in a command → write a file, run the file.**
  Commits go through `git commit -F <msgfile>`; scratch scripts live in
  `docs/scratch/` or `$env:TEMP`. Full pattern table:
  `docs/powershell-command-sheet.md` §0. No `bash -lc` wrapping.
- **Commit trailer is a bare agent name** — `Co-authored-by: Devin`, never
  a `…@users.noreply.github.com` email (the commit-msg hook rejects
  third-party emails; it cost a commit cycle already).
- **Stage only intended files.** `git status` before every commit; other
  agents' uncommitted work stays untouched and unstaged.
- **Never delete or "fix" files you didn't create** unless the task is
  explicitly a cleanup (`storage-sweep` has its own reference-check rule).
  Untracked + recent = someone else's in-flight work.
- **Moving-target protocol:** if a file you edited changes underneath you
  or your fix "disappears", run `git log --oneline -10` + `git status`
  before redoing it — another agent may have already landed it.
- **Pre-push gates check the working tree, not your commits.** If push
  fails on files you didn't touch, report the blocker; do not bypass
  hooks, do not fix other agents' files mid-flight.
- **Verify, don't assert.** "It works" requires the real code path run:
  HTTP call, Playwright capture, Blender render, GLB inspection. Vision-
  model output is a description, not proof — say which you have.
- **Scratch files have homes:** one-off scripts → `docs/scratch/` or
  delete before commit; captures → `packages/frontend/tests/browser/out/`
  or `output/qa/`; never repo root (`check_*.py`, `fix_*.py`, `qa-*.mjs`
  at root are how the debris starts).
- **New media producers** must satisfy `media-output-contract` — write
  under `output/` (non-excluded dir), sidecar metadata, no frame-seq
  names — or the Media Library can't see the output.
- **Blender has two modes, don't confuse them:** MCP = live GUI session
  (port 9876, one addon stack at a time); reproducible/batch work =
  `blender --background --python <script>`. Committed bpy scripts are the
  source of truth.
- **Subagent writes need boundaries.** `run_subagent` workers are
  stateless and can't see the board — give each a disjoint path set in
  the prompt, or claim the union yourself first. Read-only explore
  agents need no claim.
- **DB work:** one live DB (`storage/studio.db`); backups →
  `storage/backups/` newest-only. Never merge SQLite files by copying rows.

## Unattended operation rules

- **Commit early, commit often.** A verified unit of work lands before the
  next one starts — an interrupted session should lose minutes, not hours.
- **Timebox exploration.** If a search/diagnosis exceeds ~10 minutes with
  no narrowing, write findings to the task ledger and move to the next
  todo item rather than thrashing.
- **Blocked ≠ stopped.** When blocked on something needing the user
  (credentials, a decision, a broken external service), document the
  blocker in the task ledger, do the next independent item, and report
  the blocker list at the end. Never sit idle waiting.
- **Destructive ops need the user.** Deleting data outside the
  `storage-sweep` rules, force-push, history rewrites, service kills —
  stop and ask, even unattended. The 30-minute promise assumes no
  irreversible actions.
- **End-of-session checklist:** `git status` shows only intended changes
  or a clean tree; task ledger updated with status/evidence; your scratch
  files deleted; services left running; report what landed, what's
  blocked, what's next.

## See Also

- [[gates-commit-push]] — the commit protocol every chain ends with
- [[storage-sweep]] — the hygiene pass this skill schedules
- [[vendor-drift]] — required after any vendor pull
- [[media-output-contract]] — required for any new media producer
- [[ollama-model-ops]] — vision/model routing table
- `.kilo/skills/sub_agent_orchestration/SKILL.md` — deeper sub-agent
  patterns (Kilo-side; the trigger table above is the repo-scoped subset)

# Task Files — How Work Survives the Session

**Status:** Active 2026-10-25 (owner-approved; system by Orion)
**Map:** `docs/plans/focus-areas-and-behavior-ledgers-2026-10.md` — the
nine focus areas, their behavior ledgers, and the standing rules this
system operates under.

## Why this exists

Chat interfaces are not storage. Provider sessions end without warning
(free tiers kick at ~30–60 minutes of continuous work), models rotate,
and a todo list trapped in one tool's chat dies with it. Task state
therefore lives **here, in git** — one file per focus area — where any
agent in any tool can pick it up.

## Layout

One file per focus area, named for the area:

`library-and-organization.md` · `music-generation.md` ·
`audio-analysis-and-remix.md` · `visualizer.md` ·
`video-pipeline-and-storyboard.md` · `local-models-and-vision-loop.md` ·
`agent-and-automation.md` · `integrations.md` · `platform-and-workflow.md`

## Task format

Copy `template.md`. Every task is a block:

```markdown
### T-<AREA>-<NN> — <short title>
- **Status:** todo | doing | done | blocked
- **Goal:** one line — what "finished" looks like
- **Files:** paths the work touches
- **Acceptance:** the observable check (usually a behavior-ledger item
  from the focus map)
- **Last session:** <agent/model, date> — what happened, where it
  stopped. Updated at every handoff.
```

IDs are stable: area prefix + sequence (`T-VIZ-01`). Never renumber;
a referenced ID must keep meaning the same task.

## The four rules

1. **Write state as you go.** Mark `doing` when you start an item,
   `done` only when its acceptance check passes. **Commit the task
   file after each item** (with the work, or alone if the item was
   investigation-only). A session death then loses at most the
   in-flight item — and its `doing` marker plus Last-session note tell
   the next agent exactly where it stopped.
2. **Tasks carry their own context.** Goal, files, acceptance — the
   incoming agent needs nothing from a previous chat. If resuming
   requires information that is not in the block, the block is
   incomplete: fix the block first.
3. **Resume protocol.** New session, any model, any tool: read
   `AGENTS.md` → read this file → read the area's task file → resume
   at the first `doing` item (finish or hand it back to `todo` with a
   note), then the first `todo`. The owner's re-entry prompt is one
   sentence: "Resume <area> from its task file."
4. **Size tasks to the kick window.** An item must be finishable in
   ~30–40 minutes of agent work. Larger work is split at creation
   time into sequenced items, never left as one big block.

## Status discipline

- `done` means the acceptance check passed — for refactors, the
  area's behavior-ledger items were reported present/missing/degraded
  (focus map §2.1). "Code written" is not done.
- `blocked` requires the blocker named in Last session (owner action,
  missing decision, external dependency).
- When an area's work changes its state materially, update the area
  entry in the focus map in the same session (focus map §3.9 ledger).

## Picking the model for a session

Trust tiers live in `tools/model-reliability/roster.md` (A = delegate,
B = scoped, C = supervised only). An **Untested** model — new to the
catalog, or not observed in 30+ days — gets the smallest open item in
the area's file as its first job (roster.md, first-contact rule), and
its outcome is logged to `tools/model-reliability/observed.jsonl`
before the session ends.

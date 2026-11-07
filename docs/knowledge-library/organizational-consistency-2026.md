---
tags:
  - production
  - documentation
  - knowledge-library
aliases:
  - Organizational Consistency
  - One Source Per Fact
cssclasses:
  - technical-guide
date: 2026-11-06
type: concept
---

# Organizational Consistency — One Source Per Fact

**The problem this solves.** This repo is organized on three axes at once —
task areas (work), library categories (knowledge), and tags — and each axis
kept its own hand-maintained lists and counts. As the library passed ~120
documents and five different agents took turns filing things, the lists
drifted apart: the same library is now counted three different ways by
three different ledgers, task blocks are written in two different formats
depending on which agent wrote them, and derived artifacts (index, tracker,
ebook, agent maps) disagree with each other and with the files on disk.
Nothing here is a knowledge problem. It is a bookkeeping problem, and it
has a bookkeeping fix: **every organizational fact gets exactly one source,
and everything else is generated from it or checked against it.**

## The 2026-11-06 census (measured, not estimated)

Task files (`docs/plans/tasks/`, 122 task blocks):

| Drift | Count |
|---|---|
| Heading separator: em dash `—` vs plain hyphen `-` | 79 vs 43 |
| Blocks missing the **Acceptance** field | 13 |
| Blocks missing the **Last session** field | 11 |
| Placeholder IDs (`T-PLT-XX`, three blocks sharing one ID) | 3 |
| Status vocabulary | clean — only `todo` / `doing` / `done` in use |

Knowledge library (122 files besides `index.md`):

| Ledger | Per-category counts (Prod / Tech / MCP / Creative / Perf / AI / Research) |
|---|---|
| `index.md` category listings | 15 / 17 / 12 / 25 / 7 / 21 / 21 |
| `knowledge-tracker.md` sections | 16 / 20 / 12 / 22 / 7 / 20 / 21 |
| `index.md` Tags Index table | 16 / 21 / 12 / 22 / 7 / 20 / 20 |

Three ledgers, three different splits of the same library. Further:

- `visualization-effects` is listed in **3 categories** at once.
- 8 files sit in no category: 7 are library *meta* files (see R4) and one is
  a content orphan — `animatediff-evolved-2026`.
- `knowledge-tracker.md` states the library holds **113** documents;
  the disk holds **121** files (excluding `index.md` and `README.md`).
- The repo's own `AGENTS.md` describes "the 107-article research library";
  the disk holds 122 files. Even the bootstrap document carries a stale
  hand-typed count.
- Every content file carries frontmatter with tags; the only file
  without frontmatter is `README.md`, a meta file (exempt under R4).
  (This axis *improved* since the 2026-09 cleanup —
  drift is not uniform decay; it concentrates wherever a number or a list
  is maintained by hand in more than one place.)

## The rules

**R1 — One task-block format.** A task block is exactly the `template.md`
shape: heading `### T-<AREA>-<NN> — <title>` with an **em dash**, and all
five fields — Status, Goal, Files, Acceptance, Last session. Status is one
of `todo | doing | blocked | done`. **Placeholder IDs are banned:** work
that has no number yet is a plain backlog line, not a task block — an ID
shared by three blocks (today's `T-PLT-XX`) identifies nothing.

**R2 — One primary category per document.** A knowledge doc is listed in
exactly one `index.md` category. Cross-references belong in the doc's own
Related section or as a see-also note, never as a second category listing —
a doc in three categories is a doc no index can count correctly.

**R3 — Frontmatter is the source; every count is derived.** A doc's
primary category tag lives in its frontmatter. Index listings, tracker
sections, and the Tags Index counts are **generated from the files or
verified against them by the checker** — never typed by hand. If a number
cannot be reproduced by running the checker, it does not go in a document.

**R4 — Meta files are a named class.** `README.md`, `_schema.md`,
`knowledge-tracker.md`, `log.md`, `tagging-guide.md`, and per-collection
README files are *about* the library, not *in* it. They are excluded from
document counts, category listings, and agent-facing content indexes, and
listed once, explicitly, wherever membership matters.

**R5 — Two axes, kept distinct.** Task areas organize **work**; library
categories organize **knowledge**. They are not the same taxonomy and must
not grow near-duplicate names (today's `integrations` area vs
`MCP & Platform Integrations` category is the standing example). The
crosswalk below is the only sanctioned mapping; a new area or category is
added to it in the same commit that creates it.

| Task area (work) | Library categories it draws on (knowledge) |
|---|---|
| library-and-organization | governs all; its docs file under Production Pipeline |
| music-generation | Production Pipeline · AI & ML |
| audio-analysis-and-remix | Production Pipeline · Technical Implementation |
| visualizer | Creative & Visual |
| video-pipeline-and-storyboard | Production Pipeline · Creative & Visual |
| local-models-and-vision-loop | AI & ML |
| agent-and-automation | AI & ML · Technical Implementation |
| integrations | MCP & Platform Integrations |
| platform-and-workflow | Technical Implementation · Performance & Hardware |
| — (no work area) | Research & Reference is the intake shelf: research lands there, work areas consume it |

**R6 — Derived artifacts inherit, never invent.** Anything built from the
library or the task files (ebook, library map, agent starter pack, future
exports) derives membership, order, and counts from `index.md` and the
task files at build time. A builder that hard-codes a list is a future
drift incident.

## Enforcement

`tools/check-consistency.py` (landed with this doc) mechanically checks
R1, R2, R4, and frontmatter presence, and prints the census. The cleanup is
tracked as task items: **T-LIB-04** normalizes the task blocks to R1,
**T-LIB-05** reconciles the three library ledgers to R2–R4 (including the
tracker total and the `#research` count class of failure), and **T-LIB-06**
wires the checker into `tools/check-all.py` once the census reaches zero —
from then on, drift fails the gate instead of accumulating silently.

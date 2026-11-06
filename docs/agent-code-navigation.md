# Agent Code Navigation

For a condensed "where is what" file map, start at `docs/source-map.md` —
it is curated orientation, not exhaustive; confirm paths with `rg --files`.

Use this when a task requires finding implementation files. The documentation
search API searches `docs/`; it does **not** search source code. The
`docs/knowledge-library/codebase.json` file is a legacy orientation map, not a
current file index. Treat every path in it as a lead and confirm that the path
exists before editing.

## Discovery route

1. Read `AGENTS.md` and the relevant task file in `docs/plans/tasks/`. Use
   `docs/plans/focus-areas-and-behavior-ledgers-2026-10.md` to choose the area.
2. Read `docs/README.md` to find authoritative architecture or domain docs. For
   implementation-specific rules, check the nearest `README.md` and relevant
   architecture map (for example, `docs/architecture/visualizer.md`).
3. Find the owning symbol or behavior in source with a narrow search:

   ```powershell
   rg -n "useAudioLibrary|audioLibraryStore" packages/frontend/src
   rg -n "remix_probe|/probe" packages/backend/app packages/backend/tests
   ```

   Use `rg --files <area>` to discover current filenames when a symbol search
   does not identify the owner. Start in `packages/` for app implementation,
   `tools/` for developer utilities, and `scripts/` for Windows lifecycle
   operations. Avoid searching generated/output trees unless the task concerns
   generated data.
4. Follow the call chain in both directions: route/component entry point,
   service/store/adapter that owns behavior, and the caller-facing API or UI.
   Then locate the nearest tests by searching the symbol and listing the test
   directory. Do not assume a similarly named file is the active implementation.
5. Before changing code, check the governing architecture decisions and local
   invariants in `AGENTS.md`. For backend work, preserve the dependency direction
   `api -> services -> adapters`; for frontend visualizer work, use the module
   map and keep `unity-visualizer/` separate.

## Parallel discovery and handoff

Delegate only independent questions with separate search boundaries. For
example, one agent can trace the route/component to its implementation owner
while another finds callers and the nearest tests. Give each agent the task
symptom, an area to search, and a request for evidence; do not ask several
agents to scan the whole repository for the same thing. Keep discovery
read-only until the lead has reconciled the candidate paths and ownership.

Ask each discovery agent to return:

```text
Question:
Searches run:
Confirmed paths and symbols: (include line numbers or exact identifiers)
Call chain / consumers:
Nearest tests or “not found”:
Paths checked and ruled out:
Unknowns / confidence:
```

The lead should verify the strongest path and symbol in the working tree, then
combine findings before implementation starts. Stop searching once the entry
point, behavior owner, caller/consumer, and nearest test location are confirmed;
report a missing test or unresolved owner explicitly instead of broadening into
an unbounded repository scan. A path found only in `codebase.json` or prose is a
candidate, not evidence that it is current.

## Example traces

| Task | First useful search | Likely owner to confirm | Nearby test evidence |
|---|---|---|---|
| Audio selector shows a track | `rg -n "useAudioLibrary|listAudioFiles" packages/frontend/src` | `packages/frontend/src/state/audioLibraryStore.ts` and the page/component using the hook | `packages/frontend/src/state/audioLibraryStore.test.ts` |
| Remix probe fails | `rg -n "remix_probe|/probe" packages/backend/app packages/backend/tests` | `packages/backend/app/api/audio_remix.py`, then `packages/backend/app/services/remix_analysis.py` | `packages/backend/tests/test_stem_remixer.py` covers service/cache behavior; no direct route test was found in this trace |
| Visualizer mode rendering | `rg -n "canvas2dModes|selectVizMode" packages/frontend/src/features/visualizer` | `packages/frontend/src/features/visualizer/canvas2dModes.ts` and `docs/architecture/visualizer.md` | `packages/frontend/src/features/visualizer/canvas2dModeBudget.test.ts` and `selectVizMode.test.ts` cover adjacent mode behavior |

These searches are starting points, not guarantees. Confirm live paths with
`rg --files` and inspect imports/callers before editing. If a new discovery
reveals a durable ownership rule, update the owning README or architecture map
in the same change so the next agent starts closer to the implementation.

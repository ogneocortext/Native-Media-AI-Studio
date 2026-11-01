# Agent Code Navigation

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

## Example traces

| Task | First useful search | Likely owner to confirm |
|---|---|---|
| Audio selector shows a track | `rg -n "useAudioLibrary|listAudioFiles" packages/frontend/src` | `packages/frontend/src/state/audioLibraryStore.ts` and the page/component using the hook |
| Remix probe fails | `rg -n "remix_probe|/probe" packages/backend/app packages/backend/tests` | `packages/backend/app/api/audio_remix.py`, then the service called by the route |
| Visualizer mode rendering | `rg -n "render.*Mode|canvas2dModes" packages/frontend/src/features/visualizer` | `packages/frontend/src/features/visualizer/` and `docs/architecture/visualizer.md` |

These searches are starting points, not guarantees. Confirm live paths with
`rg --files` and inspect imports/callers before editing. If a new discovery
reveals a durable ownership rule, update the owning README or architecture map
in the same change so the next agent starts closer to the implementation.

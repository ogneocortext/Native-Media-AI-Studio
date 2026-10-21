# Information Architecture Audit — 2026 (O4)

**Status:** Complete 2026-10-21 — recommendations **for owner review**;
nothing here has been implemented.
**Plan:** `docs/plans/creative-onboarding-ux-2026-10.md` (Priority 3, O4);
research gaps §18.
**Cross-references:** `feature-utilization-audit-2026.md` (§2 orphaned
capabilities), `design-philosophy-2026.md` (P1 stage-first dashboard),
`docs/ux/5-minute-path.md` (O2).

> **Method and its limits.** Static audit: every route in
> `packages/frontend/src/App.tsx`, every item in the sidebar nav
> (`components/layout/Sidebar.tsx`), inbound links per route, and the
> two prior audits. No card-sort or tree-test baseline exists (§18), so
> the JTBDs below are read from what each screen actually does, not
> from observed users. Treat the recommendations as structural —
> cheap to test, in R1's case nav-only and reversible.

---

## Inventory

- **33 route entries** in `App.tsx`: **28 real pages**, 5 redirects
  (`/media-library`, `/logs`, `/music-video`, `/studio-3d`,
  `/video-editor` — old names kept working; the IA has been revised
  ad hoc before), and a 404.
- **Sidebar: 25 items in 5 groups** — Home (1), Create (10),
  Generate (3), Manage (4), System (6, collapsed by default).
- **3 routed pages are absent from the sidebar:** `/preview`
  (contextual — reached from render outputs), `/notifications`
  (reached from the header bell — a sound pattern), and
  `/ollama-chat` (no nav entry, **no inbound links found** — an
  orphan, §Orphans).
- The plan's suspicion — "6+ jobs through one navigation surface" —
  localizes precisely: **Create holds 10 items spanning at least
  three different jobs** (make a video end-to-end, perform/design
  visuals, generate assets and prompts).

## Screen → job-to-be-done

JTBDs are stated as the problem the user brings to the screen.

| Route | Nav (group) | Job-to-be-done | Expected outcome | Flag |
| --- | --- | --- | --- | --- |
| `/` Dashboard | Dashboard (Home) | Get oriented: see recent outputs and pick up where I left off | Resume work, launch a flow | **Multi-job** — overview + output management (recent videos, with delete) + feature launcher grid (P1's diagnosis) |
| `/music-video-wizard` | Music Video (Create) | Turn one track into a finished music video end-to-end | A rendered music video | — flagship flow |
| `/audio-analysis` | Audio Analysis (Create) | Analyze a track (tempo, key, energy, suggested visual) — and finish it (mastering) | An analysis record; a mastered file | **Two jobs, one door** — understand a track / finish a track; both start from a track, so the pairing is defensible — monitor, don't split (see C5) |
| `/visualizer` | Visualizer (Create) | Watch a track as a live visual and tune the look (modes, stem mixer, remix panel) | A look worth rendering | Stage + workshop in one; also the preview surface other flows borrow |
| `/three-js-studio` | Three.js Studio (Create) | Build and render 3D shader scenes | A rendered 3D scene/clip | Q1's primary 3D path |
| `/kinetic-typography` | Kinetic Type (Create) | Make lyric-driven kinetic typography videos | A typography clip | — |
| `/hyperframes` | HyperFrames (Create) | Compose and render HTML-based video compositions | A rendered composition | Receives compiled storyboards (§Orphans 4) |
| `/ai-tools` | AI Tools (Create) | Run a one-off AI utility that has no home of its own | Varies by tool | **Catch-all** — multi-job by construction |
| `/music-prompts` | Music Prompts (Create) | Generate platform-ready song prompts from an idea or a track's analysis | Prompt text for Suno etc. | **Island** — utilization audit §2.1: the wizard never invokes it |
| `/unity` | Unity Control (Create) | Drive the Unity renderer (scenes, capture) | Unity-rendered frames | Q1 made Three.js primary and Unity the fallback; nav presents them as equals |
| `/animation-studio` | Animation Studio (Create) | Assemble and render animation projects | A rendered animation | One of four assembly surfaces in Create (wizard, storyboards→hyperframes, animation studio, video gen) |
| `/image-generation` | Image Gen (Generate) | Generate still images (covers, references, storyboard panels) | Image assets | — |
| `/video-generation` | Video Gen (Generate) | Generate video clips from prompts/images (LTX path) | Generated clips | — |
| `/generate-3d` | 3D Gen (Generate) | Generate 3D objects/assets from prompts | 3D assets | **Wrong-door risk** — "3D Gen" vs "Three.js Studio": generating assets vs building scenes, labels don't teach the difference |
| `/library` | Media Library (Manage) | Find, organize, and pick the media every other flow consumes | The right file, fast | — the hub; single clear job |
| `/queue` | Queue (Manage) | See running/failed jobs and unstick them | Jobs completed or retried | — single clear job |
| `/storyboards` | Storyboards (Manage) | Plan a video as panels/scenes before spending renders | A storyboard (compiles to HyperFrames) | Planning lives in Manage while its output lands in Create — a seam, not yet a problem |
| `/data-management` | Data Management (Manage) | Clean up, export, and manage app data and outputs | Space reclaimed, data exported | **Adjacency** — file/data hygiene also lives in Database and (via delete) the Dashboard |
| `/health` | Health (System) | Answer "is the studio OK?" — services, adapters, diagnostics | A diagnosis | **Monitoring trio** (with GPU, Log Analytics): one job, three lenses, three doors |
| `/database` | Database (System) | Inspect and fix the app's database rows directly | Rows inspected/fixed | Adjacent to Data Management; the names don't teach files-vs-rows |
| `/gpu` | GPU (System) | Watch GPU/VRAM load during generation | Know whether the card is the bottleneck | Monitoring trio |
| `/log-analytics` | Log Analytics (System) | Search logs to find why something failed | A root cause | Monitoring trio |
| `/settings` | Settings (System) | Configure the studio | Settings saved | — |
| `/docs` | Docs (System) | Read the studio's own documentation in-app | An answer | — |
| `/preview` | — (contextual) | Watch a finished clip on its own page | A viewed/shared clip | No nav entry by design; its inbound story depends on render flows (and §Orphans 1) |
| `/notifications` | — (header bell) | Catch up on job and system notifications | Nothing missed | Sound chrome pattern; not a sidebar item |
| `/ollama-chat` | — (none) | Chat with local models | A conversation | **Orphan route** — no nav entry, no inbound links found |

## Merge / split candidates

- **C1 — Split the Create group by job (nav-only).** Ten items, three
  jobs. Proposed: *Make* (Music Video wizard, Storyboards,
  HyperFrames, Animation Studio), *Visuals* (Visualizer, Three.js
  Studio, Kinetic Type, Unity Control), *Tools* (Audio Analysis,
  Music Prompts, AI Tools). No routes move; grouping is metadata.
- **C2 — Split the Dashboard's three jobs.** Overview/resume stays;
  output management (recent videos, delete) belongs to the Library /
  Data Management; the equal-weight launcher grid goes away entirely
  (this is P1's stage-first proposal, with the management half made
  explicit).
- **C3 — Merge the monitoring trio behind one System entry.**
  Health + GPU + Log Analytics are one job ("is it working / what
  broke") at three fidelities. One entry with tabs keeps the
  collapsed-by-default behaviour and removes two doors. Database stays
  separate (it changes state; the trio only reads).
- **C4 — Disambiguate the data pair by name.** Data Management
  (files/outputs) vs Database (rows) is a real distinction the labels
  don't teach. Rename to *Files & Outputs* and *Database*, or merge
  under one entry with two tabs; either beats the current guess.
- **C5 — Audio Analysis: watch, don't split.** Analysis + mastering
  share a track-first entry and a user who is usually doing both in
  one sitting. Splitting mastering into its own page would repeat the
  Music Prompts island mistake in reverse. Revisit only if the page
  outgrows the pairing.
- **C6 — AI Tools: dissolve or declare.** A catch-all is an IA debt
  marker: each tool either graduates to the group its job belongs to,
  or the page is renamed *Utilities* so its grab-bag nature is honest.

## Orphaned capabilities

1. **`features/art-direction/ArtDirection.tsx` — a whole feature with
   no door.** Not routed in `App.tsx`, not imported by any other
   component (grep-verified 2026-10-21). It even links *out* to
   `/preview`, from a page nothing can reach. Decide: route it, fold
   it into Storyboards (its nearest job-neighbour), or remove it.
   This audit takes no position on which — only that "none of the
   above, indefinitely" is the one bad option.
2. **`/ollama-chat` — routed, unlisted, unlinked.** Either it is a
   tool (give it a nav home under the proposed *Tools* group) or an
   experiment that ended (remove the route). Same decision shape as
   ArtDirection.
3. **Music Prompts ↔ the wizard (utilization audit §2.1).** The
   capability *has* a home; what is missing is the path from its job's
   main flow. The wizard's Style step takes a hand-typed prompt while
   a generator that already knows the track's genre/mood sits one nav
   click away. Fix is a connection ("Generate with AI" in the Style
   step), not a move.
4. **Storyboard → HyperFrames preview gap (utilization audit §2.2).**
   The compile path is wired at the API level; the remaining gap is a
   preview action, so a storyboard's compiled result can be *seen*
   before rendering. An IA path exists on paper only.
5. **`/preview`'s inbound story.** Today its discovered inbound links
   live in the unreachable ArtDirection page and in render flows. If
   ArtDirection is folded or removed, give Preview a deliberate home:
   "View" actions in Queue results and Library items.

## Recommendations (sequenced, cheapest first)

- **R1. Regroup the sidebar by job (C1).** Nav metadata only, fully
   reversible, and it makes every later decision easier to see.
- **R2. Decide the two unlisted rooms (Orphans 1–2).** ArtDirection
   and Ollama Chat each get a home or a removal — owner's call, but
   make it a call.
- **R3. Connect Music Prompts to the wizard's Style step (Orphan 3).**
   The highest-value single link in this audit: it closes a documented
   data-flow break, not just a nav gap.
- **R4. One System entry, three tabs (C3) + rename the data pair
   (C4).** Small frontend work; do it with R1 so the nav changes land
   once.
- **R5. Dashboard split (C2)** — sequence with design-philosophy P1;
   the launcher grid's removal is the visible half, moving output
   management to the Library is the structural half.
- **R6. Rename "3D Gen" → "3D Assets"** (table flag) — a one-word fix
  for a standing wrong-door risk.
- **R7. Add `/onboarding` + Quick start** per the O2 draft — the new
  surface lands in the *Make* group proposed by R1, and first-run
  entry does not depend on any of R1–R6.

**Follow-up if the owner wants evidence over structure:** a 10-minute
tree test of the R1 grouping (owner + one other user, five find-it
tasks) before any route moves. Nothing in R1–R7 requires it; routes
themselves do not move in any recommendation above.

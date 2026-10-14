# Remix Iteration Plan — Oct 2026

**Status:** Implemented 2026-10-13/14 — R1+R2 in `48869fb`, the parked items in the follow-ups; all four landed, the wizard last
**Owner:** repo owner (implementation: local coding agent)
**Evaluation:** UX review of the completed remix/mashup plan (2026-10-13)

> The remix plan is complete (A1–A7, B1–B7, Windows e2e green). This plan
> covers what that plan left out: the plan got agents and users *to* a first
> render, but real mashup work is iterative — nobody's first render is final.
> These two items close the loop.

## Closure notes (2026-10-13)

Both items landed with their acceptance checks, verified on Windows:

- R1: `base_recipe` on `from-prompt`, revision system prompt, `changes` diff,
  MCP `base_recipe`, panel "Revise" input. Unit tests cover gain delta, layer
  removal, slot length, empty revision, and the unknown-track case.
- R2: `slot_index` on `preview-audio` (out of range → 400, no render),
  click-to-audition, drag + arrow-key reorder off the slots array.

Two defects the acceptance list exposed, both fixed rather than tested around:

1. The unknown-track guard could never fire — it iterated
   `mentioned_sources()`, which only returns sources that already matched —
   so "vocals from The Vow up 2 dB" silently boosted *every* vocals layer.
   Replaced with a deterministic reference check (connector grammar + a
   capitalisation bias that keeps "from the top" from warning) that refuses
   before the model call and in the heuristic path.
2. The Revise button's `aria-label` overrode its visible text, so its
   accessible name disagreed with the label (WCAG 2.5.3) and
   `getByRole("button", { name: "Revise" })` could not find it.

Two measured facts worth keeping:

- A cold `qwen3.5:9b` under VRAM contention answered `from-prompt` in
  **167 s** (backend log: `-> 200 (167473.6ms)`) while the frontend fetch
  budget was 180 s — the client aborted a request the backend was about to
  answer. The draft fetch budget is now 300 s.
- `run-gates.py`'s e2e gate runs only `app-shell`, `canvas2d` and
  `lrc-visualizer` — `remix-panel.spec.ts` is **not** in it, so a green e2e
  gate says nothing about this panel. Run the spec directly (8/8, ~2 min
  warm).

## What already exists (don't rebuild)

- `POST /api/audio/remix/from-prompt` (`RemixPromptRequest{prompt, model?}`) →
  `{recipe, explanation, warnings, model_used, source}`; draft-only, recipe is
  the exact `/build` shape (`audio_remix.py:264`).
- `services/remix_prompt.py`: deterministic repair pipeline (track mention
  detection, per-source stem attribution, adjective map, model-output repair,
  heuristic fallback when Ollama is down).
- `POST /api/audio/remix/preview-audio` → `{url}` renders a ~30 s excerpt;
  `GET /preview-file/{key}` serves it (`audio_remix.py:297`).
- `RemixPanel.tsx`: A6 proportional timeline (`timelineSegments()` in
  `remixRecipe.ts:124`, rendered at `RemixPanel.tsx:544`, view-only),
  per-layer audition (`auditionLayer`, `RemixPanel.tsx:406`), job-tracked
  builds (B5).
- MCP: 9 `remix_*` tools including `remix_from_prompt`
  (`tools/mcp/ollama-tools-mcp.mjs:276`).

## R1. Revision loop — refine a draft or a build with one sentence

**Problem.** Every refinement today costs a full re-draft ("make a darker
version of X…") or hand-editing JSON. The agent flow the plan enables is
prompt → draft → review → build, but the actual loop is build → listen →
"vocals up 2 dB" → rebuild. There is no primitive for the second half.

**Change.** Teach `from-prompt` revisions instead of adding a new endpoint:

- `RemixPromptRequest` gains `base_recipe: RemixRecipeRequest | None = None`.
  When present, the prompt is interpreted as *deltas* against it ("vocals up
  2 dB", "drop the bass in slot 2", "make slot 1 twice as long").
- The system prompt changes shape in revision mode: it receives the current
  recipe JSON verbatim plus the revision prompt, and must return the **full
  revised recipe** (not a diff). Instruction: apply only what the revision
  asks; leave everything else identical.
- The existing deterministic repair pipeline runs unchanged on the revised
  recipe (re-resolve tracks, clamp numerics, drop unresolvable layers with
  warnings). A revision can never produce a recipe `/build` would reject.
- Warnings gain a `changes: list[str]` — a human-readable diff computed by
  comparing base vs revised ("slot 1: vocals gain 0.0 → 2.0 dB; slot 2:
  removed bass layer"). An empty revision ("looks good") returns the recipe
  unchanged with `changes: []`, not an error.
- MCP: extend `remix_from_prompt` with an optional `base_recipe` object
  parameter. No new tool — one tool, two modes, same as the HTTP surface.
- Frontend (small): a "Revise with prompt" input in the panel header that
  sends the panel's current recipe as `base_recipe` and applies the returned
  recipe to the form for review. The panel already edits recipes; this just
  gives users the agent's primitive.

**Accept:**
- `from-prompt` with `base_recipe` + "vocals up 2 dB" returns the same
  recipe with only that layer's gain changed, and `changes` names it.
- "drop the bass in slot 2" removes exactly that layer; nothing else moves.
- A revision naming an unknown track warns and leaves the recipe unchanged
  (repair-before-return, same as drafts).
- Unit tests: gain delta, layer removal, slot-length change, empty revision,
  unknown-track revision. The heuristic fallback path must also handle
  revisions (parse "X up/down N dB" deterministically when Ollama is down).

**Non-goal:** prompt → audio in one shot stays forbidden (inherited). Revision
still returns a recipe for review; rendering is always an explicit `/build`.

## R2. Interactive timeline — click to audition, drag to reorder

**Problem.** The A6 timeline is view-only: proportional widths, stem chips,
tooltips — but the moment a user wants to *act* on what they see ("that slot
is too long", "what does slot 2 sound like alone?"), they scroll back to the
form sections. The timeline shows the arrangement; it should also edit it.

**Change.**

- **Click a segment → audition that slot.** `POST /preview-audio` gains an
  optional `slot_index: int`. The backend builds a single-slot recipe from
  the posted recipe (same name, one slot) and renders it through the existing
  `render_preview_audio` path — no new DSP. The panel plays the returned URL
  through the existing `play()` used by layer audition. Out-of-range index →
  400.
- **Drag a segment → reorder slots.** Pointer-based drag on the segment row;
  on drop, the slots array reorders and the form sections follow (they render
  from the same state, so no extra wiring). Dragged segment gets a ghost
  style; show a drop indicator between segments. Keyboard: with a segment
  focused, arrow keys nudge it left/right — the panel is keyboard-operated
  elsewhere, so drag can't be the only path.
- Scope guard: no per-segment resize handles, no chip-level solo/mute — click
  and drag only. Resize/solo are a separate plan if anyone asks.

**Accept:**
- Clicking slot 2's segment plays an excerpt containing only slot 2's layers
  (verified in-browser: the played URL's recipe has one slot).
- Dragging slot 3 before slot 1 reorders the form sections to match; the
  timeline and the forms never disagree (single source of truth: the slots
  array).
- `slot_index` out of range → 400, no render.
- Playwright: click-to-audition plays audio; drag reorder persists into the
  built recipe (the repo already e2e-tests this panel — extend, don't invent).

## Suggested order

**R1 → R2.** R1 is backend-only and unblocks the agent loop immediately; R2
is frontend-only and touches nothing R1 builds. They can land as separate
commits in either order, but R1 first gives agents the primitive while the
UI work is in flight.

## Deliberately parked (not this plan)

> **Update 2026-10-13:** the owner asked for these to be built. All four items
> landed — R1/R2 first, then the parked items across two follow-ups, the
> wizard last (`remixWizard.ts`). Nothing is parked any more.

- **A/B compare** (pin two variants, flip between them) — **Landed.**
  `abCompare.ts` holds the pure pin/match logic (a pin is a structural
  snapshot of the whole form, so flipping is a context switch and the "which
  am I looking at" marker is equality with the pin, not a last-loaded flag).
  Panel: Pin as A / A / Pin as B / B; flipping also clears the preview and
  audition so stale audio can't play under the new form. 7 unit tests, one
  e2e (pin, edit, pin, flip, flip back, edit clears both markers, pins
  survive the edit).
- **Version history** (`mashup-1`, `mashup-2` lineage) — **Landed.** A rebuild
  archives the render it replaces under `<name>/.versions/vNNN/` (stems,
  manifest and its own `enhanced/` master — a version is a complete render),
  the manifest records its version, `GET /{name}/versions` lists the lineage
  and `GET /{name}/file/{which}?version=N` plays an archived one (404 for an
  unknown version, never a silent fallback). Panel: a Render picker in the
  Hear card; Mastering stays on the current render and says why. 5 unit
  tests, one e2e (two builds under one name, play v1).
- **Guided wizard mode** — **Landed.** `remixWizard.ts` holds the pure logic
  (structure builders for the three preset shapes, the silent-intro offset,
  duration, naming, summary lines); the panel renders four steps — the two
  songs, the shape, the length, a summary — and ends by loading the
  arrangement into the same form the presets fill, so the user keeps the
  editor they would have used by hand. It deliberately builds nothing:
  rendering stays an explicit act, as everywhere else in the panel. The
  silent-intro trap is handled here rather than left to a warning after the
  render — a vocals entry lands on the first audible 4-bar boundary, so
  Ad-Nauseam's 7.06 s of silence puts the entry at bar 8, not bar 0. 13 unit
  tests, one e2e.

  The plan's parking reasoning is recorded because it shaped the build: the
  presets already lower the floor, so the wizard adds order and completeness
  (the two songs and the length set once, in the open) rather than new
  concepts — no structure the presets do not already build.
- **Cancel for long builds** — **Landed.** B5's job ids did make it a small
  endpoint plus a button. The render polls a cancel token between slots
  (a slot's time-stretch can't be aborted mid-flight), and because the mix is
  in memory until it completes, a cancelled build writes nothing and leaves
  any previous render untouched — cancel is never destructive. An enhance is
  refused (409, not a lie): the Suno chain is one call with no safe point.
  8 unit tests, a live API check (cancel -> cancelled in 10.7 s, nothing on
  disk, second cancel 409, unknown 404), one e2e (the button appears and the
  panel returns to idle).

  Original reasoning kept: A/B wanted the variant generation R1's revision
  loop makes natural; version history is bookkeeping, not interaction; the
  wizard's presets already lower the floor; cancel was "flagged in review;
  B5's job IDs make it a small endpoint + button, but nobody has asked for it
  yet".

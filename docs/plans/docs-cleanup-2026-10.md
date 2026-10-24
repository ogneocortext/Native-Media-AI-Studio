# Docs Cleanup Plan — 2026-10

**Status:** Proposed 2026-10-21 — for owner review. **Nothing in this
plan has been executed**; every item is a proposal with its evidence,
required reference updates, and verification step attached.
**Origin:** a 2026-10-21 survey of the `docs/` tree against the
directory map in `docs/README.md`, with every claim grep-verified
against the codebase before it was written down.
**Scope:** file placement only. No content rewrites except where an
item explicitly says so (C3).

---

## C1 — `docs/track-prompts-lyrics.csv` is runtime data living in docs/

- **Evidence:** the backend reads it from a **hardcoded path** —
  `packages/backend/app/api/data.py:512`:
  `PROJECT_ROOT / "docs" / "track-prompts-lyrics.csv"`. Two frontend
  features fetch it: `KineticTypographyPage.tsx:288` and
  `Visualizer.tsx:510` (`fetch("/track-prompts-lyrics.csv")`). It is
  Suno working data (11 tracks: name, prompt, lyrics), not
  documentation, and it is absent from the `docs/README.md` map.
- **Proposal (choose one):**
  - **(a) Relocate with its loader.** Move to `suno-templates/` (the
    repo's Suno material home), update the one path in `data.py`,
    and verify both fetch callers still resolve. Effort: S — one
    code line plus verification.
  - **(b) Keep and document.** Add it to the `docs/README.md` map as
    app-served data, so its presence in `docs/` is a stated decision
    rather than an accident. Effort: XS.
- **Recommendation:** (a) if the file is still actively edited as
  Suno data; (b) if it is effectively frozen. Owner's call — it
  depends on how the file is used day-to-day, which the code can't
  say.
- **Verify:** after (a), load Kinetic Typography and the Visualizer
  lyric features against a track in the CSV; after (b), map updated.

## C2 — Fold `docs/ux-audit/` into `docs/ux/`

- **Evidence:** two UX directories now exist. `docs/ux-audit/` holds
  `audit-report.md` and `three-js-visualizer-review-2026-09-29.md`;
  `docs/ux/` (created by the Priority 3 pass) holds the 5-minute
  path draft (O2) and the IA audit (O4). One topic, two homes.
- **Proposal:** move both `ux-audit/` files into `docs/ux/`, delete
  the empty directory, and update the three references:
  1. `docs/README.md` map — merge the `ux-audit/` and `ux/` rows.
  2. `docs/knowledge-library/index.md:136` — the
     `[[../ux-audit/audit-report]]` link → `[[../ux/audit-report]]`.
  3. `docs/knowledge-library/knowledge-tracker.md` — the tracker
     lists `../ux-audit/audit-report.md` (and discusses it at line
     28); update both mentions.
- **Verify:** `python tools/validate-knowledge-tags.py` — all checks
  passed (the tracker path is validator-checked, so a missed update
  fails loudly). Effort: S.

## C3 — `three-js-studio.md`: same title, two documents, drifted

- **Status: ✅ Done 2026-10-22** — option (b) was chosen: the route doc's
  unique sections (Interaction Model, Architecture, TSL Integration, Key
  Patterns, Known Limitations, Related Files) were merged into
  `docs/knowledge-library/three-js-studio.md`, and the `docs/knowledge/`
  copy was deleted. The validator's divergent-duplicate warning for this
  pair is gone.
- **Evidence:** `docs/knowledge-library/three-js-studio.md` now carries
  both the library reference treatment and the route doc's content.

## C4 — `unity-audio-visualization-2026.md`: divergent pair across the Unity boundary

- **Status: ✅ Done 2026-10-22** — the `docs/knowledge/` copy was moved into
  the library (`docs/knowledge-library/unity-audio-visualization-2026.md`),
  its frontmatter fixed (`type: source`, primary `platform` tag), and the
  Unity-visualizer copy kept as the project's own copy. The validator's
  divergent-duplicate warning for this pair is gone.
- **Evidence:** `docs/knowledge-library/unity-audio-visualization-2026.md`
  (23,716 B) vs `unity-visualizer/Assets/Documentation/
  unity-audio-visualization-2026.md` (22,966 B) — near-equal size,
  flagged divergent by the validator.
- **Proposal:** pick one canonical copy, sync the other to it (or
  replace it with a pointer), and record the choice in a header line
  in both. Execution is **local/owner only** — the
  `unity-visualizer/` subtree is not edited from the sandbox.
  Effort: S.

## C5 — Review four research-style files in `docs/notes/`

- **Evidence:** `docs/notes/` is defined in the map as "working
  material, **not authoritative**," yet it holds four dated,
  research-shaped documents: `CHARACTER_RIGGING_2026.md`,
  `UNITY_ANIMATION_2026.md`, `3D_MODELS_8GB_VRAM.md`,
  `GPU_UTILIZATION_RESEARCH.md`.
- **Verified nuance:** at least one is correctly a note —
  `CHARACTER_RIGGING_2026.md` is a status & decision record whose
  full research already lives in the library
  (`character-driven-visualization-research.md`), and it says so in
  its own header. The library also already holds
  `video-generation-vram-2026.md`, so `3D_MODELS_8GB_VRAM.md` may
  likewise be a working note rather than un-promoted research.
- **Proposal:** review the four **one by one**: promote what is
  genuinely library-grade research (frontmatter tags + index entry +
  tracker entry — the validator enforces all three), leave status
  and decision records in `notes/` where they belong. Do not batch
  this. Effort: S per file.

## Verified NOT misplaced — do not "fix" these

Checked during the survey; each looks anomalous and is deliberate:

- **`docs/knowledge/` as a whole** — a separate app-served doc set
  under decision **D12** (see the `docs/README.md` map). Code cites
  its Gemini packets as implementation specs (e.g.
  `canvas2dModeBudget.ts` cites the canvas2d diagnosis packet;
  `StemMixer.tsx` cites the stem-mixer UX packet). The dated
  `gemini-*` folders are provenance records, not clutter.
- **The knowledge library's JSON data files** (`prompts.json`,
  `music-prompt-presets.json`, `api-registry.json`, etc.) — runtime
  data the backend and the Docs API read from the library by design;
  the library is the app's knowledge base, not a paper archive.
- **The loose root files** `SYSTEM_REQUIREMENTS.md`,
  `TESTING_WORKFLOWS.md`, `ENHANCEMENT_RECOMMENDATIONS.md` — all
  three are listed in `docs/README.md`'s Key Files section.
- **`packages/frontend/public/docs/` copies** of the visual-
  storytelling files — app-served copies, same pattern as D12.
- **`docs/visual-storytelling/*.json`** — analysis/transcript
  artifacts stored beside the storyboards they describe; acceptable
  co-location. Revisit only if the folder grows.

## Sequencing and decisions

1. **No dependencies between items** — execute in any order, each as
   its own commit so a bad move reverts cleanly.
2. **Owner decisions required:** C1 (a vs b), C3 (a vs b), C4
   (which copy is canonical). C2 and C5 are mechanical once started.
3. **Gates:** `python tools/validate-knowledge-tags.py` after C2 and
   after any C5 promotion; the full `tools/run-gates.py` on Windows
   before pushing, per repo practice.
4. **Out of scope:** the wider repo reorganization in
   `docs/notes/REORG_PLAN.md` (2026-09-06) — this plan covers `docs/`
   placement only.

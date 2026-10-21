# The 5-Minute Path — First-Run Flow Draft (O2)

**Status:** Implemented 2026-10-21 — O3 built this path. See
`docs/plans/creative-onboarding-ux-2026-10.md` (O3) for what shipped and
what was deferred.
**Plan:** `docs/plans/creative-onboarding-ux-2026-10.md` (Priority 3, O2)
**Evidence:** `docs/knowledge-library/creative-onboarding-patterns-2026.md`
(O1 teardowns — CapCut / DaVinci Resolve / Runway)
**Constitution:** design-philosophy principles 1 (stage leads), 3 (every
async state is designed), 6 (keyboard on the stage), 7 (less, but better).

> A new user with one track should reach a rendered clip in ≤5 minutes,
> making **zero** settings decisions. Today they land on a Dashboard in
> front of 24 routes. This draft is the beginner room (O1 pattern 2):
> a dedicated surface with less in it — not a tour, not an overlay.

---

## Entry, exit, and the one recommendation O3 needs

**Recommended shape: Option A — a dedicated `/onboarding` route.**

- **First run, empty library** → the app opens on `/onboarding`
  (the path *is* the empty state, O1 pattern 4 / R4).
- **First run, library not empty** (existing installs) → no hijack: a
  one-time Dashboard banner offers the path instead.
- **Always reachable afterwards** as a **Quick start** nav item.
- **Exit** is always visible ("Show the full studio"). Exiting asks
  nothing; a small "Don't offer this again" on the exit sets the flag.
- **Completion or dismissal** sets `nma.firstRunDone` (localStorage);
  the flag is the only state the path owns.
- Options B (modal on first upload) and C (dashboard simplify toggle)
  are rejected in O1 terms: a modal fights the stage (constitution 1),
  and a toggle is a setting — the path's whole point is no settings.

## Flow

```
 ┌─────────┐   ┌──────────────┐   ┌───────────────┐   ┌──────────┐
 │ 1. ADD  │──▶│ 2. ANALYZE   │──▶│ 3. YOUR LOOK  │──▶│ 4. WATCH │
 │  TRACK  │   │ (automatic)  │   │ (suggested)   │   │ (preview)│
 └─────────┘   └──────────────┘   └───────────────┘   └────┬─────┘
                                                           │
 ┌─────────┐   ┌──────────────┐                            │
 │ 6. DONE │◀──│ 5. RENDER    │◀───────────────────────────┘
 │ (plays) │   │ 10 s clip    │      one button: "Make my clip"
 └─────────┘   └──────────────┘
```

Linear, no branches. The only interruptions allowed are failure
prompts that carry their own fix (O1 pattern 3).

## Time budget (the 5 minutes, accounted)

| Step | Budget | Basis |
| --- | --- | --- |
| 1. Add track | ~10 s | User picks/drops a file |
| 2. Analyze | 5–90 s | Fast beat backend (sonara) is ~0.2 s of beat work on a 157 s track per `audio_analyzer.py`; full librosa analysis is measured in that same note at ~80 s — the fallback case sets the budget, staged progress covers it |
| 3. Your look | ~10 s | Reading one suggestion, one click |
| 4. Watch | 15–30 s | User-paced; the clip's source window is 10 s |
| 5. Render | ≤60 s | **Budget target for O3 to measure**, not a measurement — 10 s clip via the existing render pipeline |
| 6. Done | — | Plays immediately |
| **Total** | **≤ ~3 min typical, ≤5 worst case** | |

## The steps

### 1. Add track

```
┌──────────────────────────────────────────────────┐
│                                                  │
│            Drop a track, get a video.            │
│                                                  │
│        ┌────────────────────────────┐            │
│        │   ⬆  Drop audio here       │            │
│        │      or [ Choose a track ] │            │
│        └────────────────────────────┘            │
│     …or pick one already in your library ▾       │
│                                                  │
│              Show the full studio →              │
└──────────────────────────────────────────────────┘
```

- **User does:** drop a file, browse, or pick from the library.
- **System does:** accepts and moves on. No project name, no settings.
- **Exists today:** upload + library (D16 store). The unified drop
  surface is new in O3.

### 2. Analyze (automatic)

```
┌──────────────────────────────────────────────────┐
│  Midnight Run — SunoV6Mini.m4a                   │
│                                                  │
│  ● Listening…        ✓ Finding the beat…         │
│  ◌ Reading the energy…                           │
│                                                  │
│  [progress bar, named stages — never a spinner]  │
└──────────────────────────────────────────────────┘
```

- **User does:** nothing. Analysis starts on selection — this
  generalizes the auto-analyze that today only happens via the
  Media Library `?file=` preselection; the manual Analyze button is
  not on the path.
- **System does:** full analysis; the result's Q4 suggested
  visualization + confidence feeds step 3. Fast beat backend preferred
  (see budget). Failure → one prompt with the fix attached ("This
  file couldn't be read — try a WAV or MP3" + Choose another).
- **Copy rule:** stages are named after §19's staged-progress
  contract — *Listening… / Finding the beat… / Reading the energy…* —
  never a bare percentage.

### 3. Your look (one suggestion, pre-accepted)

```
┌──────────────────────────────────────────────────┐
│  ┌──────────────────────────────┐                │
│  │      [ style preview ]       │  PULSE GRID    │
│  │                              │  High-energy   │
│  └──────────────────────────────┘  track, 126 BPM │
│                                                  │
│  We picked this look for your track.             │
│  You can change it later in the Visualizer.      │
│                                                  │
│                    [ Looks good → ]              │
└──────────────────────────────────────────────────┘
```

- **User does:** one click. There is no style picker on the path
  (O1 R1) — Q4's suggestion is *the* look; confidence is rendered as
  the plain-language reason ("High-energy track"), never as a number.
- **System does:** locks the suggested mode as the preview/render
  visual.
- **Exists today:** the suggestion itself (analysis API: suggested
  visualization + confidence). The pre-accepted presentation is new.

### 4. Watch (preview)

```
┌──────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────┐    │
│  │                                          │    │
│  │         [ visual playing,               │    │
│  │           stage fills the screen ]       │    │
│  │                                          │    │
│  └──────────────────────────────────────────┘    │
│   ▶/⏸ (space)        [ Make my clip → ]         │
└──────────────────────────────────────────────────┘
```

- **User does:** watches the track play with the look applied; the
  stage is the hero (constitution 1), transport is play/pause only
  (spacebar, constitution 6).
- **The button** is the render decision — the only one on the path.
- **Exists today:** the visualizer stage and playback. The stripped
  transport + single CTA framing is new.

### 5. Render (one button already pressed)

- Fixed spec, nothing to choose: **10 seconds, the highest-energy
  window of the track** (the analysis already knows where it is), the
  step-3 look, platform-default encoding. Copy before pressing: the
  button says exactly what happens — **"Make my clip"**; on the
  preview, a caption: *"We'll clip the biggest 10 seconds."*
- Progress is staged like step 2: *Rendering frames… / Mixing the
  audio… / Finishing…*
- **Exists today:** the render pipeline (wizard/Remotion). The fixed
  10 s highest-energy spec is new.

### 6. Done (success is a place)

```
┌──────────────────────────────────────────────────┐
│  Your first clip is ready.                       │
│  ┌──────────────────────────────────────────┐    │
│  │      [ clip playing on loop ]            │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  [ Save to library ]  [ Open in Visualizer ]     │
│  [ Make another ]                                │
└──────────────────────────────────────────────────┘
```

- The clip **plays in place** — the output is the celebration
  (O1 pattern 6); no confetti, no modal, no toast.
- Three next actions, in that order: keep it, go deeper (this is the
  door into the full studio — where styles *can* be changed), or run
  the path again with another track.
- Sets `nma.firstRunDone`.

## Copy guidelines

| Moment | Copy | Rule |
| --- | --- | --- |
| Path headline | "Drop a track, get a video." | States the whole bargain in one line |
| Primary buttons | "Choose a track" / "Looks good" / "Make my clip" / "Save to library" | Verb + object; no "Submit", "Proceed", "Render…" |
| Progress | Named stages (Listening… / Finding the beat… / Rendering frames…) | §19 contract; never bare % or spinners |
| Suggestion reason | "High-energy track, 126 BPM" | Plain-language cause; confidence stays a number only in the full analysis page |
| Clip caption | "We'll clip the biggest 10 seconds." | The one spec the user hears about, before pressing |
| Success | "Your first clip is ready." | Then silence — the clip talks |
| Failure | What happened + the fix + one button | O1 pattern 3; e.g. "That file couldn't be read." [Choose another track] |
| Exit | "Show the full studio" | Always visible, never guilt-tripped |

## Hidden in first-run mode (explicit list)

Everything below exists in the studio and is **absent from the path**
— hidden, not disabled (O1 pattern 5):

- Mastering (MasteringPanel, targets, QC) and all audio enhancement
- Stem separation and the stem mixer; remix tools
- Custom presets, FX controls, kinetic presets, theme seeds
- The suggested-visualization *alternatives* (mode picker)
- Music-video wizard advanced options (lip-sync, per-section edits)
- Storyboards, Three.js Studio, HyperFrames, Generate 3D, AI Tools
- Queue, Logs/Log Analytics, Health, GPU, Database, Data Management,
  Settings — and the nav that leads to them
- Analysis details (waveform features, key/chroma readouts, per-stem
  curves) — the path shows only the step-3 reason line

## Exists today vs new in O3

| Piece | Status |
| --- | --- |
| Upload / library pick | Exists (D16 audio library store) |
| Auto-analysis on selection | Partial — only via `?file=` preselection today; generalize in O3 |
| Suggested visual + reason | Exists (Q4 suggestion in the analysis result) |
| Stage preview + playback | Exists (Visualizer) |
| Fixed 10 s highest-energy render | New — spec above; pipeline exists |
| First-run detection + flag | New — no onboarding/first-run code exists in the frontend today (grep-verified 2026-10-21) |
| `/onboarding` surface + Quick start entry | New |
| Staged progress labels | Partial — §19 contract is documented; path copy specified here |

## Decisions for the owner (O3 waits on these)

1. **Route shape:** Option A as recommended, or B/C from the plan?
2. **Clip window:** highest-energy 10 s (recommended — analysis data
   already supports it) vs first 10 s vs user-scrubbed later?
3. **Demo track:** ship one bundled sample track so a first success
   doesn't require having a file ready (Runway's demo-asset pattern)?
   Local-first makes this cheap; it is also one more asset to maintain.
4. **Quick start placement:** sidebar item vs Dashboard card (P1
   stage-first dashboard work may subsume this — sequence with P1).

## Out of scope for O3 (per plan)

Tooltip tours; account/cloud anything; changes to the full studio's
own screens (O4's IA audit covers those); backend changes.

# Creative Tool Onboarding & First-Run UX Plan — Oct 2026

**Status:** Proposed 2026-10-19 — awaiting owner review
**Decides:** none (addresses research gaps §17–18 from `app-research-gaps-2026.md`)
**Owner:** repo owner (implementation: local coding agent)
**Source research:** [[app-research-gaps-2026]] §17–18, [[design-philosophy-2026]], UX audit report

> Read `docs/architecture/decision-log.md` before implementing. New UX work follows
> the P1–P6 principles from `design-philosophy-2026.md`. Do not touch
> `unity-visualizer/` (protected).

---

## Problem

The app's onboarding experience is unstructured for creative users:

1. **No first-run path** — A new user with one uploaded track faces the full dashboard with no guided "get to your first output" flow. The studio has no empty states or progressive disclosure.
2. **No job-to-be-done mapping** — Information architecture (IA) has grown organically over a year with no review. The app may be serving 6+ jobs through one navigation surface, creating friction.
3. **No onboarding patterns research** — The knowledge library has no research on how successful creative tools (CapCut, DaVinci, Resolve) onboard users without tutorial hell.

Research gaps §17 flags this as **Research Now** (highest priority). This plan establishes the 5-minute path and audits the IA before building more features.

---

## Feature specs

### O1 — Research pass: creative tool onboarding patterns

Before building, benchmark 3 leading creative tools to extract patterns:

**Methodology:**
1. Record the first 5 minutes of CapCut (mobile), DaVinci Resolve (desktop), and one AI video tool (e.g., Runway or Pika).
2. Extract for each:
   - Time-to-first-output (how many seconds/minutes before the user sees a result)
   - Number of decisions forced before first output (file import, template selection, settings)
   - Disclosure patterns (progressive disclosure vs all-at-once vs guided tour)
   - Empty-state handling (what shows when no project exists)
   - First-success reinforcement (how the tool celebrates the first export)

**Deliverable:** A research markdown file `docs/knowledge-library/creative-onboarding-patterns-2026.md` with:
- Comparative table of the 3 tools across the 5 dimensions above
- Pattern catalog (e.g., "template-first" vs "blank-canvas-first", "guided export" vs "settings-first")
- Recommendations for the studio's 5-minute path (see O2)

**Acceptance:**
- Document added to knowledge library with proper frontmatter (tags, date)
- Table captures concrete measurements (e.g., "CapCut: 45s to first export, 3 decisions")
- Recommendations are actionable (e.g., "Use template-first: offer 3 starter templates on upload")

**Files:**
- `docs/knowledge-library/creative-onboarding-patterns-2026.md` (new)
- Update `docs/knowledge-library/index.md` to link the new article

---

### O2 — Draft the studio's 5-minute path

Based on O1's recommendations, design a linear path that gets a new user from upload to rendered output in ≤5 minutes:

**Proposed path (subject to O1 findings):**
1. **Upload** — Drop audio file or drag from library
2. **Auto-analysis** — Runs automatically (no button press), shows progress bar
3. **One suggested visual** — Auto-selects a viz style based on track energy/genre (Q4 already does this auto-selection)
4. **Preview** — Auto-plays the track with the selected visual
5. **Render** — One "Export 10s clip" button, no settings exposed
6. **Success** — Shows the rendered MP4 with a "Save to library" + "Share" action

**UX constraints:**
- One page flow (no navigation between steps)
- No advanced settings exposed (mastering, stem separation, custom presets hidden)
- Progress is visible at every step (analysis, rendering)
- First export celebrates (confetti or clear success message)

**Deliverable:** A wireframe/flow markdown file `docs/ux/5-minute-path.md` with:
- Step-by-step flow diagram
- Screen mockups for each step (text descriptions or ASCII art)
- Copy guidelines (button labels, help text, success messages)
- List of features to hide in first-run mode (mastering, stem mixer, custom FX)

**Acceptance:**
- Document added to `docs/ux/` (new directory if it doesn't exist)
- Flow is linear with no branches
- Mockups describe the UI for each step
- Hidden features are listed explicitly

**Files:**
- `docs/ux/5-minute-path.md` (new)
- Update `docs/README.md` to include `ux/` in the directory map

---

### O3 — Implement the 5-minute path (frontend)

Build the onboarding flow as a new page or modal:

**Implementation options (to be decided by O1 findings):**
- Option A: Dedicated `/onboarding` route that shows for first-time users (detected via localStorage)
- Option B: Inline modal that appears on first track upload
- Option C: "Quick start" mode toggle that simplifies the dashboard

**Core components:**
- `OnboardingFlow.tsx` — orchestrates the 5 steps (upload → analysis → visual → preview → render → success)
- `FirstRunDetector.ts` — hook that checks if this is the user's first session (localStorage flag)
- `QuickExportButton.tsx` — simplified export button (no settings, fixed 10s clip)
- `SuccessCard.tsx` — celebrates first export with download + share actions

**Acceptance:**
- First-time users see the onboarding flow automatically
- Flow completes in ≤5 minutes on a typical track (measured)
- Exported MP4 is valid (ffprobe check)
- Success state celebrates the output
- Subsequent visits go to the normal dashboard (onboarding skipped unless user opts in again)
- Unit tests for the flow state machine
- Playwright test that drives the full flow end-to-end

**Files:**
- Frontend: `OnboardingFlow.tsx`, `FirstRunDetector.ts`, `QuickExportButton.tsx`, `SuccessCard.tsx`
- Routing: Add `/onboarding` route if using Option A
- Tests: `OnboardingFlow.spec.ts` (Playwright), unit tests for state machine

**Status: Done (2026-10-21).** Option A shipped.

- `features/onboarding/onboardingState.ts` — the rules, pure and unit-tested:
  the six steps, the transitions (illegal ones are no-ops), the
  highest-energy 10 s window picker, and the plain-language suggestion
  reason. 20 unit tests in `onboardingState.test.ts`.
- `features/onboarding/FirstRunDetector.ts` — the `nma.firstRunDone`
  localStorage flag, guarded for private-mode browsers.
- `features/onboarding/OnboardingFlow.tsx` — the six steps. Analysis starts
  automatically on selection; the suggested look is pre-accepted with its
  reason shown; the render is one button with a fixed 10 s spec.
- `features/onboarding/QuickExportButton.tsx` / `SuccessCard.tsx` — the
  single CTA and the in-place celebration.
- `features/onboarding/OnboardingPage.tsx` — the `/onboarding` route plus
  `FirstRunGate`, which sends a first-time user with an empty library to
  the path (no hijack for existing installs).
- Wired in `App.tsx` (route + title), `Sidebar.tsx` ("Quick start" nav
  item), and `Dashboard.tsx` (one-time banner for existing installs).
- `tests/onboarding-flow.spec.ts` — 6 Playwright tests: the path is
  reachable, exit lands on the studio, an empty library redirects a
  first-time user, a returning user is not redirected, a failure carries
  its own fix, and the full path renders a valid MP4.

**Measured:** the full path — upload → analyse → look → watch → render →
success — completes in **8.9 s** on the 10 s fixture (analysis cached from
a prior run; the uncached run is bounded by the ~80 s librosa fallback).
The exported file is a valid MP4: h264 1920×1080 + aac, duration exactly
10.000000 s (ffprobe).

**Two bugs the E2E test caught and the implementation fixed:**
1. The upload response's `filename` is the *original* name; the file on
   disk carries a content-hash prefix (`<hash>_name.wav`), and that is
   the name the analysis endpoints expect. Using `filename` made
   `ensure-analysis` 404. Now the basename of `stored_path` is used, as
   `AudioAnalysisPage` already did.
2. `onComplete` navigated to `/`, so the success card — the celebration —
   was never shown; the render had actually succeeded. Completion now sets
   the first-run flag only, and the user leaves the path through the
   success card's own three actions.

**Deferred (per the draft's open questions, still the owner's call):**
- Clip window: highest-energy 10 s implemented (the draft's recommendation).
- Demo track: not shipped — the path needs a file to begin with.
- Quick start placement: a sidebar item plus a Dashboard banner; the
  banner is dismissible and stored in `sessionStorage`.
- The "watch" stage shows the track playing with the look's energy shape
  behind it, not the full shader stack — the path's job is the idea, not
  the visualizer.

---

### O4 — Information architecture audit

Map every top-level screen to its job-to-be-done:

**Methodology:**
1. List every top-level screen (route) in the app: `/dashboard`, `/library`, `/audio-analysis`, `/visualizer`, `/three-js-studio`, `/storyboards`, `/queue`, `/logs`, `/settings`, etc.
2. For each screen, identify the primary job-to-be-done (JTBD):
   - What problem is the user trying to solve when they visit this screen?
   - What outcome do they expect?
3. Flag screens serving 2+ jobs as merge/split candidates (e.g., does `/dashboard` serve both monitoring and project management?)
4. Identify orphaned capabilities (features with no clear home in the navigation)

**Deliverable:** A markdown file `docs/ux/ia-audit-2026.md` with:
- Table: screen → JTBD → outcome
- List of merge/split candidates with rationale
- List of orphaned capabilities
- Recommended IA changes (if any)

**Acceptance:**
- Every top-level route is accounted for
- JTBDs are specific (not "manage audio" but "upload and analyze tracks")
- Merge/split candidates have clear rationale (e.g., "screen X does both A and B, conflicting UX patterns")
- Recommendations are actionable

**Files:**
- `docs/ux/ia-audit-2026.md` (new)

---

## Suggested order

O1 (research) → O2 (draft path) → O4 (IA audit) → O3 (implement path)

Rationale:
- O1 informs O2's design decisions
- O4 runs in parallel with O2 (both are analysis, not code)
- O3 builds last, informed by O1+O2+O4

---

## Non-goals

- Full A/B testing of onboarding flows (out of scope for local-first app)
- Account system or cloud sync (keep local-first)
- Guided tour tooltips (overly complex; prefer a single linear flow)
- Changing core features (this is UX work, not feature changes)

---

## Verification gates

| Gate | Command |
| --- | --- |
| Knowledge docs | `python tools/validate-knowledge-tags.py` (for O1 output) |
| Frontend build | `pnpm build` in `packages/frontend` |
| Onboarding E2E | `pnpm exec playwright test onboarding.spec.ts` (new spec) |
| UX docs review | Manual review of O2 and O4 documents by owner |

---

## Out of scope

- Unity-visualizer (protected per AGENTS.md)
- Backend changes (this is pure frontend/UX work)
- Decision-log reversals
- Q1–Q6 (all resolved)

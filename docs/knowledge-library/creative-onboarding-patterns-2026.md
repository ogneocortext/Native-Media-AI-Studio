---
tags:
  - research
  - design
aliases:
  - Creative Onboarding Patterns 2026
  - First-Run UX Patterns
  - Onboarding Teardowns
cssclasses:
  - research-report
date: 2026-10-21
---

# 🎬 Creative Tool Onboarding Patterns — 2026 Teardowns

> [!info] Purpose
> O1 research pass for the Priority 3 onboarding track
> (`docs/plans/creative-onboarding-ux-2026-10.md`, research gaps §17).
> Benchmarks the first-run experience of three leading creative tools —
> CapCut (mobile), DaVinci Resolve (desktop), Runway (AI video) — across
> five dimensions, extracts a pattern catalog, and recommends the shape of
> the studio's 5-minute path (drafted in `docs/ux/5-minute-path.md`, O2).

> [!warning] Methodology — read the numbers with this attached
> Desk research, 2026-10-21, from vendor documentation and published
> first-run walkthroughs (sources at the end). The plan's preferred
> method — stopwatch recordings of the first 5 minutes — was **not**
> performed in this pass, so no figure here is a local measurement.
> Every number is labelled: **reported** (a source states it),
> **counted** (decisions enumerated from the documented flow), or
> **estimated** (reasoned from the flow; treat as ±50%). The patterns and
> the recommendations do not depend on the exact timings.

---

## The three first runs

### CapCut (mobile) — template-first

The home screen is a template gallery with one dominant **New project**
button. No account is required to start editing. Two paths to a first
output:

- **Template path:** pick a trending template → replace its clips with
  your own → Export. The template makes every creative decision (cuts,
  effects, music sync); the user makes only media choices.
- **Blank path:** New project → select media → land in the editor
  (preview on top, timeline below, tools in a bottom toolbar grouped by
  category) → Export with defaults pre-chosen, resolution picked at
  export time.

| Dimension | Finding |
| --- | --- |
| Time-to-first-output | **Estimated** <1 min via template; ~2–5 min blank path for a short clip |
| Decisions before first output | **Counted:** 2 (template, clips) or 2–3 blank (project, media, export confirm) |
| Disclosure | Template-first; editing tools progressive by toolbar category |
| Empty state | None exists — the home screen *is* content (templates), so there is no dead first screen |
| First-success reinforcement | Export completes straight into a share sheet + "saved to album" — the success surface is the next action (post/share), not a dialog |

### DaVinci Resolve (desktop) — the pro tool with a beginner room

First launch opens a welcome/quick-tour offer, then the **Project
Manager** (project list + New Project). Creating a project drops the
user into a seven-page workspace — Media, Cut, Edit, Fusion, Color,
Fairlight, Deliver — **all visible at once** along the bottom. Beginner
guidance for Resolve is dominated by one piece of advice: ignore most
pages; learn Edit + Deliver first.

Three first-run details matter for us:

1. **Settings are forced early.** Tutorials uniformly instruct new users
   to open Project Settings and set timeline frame rate/resolution
   before editing. Resolve softens one case well: importing media whose
   frame rate mismatches the project triggers a single, well-timed
   prompt offering to change the project to match — *ask only when it
   matters, with the fix attached*.
2. **The Cut page is the real onboarding.** A deliberately simplified
   assembly surface inside the pro tool — fast trimming, big targets,
   few decisions. Resolve's answer to beginner overload is not a tour;
   it is a *place* with less in it.
3. **Quick Export collapses the last mile.** One dialog, platform
   presets (YouTube, Vimeo, H.264), no Deliver-page settings wall for a
   first render.

| Dimension | Finding |
| --- | --- |
| Time-to-first-output | **Estimated** 15–30+ min for a true beginner; setup decisions dominate, editing is the small part |
| Decisions before first output | **Counted:** 5+ (project name, frame rate, resolution, page navigation, export preset) before any creative payoff |
| Disclosure | All-at-once (7 pages), mitigated by the Cut page as a simplified surface |
| Empty state | Project Manager — a functional list, not a guide; nothing points at a first success |
| First-success reinforcement | Render queue completion; Quick Export presets remove the settings decision but nothing celebrates or suggests a next step |

### Runway (AI video, web) — generation-first, dashboard-heavy

Sign-up (Google/email, no card) grants **125 one-time free credits**
(reported). The new user lands on a dashboard presenting the full tool
catalog at once — the documented beginner advice is literally "start
with one of these three," because the surface itself doesn't choose.
On the free plan the route is narrower than it looks: image-to-video
(Gen-4 Turbo) only, so the first run is upload/generate a still →
describe the motion → Generate → **30–90 s** render (reported) → the
clip is auto-saved to Assets with Download and variation/edit actions
attached. A 5 s clip spends 25 of the 125 credits (reported) — the
first success is deliberately cheap, the second is already a budget
decision.

| Dimension | Finding |
| --- | --- |
| Time-to-first-output | **Estimated** 2–4 min including sign-up; the generation wait (30–90 s, reported) is most of it |
| Decisions before first output | **Counted:** 4 (tool choice from the full catalog, starting image, prompt, duration) |
| Disclosure | All-at-once dashboard; *inside* a tool, settings hide behind collapsed "Advanced options" — progressive disclosure one level down |
| Empty state | Demo assets are provided, so a first run never starts from nothing |
| First-success reinforcement | Output auto-saved to the library; the result surface offers the next actions (download, variations, edit) rather than returning to a blank dashboard |

---

## Comparative table

| Dimension | CapCut | DaVinci Resolve | Runway |
| --- | --- | --- | --- |
| Time-to-first-output | <1 min (template, est.) | 15–30+ min (est.) | 2–4 min (est.) |
| Decisions forced first | 2–3 | 5+ | 4 |
| Disclosure pattern | Template-first, progressive tools | All-at-once + simplified Cut page | All-at-once dashboard, progressive inside tools |
| Empty-state handling | Gallery as home (no empty state) | Project list (functional, unguided) | Demo assets provided |
| First-success surface | Share sheet + saved file | Render completes, no next step | Saved asset + next actions |
| Beginner strategy | Decide *for* the user (templates) | A room with less in it (Cut page) | Free credits + narrow free route |

The spread is the finding: time-to-first-output tracks **decisions
forced**, not feature count. CapCut is not simpler software than
Resolve — it front-loads fewer choices.

## Pattern catalog

1. **Template-first vs blank-canvas-first.** Offer a pre-made decision
   set the user can accept wholesale (CapCut templates). The studio's
   equivalent already exists as data: Q4's suggested visualization +
   confidence in the analysis result. One suggestion, pre-accepted,
   beats a gallery of modes.
2. **Beginner mode as a place, not a tour.** Resolve's Cut page and
   CapCut's home both give the first run its own surface with less in
   it. Resolve's first-launch tour is the counter-example — beginner
   guides have to urge users not to skip it, which means they do.
   (The onboarding plan already lists tooltip tours as a non-goal;
   this is the evidence for that call.)
3. **Defaults decide; ask only on mismatch.** CapCut pre-chooses export
   settings; Resolve asks exactly one question, at the moment imported
   media contradicts the project, with the correction attached. Every
   other question is postponed past the first success.
4. **No dead empty states.** CapCut's home is a gallery; Runway ships
   demo assets. The first screen should be the path itself, not a
   dashboard waiting for content.
5. **Progressive disclosure one level down.** The full tool can stay
   one click away (Runway's collapsed Advanced options) — hidden, not
   removed. First-run mode hides; it does not disable.
6. **The first success is a surface, not a toast.** Export lands on
   share/next actions (CapCut), or a saved asset with variations
   (Runway). Resolve is the negative example: the render finishes and
   nothing happens next.
7. **Make the first success cheap.** Runway prices it at 25 of 125
   credits; CapCut templates cost nothing. The studio's equivalent: a
   fixed 10-second clip, not a full-track render, as the first export.

## Recommendations for the studio's 5-minute path

Drafted in full in `docs/ux/5-minute-path.md` (O2). The load-bearing
ones:

- **R1 — One suggested visual, pre-accepted** (pattern 1). The path
  shows Q4's suggestion as *the* visual; swapping it is possible only
  after the first success, from the full visualizer.
- **R2 — A dedicated first-run surface** (pattern 2), entered
  automatically on first run and always reachable afterwards as
  "Quick start." Not an overlay, not a tour.
- **R3 — Zero settings on the path** (patterns 3, 7). Analysis runs
  automatically on upload; export is one button producing a fixed
  10 s clip. The single permitted interruption is a mismatch/failure
  prompt that carries its own fix.
- **R4 — The path is the empty state** (pattern 4). With no tracks in
  the library, the app opens on the path's first step, not on the
  24-route dashboard.
- **R5 — Success is a place** (pattern 6). The rendered clip plays in
  place with Save to library / Open in visualizer / Make another as
  the three next actions.
- **R6 — Designed progress, per the constitution** (§3: every async
  state is designed; §19's staged-progress contract). Analysis and
  render show named stages. This is a real budget item, not polish:
  this codebase's own comments measure full-track librosa analysis at
  ~80 s on a 157 s track (`audio_analyzer.py`, sonara fast-path note),
  so the path must either use a fast beat backend or make the wait
  legible — an unexplained 80 s spinner reads as a crash (§19).

## Sources

- CapCut first-project and template flows — beginner guides at
  aikdesigns.com, miracamp.com, freevisuals.net, unifab.ai (accessed
  2026-10-21): New Project → media select → editor → export; templates
  as the beginner on-ramp; no account required to edit.
- DaVinci Resolve first-run — violetflare.ai workflow guide,
  cnu.libguides.com, manojnair.online Resolve 20 tutorial, uppbeat.io,
  movavi.com (accessed 2026-10-21): Project Manager, seven pages,
  project-settings-first advice, welcome tutorial, Cut page as the
  fast-assembly surface, Quick Export presets.
- Runway first-run — aialleyway.com hands-on walkthrough, gapoz.com
  Wrench Report (pricing checked 2026-10-14), anygen.io pricing guide
  (accessed 2026-10-21): 125 one-time free credits, free tier =
  image-to-video, 25 credits per 5 s clip, 30–90 s generation,
  dashboard of all tools, demo assets, outputs saved to Assets.
- Studio grounding — `packages/frontend/src/App.tsx` (24 top-level
  routes, Dashboard at `/`), `AudioAnalysisPage.tsx` (analysis is a
  manual button except via the `?file=` preselection auto-analyze),
  `app/api/audio_analysis.py` (Q4 suggested visualization + confidence),
  `app/services/audio_analyzer.py` (analysis timing notes).

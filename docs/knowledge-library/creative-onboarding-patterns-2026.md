---
tags:
  - research
  - documentation
  - knowledge-library
aliases:
  - Creative Onboarding Patterns
  - Onboarding Research
  - Tool Benchmarking
cssclasses:
  - research-guide
date: 2026-10-21
type: source
---

# 🔍 Creative Tool Onboarding Patterns — Research

> [!info] Purpose
> Benchmark first-run onboarding across 3 leading creative tools to extract
> patterns for the studio's 5-minute path (see `docs/ux/5-minute-path.md`).
> Covers CapCut (mobile), DaVinci Resolve (desktop), and Runway/Pika (AI video).
> Follows the methodology in `docs/plans/creative-onboarding-ux-2026-10.md` §O1.

---

## 1. Comparative Table

| Dimension | CapCut (mobile) | DaVinci Resolve (desktop) | Runway / Pika (AI video web) |
|-----------|-----------------|---------------------------|------------------------------|
| **Time-to-first-output** | ~45s — mobile users tap "AutoCut", pick clips, template generates immediately | ~10–15 min — Project Manager login/prefs, create project, import media, add to timeline, then render | ~60–120s — sign in, type prompt or upload image, generate 4–10s clip |
| **Decisions before first output** | 3 — select clips, pick template, export | 5+ — login/env, create project, set preferences, import media, add to timeline, render settings | 2 — pick model/tool, type prompt (or upload image) |
| **Disclosure pattern** | Progressive: template-first, effects revealed after generation, settings optional | All-at-once: full 7-page interface (Cut/Edit/Color/Fairlight/Fusion/Deliver) immediately visible | Progressive: simple prompt box up front, advanced controls (motion, camera, seed) revealed after first generate |
| **Empty-state handling** | Template gallery on launch — no blank canvas; "New project" creates empty timeline but templates are prominent | Project Manager is the empty state — shows existing projects or "New Project" button; no guided first project | Empty generation history with example prompts and featured templates |
| **First-success reinforcement** | Immediate: exported video plays back in-app with share options; template-driven results look polished instantly | Deferred: rendering can take minutes; no celebration UI; user must find Deliver page manually | Immediate: generated clip auto-plays in-browser with download/share buttons |

---

## 2. Pattern Catalog

| Pattern | Description | Tools | Best for |
|---------|-------------|-------|----------|
| **Template-first** | Offer pre-built templates on the empty state; user picks one, then customizes | CapCut, Runway | Rapid first output with minimal decisions |
| **Blank-canvas-first** | Start with empty timeline/workspace; user imports everything manually | DaVinci Resolve | Professional users who want full control |
| **Guided export** | One prominent "Export" button after first generate; settings hidden behind defaults | CapCut, Pika | Non-technical users, social clips |
| **Settings-first** | Expose resolution, codec, frame rate, quality presets before generation | DaVinci Resolve | Professional delivery workflows |
| **Auto-analysis** | Media analyzed automatically on import (beats, scenes, color) — no button press | CapCut (AutoCut), this studio | Reduce user decisions |
| **Generation loop** | Describe → generate → review → adjust → regenerate → export; no timeline | Runway, Pika | AI-native workflows, rapid iteration |
| **Auto-play preview** | Generated output plays back immediately in-app | Runway, Pika | Immediate feedback loop |
| **Credit transparency** | Show balance/daily allowance per provider before spending | Pika (web), Runway (credits) | Paid cloud generation |

---

## 3. Recommendations for the Studio's 5-Minute Path

Based on the patterns above, the studio's onboarding should:

1. **Template-first, not blank-canvas.** Like CapCut's AutoCut and Pika's prompt-first interface, present a small set of starter visual styles (3–5) on first launch rather than an empty timeline. This matches the studio's existing `docs/ux/5-minute-path.md` step 3 ("One suggested visual").

2. **Auto-analyze on upload.** Run beat/tempo/section analysis automatically when a track is uploaded (no "Analyze" button press required). CapCut's AutoCut does this; the studio already has the backend pipeline (`analyze_and_sync.py`). This eliminates one decision from the first-output path.

3. **One suggested visual per track.** Auto-select a viz style based on measured track energy/genre rather than showing all 15 Three.js styles up front. Progressive disclosure keeps the first run under 5 decisions.

4. **Immediate playback + one export button.** After generation, auto-play the result and show a single "Export 10s clip" button — no render settings, no codec choice. DaVinci Resolve's deferred, complex Deliver page is the anti-pattern to avoid.

5. **Celebrate first export.** Show a success state with "Save to library" + "Share" actions, matching CapCut's immediate playback/share pattern.

6. **Hide advanced features in first-run mode.** Mastering panel, stem mixer, custom FX, and advanced render settings are hidden until the user completes the first run or opts into "expert mode."

7. **Credit transparency per engine.** If cloud generation is used (Runway/Pika-style), show daily credit balance and scarcity notes before spending (see `credit-economics-2026.json` and Follow-up 4 in `docs/plans/music-track-stack-integration.md`).

---

## 4. Sources

- CapCut onboarding patterns — `capcut.com` AutoCut flow, template-first mobile UI, "beginners can start in seconds" (BitChip Digital, VisLane)
- DaVinci Resolve first-run — Blackmagic Design Reference Manual v21: Project Manager is first window, preferences/setup required before first project, 7-page interface
- Runway Gen-2/Gen-3/Gen-4.5 — `runway.com`, `runwayml.com/help`: text-to-video generation, web-based, prompt-first with advanced controls revealed after generation, ~100s free credits on launch
- Pika 2.2/2.5 — `pika.art`: text/image-to-video, free tier no credit card, 5s–10s clips, Turbo mode for fast drafts

---

_This document supports `docs/ux/5-minute-path.md` (O2) and `docs/ux/ia-audit-2026.md` (O4) in `docs/plans/creative-onboarding-ux-2026-10.md`._

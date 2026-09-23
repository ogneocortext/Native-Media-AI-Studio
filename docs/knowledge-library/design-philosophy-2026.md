---
tags:
  - design
  - ux
  - philosophy
  - design-system
aliases:
  - Design Philosophy
  - UX Principles
cssclasses:
  - analysis
  - research
date: 2026-09-23
---

# 🎛️ Design Philosophy — Native Media AI Studio

**Thesis: the studio is an instrument, not a dashboard.**

A dashboard reports. An instrument is *played*. Every UX decision should
make the app feel closer to an OP-1 or Ableton Live and further from a SaaS
admin panel. The visualizer's blue→pink sweep already has this confidence;
the chrome around it should catch up.

## The schools we steal from

### Dieter Rams — "less, but better"
The 10 principles, translated to software: innovative, useful, aesthetic,
*understandable*, *unobtrusive*, **honest**, long-lasting, thorough to the
last detail, as little design as possible. "Honest" is the load-bearing one
for us: show real render state, never fake progress; a queued ComfyUI job
says "queued behind 3 jobs", not a spinner that implies work is happening.
"Unobtrusive" means the chrome never competes with the stage.

### Teenage Engineering — playful professionalism
A pro tool disguised as an invitation to play. Three takeaways:
- **Limitation as liberation:** 3–5 primary actions per screen max. Depth
  through navigation, not density.
- **Color as function:** one accent per screen, mapped to meaning. The user
  learns the vocabulary (blue = interactive, pink = creation energy,
  red = destructive-only).
- **Satisfying feedback:** every action answers physically — press states,
  transitions, the mode-crossfade we already have.

### Ableton Live — the tool disappears
One window, no floating-window management, no hidden menus. Muted palette
with *selective* emphasis: nearly everything gray-on-gray, color reserved
for user content and state (playing, recording, armed). Functional
minimalism — every pixel serves a purpose. High density achieved through
spatial memory and small, precise text, not through cramming.

### Linear — speed as a feature
Keyboard-first, instant-feeling, restrained. Motion feels alive but never
decorates. Information density without clutter.

### Don Norman — close the gulfs
The gulf of execution (can I figure out what to do?) and the gulf of
evaluation (did it work? what happened?). Every action gets feedback; every
system state is legible. The tuned-visual-profile toast ("applied profile
X") is already this — do more of it.

### Nothing / industrial minimalism — expose the data
Numbers and states ARE the visual. Queue depth, GPU/VRAM, render progress,
beat/BPM readouts — don't hide the machine behind illustrations. Dot-grids,
monospaced readouts, visible structure.

## Diagnosis: why it feels "flat and poorly planned"

Honest accounting of the current UI (24 routes, grouped nav already exists
and is good — Home / Create / Generate / Manage / System):

1. **No signature in the chrome.** The visualizer has a strong identity;
   the surrounding app is generic dark SaaS. Nothing in the panels has the
   confidence of the shader sweep.
2. **Rotating-agent inconsistency.** 24 features built across sessions means
   spacing, empty states, and loading patterns drift per page. "Poorly
   planned" is usually inconsistency, not ugliness.
3. **States aren't designed.** Loading / empty / error are where planning
   shows. A blank panel with a spinner is the flat feeling.
4. **Chrome competes with the stage.** Supporting UI should attenuate so the
   work surface leads ("don't compete for attention you haven't earned").

## The studio's design constitution

1. **The stage leads; chrome recedes.** The visualizer/preview surface is
   the hero. Panels, sidebars, and headers are quiet scaffolding.
2. **One accent per screen; color is function.** Never decorate with hue.
3. **Every async state is designed.** Empty teaches, loading is honest,
   error offers a next action.
4. **Motion explains; never decorates.** Transitions narrate state changes
   (the mode crossfade is the template). `prefers-reduced-motion` stays
   respected.
5. **Density with discipline.** 4px grid, tokenized radius, tabular numerals
   for timecodes/counts, small precise text à la Ableton.
6. **Instruments are played.** Keyboard-first on the stage: spacebar
   play/pause, arrows switch modes.
7. **Less, but better.** If a control doesn't earn its place, it goes.

## Prioritized proposals (NOT approved — pick before implementing)

- **P1 — Stage-first dashboard.** Dashboard leads with the live stage or
  latest render, not a card grid of 24 equal features.
- **P2 — Designed async states.** Empty/loading/error treatments for Queue,
  generation pages, and ComfyUI fallback — honest progress, next actions.
- **P3 — Accent audit.** Map every accent usage to the function vocabulary;
  demote decorative hue.
- **P4 — Stage keyboard map.** Spacebar, arrows, `1–9` for visualizer modes.
- **P5 — Consistency sweep.** One pass aligning spacing/radius/empty-states
  across the 24 features to the token system.
- **P6 — Signature moment.** One unmistakable chrome detail (e.g. the
  sidebar CTA or the queue progress) with the confidence of the shader
  sweep — the thing a screenshot is recognized by.

## Sources

- Dieter Rams, Ten Principles for Good Design (via swiss-miss.com/2007/11/dieter-rams-10.html; Fast Company interview)
- Teenage Engineering design school: github.com/local-over/anti-slop-ui `skills/schools/teenage-engineering.md`; Jesper Kouthoofd interview (thoughteconomics.com)
- Ableton Live 12 UI/UX analysis: github.com/info-tronic-art/audio-dna `design/ux_analyses/Ableton_Live_12_UI_UX_Analysis.md`
- Industrial minimalism / inspiration refs: github.com/catch-the-wave/fullstack-ios-claude-skills
- Nothing design system (transparency, exposed data): github.com/hayatotoyoda/dotfiles `.claude/skills/nothing-design/SKILL.md`
- Dark-mode discipline feeding P3: `dark-ui-color-system-2026.md` (same folder)

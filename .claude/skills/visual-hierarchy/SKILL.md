---
name: visual-hierarchy
description: >-
  Visual hierarchy and stage-chrome ownership for dense screens: zone
  ownership model, glanceable-vs-docked-inspector split, z-index ladders,
  cover-swap-reveal transitions, conditional-layer entrances. Use when a
  UI "feels cluttered", controls overlap or fight for attention, or a
  canvas/stage has too much chrome — distilled from the visualizer
  T-VIZ-42/43/45/46 fixes.
---

# Skill: visual-hierarchy

# Visual Hierarchy & Stage Chrome

> [!warning] "Looks cluttered" is almost never a spacing problem — it's an
> ownership problem. Every pixel of chrome competes for attention; the fix is
> deciding WHO owns each zone, not shrinking everything. This skill covers
> the hierarchy model proven on this repo's visualizer (T-VIZ-42/43/45/46).

## When to Use

- A screen feels crowded, twitchy, or "no sense of hierarchy"
- Multiple floating panels/toolbars overlay the same canvas or content area
- Controls exist in two places (stage + panel) and drift out of sync
- An identity/state swap (track change, mode switch, preset apply) feels
  like whiplash instead of an intentional transition
- Reviewing z-index usage — indexes scattered with no documented ladder

## The Core Model: Zone Ownership

Assign every region of the screen exactly ONE owner. When two elements want
the same zone, one of them moves — you don't shrink both.

| Zone | Owner | Rule |
|------|-------|------|
| Content center | The content itself (canvas, document, data) | Nothing else paints here by default |
| Edge chrome | At most ONE glanceable element per edge/corner | Pick the highest-frequency control; everything else goes to the dock |
| Detail surface | One docked panel (inspector/sidebar) with tabs | ALL detailed/rarely-used controls live here, one tab at a time |
| Passive telemetry | overlay, `pointer-events: none` | Never intercepts clicks; top-left or bottom-left, the corners chrome doesn't use |

### The glanceable ↔ detailed split

- **Glanceable (stage):** controls used every few seconds — play, mode,
  preset picker, primary toggle. Count them: if a user needs more than
  ~5 on the stage, the stage is wrong.
- **Detailed (inspector):** everything else — tuning, per-band controls,
  style pickers, advanced options. One tabbed dock, not floating columns.
- **Duplicate surfaces are bugs waiting to happen.** If a control exists in
  both places, pick the canonical home and delete the other — two copies
  drift (this repo had StylePicker on stage AND needed in inspector;
  ReactivityHUD duplicated the Tuning tab).

### Passive overlays must not eat clicks

Telemetry/stats cards get `pointer-events: none`. Verify with
`document.elementFromPoint(x, y)` in a real browser — a painted element
can still be a click-eater, and the inverse (painted but unreachable)
is worse.

## The Ghost-Layer Trap (verified bug class)

An overlay "open" state that only demotes z-index leaves chrome **painted
but unclickable** — clicks land on the scrim. Two fixes, pick by intent:

- **Should be invisible:** `display: none` / `visibility: hidden` — not
  opacity or z-index. (This repo's Warp button died exactly this way:
  `.viz-shader-hud` sat below the z-150 scrim but stayed painted.)
- **Should stay painted but inert:** keep it under the scrim AND confirm
  `elementFromPoint` returns the scrim — then it's intentional.

CSS cascade trap that made the fix silently fail once: Tailwind
`@layer(utilities)` beats `@layer(components)` regardless of specificity —
a `flex` utility class kept overriding a `display:none` rule in a layered
stylesheet. When a display override "doesn't work," check which layer each
rule lives in before touching specificity.

## Z-Index: Document the Ladder

Scattered z-indexes (10, 25, 30, 40, 100, 150, 160, 200…) with no map is a
regression factory. Write the ladder as a comment at the top of the
stylesheet and keep it truthful:

```
Stage z-index ladder:
  10  content decorations
  40  stage chrome (glanceable controls)
  100 debug overlays
  150 overlay scrim
  160 interactive chrome above scrim
  200 menus/popovers
```

Rules: chrome tiers get named bands, not arbitrary numbers; anything above
the scrim must be *intentionally* interactive; passive telemetry stays in
the lowest band AND pointer-events-none.

## Transition Choreography for Identity Swaps

When a selection/preset/mode change replaces the whole visual identity,
the transition must be a **cover → swap → reveal**, not a pulse:

1. Cover to opaque (full fade-in completes BEFORE the swap)
2. Apply the new state while fully covered
3. Reveal

The anti-pattern this repo shipped and fixed (T-VIZ-45): apply the new
preset AND start a 220ms fade in the same frame — the fade was still
ramping when the new scene mounted, so every change was a hard cut
disguised as a transition. Timings: cover ≥ the CSS fade-in duration,
hold ~80ms, then reveal.

Guards that made it robust: re-check "is this still the latest request /
has the user manually overridden" inside EACH timeout, not just before —
a second selection mid-transition must not be clobbered or revealed early.

### Conditional layers need entrances too

Elements that mount/unmount with state (`visible && <Canvas>`) snap into
existence. Give them a one-shot mount animation (fade + slight translate,
~0.5–0.7s ease-out) or an exit — appearing instantly reads as a pop.

### Reduced motion is a first-class mode

Decorative/beat-driven animation layers must accept a `calm`/reduced-motion
prop: pose may still ease between states (slow, purposeful) but idle sway,
breath, pulse accents, and drift go to zero. `prefers-reduced-motion` is
not optional polish — it's the accessibility contract.

## Verification Loop (don't skip)

Hierarchy claims are visual claims — verify them rendered:

1. Screenshot each mode/state at a real viewport (use `__VIZ_TEST__`-style
   hooks or real clicks, not static HTML).
2. Measure, don't guess: `getBoundingClientRect()` on every chrome element,
   assert zero intersections; `elementFromPoint` on every interactive
   control to prove it's clickable.
3. For canvas/SVG content too small for the vision model, export the
   element's own pixels (`canvas.toDataURL`) and upscale 3x before analysis
   — a 240px canvas is below the model's useful threshold at 1x.
4. Sample `getImageData` pixel values when the vision model's verdict and
   your eyes disagree — it has a resolution floor.

## Anti-Patterns

| ❌ | ✅ |
|---|-----------|
| Shrink everything to fit | Assign zone ownership, move the loser to the dock |
| Same control in stage + panel | One canonical home; delete the duplicate |
| Passive card intercepts clicks | `pointer-events: none` |
| Painted-but-buried chrome | `display:none` when it should be gone |
| Fade that starts as the swap lands | Cover → swap → reveal |
| Instant mount for conditional layers | One-shot entrance animation |
| z-index by vibes | Documented ladder in the stylesheet header |
| Decorative motion ignores reduced-motion | `calm` prop zeroes accents, keeps pose easing |

## Usage in This Repo

- Visualizer: `packages/frontend/src/styles/visualizer.css` (z-ladder
  header comment), `visualizer-chrome.css`, `features/visualizer/`
  — canonical example of the whole model (T-VIZ-42/43/45/46).
- Page shells: `layout-structures` skill for the grid skeleton this
  model sits inside.

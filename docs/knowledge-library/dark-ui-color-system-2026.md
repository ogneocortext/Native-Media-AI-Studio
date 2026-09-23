---
tags:
  - visualization
  - css
  - design-system
  - dark-mode
  - oklch
  - accessibility
  - contrast
aliases:
  - Dark UI Color System
  - Frontend Contrast Tokens
cssclasses:
  - analysis
  - research
date: 2026-09-23
---

# 🌑 Dark UI Color System — Token Ladder, Contrast, and a Syntax Bug

Documents the `globals.css` design-token overhaul of 2026-09-23
(`--bg-*`, `--text-*`, `--border-*`, Tailwind `@theme` mirrors).
Motivation: the app read as "too much black" — measured cause was not the
background alone but flat elevation (surface/bg at 1.05:1) plus invisible
borders (1.49:1), so every panel melted into one black mass.

## The ladder (dark rungs)

| Token | Value | Role |
|---|---|---|
| `--bg-primary` | `oklch(15% 0.012 260)` | ground (`body`) — tinted near-black, never pure `#000` |
| `--bg-surface` | `oklch(20% 0.012 260)` | cards |
| `--bg-surface-hover` | `oklch(24.5% 0.012 260)` | hover state |
| `--bg-elevated` | `oklch(29% 0.014 260)` | popovers, dialogs, top tier |

Adjacent-rung contrast: 1.09 / 1.12 / 1.15 — visible but subtle, inside the
1.06–1.15 band the better dark systems use. Elevation is expressed through
these steps, **not** box-shadows (shadows tuned for light mode disappear on
dark surfaces).

Text ladder: primary `oklch(93% 0.004 260)` (off-white — pure white on dark
causes halation), secondary `76%` (9.16:1 on ground), tertiary `62%`
(5.40:1 on ground — passes AA for normal text, not just large/decorative).

Borders are decorative on dark; structure comes from elevation. They are
lighter than intuition suggests because a border needs contrast against a
dark surface too: `--border-color` at 1.81:1, `--border-subtle` at 1.39:1.

## The syntax bug (real)

The old tokens were written `oklch(12% 0 0 260)` — four space-separated
components with no `/` before the alpha. Per CSS Color 4 that is **invalid**;
browsers drop the declaration and the custom property becomes
guaranteed-invalid, so every `var(--bg-primary)` without a fallback resolved
to unset. The author meant hue 260 — which is now expressed properly as
`oklch(15% 0.012 260)` (chroma carries the blue cast; with `C=0` the hue
would have been meaningless anyway). Fixed in `:root`, in the
`prefers-contrast: more` override, and in the Tailwind `@theme` mirrors
(`--color-surface`, `--color-background`), which had the same bug and the
comment "values mirror :root" — they now actually do.

Why the Python vision-feedback tool didn't catch it: `tools/design-feedback`
screenshots the app and asks a local vision model for qualitative critique.
That loop can say "looks too dark" but cannot see a dropped CSS declaration
or measure a 1.05:1 elevation step. Quantitative token checks (this doc's
table, computed with the Oklch→linear-sRGB matrices + WCAG relative
luminance) are the right tool for color-system work; vision review is for
taste, hierarchy, and "does it feel premium".

## Measurement method

Oklch → linear sRGB via the Björn Ottosson inverse matrices (same as the
v4 shader work), relative luminance `Y = 0.2126R + 0.7152G + 0.0722B`
computed **directly on the linear values** — no sRGB transfer function,
which would double-apply gamma and under-report ratios. Contrast
`(Yhi+0.05)/(Ylo+0.05)` per WCAG 2.x.

## Rules for future token edits

1. Never pure black ground — tinted near-black (`oklch(12–18%, 0.005–0.02, 250–280)`).
2. New surface rung? Keep adjacent contrast in 1.06–1.15.
3. New text color? Check against every surface it can sit on; body text ≥ 4.5:1.
4. Borders are decoration; if a boundary must carry meaning, use elevation or the accent.
5. Accents: desaturate slightly for dark mode (shared tokens today — a `light-dark()` split is the open follow-up).
6. After editing tokens, re-run the contrast table before committing.

## Sources

- 4-tier dark system (deepest surface `#1f1f21`, elevation not shadows): dev.to/raxxostudios
- Tinted near-blacks, no-pure-black, accent desaturation, off-white text: nalindalal/skillset `ui-core/references/dark-mode.md`
- `oklch(15% 0.01 250)` surface ladder, chroma 0.005–0.01 tint guidance: akarachen/aghub `reference/color-and-contrast.md`
- Adjacent-surface 1.06–1.09, warm-cast darks, alarm-color-is-the-lighter-pair: bedikryst/voctmanager `dark-mode-spec-2026-08.md`
- Border opacity, chip saturation flip, dark checklist: blink-new/claude `ux-design-principles/text/dark-mode.md`

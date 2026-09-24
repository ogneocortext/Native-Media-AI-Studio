---
tags:
  - frontend-css
  - color-strategy
  - accessibility
  - apca
aliases:
  - Color Strategy 2026
  - Contrast Guide
date: 2026-09-23
---

# 🎨 Color Strategy 2026 — Contrast That Survives Dark Mode

> Research synthesis (Sept 2026) + measured token audit of this repo.
> Sources: APCA/WCAG-3 drafts (Myndex SAPC-APCA, apca-w3), APCA-vs-WCAG dark-mode
> analyses (AppCrib 2026), CSS Crème colour guide, karlkoch OKLCH theming notes.

## 1. What we measured (the complaint was right)

Computed WCAG ratios for our token pairs (`tools` scratch calc, oklch→sRGB):

| Pair (dark) | Ratio | Verdict |
|---|---|---|
| primary (95%) on surfaces | ~15:1 | AAA ✓ |
| **secondary (70%) on surfaces** | **2.9:1** | **FAIL** |
| **tertiary (55%) on surfaces** | **1.5:1** | **near-invisible** |
| light theme, all pairs | 12–21:1 | AAA ✓ |

The app is overwhelmingly secondary/muted text → dark mode reads as
"hardly any contrast" while light mode is perfect. **The bug is dark-only.**

## 2. Why: WCAG lies about dark mode, APCA doesn't

- WCAG 2 ratios are direction-blind and overstate dark-pair contrast; APCA is
  polarity-aware and penalizes light-on-dark body text harder. A dark theme
  mirrored from a light palette with matching WCAG numbers reads
  measurably worse (AppCrib 2026).
- APCA tiers that matter here: **Lc 75** minimum body, **Lc 60** minimum
  content text, **Lc 45** large/bold headlines, **Lc 30** spot text
  (placeholders, labels, copyright). Our dark secondary sat around Lc ~50 —
  below the content floor.
- Fix rule: lightness does the work (hue/chroma barely affect readability).
  Keep text achromatic; move L only.

## 3. Token decisions (implemented 2026-09-23)

| Token | Was (dark) | Now (dark) | Ratio on mid surface | Tier |
|---|---|---|---|---|
| `--text-secondary` | 70% (2.9:1 FAIL) | **80%** | **5.5:1 AA body** | content text ✓ |
| `--text-tertiary` | 55% (1.5:1) | **68%** | **2.6:1** | spot/UI labels |
| `--color-muted` (@theme) | mirrors 70% | mirrors 80% | — | 379 usages fixed at once |
| `prefers-contrast: more` | 85% / 75% | **88% / 78%** | stays above new defaults | HC users ✓ |

- Tertiary deliberately stays dimmer than secondary (hierarchy must survive),
  but moves from "invisible" to "spot-readable". Placeholders/disabled ride
  on secondary/muted, so they land at AA.
- Light theme untouched (already AAA across the board).
- Surfaces (12/16/20%) untouched — depth system works; text was the lever.

## 4. Rules going forward

1. New text colors: pick L by tier (body ≥80%, content ≥78%, spot ≥65%
   on dark surfaces), never by eye. Re-run the ratio calc.
2. Both polarities get checked — WCAG numbers matching across themes proves
   nothing (see §2).
3. Muted hierarchy ≠ faint text: differentiate with size/weight/case
   (10px uppercase taglines) once lightness floors are met.
4. Derived pairs (muted-on-tint, e.g. badges) get individual checks.

## 5. Second audit pass (2026-09-23, `tools/tests/contrast_audit.py`)

A Playwright auditor now measures every rendered text/background pair
(computed styles, OKLCH-aware parsing — Chrome serializes computed color
back as `oklch()`, which rgb-only parsers silently drop). It found
**126 offenders** beyond the token fix, all fixed:

| Offender | Cause | Fix (measured) |
|---|---|---|
| Active nav item (dark text on violet) | `color: text-inverse` → near-black in dark | pinned white — 9.3:1 both themes |
| `text-primary` 12px links (Queue ×81) | saturated violet 2.3:1 on dark | new `--color-link` token (5.1:1), fills keep saturated token |
| `text-error` labels/counts (×13) | danger red 2.7:1 on dark | new `--color-error-text` (5.5:1) |
| `text-success` labels (×2) | success green 3.8:1 on dark | new `--color-success-text` |
| Group titles, tagline, footer, no-results | tertiary 2.6:1 | `--text-secondary` (hierarchy via size/case) |

Pattern: **saturated brand hues are for fills/borders; text-on-dark gets
lightened twins** (`-text`/`-link` tokens, `light-dark()` so light theme
keeps the saturated originals). Re-audit: **1170 nodes, 0 below AA**.
(`LogViewer.tsx`, the last raw `text-error` user, was unimported dead code
and was deleted 2026-09-23.)

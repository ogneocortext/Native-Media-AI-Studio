---
tags:
  - frontend-css
  - tailwind-v4
  - design-system
  - accessibility
aliases:
  - Modern CSS 2026
  - Frontend Styling Guide
date: 2026-09-23
---

# 🎨 Modern CSS 2026 — Frontend Styling Guide

> Research synthesis (Sept 2026) applied to `packages/frontend/src/styles/`.
> Sources: Tailwind v4 docs/blog, MDN, web.dev, CSS Crème colour guide,
> moderncsstools.com, cascade-layers architecture guides, a11y media-query guide.

## 1. Token discipline: `@theme` vs `:root`

- **`@theme`** = tokens that map to Tailwind utilities (`--color-muted` →
  `text-muted`, `bg-muted/20`). Required top-level; cannot be nested.
- **`:root`** = plain variables for bespoke CSS (`var(--bg-surface)` in gradients).
- Our setup mirrors both (same values). That is the sanctioned pattern — but
  every NEW utility-facing token must go in `@theme` or its classes silently
  generate **zero CSS** (this actually happened: ~600 `text-muted`/`bg-surface`
  usages were dead until the `@theme` block was added; verify with
  `grep -c '\.text-muted' dist/assets/*.css`).

## 2. Cascade layers — order is a load-bearing decision

- Layer order is fixed by the **first** `@layer` declaration; later layers win
  **regardless of specificity**; unlayered CSS beats ALL layered CSS;
  `!important` **inverts** inside layers (early layer wins).
- Tailwind v4's documented order is `theme, base, components, utilities`.
- **Our order is deliberately `base, theme, components, utilities`** (2026-09-23).
  The theme layer carries the manual `html[data-theme]` color-scheme override,
  and layers beat specificity — with Tailwind's order, base-layer
  `:root { color-scheme: light dark }` would permanently override the toggle
  and `light-dark()` would follow the OS instead of the app setting. This was
  verified live (computed `colorScheme` flipped back after reordering).
- Do NOT "align with docs" without re-verifying the toggle in both themes.
- Keep the single declaration in `globals.css` — never re-declare order
  in another file.

## 3. Custom utilities: `@utility` vs `@layer utilities`

- Tailwind docs prefer `@utility` for NEW custom utilities: it enables
  `hover:`/`focus:`/`lg:` variants automatically. Raw `@layer utilities`
  blocks cannot do variants.
- Our customs (`.shimmer`, `.glass`, `.animate-*`) work as layer blocks and
  nobody needs variants on them today — migration deferred, not forgotten.

## 4. Gradients: always declare an interpolation space

- Default gradient interpolation is sRGB → muddy gray middle between vivid
  stops. Use `in oklch` (project convention; perceptual) or `in oklab`
  (best for opaque-color interpolation).
- All brand gradients (`btn-primary`, `metric-value`, `card-glow`,
  `progress-fill`, `sidebar-cta`) carry `in oklch`.

## 5. Colour: OKLCH + color-mix + light-dark rules

- OKLCH everywhere; equal L steps look equal. Chroma ≤ ~0.2 near white/black
  (gamut mapping dulls otherwise).
- Derive, don't hand-pick: hover = `color-mix(in oklch, X, black/white)`;
  tints = mix with `transparent` (works on any background).
- `light-dark()` REQUIRES `color-scheme` to be in effect or it always returns
  the light value — see §2 for why the toggle wiring is fragile.
- New code must use tokens, never raw hex for theme surfaces
  (fixed 2026-09-23: `metric-card`, `btn-secondary`, `neumorphic`, selects).

## 6. Contrast & forced colors (a11y)

- `@media (prefers-contrast: more)` hardens `--text-secondary`,
  `--text-tertiary`, `--border-color` (in `globals.css`, base layer).
- `@media (forced-colors: active)` maps focus ring to `Highlight`
  (don't fight the OS palette beyond that).
- Check derived pairs (muted text on tinted surfaces) with a contrast checker
  — a mix is still a colour somebody has to verify.

## 7. Transitions: never `all`

- `transition: all` forces the browser to watch every property including
  layout ones. Scope to `color, background-color, border-color, box-shadow,
  transform, filter, opacity` (done across `components/sidebar/theatre.css`).
- Theme flips fade smoothly because surfaces already transition
  color/background-color; `body` carries the page-level transition.

## 8. Small things that are now standard

- Global `:focus-visible` ring + `forced-colors` fallback (§6).
- `::selection` uses brand tint.
- `h1, h2 { text-wrap: balance; }` — no ragged hero lines.
- `prefers-reduced-motion` blanket (duration → 0.01ms, single iteration).
  Spinners stay visible in a static end-state rather than being removed.

## 9. Verification checklist (run before declaring CSS done)

1. `npx vite build` succeeds.
2. Dead-utility grep on the bundle:
   `text-muted|bg-surface|text-primary|border-primary` must have matches.
3. Computed-style probes in BOTH themes (dark + light):
   `color-scheme`, `.text-muted` color, `.shimmer` animation-name.
4. Toggle theme via `localStorage.theme` + reload; confirm scheme flips.
5. Playwright screenshots (dark + light) + vision review for defects.
6. `npx tsc --noEmit` clean.

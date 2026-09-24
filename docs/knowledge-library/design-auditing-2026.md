---
tags:
  - frontend-css
  - design-qa
  - accessibility
  - axe-core
aliases:
  - Design Auditing 2026
  - UI QA System Guide
date: 2026-09-23
---

# 🔍 Design Auditing 2026 — Contrast, axe-core, Visual Review

> Research synthesis (Sept 2026) behind `tools/tests/contrast_audit.py`.
> Sources: Playwright a11y docs, @axe-core/playwright, APCA/ARC Bronze spec,
> Bridge-PCA notes, CI/CD a11y best-practices guides, visual-regression
> surveys (pixelmatch vs VLM judgement).

## 1. The three layers (use all three, confuse none)

| Layer | Answers | Tool here |
|---|---|---|
| Computed contrast | exact pair ratios, both polarities | `contrast_audit.py` text pass (WCAG + APCA Lc) |
| Engine rules | names/roles/landmarks/labels/keyboard-adjacent | axe-core (`wcag2a`+`wcag2aa` tags), injected into the same run |
| Visual judgement | intent: hierarchy, breakage, taste | local VLM screenshot review (no baselines) |

Automated checks catch ~30–57% of issues (Deque 2021 / LIA 2025). A green
run is "no machine-detectable defects", never a conformance claim. Manual +
assistive-tech testing still covers the rest.

## 2. Contrast: report WCAG *and* APCA

- WCAG ratios are regulatory reality (EAA/ADA reference WCAG 2.1 AA) but
  direction-blind and unreliable in dark mode.
- APCA Lc is perceptually uniform and polarity-aware: **75** body minimum,
  **60** content-text minimum, **45** headlines/large, **30** spot text
  (placeholders, labels, copyright). Font weight shifts perception ≈Lc 15
  per 400→700 step — thin glyphs need more.
- Policy: verdicts stay WCAG-based (regulatory), Lc is advisory —
  flag `APCA-CAUTION` when WCAG passes but Lc < 45 on ≥12px text.
  Never translate ("Lc 60 ≈ 4.5:1" only coincides near mid-gray).
- Implementation note: Chrome serializes computed color as `oklch()` /
  `color(srgb…)` — parsers must handle those, and backgrounds need true
  alpha compositing over the `Canvas` system color, not first-opaque-wins.

## 3. axe-core rules of engagement

- `@axe-core/playwright`, tags `wcag2a`+`wcag2aa` only (best-practice rules
  are advisory — don't let them block).
- Scan real states: after `networkidle` + settled lazy chunks, both themes,
  plus one interacted state (our run opens nothing modal — documented gap).
- Suppress findings by specific fingerprint (route+rule+selector), scoped and
  dated — never whole-rule disables, never full-HTML snapshots.
- Ratchet policy for legacy debt: threshold count that only ever decreases.
  (We run at zero: any violation fails the run.)

## 4. Viewports and themes

- Every route scanned at **1440×900 and 390×844**, dark **and** light
  (`localStorage.theme` + reload). Polarity must be tested both ways —
  WCAG reports mirrored palettes as equivalent; they aren't.
- Mobile probe: horizontal overflow (`scrollWidth` vs viewport, offender
  list) + sub-24px severe small-target scan (44px is the WCAG target;
  24px is the AA minimum — flag below that).

## 5. Pixel baselines vs VLM judgement

- Pixelmatch answers "are pixels identical" (right for token-exact lock-in);
  VLM review answers "is the right thing on screen" (right for intent,
  hierarchy, breakage). We use VLM review (local model, no baseline files,
  no cross-OS flake) plus computed numbers where numbers exist.
- Screenshot what you ship: dev-server rendering is accepted here as the
  local harness (documented limitation vs scanning built output).

## 6. Runbook

```
python tools/tests/contrast_audit.py [/route ...] [--themes dark,light]
    [--base-url=http://127.0.0.1:5173 | --port=5173]
```
- Frontend URL resolves from `config/ports.json` (`frontend_url`), falling back
  to :5173. A preflight probe exits 2 with a clear message when it's down.
- Exit 0: zero WCAG offenders, zero axe violations, zero overflow/small-target
  offenders. Exit 1: blocking failures. Exit 2: frontend unreachable.
- Rows append to `contrast_audit_results.jsonl` (offenders only), each tagged
  with `run` id + UTC `ts`; a `kind:"summary"` record closes every run.
- Themes are pinned via per-context init scripts (single page load per route).
- Re-run after any theme/token/layout work; diff rows by run id over time.

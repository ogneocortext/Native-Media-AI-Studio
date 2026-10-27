---
tags:
  - production
  - schema
  - documentation
aliases:
  - Video Intro Recipe Schema
cssclasses:
  - production-guide
date: 2026-10-27
type: concept
---

# Video Intro Recipe Schema

**Status:** Proposed  
**Area:** Video Pipeline & Storyboard (T-VID-01)  
**Last Updated:** 2026-10-27

## Overview

The intro-recipe schema defines a deterministic, parameterized description of a 3–7 s video intro. Every brand element (logo, palette, sting audio, motion curve, duration) is specified explicitly in the recipe — nothing is hard-coded per render. The same recipe must guarantee identical brand elements across renders.

## Schema Definition

```json
{
  "$schema": "intro-recipe-v1.json",
  "version": 1,
  "name": "string",
  "duration_seconds": 3.0,
  "canvas": {
    "width": 1920,
    "height": 1080,
    "fps": 24,
    "background": "#000000"
  },
  "brand": {
    "logo": {
      "source": "string",        // URL or filesystem path to logo image
      "placement": {             // normalized 0–1 coordinates
        "x": 0.5,
        "y": 0.5
      },
      "scale": 0.4,              // fraction of canvas width
      "opacity": 1.0,            // 0–1
      "anchor": "center"         // center | top-left | top-right | bottom-left | bottom-right
    },
    "palette": {
      "primary": "#FFFFFF",      // dominant brand color
      "secondary": "#000000",    // accent / contrast
      "tertiary": "#808080"      // secondary accent
    }
  },
  "sting": {
    "source": "string",          // URL or filesystem path to sting audio (WAV/MP3)
    "fade_in_sec": 0.5,
    "fade_out_sec": 0.5,
    "gain_db": 0.0               // -60 to +6 dB
  },
  "motion": {
    "curve": "ease-out",         // linear | ease-in | ease-out | ease-in-out | bounce
    "intro_animation": "fade-in", // fade-in | scale-up | slide-up | none
    "logo_dwell_sec": 2.0        // seconds logo is fully visible before fade-out
  }
}
```

## Field Reference

### `duration_seconds` (required)
- **Type:** number
- **Range:** 3.0 – 7.0 seconds
- **Purpose:** Total intro duration. Must be ≥ sum of all motion phases (fade-in + dwell + fade-out).

### `canvas` (optional, defaults shown)
- **`width`/`height`:** Render resolution in pixels
- **`fps`:** Frame rate
- **`background`:** CSS color string for canvas background

### `brand.logo` (required)
- **`source`:** Image URL or absolute filesystem path. Must resolve at render time.
- **`placement`:** X/Y in normalized 0–1 canvas coordinates (0.5 = center)
- **`scale`:** Fraction of canvas width the logo occupies (0.1 – 1.0)
- **`opacity`:** Logo opacity (0.0 – 1.0)
- **`anchor`:** Named anchor point for placement

### `brand.palette` (required)
- **`primary`/`secondary`/`tertiary`:** CSS hex color strings (#RRGGBB)
- Used for text, shapes, accents throughout the intro

### `sting` (optional)
- **`source`:** Audio URL or absolute path (WAV/MP3)
- **`fade_in_sec`/`fade_out_sec`:** Fade durations in seconds
- **`gain_db`:** Volume adjustment in dB (-60 to +6)

### `motion` (optional)
- **`curve`:** CSS easing function name
- **`intro_animation`:** How the logo enters (fade-in | scale-up | slide-up | none)
- **`logo_dwell_sec`:** Seconds the logo remains fully visible before fade-out begins

## Determinism Guarantee

The same recipe must produce identical output across renders. This means:

1. **No random values** — all positions, scales, colors, timings are explicit
2. **No clock-dependent behavior** — all animation is keyed to `elapsed / duration_seconds`
3. **No external mutable state** — logo and sting sources must be immutable (content-addressed or versioned paths)
4. **Same resolution/fps** — canvas dimensions and frame rate are fixed per recipe

## Validation Rules

| Rule | Check |
|------|-------|
| Duration range | `3.0 <= duration_seconds <= 7.0` |
| Motion fits duration | `fade_in + dwell + fade_out <= duration_seconds` |
| Scale range | `0.1 <= logo.scale <= 1.0` |
| Opacity range | `0.0 <= logo.opacity <= 1.0` |
| Gain range | `-60 <= sting.gain_db <= 6` |
| Colors valid | CSS hex `#RRGGBB` or named CSS color |

## Usage

The render pipeline (T-VID-02) consumes this schema as input. Each field maps to a deterministic render instruction:

1. Clear canvas to `canvas.background`
2. Draw logo at `brand.logo.placement` × `canvas` dimensions, scaled by `brand.logo.scale`, opacity `brand.logo.opacity`
3. Apply `motion.intro_animation` using `motion.curve` over `motion.logo_dwell_sec`
4. Play `sting.source` with fades and gain
5. Hold for remaining duration, then fade out

## Non-Goals (v1)

- Dynamic text/typography (handled by Kinetic Typography page)
- Multi-scene intros (single static logo only)
- Video background (still image logo only)
- Audio-reactive motion (sting is played, not analyzed)

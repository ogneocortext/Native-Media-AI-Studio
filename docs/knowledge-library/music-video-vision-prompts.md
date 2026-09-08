---
title: Music Video Vision Analysis Prompts
tags: [music-video, vision, QA, quality-check, still-analysis]
aliases: [MV Vision Prompts, Still Analysis, Music Video QA]
date: 2026-09-08
source: internal
cssclasses: [technical-reference]
---

# Music Video Vision Analysis Prompts

> Structured prompts for AI vision models to analyze music video stills with actionable, section-aware feedback.

## The Problem

Generic vision prompts ("Rate 1-10: composition, color, text") produce non-actionable, generic output that doesn't help improve the composition. Music videos need **section-aware, sync-checked, energy-rated** analysis.

## Prompt Structure

Use this template for each still. Replace `SECTION`, `TIMESTAMP`, and `EXPECTED_LYRICS` with actual values.

```
Music video SECTION still at TIMESTAMPs. Expected lyrics: "EXPECTED_LYRICS".

Answer in this exact format:
LYRIC_SYNC: [text visible Y/N] [matches expected Y/N] [lag/lead/none]
ENERGY: [1-10] [matches section Y/N] [too high/too low/just right]
BEAT_REACTIVE: [Y/N] [what moves]
ENGAGEMENT: [1-10] [boring/static/dynamic]
ISSUES: [list]
FIX: [3 specific fixes]
```

## Section Energy Reference

| Section | Expected Energy | Visual Treatment |
|---------|-----------------|------------------|
| Intro | 2-3/10 | Minimal, slow camera push, dust particles, subtle glow |
| Verse | 4-5/10 | Character enters, parallax, handheld camera, moderate particles |
| Chorus | 8-10/10 | Maximalist, fluid light, hero typography, fast camera, bursts |
| Bridge | 3-4/10 | Intimate, desaturated, slow zoom, whispered feel |
| Outro | 5-7/10 | Resolve, warm tones, fade to loopable |

## Example: Intro @10s

```
Music video INTRO still at 10s. Expected lyrics: "Midnight hums in shades of blue".

Answer in this exact format:
LYRIC_SYNC: text visible Y/N | matches expected Y/N | lag/lead/none
ENERGY: 1-10 | matches section Y/N | too high/too low/just right
BEAT_REACTIVE: Y/N | what moves
ENGAGEMENT: 1-10 | boring/static/dynamic
ISSUES: list
FIX: 3 specific fixes
```

## Example: Chorus @75s

```
Music video CHORUS still at 75s. Expected lyrics: "Still I rise before the fade".

Answer in this exact format:
LYRIC_SYNC: text visible Y/N | matches expected Y/N | lag/lead/none
ENERGY: 1-10 | matches section Y/N | too high/too low/just right
BEAT_REACTIVE: Y/N | what moves
ENGAGEMENT: 1-10 | boring/static/dynamic
ISSUES: list
FIX: 3 specific fixes
```

## Usage with Vision Script

```bash
# Single still analysis
node tools/vision/analyze.mjs out/v7-intro.png "Music video INTRO still at 10s. Expected lyrics: Midnight hums in shades of blue. Answer: LYRIC_SYNC: text visible Y/N | matches Y/N | lag/lead. ENERGY: 1-10 | matches Y/N | too high/low. BEAT_REACTIVE: Y/N. ENGAGEMENT: 1-10. ISSUES: list. FIX: 3 fixes." --low --mode ui

# Batch analysis (all sections)
for section in intro verse chorus bridge; do
  node tools/vision/analyze.mjs out/v7-${section}.png "..." --low --mode ui > out/vision-${section}.txt
done
```

## Common Issues to Flag

1. **Lyric lag**: Text appears after the singer says it (check against LRC timestamps)
2. **Energy mismatch**: Chorus looks like verse (too static) or intro looks like chorus (too busy)
3. **Static composition**: No camera movement, no beat reactivity
4. **Generic styling**: All sections look the same
5. **Text unreadable**: Poor contrast, wrong size, bad placement
6. **Missing beat sync**: No visible pulse/burst on beat onsets

## Integration with Render Workflow

1. Render stills at section boundaries (from LRC)
2. Run vision analysis with section-specific prompt
3. Parse structured output for ISSUES and FIX
4. Apply fixes to composition
5. Re-render and re-analyze until ENGAGEMENT > 7 and no critical issues

## Knowledge Library References

- [[audio-reactive-production]] — frequency band mapping, beat detection patterns
- [[music-video-production]] — pipeline architecture, section treatment
- [[character-driven-visualization]] — making visuals less generic

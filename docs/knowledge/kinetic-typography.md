# Kinetic Typography — Route Documentation

> Compiled: 2026-09-15
> Context: Native Media AI Studio — `/kinetic-typography` route reference

## Overview

`/kinetic-typography` is the **lyric-animation and text-effect studio**. It lives at `packages/frontend/src/features/kinetic-typography/KineticTypographyPage.tsx` and provides:
- 8 genre-specific animation presets via `anime.js`
- Word-level karaoke highlight synced to LRC timestamps
- LRC multi-stamp parser with configurable `offset`
- WhisperX transcription integration for timestamped lyrics
- Theatre.js Studio panel for customizing kinetic typography animations with real-time preview

## Architecture

### Core Components
- **KineticTypographyPage.tsx** — top-level page; manages preset, LRC state, playback sync
- **KaraokeRenderer.tsx** — word-by-word highlight with progress fill
- **LyricsEditor.tsx** — inline LRC editor with real-time preview
- **PresetPanel.tsx** — 8 genre preset cards (Phonk Drift, Synthwave, Ambient Flow, West Coast G-Funk, UK Grime, Dubstep Impact, Lo-Fi Warmth, Cinematic)
- **TheatrePanel.tsx** — Theatre.js animation editor for custom kinetic type sequences

### Animation Library Decision
Per `docs/knowledge/kinetic-typography-options.md`:
- **Primary**: Motion (`@motionone/react`) for layout and enter/exit choreography
- **Secondary**: Anime.js v4 for text-level transforms, stagger, and timeline control
- Both coexist; Motion handles container transitions, Anime.js handles per-word/character effects

### LRC Sync Flow
1. Load `.lrc` file → parse with multi-stamp parser
2. Extract `offset` (ms) → apply to all timestamps
3. `isPhraseStart` flag marks phrase boundaries for section-aware effects
4. `sectionProgress` (0→1) drives beat-synced pulse and color transitions
5. Current word index computed from `audio.currentTime`; highlight advances on word boundary

### WhisperX Integration
- Transcription endpoint: `POST /api/audio/transcribe` (uses WhisperX in `nma-studio-cuda` env)
- Outputs timestamped word segments with confidence scores
- Auto-generates LRC file in `output/audio/<uuid>.lrc`
- Sparse words filtered out (confidence < 0.6) before LRC export

## Key Patterns

### Preset Structure
```tsx
interface KineticPreset {
  id: string;
  name: string;
  genre: string;
  enter: anime.Easing;      // word entrance
  exit: anime.Easing;        // word exit
  highlight: { scale: number; color: string; blur: number };
  stagger: number;           // ms between words
  pulseOnBeat: boolean;
}
```

### Word-Level Animation
```tsx
anime({
  targets: `.word[data-index="${i}"]`,
  translateY: [20, 0],
  opacity: [0, 1],
  easing: preset.enter,
  duration: 400,
  delay: i * preset.stagger,
});
```

### Theatre.js Integration
- Theatre.js project mounted inside `<StudioPanel>` via `@theatre/core` + `@theatre/studio`
- Keyframes exported as JSON; re-importable as presets
- Sequence sheet: `LyricSheet` — one track per text property (opacity, translateY, scale, color)

## Known Limitations
- Anime.js v4 ESM tree-shaking is imperfect; bundle includes unused easings (~12KB)
- Theatre.js studio panel conflicts with R3F `<Canvas>` pointer events — z-index layering required
- LRC parser does not support enhanced LRC extensions (word-level timestamps inside `[]`)
- WhisperX transcription is single-language (English) unless `--language` override passed

## Related Files
- `packages/frontend/src/features/kinetic-typography/KineticTypographyPage.tsx`
- `packages/frontend/src/features/kinetic-typography/KaraokeRenderer.tsx`
- `packages/frontend/src/features/kinetic-typography/LyricsEditor.tsx`
- `packages/frontend/src/features/kinetic-typography/presets/*.ts`
- `docs/knowledge/kinetic-typography-techniques-2026.md` — stroke-dash reveal, beat-synced pulse, 3D text
- `docs/knowledge/kinetic-typography-options.md` — Motion vs Anime.js decision record

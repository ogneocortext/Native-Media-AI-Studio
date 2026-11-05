---
tags:
  - visualization
  - typography
---

# Kinetic Typography — Route Documentation

> Compiled: 2026-09-15 · **Rewritten 2026-11-05** against the current tree
> Context: Native Media AI Studio — `/create/typography` route reference

## Overview

`/create/typography` (legacy `/kinetic-typography` redirects here) is the
**lyric-animation / kinetic-typography video builder**. It lives at
`packages/frontend/src/features/kinetic-typography/KineticTypographyPage.tsx`
and provides:

- Track picker backed by the shared audio library (`useAudioLibrary()` —
  the single store per D16; never call `listAudioFiles()` from a
  component)
- Loads the track's separated stems and analysis (beats/sections) plus
  lyrics from the track-lyrics index, with a CSV fallback
  (`parseLyricsFromCsv`) and `.lrc` import (`parseLrc`)
- Kinetic preset selection shared with the visualizer
  (`features/visualizer/components/KineticPresets` +
  `PresetSelector`)
- Word-level karaoke highlight synced to lyric timestamps
- Lyric editing via `components/LyricsEditorModal.tsx`
- Render through `POST /api/video/generate-section` with
  `visualization.style: "kinetic"`

## Architecture

### Core Components

- **KineticTypographyPage.tsx** — page orchestrator; owns audio
  playback state, lyric lines, preset, and render request
- **components/LyricsEditorModal.tsx** — lyric line editor modal
- **WordHighlight** (inline in the page) — per-word karaoke renderer:
  each `LyricLine.words[]` entry carries `start`/`end`; words render
  dimmed until current, then glow via `textShadow` scaled by
  `glowIntensity`

### Shared Visualizer Modules (not local copies)

The page deliberately reuses the visualizer's lyric/preset machinery
rather than duplicating it:

- `features/visualizer/components/KineticPresets.ts` —
  `kineticPresets`, `kineticPresetList`, `selectPresetForTrack`,
  `LyricLine` type
- `features/visualizer/PresetSelector.tsx` — `PresetSelector` +
  `VisualPreset`
- `features/visualizer/lyricsParser.ts` — `parseLyricsFromCsv`, `parseLrc`
- `features/visualizer/lyricsData.ts` — `createDefaultLyricsData`,
  `lyricsDataToLegacy`, `legacyToLyricsData`
- `data/trackLyrics.ts` — `fetchTrackLyricsIndex`, `fetchTrackLyrics`,
  `toLyricLines`

### Animation Stack

The genre presets and Theatre.js panel referenced by earlier revisions
of this doc live in the **visualizer**, not on this page:

- `animejs` (v4) drives preset timelines inside `KineticPresets`
- `@theatre/core` + `@theatre/studio` power
  `visualizer/components/TheatreStudioPanel.tsx`
- There is no `@motionone`/Motion dependency in
  `packages/frontend/package.json` — the "Motion primary" decision in
  `kinetic-typography-options.md` was superseded by the anime.js +
  Theatre.js implementation

### Transcription

- `POST /api/audio/transcribe` — faster-whisper
  (`services/transcription.py`), **not** WhisperX; returns word/segment
  timestamps as `LyricLine[]`
- `GET /api/audio/transcript/{filename}` — cached transcription
- `GET /api/audio/transcript/lrc/{filename}` — LRC export
  (`result_to_lrc`, `result_to_word_level_lrc`)

### Render Path

`generateKineticVideo()` (`services/api/audio.ts`) POSTs to
`/api/video/generate-section` with `method: "visualization"`,
`visualization.style: "kinetic"`, `preset_id`, `lyrics`, and the audio
filename — i.e. the deterministic visualization renderer, not ComfyUI
generation.

## Key Patterns

### Track Selection (D16)

```tsx
const { tracks } = useAudioLibrary();          // the only allowed source
// group with groupAudioEntries / parseVariantName / variantLabel
// from state/audioNaming — render optionLabel, never a local regex
```

### Lyric Line Shape

```ts
interface LyricLine {
  start: number;   // seconds
  end: number;
  text: string;
  section?: string;
  words?: { word: string; start: number; end: number }[];
}
```

Word-level data comes from transcription or enhanced LRC; lines without
`words` render as plain text.

### Preset Selection

`selectPresetForTrack` picks a preset from track analysis (tempo,
energy, sections); the backend also suggests one —
`suggested_kinetic_preset` + confidence are returned by the audio
analysis endpoint (`audio_analysis.py::_suggest_kinetic_preset`).

## Known Limitations

- Word-level karaoke only works when lyrics carry word timestamps
  (transcription or word-level LRC); plain `.lrc` lines fall back to
  line-level display
- The page renders via the visualization path — output is the
  deterministic kinetic style, not a generative video model
- Lyrics editing is modal-based; there is no inline per-word timing
  editor on this page

## Related Files

- `packages/frontend/src/features/kinetic-typography/KineticTypographyPage.tsx`
- `packages/frontend/src/features/kinetic-typography/components/LyricsEditorModal.tsx`
- `packages/frontend/src/features/visualizer/components/KineticPresets.ts`
- `packages/frontend/src/features/visualizer/PresetSelector.tsx`
- `packages/frontend/src/features/visualizer/lyricsParser.ts`
- `packages/frontend/src/data/trackLyrics.ts`
- `packages/frontend/src/services/api/audio.ts` — `transcribeAudio`,
  `generateKineticVideo`
- `packages/backend/app/services/transcription.py` — faster-whisper
- `docs/knowledge/kinetic-typography-techniques-2026.md` — technique
  research (stroke-dash reveal, beat-synced pulse, 3D text)
- `docs/knowledge/kinetic-typography-options.md` — library decision
  record (partially superseded — see note in that file)

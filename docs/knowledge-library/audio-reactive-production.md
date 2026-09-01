---
title: Audio-Reactive Music Video Production Guide
tags: [audio-reactive, music-video, visualization, beat-sync, remotion]
aliases: [Audio Reactive Guide, Beat Sync, Music Visualization]
date: 2026-09-01
source: web-research
cssclasses: [technical-reference]
---

# Audio-Reactive Music Video Production Guide

> [!info] Summary
> Research-backed techniques for creating audio-reactive music videos with proper beat synchronization, lyric timing, and genre-aware visual pacing.

## Core Principles

### 1. Structure-Aware Visualization
Visuals should evolve with the song's structure (verse/chorus/bridge), not just BPM.

| Section | Energy | Visual Treatment |
|---------|--------|------------------|
| Intro | Low (0.2) | Minimal, slow camera push, dust particles |
| Verse | Medium (0.5) | Character enters, parallax, handheld camera |
| Chorus | High (0.9-1.0) | Maximalist, fluid light, hero typography |
| Breakdown | Low (0.28) | Desaturated, VHS, whispered intimacy |
| Outro | Medium-High (0.8) | Resolve, warm tones, fade to loopable |

### 2. Frequency Band Mapping
Split audio spectrum into bands that drive different visual elements:

| Band | Frequency | Drives |
|------|-----------|--------|
| Bass | 0-5% (kick, bass) | Scale pulses, camera shake, particle bursts |
| Mid | 5-35% (vocals, synths) | Color shifts, typography glow, 3D rotation |
| High | 35-80% (hi-hats, cymbals) | Particle speed, emissive intensity, sparkle |

### 3. Beat Detection Pattern
```javascript
// Rolling energy average with threshold
if (bass > threshold && timeSinceLastBeat > minGap) {
  // Beat detected - trigger visual burst
  triggerBeatEffect();
}
```

### 4. Genre-Aware Pacing
- **EDM/Trance**: High-frequency visual bursts at drops, four-on-the-floor kick sync
- **Lo-fi**: Slow atmospheric motion, soft particles
- **Hip-hop**: Bass-heavy pulses, rhythmic typography

## Remotion-Specific Techniques

### Audio Analysis
```tsx
import { useWindowedAudioData, visualizeAudio, visualizeAudioWaveform } from "@remotion/media-utils";

// Windowed analysis for smooth audio data
const { audioData, dataOffsetInSeconds } = useWindowedAudioData({
  src: staticFile("song.mp3"),
  frame,
  fps,
  windowInSeconds: 30, // 30s window for smooth analysis
});

// Spectrum (64 frequency bins)
const spectrum = visualizeAudio({
  fps, frame, audioData,
  numberOfSamples: 64,
  optimizeFor: "speed",
  dataOffsetInSeconds
});

// Waveform (time-domain)
const waveform = visualizeAudioWaveform({
  fps, frame, audioData,
  numberOfSamples: 200,
  windowInSeconds: 0.4,
  dataOffsetInSeconds
});
```

### Lyric Synchronization
Use pre-analyzed timestamps for frame-perfect accuracy:

```tsx
type LyricLine = { start: number; end: number; text: string; section: string };

// Find current lyric based on elapsed time
const t = frame / fps;
const currentLyric = lyrics.find(l => t >= l.start && t < l.end);
const lyricProgress = (t - currentLyric.start) / (currentLyric.end - currentLyric.start);

// Per-word reveal
words.map((word, i) => {
  const wordStart = i / words.length;
  const wordEnd = (i + 1) / words.length;
  const active = lyricProgress >= wordStart && lyricProgress < wordEnd;
  return <span style={{ opacity: active ? 1 : 0.3 }}>{word}</span>;
});
```

### Spring Physics for Beat Sync
```tsx
import { spring } from "remotion";

// 136 BPM → ~13.2 frames per beat at 30fps
const beatFrames = (60 / bpm) * fps;
const beatSpring = spring({
  frame: frame % beatFrames,
  fps,
  config: { damping: 18, stiffness: 140, mass: 0.7 }
});
```

## Visual Layer Architecture

Each layer reacts to a different aspect of the audio:

| Layer | Audio Input | Effect |
|-------|-------------|--------|
| Background | Energy level | Gradient color shift, glow intensity |
| 3D Element | Bass + Treble | Scale pulse, rotation, position |
| Particles | Beat detection | Spawn burst on beat |
| Lyrics | Lyric timestamps | Word-by-word reveal |
| Waveform | Time-domain data | SVG path animation |
| Bento | Spectrum | Spectrum bars, metadata |

## Transitions
- Wipe at every section boundary (librosa-detected)
- Duration: 0.9s with Bezier easing
- Use diagonal gradient wipe for cohesion

## References
- [Phase-Viz](https://github.com/7g3n/phase-viz) - Open-source browser audio-reactive 3D visualizer
- [web-audio-beat-detector](https://github.com/chrisguttandin/web-audio-beat-detector) - Beat detection utility
- [Freebeat.ai](https://freebeat.ai) - Structure-aware visualization
- [Remotion Audio Docs](https://www.remotion.dev/docs/using-audio/)
- [Music Visualizer Research](https://github.com/KaranChandekar/music-visualizer) - R3F + Web Audio API patterns

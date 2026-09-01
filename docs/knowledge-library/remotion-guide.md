---
title: Remotion Video Compositing Guide
tags: [remotion, video, compositing, react, music-video]
aliases: [Remotion Guide, Video Composition, Remotion Patterns]
date: 2026-09-01
cssclasses: [technical-reference]
---

# 🎬 Remotion Video Compositing Guide

> [!info] Purpose
> Programmatic video creation with React + Remotion. This guide covers the patterns used in Native Media AI Studio for music video production.

## Overview

Remotion lets you define videos using React components. Each frame is rendered based on `useCurrentFrame()` and `useVideoConfig()`.

**Key Packages:**
- `remotion` — Core library (Composition, Sequence, Audio, Img, interpolate, spring)
- `@remotion/media-utils` — Audio visualization (useWindowedAudioData, visualizeAudio, visualizeAudioWaveform)
- `@remotion/three` — Three.js integration (ThreeCanvas)
- `@remotion/effects` — Post-processing (blur, etc.)
- `@remotion/bundler` — Programmatic rendering

## Project Structure

```
packages/video-editor/
├── src/
│   ├── Root.tsx                    # Entry point with Composition registry
│   ├── Composition.tsx             # Main composition (Signal Breaking Through Noise)
│   ├── index.ts                    # Remotion CLI entry
│   ├── compositions/               # Individual video compositions
│   │   ├── StillIRise.tsx
│   │   ├── TakeTheCrown.tsx
│   │   └── SiliconDreamsPreview.tsx
│   └── components/
│       └── StudioBackButton.tsx    # Shared UI component
```

## Core Patterns

### 1. Composition Definition

```tsx
import { Composition } from "remotion";

<Composition
  id="MyVideo"
  component={MyComponent}
  durationInFrames={7269}  // 242.32s @ 30fps
  fps={30}
  width={1920}
  height={1080}
  defaultProps={{
    visualSrc: "",
    visualStyle: "bars",
    colorScheme: "neon",
  }}
/>
```

### 2. Frame-Based Animation

```tsx
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";

function MyComponent() {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  
  const t = frame / fps;  // Time in seconds
  const progress = frame / totalFrames;
  
  // Interpolate values
  const opacity = interpolate(progress, [0, 0.1, 0.9, 1], [0, 1, 1, 0]);
  
  // Eased animation
  const x = interpolate(progress, [0, 1], [-100, 100], {
    easing: Easing.bezier(0, 0, 0.2, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  
  return <div style={{ opacity, transform: `translateX(${x}px)` }} />;
}
```

### 3. Audio-Reactive Animation

```tsx
import { useWindowedAudioData, visualizeAudio, visualizeAudioWaveform } from "@remotion/media-utils";

function AudioReactiveComponent() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  
  // Get windowed audio data (30s window for smooth analysis)
  const { audioData, dataOffsetInSeconds } = useWindowedAudioData({
    src: staticFile("song.mp3"),
    frame,
    fps,
    windowInSeconds: 30,
  });
  
  // Visualize as frequency spectrum (64 samples)
  const spectrum = audioData
    ? visualizeAudio({ fps, frame, audioData, numberOfSamples: 64, optimizeFor: "speed", dataOffsetInSeconds })
    : new Array(64).fill(0);
  
  // Visualize as waveform (280 points)
  const waveform = audioData
    ? visualizeAudioWaveform({ fps, frame, audioData, numberOfSamples: 280, windowInSeconds: 0.6, dataOffsetInSeconds })
    : new Array(280).fill(0);
  
  // Extract frequency bands
  const bass = spectrum.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
  const mid = spectrum.slice(10, 28).reduce((a, b) => a + b, 0) / 18;
  const treble = spectrum.slice(28, 52).reduce((a, b) => a + b, 0) / 24;
  
  return (
    <div style={{ transform: `scale(${1 + bass * 0.3})` }}>
      Bass level: {bass.toFixed(2)}
    </div>
  );
}
```

### 4. Spring Physics

```tsx
import { spring } from "remotion";

const beatSpring = spring({
  frame: frame % 14,  // 136 BPM → ~13.2 frames per beat at 30fps
  fps: 30,
  config: { damping: 18, stiffness: 180, mass: 0.6 }
});

// Use for smooth beat-reactive motion
const scale = 1 + (beatSpring - 0.5) * 0.1;
```

### 5. Three.js Integration

```tsx
import { ThreeCanvas } from "@remotion/three";
import * as THREE from "three";

<ThreeCanvas width={width} height={height} style={{ backgroundColor: "transparent" }}>
  <ambientLight intensity={0.5} />
  <directionalLight position={[4, 7, 5]} intensity={1.2} />
  <mesh castShadow receiveShadow>
    <icosahedronGeometry args={[0.95, 0]} />
    <meshStandardMaterial color="#818cf8" emissive="#818cf8" emissiveIntensity={0.5} />
  </mesh>
</ThreeCanvas>
```

### 6. Lyric Synchronization

```tsx
type LyricLine = { start: number; end: number; text: string; section: string };

const lyrics: LyricLine[] = [
  { start: 0, end: 4.5, text: "First line", section: "INTRO" },
  { start: 4.5, end: 9.0, text: "Second line", section: "VERSE" },
];

const t = frame / fps;
const currentLyric = lyrics.find(l => t >= l.start && t < l.end) ?? lyrics[0];
const lyricProgress = (t - currentLyric.start) / (currentLyric.end - currentLyric.start);
```

### 7. Section-Based Styling

```tsx
const isChorus = currentLyric.section.includes("CHORUS");
const isVerse = currentLyric.section.includes("VERSE");
const isBreakdown = currentLyric.section.includes("BREAKDOWN");

// Dynamic colors per section
const PALETTE = {
  intro: "hsl(218 92% 66%)",
  verse: "hsl(205 85% 66%)",
  chorus: "hsl(258 92% 66%)",
  breakdown: "hsl(28 72% 62%)",
};
```

## Rendering

### Preview (Dev Server)
```bash
cd packages/video-editor
npx remotion studio
# Opens at http://localhost:8080
```

### Render to Video
```bash
# Render specific composition
npx remotion render src/index.tsx MyComposition output.mp4

# Render with custom props
npx remotion render src/index.tsx MyComposition output.mp4 --props='{"visualStyle":"waveform"}'

# Render specific frames
npx remotion render src/index.tsx MyComposition output.mp4 --frames=0-100
```

### Programmatic Render (Node.js)
```tsx
import { renderMedia, selectComposition } from "@remotion/renderer";

const composition = await selectComposition({
  serveUrl: "path/to/bundle",
  id: "MyComposition",
  inputProps: {},
});

await renderMedia({
  composition,
  serveUrl: "path/to/bundle",
  codec: "h264",
  outputLocation: "output.mp4",
});
```

## Audio Analysis Integration

The backend provides pre-computed audio analysis that can drive animations:

```tsx
// Fetch from backend
const analysis = await fetch(`/api/audio/analysis/${filename}`).then(r => r.json());

// Use beat times for precise synchronization
const beatTimes = analysis.beat_times;  // Array of timestamps
const energyCurve = analysis.energy_curve;  // Array of energy values
const sections = analysis.sections;  // [{type, start, end, energy}]
```

## Post-Processing Effects

```tsx
import { blur } from "@remotion/effects/blur";

// Apply blur effect
<Video src={src} effects={[blur({ radius: 40 })]} />
```

## Best Practices

1. **Use `useWindowedAudioData`** for smooth audio analysis (30s window)
2. **Pre-compute expensive values** outside the render function
3. **Use `interpolate()`** for smooth value transitions
4. **Use `spring()`** for physics-based animations
5. **Clamp extrapolation** to prevent values outside expected ranges
6. **Memoize static data** (lyric lines, color palettes) outside components
7. **Use `AbsoluteFill`** for full-frame layouts
8. **Keep audio updates in refs** to avoid React re-renders

## Common Patterns

| Pattern | Use Case | API |
|---------|----------|-----|
| Fade in/out | Intro/outro | `interpolate(progress, [0, 0.1], [0, 1])` |
| Beat pulse | Bass-reactive scale | `spring({ frame: frame % beatFrames, fps })` |
| Section color | Mood changes | Section → color map |
| Lyric highlight | Word-by-word reveal | `lyricProgress >= wordStart && lyricProgress < wordEnd` |
| Camera movement | Dynamic shots | `interpolate` on position/rotation |
| Wipe transition | Section changes | Animated gradient overlay |

## References

- [Remotion Docs](https://www.remotion.dev/docs/)
- [Three.js Integration](https://www.remotion.dev/docs/three)
- [Audio Visualization](https://www.remotion.dev/docs/audio-visualization)
- [[music-video-production]] — Full production pipeline
- [[three-js-studio]] — Browser 3D scene builder
- [[visualization-effects]] — Shader/particle/post-processing library

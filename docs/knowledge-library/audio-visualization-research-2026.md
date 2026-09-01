---
title: Three.js Audio-Reactive Visualization Research 2026
tags: [three.js, audio-reactive, visualization, music-video, webgpu]
aliases: [Audio Visualizer Research, Music Visualization]
date: 2026-09-01
source: web-research
---

# Three.js Audio-Reactive Visualization Research 2026

> [!info] Summary
> Research findings from Three.js community and open-source projects for music video creation.

## Open Source Projects

### Phase-Viz (phase-viz)
- **URL**: https://github.com/7g3n/phase-viz
- **Demo**: https://waveform.tranjectories.xyz/
- **Features**:
  - Real-time volume, frequency, waveform analysis via Web Audio API
  - Audio-reactive 3D rendering with Three.js/WebGL
  - Multiple 3D, particle, waveform, image FX modes
  - Adjustable particle count, size, shape, camera distance, morph intensity
  - Fullscreen Live / VJ mode with keyboard controls
  - **Browser-based MP4 export** using WebCodecs (ffmpeg.wasm fallback)
- **Stack**: React, TypeScript, Vite, Three.js, Web Audio API, WebCodecs, ffmpeg.wasm, Zustand
- **Key Insight**: Workflow is `finished track → real-time visual adjustment → deterministic final video export`

### Web Audio + Three.js Starter
- **URL**: https://github.com/7g3n/web-audio-threejs-starter
- **Purpose**: Minimal educational setup for audio-reactive 3D
- **Pattern**: Load audio → Analyze (bass/mids/highs/waveform) → Map to mesh → Drive particles
- **Key Insight**: Keep high-frequency audio updates outside normal React rerenders

### AUDIOLAB
- **URL**: Three.js forum showcase
- **Focus**: Meditation/wonder/immersion through R3F audio visualization
- **Technique**: R3F useFrame for animation, Web Audio API for analysis

### Singularity
- **URL**: https://github.com/jleininger/singularity
- **Type**: Interactive music video with R3F
- **Note**: Early example (2022) but patterns still relevant

## Best Practices from Research

### Performance
1. **Keep audio analysis outside React state** — use refs for high-frequency data
2. **Use instancing** for particle systems (1000+ objects)
3. **BVH collision** for interactive scenes
4. **Baked lighting** for static scenes
5. **WebGPU renderer** with WebGL fallback for 2026

### Audio-Reactive Patterns
1. **Binary search** for beat detection on pre-analyzed beat_times arrays
2. **Smoothed energy** interpolation for sub-beat motion
3. **Frequency bin mapping** — bass/mid/treble to different visual elements
4. **Beat window** — configurable time window after onset for trigger effects

### Architecture
```typescript
// Recommended pattern for audio-reactive Three.js
const analyserRef = useRef<AnalyserNode>();
const dataRef = useRef<Float32Array>();
const beatIdxRef = useRef(-1);

useFrame(() => {
  if (!analyserRef.current) return;
  
  // Get audio data (outside React state)
  analyserRef.current.getByteFrequencyData(dataRef.current);
  
  // Calculate bass/mid/treble
  const bass = average(dataRef.current, 0, 10);
  const mid = average(dataRef.current, 10, 60);
  const treble = average(dataRef.current, 60, 128);
  
  // Apply to scene
  mesh.scale.setScalar(1 + bass * 0.01);
});
```

## Integration Opportunities for Native Media AI Studio

1. **MP4 Export** — WebCodecs-based export like Phase-Viz
2. **Preset System** — Reusable visual templates per genre
3. **VJ Mode** — Live performance mode with keyboard controls
4. **Deterministic Export** — Render final video from finished track

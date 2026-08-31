# Audio Visualization Techniques & Best Practices (2026)

> Research compiled: 2026-08-29
> Sources: Three.js community, academic papers, open-source projects, industry guides

## Core Audio Analysis Pipeline

### Frequency Band Separation
The standard approach uses FFT → frequency bands → visual mapping:
- **Bass**: 20-250Hz → scale, expansion, heavy motion
- **Mid**: 250-4000Hz → deformation, color shifts, primary motion
- **Treble**: 4000-20000Hz → particles, sparkle, fine detail

**Critical**: Calculate bin indices from actual sample rate, not fixed percentages:
```
binSize = sampleRate / (binCount * 2)
bassBins = floor(250 / binSize)
midBins = floor(4000 / binSize)
```

### Beat Detection
Two approaches, often combined:
1. **Runtime**: Bass spike detection with cooldown (simple, works without pre-analysis)
2. **Pre-analyzed**: Beat times from librosa/CUDA analysis (frame-accurate, enables look-ahead)

### Smoothing
Always smooth audio values to prevent jitter:
- `smoothingTimeConstant = 0.8` on AnalyserNode
- Exponential moving average in animation loop
- Lerp between current and target values

## Visual Mapping Strategies

### The "Vortex" Pattern (from vortex-av-engine)
- Bass expands an inner core
- Midrange deforms a wireframe polyhedron
- High-frequency transients disperse a surrounding particle field

### The "Phase-Viz" Pattern (from phase-viz, MIT license)
- Multiple visual layers with adjustable order
- Particle systems driven by frequency data
- Mesh deformation based on amplitude
- Waveform and image FX modes

### Vertex Displacement Pattern (from Audio-visualizer-3d)
- Each vertex mapped to a frequency bin
- Displacement intensity = frequency amplitude
- Color shifts cool→warm based on displacement

## Genre-to-Visual Mapping

| Genre | Motion | Color | Pacing | Best Techniques |
|-------|--------|-------|--------|-----------------|
| EDM/Electronic | Aggressive, geometric | Luminous, saturated | Fast, frequent pulses | Particles, light trails, pulsing |
| Hip-Hop | Character-led, graphic | Bold, high-contrast | Beat-synced accents | Central performer, quick visuals |
| Rock | Texture, live-energy | Grain, distorted | Fast cuts, high contrast | Stage lighting, distorted textures |
| Indie | Cinematic, slow | Soft, film-inspired | Gradual changes | Camera movement, landscapes |
| Ambient | Slow, abstract | Muted, gradual | Long loops, low frequency | Floating particles, terrain |
| Lo-Fi | Gentle, illustrated | Warm, cozy | Recurring motifs | Animated illustration, soft loops |
| R&B | Minimal, polished | Elegant, reflective | Slow, smooth | Light movement, close-ups |
| Pop | Performance + color | Bold, glossy | Chorus-driven shifts | Color changes at sections |

## Mood-to-Color Mapping (from academic research)

Research shows mood and timbre can drive visual signatures:
- **Euphoric**: Expanding light, saturated colors, upward camera
- **Dark**: Restrained lighting, shadows, metallic/urban textures
- **Dreamy**: Floating motion, soft transitions, haze
- **Aggressive**: Sharp cuts, distorted textures, rapid camera
- **Intimate**: Close framing, subtle motion, warm environments

## Open Source Projects (MIT License — Code Recyclable)

### phase-viz (github.com/7g3n/phase-viz)
- React + TypeScript + Vite + Three.js
- Multiple 3D, particle, waveform, image FX modes
- Adjustable particle count, size, shape, camera distance
- Browser-based MP4 export
- Zustand for state management

### web-audio-threejs-starter (github.com/7g3n/web-audio-threejs-starter)
- Minimal R3F starter for audio-reactive visuals
- Loads local audio, analyzes volume/bass/mids/highs
- Maps signals to Three.js mesh
- Drives particle system in real-time
- Keeps high-frequency audio updates outside React rerenders

### vortex-av-engine (github.com/zazieproductions/vortex-av-engine)
- Frequency bands reshape procedural WebGL scene
- Bass → inner core expansion
- Midrange → wireframe polyhedron deformation
- High-frequency → particle field dispersion

### Audio-visualizer-3d (github.com/Shadowwyyy/Audio-visualizer-3d)
- 20 different 3D shapes
- Real-time vertex displacement based on frequency
- Color shifts cool→warm based on displacement intensity
- Smoothing applied to prevent jitter

### Three-JS-Music-Visualiser (github.com/jhancock532/Three-JS-Music-Visualiser)
- Circle segments mapped to frequency bins
- HSL color mapping across spectrum
- dat.GUI for parameter tweaking

## Performance Best Practices

1. **Keep audio updates outside React state** — Use refs and `useFrame`, not `useState`
2. **BufferGeometry over Geometry** — BufferGeometry is the only geometry type since r171
3. **InstancedMesh** — For repeated elements (particles, bars)
4. **Smoothing at multiple levels** — AnalyserNode + animation loop lerp
5. **Avoid per-frame allocations** — Reuse Float32Arrays, don't create new objects in useFrame
6. **Draw call budget** — Target <100 draw calls for 60fps

## UX Best Practices

1. **Match visual pacing to musical pacing** — Dense tracks support frequent pulses; slow tracks need gradual changes
2. **Section-aware changes** — Save transformations for chorus, drop, instrumental break
3. **Genre-appropriate color system** — Electronic = luminous/saturated; Lo-fi = warm/soft
4. **Beat-synced effects** — Use pre-analyzed beat times for frame-accurate synchronization
5. **Demo mode** — Synthetic animation when no track is playing (so the scene isn't dead)
6. **Reduce motion option** — Disable flashing/rapid movement for accessibility

## Key Technical Details

### AnalyserNode Settings
```ts
analyser.fftSize = 2048;              // Good balance of resolution/performance
analyser.smoothingTimeConstant = 0.8; // Smooth, stable values
```

### Frequency Data Access
```ts
analyser.getByteFrequencyData(uint8Array); // 0-255 range
analyser.getByteTimeDomainData(uint8Array); // Waveform data
```

### Smoothing in Animation Loop
```ts
// Exponential moving average
smoothed += (raw - smoothed) * smoothFactor;
// Lerp toward target
current += (target - current) * lerpSpeed;
```

## References
- [phase-viz GitHub](https://github.com/7g3n/phase-viz)
- [web-audio-threejs-starter GitHub](https://github.com/7g3n/web-audio-threejs-starter)
- [vortex-av-engine GitHub](https://github.com/zazieproductions/vortex-av-engine)
- [Audio-visualizer-3d GitHub](https://github.com/Shadowwyyy/Audio-visualizer-3d)
- [Three-JS-Music-Visualiser GitHub](https://github.com/jhancock532/Three-JS-Music-Visualiser)
- [Visual signatures for music mood and timbre](https://link.springer.com/article/10.1007/s00371-024-03417-z)
- [Coding a 3D Audio Visualizer — Codrops](https://tympanus.net/codrops/2025/06/18/coding-a-3d-audio-visualizer-with-three-js-gsap-web-audio-api/)
- [8 Music Visualizer Ideas by Genre](https://freebeat.ai/articles/8-music-visualizer-ideas-for-different-music-genres)
- [The Ultimate Guide to 3D Music Visualizers](https://beatsee.app/blog/3d-music-visualizer-guide)

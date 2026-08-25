---
tags:
  - three-js
  - 3d-rendering
  - browser
  - particles
  - reflections
  - music-video
aliases:
  - Three.js Studio
  - Browser 3D
  - WebGL Studio
cssclasses:
  - technical-guide
date: 2026-08-24
---

# 🌐 Three.js Studio

> [!info] Purpose
> Browser-based 3D scene builder for music video production.
> Runs entirely in the browser using WebGL - no external software needed.
> Perfect for creating animated 3D scenes with particles, reflections, and beat sync.

---

## Features

### Core Capabilities
- **Real-time 3D rendering** via WebGL (Three.js)
- **Particle systems** with customizable count, size, color, speed
- **Reflective materials** (metalness, roughness, emissive)
- **Multiple light types** (ambient, directional, spot, point)
- **Camera modes** (static, orbit, dolly, handheld)
- **Post-processing** (bloom/glow effects)
- **Frame export** as PNG
- **Video recording** (frame sequence capture)

### Music Video Specific
- **Beat sync animation** hooks for synchronizing to audio
- **Camera movement presets** for different song sections
- **Color palette control** for mood consistency
- **Particle effects** for energy and atmosphere
- **Reflective floor** for professional look

---

## Scene Objects

### Crown (Music Video Prop)
The default scene includes a stylized crown with:
- Gold metallic band (high metalness, low roughness)
- 8 spikes around the band
- Glowing purple gem center (emissive)
- Gentle rotation and bob animation

### Adding Objects
Objects are added via the toolbar:
1. **Crown** - Adds a pre-built crown prop
2. **Particles** - Adds particle system
3. **Export Frame** - Saves current frame as PNG
4. **Record** - Captures frame sequence for video

---

## Particle System

| Property | Range | Default | Effect |
|----------|-------|---------|--------|
| Count | 100-10000 | 500 | Number of particles |
| Size | 0.01-0.1 | 0.03 | Particle size in world units |
| Color | Any | #8b5cf6 | Particle color |
| Speed | 0-5 | 1.0 | Rise speed |
| Spread | 1-20 | 5 | Spread radius |
| Opacity | 0-1 | 0.8 | Particle transparency |

> [!tip] Music Video Particles
> - **Chorus**: Fast, many particles, bright colors
> - **Verse**: Slow, few particles, muted colors
> - **Bridge**: Unique colors, medium speed

---

## Reflections & Materials

### Material Properties
| Property | Range | Effect |
|----------|-------|--------|
| Metalness | 0-1 | How metallic the surface appears |
| Roughness | 0-1 | How rough/smooth the surface is |
| Emissive | Color | Self-illumination color |
| Emissive Intensity | 0-5 | Glow strength |

### Preset Materials
| Material | Metalness | Roughness | Emissive | Use For |
|----------|-----------|-----------|----------|---------|
| Gold | 0.9 | 0.1 | #ff8c00 | Crown, jewelry |
| Chrome | 1.0 | 0.05 | none | Modern props |
| Glass | 0.0 | 0.0 | #8b5cf6 | Glowing gems |
| Matte | 0.0 | 1.0 | none | Background objects |

---

## Lighting Setup

### Four-Point Lighting
1. **Ambient** - Base illumination (low intensity, cool color)
2. **Directional** - Main light source (white, casts shadows)
3. **Spot** - Dramatic accent (colored, focused beam)
4. **Point** - Fill light (warm/cool accent)

### Music Video Lighting Moods
| Mood | Ambient | Directional | Spot | Point |
|------|---------|-------------|------|--------|
| Happy | Warm, medium | Bright | Yellow | Pink |
| Sad | Cool, low | Soft | Blue | Purple |
| Energetic | Low | Harsh | Magenta | Cyan |
| Calm | Warm, high | Soft | Orange | Pink |

---

## Camera Modes

| Mode | Description | Best For |
|------|-------------|----------|
| Static | Fixed position | Performance shots |
| Orbit | Circles around subject | Showcase, drama |
| Dolly | Moves toward/away | Build intensity |
| Handheld | Slight random movement | Energy, documentary |

### Camera Movement by Section
| Section | Mode | Speed |
|---------|------|-------|
| Intro | Dolly (in) | Slow |
| Verse | Static or orbit | Slow |
| Pre-Chorus | Dolly (in) | Medium |
| Chorus | Orbit or handheld | Fast |
| Bridge | Orbit | Medium |
| Outro | Dolly (out) | Slow |

---

## Post-Processing

### Bloom/Glow
The scene includes Unreal Bloom post-processing for:
- Glowing emissive objects
- Light bleed effects
- Dreamy atmosphere

| Parameter | Range | Default | Effect |
|-----------|-------|---------|--------|
| Strength | 0-2 | 0.5 | Intensity of bloom |
| Radius | 0-1 | 0.4 | Spread of glow |
| Threshold | 0-1 | 0.85 | What brightness triggers bloom |

---

## Export Options

### Frame Export
- Click **Export Frame** to save current view as PNG
- Resolution matches canvas size
- Useful for thumbnails or still renders

### Video Recording
- Click **Record** to start capturing frames
- Frames captured at selected FPS (24/30/60)
- Click again to stop and download all frames
- Compile frames into video externally (FFmpeg, etc.)

> [!tip] Video Creation
> 1. Record at 24fps for cinematic look
> 2. Record at 30fps for standard video
> 3. Use FFmpeg to compile frames: `ffmpeg -framerate 24 -i frame_%04d.png -c:v libx264 -pix_fmt yuv420p output.mp4`

---

## Beat Synchronization

### Hook System
The studio provides a `beatCallback` that fires every frame:
```javascript
beatCallbackRef.current = (elapsedTime) => {
  // Sync animations to audio beats
  // Example: trigger effect on beat
};
```

### Sync Strategies
| Strategy | Implementation |
|----------|---------------|
| Cut on beat | Change camera angle at beat times |
| Pulse on beat | Scale objects to beat |
| Color shift | Change light color on chorus |
| Particle burst | Emit particles on drops |

---

## Performance Tips

### For 8GB VRAM (GTX 1070 Ti)
- Keep particle count under 2000
- Use moderate bloom settings
- Limit reflective objects to 3-5
- Use 1920x1080 or lower resolution

### Optimization
- Disable shadows if not needed
- Reduce particle count for faster export
- Lower bloom quality for real-time preview
- Increase for final render

---

## Technical Details

### Stack
- **Three.js** - WebGL rendering library
- **React** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool

### Browser Requirements
- WebGL 2.0 support
- Modern browser (Chrome, Firefox, Edge)
- Hardware acceleration enabled

### Dependencies
```json
{
  "three": "^0.160.0",
  "@types/three": "^0.160.0"
}
```

---

## See Also

- [[music-video-production]] - Full production workflow
- [[3d-rendering]] - GPU rendering optimization
- [[blender-mcp]] - Blender integration for advanced scenes
- [[prompt-engineering]] - Visual style prompts
- [[youtube-optimization]] - Export settings for platforms

---

*Last updated: 2026-08-24*

# Native Media Visualizer

Standalone Unity project for creating audio-reactive visualizations for tracks in the Native Media AI Studio media library.

## Purpose

This project is dedicated to developing and testing audio visualization effects, beat-synced animations, and real-time audio-reactive visuals. It is separate from the Unity MCP project (`unity-project-mcp/`) which handles the music-video capture pipeline.

## Tech Stack

- **Unity 6000.6.0f1**
- **URP 17.0.0** (Universal Render Pipeline)
- **VFX Graph 17.0.0** (for particle effects)
- **C# / .NET**

## Project Structure

```
unity-visualizer/
├── Assets/
│   ├── Scripts/
│   │   ├── Audio/          # Audio analysis, beat detection
│   │   ├── Visuals/        # Reactive materials, beat pulse, visual effects
│   │   └── UI/             # Editor tools, wizards
│   ├── Shaders/            # Custom HLSL shaders
│   ├── Materials/          # Visual materials
│   ├── Scenes/             # Unity scenes
│   ├── Prefabs/            # Reusable visualizer prefabs
│   ├── Settings/           # URP pipeline assets
│   └── Editor/             # Editor scripts, setup wizards
├── Packages/               # Unity package manifest
└── ProjectSettings/        # Unity project settings
```

## Getting Started

### 1. Open the Project

Open the project in Unity 6000.6.0f1 or later.

### 2. Run URP Setup

After Unity imports packages:
1. Go to **NativeMediaVisualizer > Setup URP Pipeline**
2. Click **Create/Update URP Pipeline Asset**
3. Click **Configure Graphics Settings**

### 3. Create Demo Scene

1. Go to **NativeMediaVisualizer > Setup Demo Scene**
2. Click **Create Demo Scene**
3. This creates a grid of reactive cubes and a central pulsing sphere

### 4. Add Audio

1. Select the `AudioSource` object in the demo scene
2. Assign an audio clip in the Inspector
3. Press Play to see the visualization

## Core Components

### AudioAnalyzer

Main audio analysis component. Attach to any GameObject to start analyzing audio.

```csharp
public class AudioAnalyzer : MonoBehaviour
{
    public AudioSource audioSource;
    public int sampleSize = 1024;
    public FFTWindow fftWindow = FFTWindow.BlackmanHarris;
    public int bandCount = 8;
    
    public float[] SmoothedBandValues { get; }
    public bool IsBeat { get; }
    public float BeatIntensity { get; }
}
```

### AudioReactiveBase

Base class for custom audio-reactive behaviors. Subclass to create your own effects.

```csharp
public class MyReactiveEffect : AudioReactiveBase
{
    protected override void Update()
    {
        base.Update();
        // Use CurrentValue (0-1) to drive your visual
        transform.localScale = Vector3.one * (1 + CurrentValue * 2);
    }
}
```

### BeatPulse

Ready-to-use beat-synced pulse effect. Attach to any GameObject with a Renderer.

```csharp
public class BeatPulse : MonoBehaviour
{
    public AudioAnalyzer analyzer;
    public float pulseScale = 1.3f;
    public float pulseDuration = 0.15f;
}
```

### AudioReactiveMaterial

Drives material properties (emission, color) from audio data without custom shaders.

```csharp
public class AudioReactiveMaterial : MonoBehaviour
{
    public AudioAnalyzer analyzer;
    public Renderer targetRenderer;
    public int bandIndex = 0;
}
```

## Features

- **Real-time FFT analysis** — 8 frequency bands with configurable range
- **Beat detection** — Energy-based with cooldown and threshold
- **Smoothing** — Exponential moving average + decay buffer
- **DSP-accurate timing** — Ready for beat-synced animations
- **Material reactivity** — Drive emission/color via MaterialPropertyBlock
- **VFX Graph ready** — Custom property binders can be added

## Performance Targets

- Audio analysis: < 1ms per frame
- Band updates: < 0.5ms per frame
- Total audio+visual budget: < 5ms per frame at 60fps

## Knowledge Base

See `docs/knowledge/unity-audio-visualization-2026.md` for:
- FFT spectrum theory and best practices
- Shader-based audio reactivity patterns
- VFX Graph integration
- Beat detection algorithms
- DSP clock synchronization
- Unity 6.x audio system updates

## Protected Directory

> [!warning] CRITICAL: This directory (`unity-visualizer/`) is a protected project directory. Do not delete or move it during directory audits or cleanup. It is a standalone Unity project dedicated to track audio visualization and must not be conflated with `unity-project-mcp/`.

## Next Steps

- [ ] Create custom audio-reactive shaders (HLSL + Shader Graph)
- [ ] Add VFX Graph particle systems for audio
- [ ] Implement timeline-based visualization sequences
- [ ] Add track metadata import from media library
- [ ] Build export pipeline for rendered visualizations

---
tags:
  - unity
  - audio
  - visualization
  - shader-graph
  - vfx-graph
  - timeline
  - beat-detection
  - urp
  - 2026
aliases:
  - Unity Audio Visualization
  - Audio Reactive Unity
  - Unity Beat Sync
  - Unity DSP Timing
cssclasses:
  - technical-guide
  - unity-guide
date: 2026-09-08
research_date: 2026-09-08
sources: 15
---

# 🎵 Unity Audio Visualization & Audio-Synced Visuals — 2026 Best Practices

> [!info] Scope
> Production-ready guide for creating audio-reactive visuals and beat-synced animations in Unity 6.x with URP. Covers real-time FFT analysis, shader reactivity, VFX Graph, Timeline sync, beat detection, and performance optimization.
>
> [!tip] Companion Docs
> - [[../knowledge/audio-visualization-techniques-2026|General Audio Visualization Techniques]]
> - [[../knowledge-library/visualization-effects.md|Visualization Effects Library (WebGPU/TSL)]]
> - [[../knowledge-library/lyric-beat-visualization-2026|Code-Driven Lyric + Beat Visualization (HyperFrames/HTML)]]

---

## 1. Core Audio Analysis in Unity

### 1.1 FFT Spectrum Data

Unity provides `AudioSource.GetSpectrumData()` for real-time frequency analysis:

```csharp
// ✅ 2026 — Pre-allocate array, use non-allocating overload
float[] spectrum = new float[512]; // Must be power of 2: 64-8192

void AnalyzeAudio()
{
    audioSource.GetSpectrumData(spectrum, 0, FFTWindow.BlackmanHarris);
}
```

**Key parameters**:
- `samples`: Pre-allocated float array (power of 2, min 64, max 8192)
- `channel`: Audio channel to sample (0 = left/mono)
- `window`: `FFTWindow.Rectangular` (fastest), `BlackmanHarris` (best for music analysis), `Hann`, `Hamming`

**Critical notes**:
- Unity allocates history buffers on first call — initial data is empty until engine populates
- `GetSpectrumData` is **not suited for critical real-time analysis** with low latency requirements
- Uses `AudioSettings.outputSampleRate`, not the clip's sample rate
- Frequency bins are evenly spaced from 0 to Nyquist (sampleRate / 2)

### 1.2 Frequency Band Separation

```csharp
// Calculate actual frequency boundaries from sample rate
float binSize = AudioSettings.outputSampleRate / (spectrum.Length * 2);
int bassBins = Mathf.FloorToInt(250f / binSize);      // ~20-250Hz
int midBins = Mathf.FloorToInt(4000f / binSize);      // ~250-4000Hz
// Treble = remaining bins (4000-20000Hz)
```

**Standard band mapping**:
- **Bass** (20-250Hz): Scale, expansion, heavy motion, camera shake
- **Mid** (250-4000Hz): Deformation, color shifts, primary motion
- **Treble** (4000-20000Hz): Particles, sparkle, fine detail

### 1.3 Waveform Data

For time-domain analysis (waveform visualization):

```csharp
float[] waveform = new float[512];
audioSource.GetOutputData(waveform, 0); // Time domain, -1 to 1
```

---

## 2. Audio-Visual Synchronization

### 2.1 The DSP Clock (Critical for Rhythm Games)

**The fundamental rule**: Audio runs on the DSP clock, visuals run on the frame-based `Update()` loop. These must be reconciled explicitly.

```csharp
// ✅ CORRECT — DSP-accurate beat position
double GetCurrentBeatPosition(double dspStartTime, double bpm)
{
    double secondsPerBeat = 60.0 / bpm;
    double elapsed = AudioSettings.dspTime - dspStartTime;
    return elapsed / secondsPerBeat;
}

// ❌ WRONG — Frame-based drift
float beatPosition = Time.time * bpm / 60f;
```

### 2.2 Sample-Accurate Audio Scheduling

```csharp
// ✅ Use PlayScheduled for multi-source sync
AudioSource.PlayScheduled(dspTime);

// ❌ Avoid Play() for rhythm-critical audio
// audioSource.Play(); // Not guaranteed to align across sources
```

**Why it matters**: `Play()` calls aren't guaranteed to align to the same sample position across different AudioSources. `PlayScheduled()` against `AudioSettings.dspTime` ensures sample-accurate alignment.

### 2.3 Timeline Sync with DSP Clock

For cutscenes and cinematic sequences:

```csharp
// Set PlayableDirector to DSP Clock mode
// Inspector: Update Mode = DSP Clock

// ✅ Required for perfect audio-visual sync during frame drops
public class TimelinePauseManager : MonoBehaviour
{
    public PlayableDirector playableDirector;
    
    public void TogglePause()
    {
        if (isGamePaused)
        {
            Time.timeScale = 0f;
            playableDirector.Pause(); // REQUIRED when using DSP Clock
        }
        else
        {
            Time.timeScale = 1.0f;
            playableDirector.Play();
        }
    }
}
```

**Why DSP Clock**: When frame rate drops, the game clock (`Time.time`) lags, but the DSP clock continues at constant pitch. DSP Clock mode makes the timeline follow audio playback position, preventing lip-sync drift.

---

## 3. Shader-Based Audio Reactivity

### 3.1 Passing Audio Data to Shaders

**Approach 1: Material Property Blocks (per-instance)**

```csharp
private MaterialPropertyBlock mpb;

void Update()
{
    float bass = GetBandAverage(0, bassBins);
    mpb.SetFloat("_BassIntensity", bass);
    renderer.SetPropertyBlock(mpb);
}
```

**Approach 2: Float Array via `SetFloatArray()` (HLSL only)**

```csharp
// Shader: float frequencyData[256]; (in HLSL, NOT Properties block)
material.SetFloatArray("frequencyData", spectrumData);
```

**Note**: Shader Graph does NOT support float array properties — use HLSL or pass individual float values.

### 3.2 Shader Graph Audio Reactivity

```csharp
// Pass individual band values to Shader Graph
material.SetFloat("_Bass", bassValue);
material.SetFloat("_Mid", midValue);
material.SetFloat("_Treble", trebleValue);
material.SetFloat("_Amplitude", overallAmplitude);
```

In Shader Graph:
1. Create **Float** properties for each audio value
2. Use **Property** node to expose them
3. Connect to **Vertex Position**, **Color**, **Emission**, etc.

### 3.3 HLSL Audio-Reactive Shader Pattern

```hlsl
// Vertex displacement based on audio
float bass = _BassIntensity * 0.5;
float noise = snoise(positionLocal * 2.0 + _Time.y);
float3 displaced = positionLocal + normal * noise * bass;

// Fragment color shift
float3 color = lerp(coolColor, warmColor, _Amplitude);
emission = color * _BassIntensity * 2.0;
```

### 3.4 Compute Shader Audio Reactivity (GPU-Driven)

For high-performance GPU-driven visualizations:

```csharp
// CPU: Upload spectrum to compute shader buffer
computeShader.SetFloatArray("audioBands", bandValues);
computeShader.SetFloat("amplitude", overallAmplitude);

// GPU: Generate/modify geometry entirely on GPU
computeShader.Dispatch(0, width/8, length/8, 1);
```

**Example pattern** (from `compute-audio-noise-grid`):
- Audio FFT → 8 frequency bands with exponential bin sizes
- Decay buffer smooths raw values
- Compute shader generates grid of cubes with Perlin noise
- Cube height = `lerp(baseHeight, noise^exponent * amplitude, smoothstep(0,1,amplitude))`

---

## 4. VFX Graph Audio Integration

### 4.1 Built-in Audio Spectrum Binder

Unity VFX Graph includes built-in audio support:

```
VFX Property Binder → Audio Spectrum → Attribute Map
```

This bakes audio spectrum to a `Texture2D` attribute map automatically.

### 4.2 Custom Property Binders

Extend `VFXBinderBase` for custom audio-driven VFX:

```csharp
[VFXBinder("Audio/Bass Pulse")]
public class BassPulseBinder : VFXBinderBase
{
    [VFXPropertyBinding("System.Single")]
    public ExposedProperty bassProperty;
    
    public AudioSource audioSource;
    private float[] spectrum = new float[512];
    
    public override bool IsValid(VisualEffect component)
    {
        return audioSource != null && component.HasFloat(bassProperty);
    }
    
    public override void UpdateBinding(VisualEffect component)
    {
        audioSource.GetSpectrumData(spectrum, 0, FFTWindow.BlackmanHarris);
        float bass = GetBandAverage(0, 10);
        component.SetFloat(bassProperty, bass);
    }
}
```

### 4.3 Output Events for Audio-Triggered VFX

```csharp
// VFX Graph: Output Event named "OnBeat"
// C#: Listen for the event
public class BeatVFXHandler : MonoBehaviour
{
    public VisualEffect vfx;
    
    void OnEnable()
    {
        vfx.visualEvent += OnVFXEvent;
    }
    
    void OnVFXEvent(VFXEventType eventType, VFXEventAttribute eventData)
    {
        if (eventType == VFXEventType.OutputEvent)
        {
            // Trigger audio, camera shake, etc.
        }
    }
}
```

---

## 5. Beat Detection

### 5.1 Energy-Based Detection (Simple)

```csharp
public class SimpleBeatDetector : MonoBehaviour
{
    public AudioSource audioSource;
    public float beatThreshold = 1.5f;
    public float beatCooldown = 0.2f;
    
    private float[] spectrumHistory = new float[43]; // ~1 second at 60fps
    private float lastBeatTime;
    
    void Update()
    {
        audioSource.GetSpectrumData(spectrum, 0, FFTWindow.BlackmanHarris);
        float bassEnergy = GetBandEnergy(0, 10);
        
        float average = spectrumHistory.Average();
        float threshold = average * beatThreshold;
        
        if (bassEnergy > threshold && Time.time - lastBeatTime > beatCooldown)
        {
            OnBeatDetected();
            lastBeatTime = Time.time;
        }
        
        // Shift history
        Array.Copy(spectrumHistory, 1, spectrumHistory, 0, spectrumHistory.Length - 1);
        spectrumHistory[spectrumHistory.Length - 1] = bassEnergy;
    }
}
```

### 5.2 Spectral Flux Detection (Advanced)

For melodic/harmonic changes, detect onset using spectral flux:

```csharp
// Compare current spectrum to previous frame
float spectralFlux = 0;
for (int i = 0; i < spectrum.Length; i++)
{
    float diff = spectrum[i] - previousSpectrum[i];
    if (diff > 0) spectralFlux += diff; // Rectified flux
}
```

**Open-source options**:
- **Beat** (`com.mortise.beat`): Lightweight beat detector with sub-bass/bass/mid/high bands, rolling energy history, threshold multiplier, cooldown
- **RASTA**: Multi-threaded spectral analysis tool for Unity, 8 spectral + 2 time-domain descriptors
- **musical-analysis**: Comprehensive real-time beat detection with BPM analysis, confidence scoring, multiple detection methods

### 5.3 Pre-Analyzed Beats (Production Rhythm Games)

```csharp
// Pre-process audio offline for frame-accurate beat times
// (librosa in Python → JSON → Unity)
public class BeatMapPlayer : MonoBehaviour
{
    public List<double> beatTimes; // Pre-analyzed beat timestamps
    public int nextBeatIndex;
    
    void Update()
    {
        double currentTime = audioSource.time;
        while (nextBeatIndex < beatTimes.Count && 
               beatTimes[nextBeatIndex] <= currentTime)
        {
            TriggerBeatEffects(beatTimes[nextBeatIndex]);
            nextBeatIndex++;
        }
    }
}
```

---

## 6. Audio-Reactive Animation

### 6.1 DSP-Synced Animation Driving

```csharp
// ✅ Drive animations from calculated beat phase, NOT Time.time
double beatPhase = GetCurrentBeatPosition(dspStartTime, bpm);
float normalizedPhase = (float)(beatPhase % 1.0); // 0-1 within current beat

// Use normalizedPhase to drive:
// - Animation curve evaluation
// - Particle emission rate
// - Light intensity pulsing
// - Camera shake intensity
```

### 6.2 AnimationClip Beat Synchronization

```csharp
// For pre-baked animations synced to audio
// Use Timeline with DSP Clock update mode
// Place animation clips at exact beat times
```

### 6.3 Character Animation States (Rhythm Games)

```csharp
[CreateAssetMenu(menuName = "RhythmGame/Character")]
public class CharacterDefinition : ScriptableObject
{
    public AudioClip loopClip;
    public float loopLengthBeats;
    public RuntimeAnimatorController animatorController;
    public VisualEffect idleVFX;
    public VisualEffect activeVFX;
}
```

**Pattern**: Data-driven character roster with audio loops, animation controllers, and VFX — designers can add characters without touching code.

---

## 7. Unity 6.x Audio System Updates

### 7.1 Scriptable Generators (Unity 6.5+)

Audio clips now implement `IAudioGenerator`, enabling nested generator trees:

```csharp
// Audio clips can be leaves in generator trees
// Streaming pipeline decodes samples in async background jobs
// Backed by AudioClip.CreateInstance(ControlContext, AudioFormat?, ...)
```

**Implication**: More flexible audio pipelines, async clip loading with `isLoading()`/`didLoadFail()` checks.

### 7.2 Enhanced Audio Foundation (Unity 6.5+)

- New transparent substitute audio backend (Windows, Mac, iOS, Android, Xbox)
- Accessible via `-showAudioFoundationUI` flag
- Enables: accelerated startup, seamless device transitions, multi-output configs
- Better hardware-specific spatializer integration

### 7.3 Deprecated APIs — Fixes Required

| Deprecated | Replacement | Unity Version |
|------------|-------------|---------------|
| `AudioSource.GetSpectrumData()` returning `float[]` | Pre-allocated array overload | 6000.4+ |
| `EditorApplication.isPlaying = false` | `EditorApplication.ExitPlaymode()` | 6.x |
| `FindObjectOfType<T>()` | `FindAnyObjectByType<T>()` | 6.x |

---

## 8. Performance Best Practices

### 8.1 Audio Analysis Performance

```csharp
// ✅ REUSE arrays — never allocate in Update
private float[] spectrum = new float[512];
private float[] previousSpectrum = new float[512];

// ✅ Limit analysis rate if full 60fps isn't needed
private float analysisInterval = 0.016f; // ~60fps
private float lastAnalysisTime;

void Update()
{
    if (Time.time - lastAnalysisTime >= analysisInterval)
    {
        AnalyzeAudio();
        lastAnalysisTime = Time.time;
    }
}

// ✅ Use Job System/Burst for heavy analysis
// ✅ Profile: Audio Profiler → DSP CPU, Streaming CPU, Total Audio Memory
```

### 8.2 Smoothing Techniques

```csharp
// Exponential moving average
smoothedBass += (rawBass - smoothedBass) * smoothFactor;

// Lerp toward target
currentValue += (targetValue - currentValue) * lerpSpeed;

// Decay buffer for band values
bandValue *= decayRate; // e.g., 0.95 per frame
```

### 8.3 Material Property Optimization

```csharp
// ✅ Use MaterialPropertyBlock for per-instance values
private MaterialPropertyBlock mpb;

void Start()
{
    mpb = new MaterialPropertyBlock();
}

void Update()
{
    mpb.SetFloat("_Bass", bassValue);
    mpb.SetFloat("_Mid", midValue);
    renderer.SetPropertyBlock(mpb);
}

// ❌ Avoid material.SetFloat() in Update without PropertyBlock
// Creates new material instance each call
```

---

## 9. Recommended Libraries & Tools

### 9.1 Production-Ready

| Library | Purpose | Platform | Notes |
|---------|---------|----------|-------|
| **LASP** | Low-latency audio input | Desktop (Win/Mac/Linux) | Keijiro's library, used by Rector, VFX Graph integration |
| **Visuor** | Lightweight audio visualization | Any | Job System + Burst, 3D + uGUI support |
| **RASTA** | Real-time spectral analysis | Any | Multi-threaded, 8 spectral + 2 time-domain descriptors |
| **Beat** | Beat detection | Any | Sub-bass/bass/mid/high bands, rolling energy history |

### 9.2 Middleware for Production

- **FMOD / Wwise**: Commercial-grade audio middleware with built-in beat detection, parameter curves, and Unity integration
- **CRIWARE (ADX2)**: Alternative middleware, strong in game audio

### 9.3 Research Tools

- **librosa** (Python): Offline beat tracking, BPM detection, onset detection → export JSON for Unity
- **Essentia**: Large-scale audio analysis, feature extraction

---

## 10. Complete Audio Visualization Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Audio Analysis Layer                      │
│  AudioSource → GetSpectrumData() → FFT → Frequency Bands   │
│                   → Beat Detection → Smoothing               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Reactivity Layer                          │
│  Band values → Smoothing → Decay buffers → Normalization    │
│               → Beat phase calculation (DSP clock)           │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ Shader Layer  │   │ VFX Layer     │   │ Anim Layer    │
│ - Material    │   │ - VFX Graph   │   │ - Animator    │
│   Property    │   │ - Property    │   │ - Timeline    │
│   Block       │   │   Binders     │   │ - DSP Clock   │
│ - HLSL arrays │   │ - Output      │   │ - Beat-synced │
│ - Vertex      │   │   Events      │   │   clips       │
│   displace    │   │ - Compute     │   │ - Blend trees │
└───────────────┘   └───────────────┘   └───────────────┘
```

---

## 11. Project-Specific Configuration

### 11.1 URP Audio-Visual Pipeline

With URP 17.0.0 in this project:
- Use **Forward+** renderer for audio-reactive materials
- Shader Graph supports all audio-reactive patterns via property blocks
- VFX Graph works with URP (requires `VFX` import in URP settings)
- Post-processing (Bloom, DoF) via `RenderPipeline` for audio-driven effects

### 11.2 Hardware Constraints

| Resource | Constraint | Impact |
|----------|------------|--------|
| GPU | GTX 1070 Ti (8GB VRAM) | Limit compute shader resolution, particle count <50k |
| CPU | Ryzen 5 5500 (6 cores) | Use Job System for audio analysis, avoid main thread |
| RAM | 32GB | Pre-allocate arrays, reuse buffers |

### 11.3 Recommended Settings for This Project

```csharp
// Audio analysis
sampleSize: 512 // Good balance of resolution/performance
fftWindow: FFTWindow.BlackmanHarris // Best for music analysis
analysisRate: 60fps // Full frame rate for responsiveness

// Smoothing
smoothFactor: 0.15f // Responsive but not jittery
decayRate: 0.92f // Band value decay per frame

// Frequency bands
bandCount: 8 // Logarithmic spacing for music
minFrequency: 20Hz
maxFrequency: 20000Hz

// Beat detection
threshold: 1.3f // Energy multiplier
cooldown: 0.15f // Minimum seconds between beats
```

---

## 12. Common Pitfalls & Solutions

| Problem | Cause | Solution |
|---------|-------|----------|
| Visuals drift from audio | Using `Time.time` instead of DSP clock | Use `AudioSettings.dspTime` for all timing |
| Initial spectrum data empty | Unity allocates history on first call | Discard first 0.5-1s of data after first `GetSpectrumData` |
| Audio stutters during load | Streaming with disk I/O pressure | Use `Compressed In Memory` for rhythm-critical audio |
| Shader reactivity flickering | Raw audio values, no smoothing | Apply exponential moving average |
| VFX Graph audio not updating | Property Binder not in Update loop | Ensure `UpdateBinding()` runs every frame |
| Timeline desync on lag | Using Game Time update mode | Switch to DSP Clock mode |
| Material performance hit | `material.SetFloat()` in Update | Use `MaterialPropertyBlock` |
| Beat detection missing hits | Threshold too high / no cooldown | Tune threshold multiplier, add cooldown |

---

## 13. Testing & Calibration

### 13.1 Audio Latency Calibration

```csharp
// Provide manual audio offset calibration for users
public float audioLatencyOffset = 0.0f; // User-calibrated

void Update()
{
    // Adjust visual timing by latency offset
    double adjustedTime = AudioSettings.dspTime - audioLatencyOffset;
}
```

### 13.2 Bluetooth Audio Detection

```csharp
// Warn users about Bluetooth audio latency
#if UNITY_ANDROID
using UnityEngine.Android;
bool isBluetooth = AndroidJavaClass.CallStatic<bool>("isBluetoothA2dpOn");
#endif
```

### 13.3 Profiling Checklist

- [ ] Audio Profiler: DSP CPU < 5ms, no underruns
- [ ] Spectrum analysis: < 1ms per frame
- [ ] Material property updates: < 0.5ms per frame
- [ ] VFX Graph: < 2ms per frame for audio binders
- [ ] Total audio+visual budget: < 5ms per frame at 60fps

---

## 14. References

### Unity Documentation
- [AudioSource.GetSpectrumData](https://docs.unity3d.com/6000.4/Documentation/ScriptReference/AudioSource.GetSpectrumData.html)
- [AudioSettings.dspTime](https://docs.unity3d.com/6000.4/Documentation/ScriptReference/AudioSettings-dspTime.html)
- [PlayableDirector.timeUpdateMode](https://docs.unity3d.com/6000.4/Documentation/ScriptReference/Playables.PlayableDirector-timeUpdateMode.html)
- [VFX Property Binders](https://docs.unity3d.com/Packages/com.unity.visualeffectgraph@17.0/manual/PropertyBinders.html)
- [Scriptable Audio Generators](https://docs.unity3d.com/6000.6/Documentation/Manual/audio-scriptable-processors-generators.html)

### Community Resources
- [How to Build a Rhythm Game in Unity for Mobile (DEV Community, 2026)](https://dev.to/unitysourcecode/how-to-build-a-rhythm-game-in-unity-for-mobile-2hd1)
- [Audio Status Update Q2 2026 — Unity Discussions](https://discussions.unity.com/t/audio-status-update-q2-2026/1723396)
- [Unity Timeline Audio Desync Fix (Troubleshooting Atlas, 2026)](https://unity-trouble-atlas.7colorsgame.com/en/article/unity-timeline-audio-desync/)
- [LASP — Low-latency Audio Signal Processing](https://github.com/keijiro/lasp)
- [LaspVfx — Audio Reactive VFX](https://github.com/keijiro/LaspVfx)
- [Visuor — Lightweight Audio Visualization](https://github.com/nc0ted/Visuor)
- [Beat — Beat Detection Library](https://github.com/onovich/Beat)
- [musical-analysis — Comprehensive Real-time Analysis](https://github.com/YentlHendrickx/musical-analysis)
- [RASTA — Real-Time Audio Spectral Toolbox](https://vbn.aau.dk/en/publications/rasta-real-time-audio-spectral-toolbox-for-analysis-in-unity3d/)

### Production Examples
- [Rector — Audio-Reactive VFX App (Unity 6000, URP 17, LASP)](https://github.com/shivaduke28/Rector)
- [compute-audio-noise-grid — GPU Audio Visualizer](https://github.com/maybebool/compute-audio-noise-grid)
- [Frequency Audio Visualiser — VR Audio Reactive](https://github.com/tomashrdlicka/Frequency_Audio_Visualiser)
- [Audio Reactive Starfield — Shader + Post-Processing](https://benglasser.com/blog/20250516-StarfieldVisualizer)

---

*Last updated: 2026-09-08 — Unity 6.6, URP 17.0, Scriptable Generators, DSP Clock sync*

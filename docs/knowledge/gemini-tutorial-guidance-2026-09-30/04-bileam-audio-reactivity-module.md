# Gemini Guidance — Bileam Tschepe: Audio-Reactivity Module Spec

- **Source video:** "Make Anything Audio Reactive – TouchDesigner Tips, Tricks and FAQs 12" — bileam tschepe — 7,402 likes
  https://www.youtube.com/watch?v=rGoCbVmGtPE
- **Gemini chat:** https://aistudio.google.com/prompts/1yU81YXnHVusXnyuIE1lDr9IuxFHmRrQI
- **Model:** Gemini 3.5 Flash Lite, 2026-09-30. Answered with grounded web-search sourcing; did not refuse the video.
- **Prompt style:** implementation guidance to build upon (steal / adapt / improve), not a video recap.
- **Note:** this video did NOT pass the 10k-like bar; included as an approved exception for the audio-reactive category where no qualifying tutorial was found.

---

## 1. Core Audio-Reactivity Principles (Distilled from Tschepe's Workflow)

1. **The Abstract Signal Principle (CHOP-to-Value Normalization):** Audio data shouldn't be treated as sound; it must be stripped of its identity and converted into dimensionless control signals (0.0 to 1.0 or -1.0 to 1.0). Whether it drives a scale, a rotation speed, or a color shift, the underlying math doesn't care if it came from a kick drum or an LFO.
2. **The Multi-Channel Split (Frequency/Feature Bifurcation):** Never map a master audio track to a single parameter. Split the signal into bands (Low/Bass, Mid, High/Transient) so different visual elements take responsibility for distinct register zones (e.g., bass scales the geometry, highs drive particle jitter, transients trigger camera glitches).
3. **The Lag/Smoothing Buffer (Inertia over Raw Data):** Raw audio analysis values are jumpy and jittery, causing visual seizure rather than rhythm. Every audio stream requires a smoothing or lag filter (exponential moving average/interpolation) to give parameters physical weight and organic "spring."
4. **Math Routing & Remapping (Range Re-mapping):** Direct mapping (input = output) never looks good. You need intermediate mathematical transformations—such as clamping, exponentiation (gamma curves to boost peaks), and multiplying by LFOs or envelopes—to restrict changes to aesthetically pleasing bounds.
5. **Feedback Loop Smearing (History/Accumulation):** Static geometry looks flat. Feeding rendered frames back into themselves modulated by audio parameters creates temporal smearing, trails, and organic ghosting that binds frame-to-frame motion together.

## 2. Adapting the Architecture: Live CHOPs → Pre-Computed JSON Timeline

TouchDesigner relies on real-time continuous streams (CHOPs). For Native Media AI Studio, you want fully deterministic, frame-accurate renders via Remotion and Three.js, meaning zero live jitter or frame-drop discrepancies.

**The Translation Layer Architecture**

Instead of computing audio data inside the render loop, you generate a Dense JSON Timeline via Python/librosa before rendering begins.

- Timeline Structure: An array sampled at your target framerate (e.g., 30 or 60 fps).
- JSON Schema per Frame:

```json
{
  "frame": 120,
  "time": 2.000,
  "bands": { "bass": 0.82, "mid": 0.34, "high": 0.12 },
  "transient": 0.95,
  "rms": 0.65,
  "section": 2,
  "beat_active": true
}
```

- Runtime Consumer (Three.js/Remotion): At frame N, your render loop does a direct array lookup: `const data = timeline[frame];`. This completely eliminates real-time audio parsing overhead, guarantees identical frames on your GTX 1070 Ti across multiple test renders, and ensures Remotion syncs perfectly.

## 3. What to Do Differently for a Local Render-to-Video Pipeline

Live VJ setups optimize for zero latency and continuous improvisation. A render-to-video pipeline (Remotion + FFmpeg on local hardware) optimizes for temporal consistency and sub-pixel accumulation, which changes your approach:

- **Drop Random-Walk Noise for Deterministic Phase Waves:** Live setups use pseudo-random noise generators (snoise()) that drift. For a music video, random noise causes temporal popping when rendering out of order or re-rendering. Replace continuous noise functions with deterministic time-indexed sine waves driven by your librosa `beat_times` phase.
- **Leverage Post-Processing Accumulation (Motion Blur / Feedback):** On a GTX 1070 Ti, real-time feedback loops can choke if unoptimized. Pre-calculating a frame timeline lets you implement multi-pass accumulation blur or motion blur safely in Three.js/WebGL because you control the exact render step execution order without missing frames.
- **Segment-Aware Scene Transitions:** Use your "8 energy-aware sections" to trigger structural changes (e.g., changing shader uniforms, camera focal lengths, or ComfyUI background prompts) at thematic boundaries rather than relying on random mid-track shifts.

## 4. Concrete Audio-Reactivity Module Spec

Implement this module in JavaScript/TypeScript. It ingests your raw JSON timeline, applies smoothing and mapping, and outputs ready-to-use uniforms for Three.js or props for Remotion.

```typescript
interface AudioFrameInput {
  bass: number;  // raw 0-1
  mid: number;
  high: number;
  transient: number;
}

interface MappedVisualProps {
  geometryScale: number;    // Range: [1.0, 2.5]
  materialRoughness: number; // Range: [0.1, 0.9]
  bloomIntensity: number;   // Range: [0.5, 3.0]
  cameraShake: number;      // Range: [0.0, 0.15]
}

class AudioReactivityProcessor {
  private prevBass = 0;
  private prevTransient = 0;
  // Exponential smoothing factor (Lerp weight)
  private smoothing = 0.35;

  public processFrame(raw: AudioFrameInput): MappedVisualProps {
    // 1. Smoothing / Inertia (Low-pass filter equivalent)
    const smoothedBass = this.prevBass + (raw.bass - this.prevBass) * this.smoothing;
    const smoothedTransient = this.prevTransient + (raw.transient - this.prevTransient) * this.smoothing;
    this.prevBass = smoothedBass;
    this.prevTransient = smoothedTransient;

    // 2. Mapping Layer (Feature-to-Parameter with Curves & Clamping)
    // Scale jumps heavily on bass peaks, maintaining a baseline of 1.0
    const geometryScale = 1.0 + Math.pow(smoothedBass, 1.8) * 1.5;
    // High frequencies or transients make surfaces glossy/reflective
    const materialRoughness = THREE.MathUtils.clamp(0.9 - (raw.high * 0.6), 0.1, 0.9);
    // Bloom spikes aggressively only on strong transients/onset hits
    const bloomIntensity = 0.5 + Math.pow(smoothedTransient, 2.0) * 2.5;
    // Camera shake tied directly to transient triggers
    const cameraShake = smoothedTransient * 0.15;

    return {
      geometryScale,
      materialRoughness,
      bloomIntensity,
      cameraShake
    };
  }
}
```

## 5. The 3 Most Common Mistakes That Make Visuals Look Cheap (And How Your Setup Avoids Them)

1. **The "Epileptic Scaling" Trap (Linear Direct Mapping):**
   - The Mistake: Mapping audio amplitude directly to scale or vertex displacement on a 1:1 linear scale, causing the whole scene to vibrate erratically like a cheap equalizer bar.
   - How your architecture avoids it: The Smoothing + Exponentiation Curve (`Math.pow(smoothedBass, 1.8)`) in the mapping module creates a natural threshold. Soft sounds do nothing; only real hits push the geometry past its resting baseline.
2. **The "Floating in a Void" Disconnect:**
   - The Mistake: 3D objects scale and rotate, but the lighting, background, and post-processing remain entirely static, making the visuals look like a pasted-on UI element.
   - How your architecture avoids it: A single JSON timeline controls multiple systems simultaneously. When the bass hits, it doesn't just scale a mesh—it scales the mesh while driving the Three.js bloom intensity up and shifting the ComfyUI background video playback speed or layer opacity.
3. **The "Out-of-Sync Drift" Flaw:**
   - The Mistake: Using frame-rate dependent logic (dt delta time accumulation) that drifts out of sync with the audio track over time, especially during heavy rendering loads.
   - How your architecture avoids it: By using a pre-computed frame-accurate JSON timeline indexed directly by the exact integer frame number (`timeline[frameNumber]`), your Remotion render pipeline ensures absolute, sample-accurate deterministic lock between audio analysis flags and visual outcomes.

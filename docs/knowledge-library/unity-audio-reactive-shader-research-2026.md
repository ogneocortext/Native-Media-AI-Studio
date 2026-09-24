# Unity Audio-Reactive Shader Research (2026)

> Stored: 2026-09-23
> Context: Native Media AI Studio — `unity-visualizer` URP 17.0.0 project

## 1. Problem / Goal

Unity visualizer currently drives **built-in URP Lit** via `MaterialPropertyBlock` (`_EmissionIntensity`, `_BaseColor`, `_Tiling`) only. We want custom HLSL that reacts to FFT bands + beat pulses from `AudioAnalyzer.cs` with:

- vertex displacement (wave/terrain/noise)
- emission / color shifts
- optional full-screen unlit pass
- minimal CPU overhead (GPU-driven)

## 2. Sources & Patterns

### 2.1 llealloo/audiolink (Unity)
AudioLink is the de-facto standard for audio-reactive shaders in Unity URP/HDRP. Core idea: pack FFT bands / waveform / beat into one `Texture2DArray` (or `RenderTexture`) on the CPU, sample it in shader via `AudioLink` node/function.

Key takeaways:
- `AudioLink` exposes:
  - `AL_Time` — audio-sync clock
  - `AL_BandLevels[4]` — low/mid/high/presence bands (4 textures × N slices)
  - `AL_Waveform` — waveform texture
  - `AL_Beat` — beat trigger
- Works in URP via `AudioLink` node in Shader Graph or `#include "Packages/com.llealloo.audiolink/AudioLink.hlsl"` in raw HLSL.
- Band mapping uses texture UV.y = band index, UV.x = time/position.
- Beat detection is server-side (`AudioLink.GetBeat()` returns float pulse).
- Avoid CPU polling per material: upload once per frame, sample N times on GPU.

### 2.2 keijiro/noiseshader
Classic lightweight HLSL noise shaders for Unity. Relevant techniques:
- `snoise` / `cnoise` (Simplex/Classic noise) — compact GLSL-style functions that port directly to Unity HLSL with minor type tweaks (`float3` vs `vec3`).
- Noise as vertex displacement: `v.vertex.xyz += normal * snoise(v.vertex.xz * freq + time) * amp`.
- Cheap full-screen unlit pass using `ScreenPosition` + noise domain warping.
- Avoid `tex2D` in vertex stage if not needed — use procedural noise only.

### 2.3 TSL (Unity Shaderlab/TSL) docs
URP 17+ uses TSL (Shader Graph generates TSL). For raw HLSL:
- Use `HLSLPROGRAM` / `ENDHLSL` blocks inside `SubShader`.
- URP lit/unlit templates require:
  - `#pragma vertex vert`
  - `#pragma fragment frag`
  - `#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"`
  - Use `*_srgb` macros for color space correctness (`LinearEyeToneMap` in SRP).
- For custom vertex displacement in URP Lit:
  - You **must** implement a `Surface` function (Standard PBR) or use Shader Graph Vertex Displacement node.
  - Raw HLSL with `vert()` only affects `SV_Position` — mesh shape stays the same unless you write a custom `Surface` shader or use `#pragma instancing_options` + compute buffers.
  - Easier path: **Unlit** shader with `VertExistence` displacement OR use **Shader Graph** with Vertex Displacement + AudioLink custom function node.

### 2.4 Decision: Raw HLSL vs Shader Graph
Given empty `Assets/Shaders/` and no Shader Graph workflow established yet, we will implement:
1. **`AudioReactiveLit.shader`** — raw HLSL `Unlit` pass + `PBR` hybrid trick: sample audio in vert, write to `v.color`, use `Surface` to apply as emission. (Simpler than full PBR surface.)
2. **`AudioReactiveUnlit.shader`** — lightweight full-screen/plane shader using AudioLink-style uniform upload from C#.

We keep Shader Graph as a future step when artists need visual editing.

## 3. Uniform / Data Flow

```
AudioAnalyzer.cs
  -> bandLevels[8], beatLevel, waveform[128]
  -> MaterialPropertyBlock.SetFloatArray / SetTexture
  -> AudioReactiveShader.cs (optional helper)
     -> shader keywords / CBUFFER / material props
```

Performance rules:
- Upload `bandLevels` and `beatLevel` once per frame on a **single shared** `MaterialPropertyBlock`.
- Per-renderer `MaterialPropertyBlock` is cheap; avoid `Material.SetFloatArray` (allocates).
- For multiple materials, share a `ComputeBuffer` or `Texture2D` if count > 16.
- Sample audio in shader as `float4(band0, band1, band2, band3)` from uniform array.

## 4. Shader Design

### 4.1 AudioReactiveLit.shader (URP Unlit + PBR-like emission)
```hlsl
// Pseudocode
float4 _BandLevels[8];
float _BeatLevel;
float _Time;

struct appdata { float4 vertex : POSITION; float3 normal : NORMAL; };
struct v2f { float4 pos : SV_Position; float3 worldPos : TEXCOORD0; float3 normal : TEXCOORD1; };

v2f vert(appdata v) {
  v2f o;
  float3 p = v.vertex.xyz;
  float band = _BandLevels[0]; // bass drives displacement
  p += v.normal * band * 0.3 * sin(p.y * 4.0 + _Time);
  o.pos = TransformObjectToHClip(p);
  o.worldPos = TransformObjectToWorld(p);
  o.normal = TransformObjectToNormal(v.normal);
  return o;
}

float4 frag(v2f i) : SV_Target {
  float3 viewDir = normalize(_WorldSpaceCameraPos - i.worldPos);
  float rim = 1.0 - saturate(dot(viewDir, i.normal));
  float3 col = lerp(float3(0.1,0.2,0.8), float3(1,0.3,0.1), _BeatLevel);
  return float4(col * (1.0 + rim * _BandLevels[3]), 1.0);
}
```

### 4.2 AudioReactiveUnlit.shader (plane/full-screen)
- 2-pass: background gradient + noise + waveform line.
- `_BandLevels` maps to color stops.
- `_Waveform` texture drawn via C# `Graphics.Blit` or `OnRenderImage`.

## 5. C# Driver: AudioReactiveShader.cs

Responsibilities:
- Cache `MaterialPropertyBlock` per renderer.
- Map `AudioAnalyzer.cs` smoothed bands → `_BandLevels[0..7]`.
- Push `_BeatLevel` and `_Time` each frame.
- Optional: drive `_Waveform` texture via `Texture2D` update (low freq — 128 floats).

```csharp
public class AudioReactiveShader : MonoBehaviour {
  public Renderer target;
  public AudioAnalyzer analyzer;
  MaterialPropertyBlock _mpb;

  void Update() {
    if (!analyzer || !target) return;
    _mpb ??= new MaterialPropertyBlock();
    target.GetPropertyBlock(_mpb);
    _mpb.SetFloatArray("_BandLevels", analyzer.SmoothedBands);
    _mpb.SetFloat("_BeatLevel", analyzer.BeatLevel);
    _mpb.SetFloat("_Time", Time.time);
    target.SetPropertyBlock(_mpb);
  }
}
```

## 6. Integration Checklist

- [ ] Add `AudioReactive/` shaders under `unity-visualizer/Assets/Shaders/`
- [ ] Add `AudioReactiveShader.cs` under `unity-visualizer/Assets/Scripts/Visuals/`
- [ ] Create test material: Shader → `AudioReactive/AudioReactiveLit`, assign to plane/cube.
- [ ] Add `AudioReactiveShader` component alongside existing `BeatPulse.cs` / `AudioReactiveMaterial.cs`.
- [ ] Verify URP asset includes `Unlit` / custom shader pass (URP `ForwardRenderer` does not filter by default).
- [ ] Profile with Unity Profiler: GPU time should stay under ~2 ms on integrated GPU for 1 draw call.

## 7. References

- llealloo/audiolink — https://github.com/llealloo/audiolink
- keijiro/noiseshader — https://github.com/keijiro/noiseshader
- Unity URP HLSL includes — `Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl`
- AudioLink shader source: `Packages/com.llealloo.audiolink/Shaders/AudioLink.cginc` (when installed)

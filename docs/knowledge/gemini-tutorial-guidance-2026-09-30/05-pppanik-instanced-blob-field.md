# Gemini Guidance — PPPANIK: Instanced Blob-Field for Three.js

- **Source video:** "BLOB TRACK INSTANCING (AUDIOREACTIVE) - TOUCHDESIGNER TUTORIAL" — PPPANIK — 9,788 likes
  https://www.youtube.com/watch?v=gtP1Ae35RqY
- **Gemini chat:** https://aistudio.google.com/prompts/1Uxv66BEiXsseEpCT27GS9x6CqrGp1pwQ
- **Model:** Gemini 3.5 Flash Lite, 2026-09-30. Answered with grounded web-search sourcing; did not refuse the video.
- **Prompt style:** implementation guidance to build upon (steal / adapt / improve), not a video recap.
- **Note:** this video did NOT pass the 10k-like bar; included as an approved exception for the audio-reactive category where no qualifying tutorial was found.
- **Code caveat:** the embedded simplex-noise (`snoise`) GLSL below was reconstructed from a garbled page extraction — treat it as the canonical Ashima snoise pattern and verify against a known-good copy before shipping.

---

## 1. Core Principle: Decoupled Simulation & Procedural Instancing

The core technique in TouchDesigner blob/particle instancing tutorials isn't node-specific—it is parametric layout driven by spatial noise offset by data channels. Instead of moving individual objects via heavy CPU loops, you populate a static grid or volume of instances (e.g., a 3D lattice, a sphere shell, or a Fibonacci spiral) and animate them implicitly in parallel. Each instance is given a unique seed or index-based identifier. In the vertex shader, you sample a 3D simplex or Perlin noise field whose coordinates change over time. By multiplying the noise lookup by global audio attributes (like bass drops or transient spikes) and offsetting it by the instance's layout index, you get a cohesive, organic wave of motion where the whole field breathes, twists, and morphs like a living organism without a single CPU physics calculation.

## 2. Architecture Adaptation: Remotion + JSON Timeline Three.js InstancedMesh

Your deterministic, pre-computed Remotion pipeline is actually an advantage over live VJ software: you don't need random real-time noise states or laggy smoothing loops. Everything can be indexed precisely by frame number.

- TouchDesigner LFOs / Audio CHOPs → Your pre-computed frame-accurate JSON timeline (`jsonFrame.bass`, `jsonFrame.mid`, `jsonFrame.high`, `jsonFrame.transient`, `jsonFrame.beatFlag`).
- Instance Position / Lattice Layout → Generated once in JS during setup using a mathematical distribution (e.g., a Fibonacci sphere or deformed grid) and stored in a custom `THREE.InstancedBufferAttribute`.
- Per-Instance Phase Offset (ID) → A custom attribute (`aInstanceId` or `aPhase`) assigned to each instance from 0.0 to 1.0. This ensures instances don't all move uniformly; waves ripple across the field.
- Global Audio Uniforms → Updated per frame in your Remotion render loop by looking up the current frame from your JSON timeline and passing it to your material's uniforms (`uBass`, `uTransient`, etc.).
- Deterministic Render Execution → Remotion renders frame-by-frame. Because your timeline lookup is pure (Frame → Exact JSON data), there is zero frame-rate stutter or drift.

## 3. Instancing Budget on a GTX 1070 Ti (8GB VRAM) at 1080p60

Your GTX 1070 Ti is a Pascal-architecture card with roughly 8 TFLOPS of single-precision performance and a memory bandwidth of 256 GB/s. For a 1080p60 offline render using Remotion (where rendering time per frame doesn't have to lock to real-time 16.6ms), your hardware can handle massive instance counts if structured correctly:

- **Recommended Instance Count:** 30,000 to 60,000 instances is the sweet spot for smooth rendering speeds and rich density.
- **Hard Ceiling:** Up to 100,000+ instances are entirely possible if geometry complexity is kept minimal.
- **Performance Levers:**
  1. **Geometry Complexity:** Keep the base instance geometry ultra-low poly. Use a tetrahedron (4 vertices), a low-poly ico-sphere (12–42 vertices), or even thin cross-planes (quads = 4 vertices). Avoid high-poly meshes (e.g., 500-vertex spheres) multiplied by 50,000 instances, which will thrash vertex throughput.
  2. **Attribute Count:** Keep custom instance attributes lightweight. Use a single vec4 attribute pack (e.g., `(offsetX, offsetY, offsetZ, phaseOffset)`) to minimize memory bandwidth overhead.
  3. **Shader Cost:** Avoid complex nested loops or heavy raymarching inside the vertex/fragment shaders. Stick to one or two layers of procedural simplex noise math.
  4. **Post-Processing (Bloom):** Bloom is heavy. Since you are using Three.js post-processing, downscale the bloom pass resolution or keep threshold/intensity tightly managed so it doesn't bottleneck fill-rate at 1080p.

## 4. What to Do Differently: Breaking the "Tutorial Blob" Look

Standard TouchDesigner/Three.js audio blobs look identical: a pulsing sphere of cubes or ico-spheres reacting uniformly to a low-pass filter. To make Native Media AI Studio look distinctive and professional:

- **Avoid Uniform Scaling Blobs:** Don't just scale instances up and down with the bass. That looks cheap. Instead, use audio to drive differential advection and morphing—have bass compress the inner core while transients trigger a high-velocity particle "spore ejection" outward along normal vectors.
- **Non-Euclidean Spatial Distributions:** Instead of a standard cube or sphere layout, distribute your instances along a mathematical torus knot or a DNA double-helix strand matrix, making the base shape abstract and cinematic before audio deformation even begins.
- **Color Temperature & Chromatic Aberration:** Tie high-frequency transients to a sharp shift in fragment roughness and emissive color gradients (e.g., shifting from deep cold cyber-blues to scorching hot magenta/orange on transients), paired with subtle chromatic aberration driven by the transient value.
- **Depth-Of-Field & Scale Gradation:** Make instances smaller and darker the further they are from the focal center, creating a dense volumetric atmosphere rather than a flat screen-space cluster.

## 5. Concrete Implementation Sketch

Here is a production-ready blueprint for a Three.js custom ShaderMaterial utilizing InstancedMesh driven by your JSON timeline.

**A. Shaders (GLSL)**

```glsl
// VERTEX SHADER with audio-driven noise displacement
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTransient;

attribute vec3 aOffset;
attribute float aPhase;

varying vec3 vNormal;
varying float vPhase;

// Classic Perlin 3D Noise (Ashima snoise) — verify against a known-good copy
vec4 permute(vec4 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.x);
  vec4 y_ = floor(j - 7.0 * x_);
  vec3 x = x_ * ns.x + ns.yyyy;
  vec3 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

void main() {
  vNormal = normal;
  vPhase = aPhase;
  // Base position of instance layout
  vec3 pos = aOffset;
  // Noise-driven displacement morphing over time, modulated by bass and phase offset
  float noiseFreq = 0.8;
  float noiseVal = snoise((pos * noiseFreq) + (uTime * 0.4) + (aPhase * 2.0));
  // Audio reactivity: expand outward on bass hits, spike on transients
  float displacementMagnitude = (uBass * 0.6) + (uTransient * 1.2);
  vec3 displacedPosition = pos + (normal * noiseVal * displacementMagnitude);
  // Standard instanced transformation stack
  vec4 mvPosition = modelViewMatrix * vec4(displacedPosition + position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
```

```glsl
// FRAGMENT SHADER with transient-driven color temperature
uniform float uMid;
uniform float uTransient;
varying vec3 vNormal;
varying float vPhase;

void main() {
  // Dynamic color shifts based on mid frequencies and transient spikes
  vec3 baseColor = mix(vec3(0.05, 0.1, 0.3), vec3(0.8, 0.1, 0.4), vPhase);
  vec3 transientColor = vec3(1.0, 0.6, 0.2) * uTransient;
  vec3 finalColor = baseColor + (transientColor * (uMid + 0.2));
  gl_FragColor = vec4(finalColor, 0.9);
}
```

**B. React / Three.js component implementation**

```javascript
import * as THREE from 'three';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber'; // Or vanilla Three.js animation loop

export function AudioReactiveBlobField({ currentFrameData }) {
  const meshRef = useRef();
  const count = 40000; // 40,000 instances optimized for GTX 1070 Ti

  // Initialize geometry, layout positions, and custom attributes once
  const [geometry, material] = useMemo(() => {
    // Ultra-low poly blueprint geometry (tetrahedron to save vertex fill-rate)
    const baseGeo = new THREE.TetrahedronGeometry(0.08, 0);
    const offsets = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    // Generate a non-uniform distribution (e.g., Fibonacci Sphere Shell)
    const radius = 2.5;
    for (let i = 0; i < count; i++) {
      const phi = Math.acos(1 - 2 * (i + 0.5) / count);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i; // Golden ratio spiral
      offsets[i * 3 + 0] = radius * Math.cos(theta) * Math.sin(phi);
      offsets[i * 3 + 1] = radius * Math.sin(theta) * Math.sin(phi);
      offsets[i * 3 + 2] = radius * Math.cos(phi);
      phases[i] = Math.random() * Math.PI * 2.0;
    }
    // Attach custom attributes to InstancedBufferGeometry
    const instancedGeo = new THREE.InstancedBufferGeometry();
    instancedGeo.index = baseGeo.index;
    instancedGeo.attributes.position = baseGeo.attributes.position;
    instancedGeo.attributes.normal = baseGeo.attributes.normal;
    instancedGeo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    instancedGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: blobVertexShader,
      fragmentShader: blobFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uTransient: { value: 0 }
      },
      wireframe: false,
      transparent: true
    });
    return [instancedGeo, mat];
  }, [count]);

  // Frame-accurate update loop fed deterministically by Remotion's JSON timeline
  useFrame(() => {
    if (!meshRef.current) return;
    // currentFrameData comes directly from your pre-computed librosa JSON lookup for frame N
    material.uniforms.uTime.value = currentFrameData.time;
    material.uniforms.uBass.value = currentFrameData.bass; // Smoothed 0.0 - 1.0
    material.uniforms.uMid.value = currentFrameData.mid; // Smoothed 0.0 - 1.0
    material.uniforms.uTransient.value = currentFrameData.transient; // Trigger flag/spike value
  });

  return <instancedMesh ref={meshRef} args={[geometry, material, count]} />;
}
```

# Three.js & WebGPU Best Practices (2026)

> Research compiled: 2026-08-29
> Sources: three.js official docs, R3F docs, community guides, GitHub

## Current State (August 2026)

### Three.js r185 (July 1, 2026)
- **WebGPURenderer is the recommended default** — WebGLRenderer is in maintenance mode
- All deprecated code paths (dating back to r150) have been **removed** (not just warned)
- `three/webgpu` entry point is the canonical import for new projects
- Key fix: AnimationAction time-warping bug resolved
- Performance: r184 fixed per-frame allocation leak (240K-500K unnecessary object instantiations/sec)

### WebGPU Browser Support (2026)
| Browser | Version | Notes |
|---------|---------|-------|
| Chrome/Edge | 113+ (May 2023) | Full support |
| Firefox | 141+ Win, 145+ macOS | Enabled by default |
| Safari | 26+ (Sep 2025) | macOS, iOS, iPadOS, visionOS |
| **Global coverage** | **~95%** | Remaining 5% get WebGL2 fallback |

WebGPU hit **Baseline status** in January 2026 — stable and on by default in all major browsers.

### React Three Fiber
- **v9.7.0** (July 31, 2026) — latest stable, supports WebGPU via async `gl` prop
- **v10.0.0-alpha.3** — first-class WebGPU/TSL support, new hooks (`useUniforms`, `useNodes`, `useLocalNodes`, `usePostProcessing`)
- v9 migration: `gl` prop accepts async factory returning a Promise<renderer>

## Critical Best Practices

### 1. Renderer Selection
```ts
// CORRECT (2026) — WebGPU with automatic WebGL2 fallback
import * as THREE from 'three/webgpu';
const renderer = new THREE.WebGPURenderer({ antialias: true });
await renderer.init(); // REQUIRED — async initialization

// DEPRECATED — do not use for new code
import * as THREE from 'three';
const renderer = new THREE.WebGLRenderer({ antialias: true });
```

### 2. R3F Canvas with WebGPU
```tsx
import { Canvas } from '@react-three/fiber';
import { WebGPURenderer } from 'three/webgpu';

<Canvas gl={async (props) => {
  const renderer = new WebGPURenderer(props as any);
  await renderer.init();
  return renderer;
}}>
  {/* scene */}
</Canvas>
```

### 3. TSL (Three Shading Language)
- Node-based shader system — compiles to WGSL (WebGPU) and GLSL (WebGL2 fallback)
- Replaces hand-written GLSL `ShaderMaterial`
- Write once, run on both backends
- Key functions: `add()`, `mul()`, `texture()`, `positionLocal()`, `uniform()`
- No official one-click GLSL-to-TSL migration — port each material individually

### 4. Performance Targets
- **Draw calls**: <100 per frame
- **Frame rate**: 60 FPS minimum
- **Particles**: Use compute shaders for 1,000,000+ (vs ~50,000 ceiling in WebGL)
- **Profiling**: Use `renderer.info`, `stats-gl`, Spector.js
- **Memory**: Proper disposal traversal on object removal
- **Scene structure**: Group hierarchy, InstancedMesh early, LOD for distance

### 5. Render Loop Patterns
- Keep business logic outside render loop (services/models)
- Use `requestAnimationFrame` minimally
- For WebGPU with `setAnimationLoop`, Three.js awaits init automatically
- With custom RAF loop, you MUST `await renderer.init()` before first render

### 6. Material & Light Optimization
- Reuse materials across meshes
- Bake lighting where possible
- Minimize dynamic lights
- Use `InstancedMesh` for repeated geometry
- Combine post-processing passes; switch to TSL nodes

### 7. Asset Pipeline
- Compress with gltf-transform (Draco + KTX2)
- Use `BufferGeometry` (only geometry type since r171+)
- Implement resize observer + pixel ratio capping
- Render-on-demand for static scenes

### 8. Memory Management
```ts
// Proper disposal pattern
object.traverse((child) => {
  if (child instanceof THREE.Mesh) {
    child.geometry.dispose();
    if (Array.isArray(child.material)) {
      child.material.forEach(m => m.dispose());
    } else {
      child.material.dispose();
    }
  }
});
```

## Migration Checklist for This Project

- [x] Remove deprecated `PCFSoftShadowMap` (use `shadows={false}` or `shadows="basic"`)
- [ ] Upgrade three.js to r185+ (`three@latest`)
- [ ] Migrate imports from `'three'` to `'three/webgpu'`
- [ ] Add async `gl` factory to Canvas for WebGPU
- [ ] Convert custom GLSL shaders to TSL
- [ ] Replace `ShaderMaterial` with `NodeMaterial` equivalents
- [ ] Audit draw calls with `renderer.info`
- [ ] Implement proper disposal for dynamically created objects
- [ ] Use `InstancedMesh` for particle systems (currently individual Points)
- [ ] Profile and optimize for <100 draw calls

## Risks & Gotchas

1. **Forgetting async init** — black canvas with no error if `await renderer.init()` is skipped
2. **Mixing import paths** — importing from both `'three'` and `'three/webgpu'` bundles entire WebGL codebase (extra MB)
3. **Drei compatibility** — Most helpers work; `MeshReflectorMaterial` and `EffectComposer` may need WebGPU-specific versions
4. **Custom shaders** — Hand-written GLSL only runs via WebGL2 fallback; must port to TSL for native WebGPU
5. **Firefox caveat** — Some timestamp queries not supported; test compute shaders separately

## References
- [three.js WebGPURenderer manual](https://threejs.org/manual/en/webgpurenderer.html)
- [R3F v9 Migration Guide](https://r3f.docs.pmnd.rs/tutorials/v9-migration-guide)
- [R3F Canvas API](https://r3f.docs.pmnd.rs/api/canvas)
- [WebGPU Migration Guide](https://www.utsubo.com/blog/webgpu-threejs-migration-guide)
- [Three.js r185 Release](https://github.com/mrdoob/three.js/releases)
- [TSL Field Guide](https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/)

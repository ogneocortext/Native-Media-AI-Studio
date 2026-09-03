# Character-Driven Visualization — Research Report

> Generated: 2026-09-01
> Scope: Comprehensive audit of character creation, rigging, rendering, and animation infrastructure across the Native Media AI Studio codebase.

---

## 1. What Went Wrong — The Character Placeholder Problem

### 1.1 Core Critique

The Blender-generated character is universally described as a **low-poly placeholder**, not a bespoke character:

> "Blender figure is low-poly primitives (capsule limbs, block torso, torus halo) — reads as dev placeholder, not bespoke character. Occluded by lyric glass panel (covers torso 30-60% of frame) and waveform line cuts across waist. Shadow is soft blob but not grounded. No rim light variation per act."
> — `docs/visual-storytelling/VISUAL_STORYTELLING_2026.md:55`

### 1.2 Root Cause in Code

File: `packages/backend/app/services/blender/builder.py` (lines 325-401)

The `create_character()` method generates:
- An armature with bone hierarchy (Spine → Chest → Head, UpperArm_L/R, LowerArm_L/R, UpperLeg_L/R, LowerLeg_L/R)
- **A single cylinder mesh** (`primitive_cylinder_add(radius=0.25, depth=1.4)`) as the body
- Automatic weight skinning (`ARMATURE_AUTO`)
- Flat peach-orange material (no PBR detail)

The `style` parameter is accepted but **completely unused** — no branching on "humanoid" vs any other style.

### 1.3 Composition Problems

From `MINDFUL_LAYERING_2026.md`:
- Character centered 48-52% x with identical scenery horizon — monotonous composition
- 27 layers simultaneously — no hierarchy, no reduction test
- Character occluded 30-60% by lyric glass + waveform crossing waist
- Reflection mirrored adds second character competing for focus

---

## 2. 2026 Techniques for Character Creation

### 2.1 Rendering Stack (from `visualization-effects.md`)

| Technique | Status in Code |
|-----------|---------------|
| WebGPURenderer replaces WebGLRenderer | ❌ Still WebGL2 |
| TSL replaces GLSL | ❌ Not adopted |
| Compute shaders (100k→1M particles) | ❌ CPU particles |
| Gaussian Splatting + NeRF for photoreal scans | ❌ Not implemented |
| Blender 5.2 EEVEE Next with per-BSDF raytracing | ✅ Available via MCP |

### 2.2 AI 3D Generation Pipeline (from `hunyuan3d-setup.md`)

Full texture pipeline for quality character meshes:
```
Hy3DGenerateMesh → Hy3DVAEDecode → Hy3DPostprocessMesh (remove floaters, target_faces 50000)
→ Hy3DMeshUVWrap → Hy3DCameraConfig → Hy3DRenderMultiView → Hy3DSampleMultiView
→ Hy3DBakeFromMultiview → Hy3DMeshVerticeInpaintTexture → Hy3DApplyTexture → Hy3DExportMesh (.glb)
```

**Critical**: Single-view produces "flat back" geometry. Multi-view is required for characters.

### 2.3 Character Consistency Method (from `prompt-engineering.md`)

Negative prompts to avoid ugly/generic AI characters:
```
blurry, low quality, distorted, deformed, ugly, bad anatomy, bad proportions,
extra limbs, disfigured, poorly drawn face, mutation, mutated, watermark,
text, signature, out of frame, oversaturated, underexposed, overexposed, grainy, noisy
```

4-Step Character Consistency Method:
1. Create a character bible with detailed description
2. Use reference images for face lock
3. Include character name in every prompt
4. Lock seed for similar starting points

### 2.4 Unity Animation 2026 (from `UNITY_ANIMATION_2026.md`)

- **Honami Animation System**: Zero-allocation alternative to Unity Animator; procedural rigging (LookAt, Pose, Pseudo-Physics)
- **Meshy (meshy.ai)**: AI PBR textures baked to model UVs (up to 8K base color, 4K PBR maps); Delighting removes baked lighting
- **Unity 3D Object Generator (beta)**: Text/image → 3D mesh prefab

---

## 3. Current Infrastructure Audit

### 3.1 Blender Backend (`builder.py`)

| Capability | Status |
|-----------|--------|
| Armature creation | ✅ Stick-figure bones |
| Mesh body | ❌ Single cylinder primitive |
| Skinning | ✅ Automatic weights |
| PBR materials | ❌ Flat color only |
| Style variation | ❌ Parameter unused |
| Beat-synced animation | ✅ Arm swing ±20° on beats |
| Face/clothing/detail | ❌ None |

### 3.2 Three.js Studio (`ThreeJSStudio.tsx`)

| Capability | Status |
|-----------|--------|
| Renderer | WebGL2 (not WebGPU) |
| Post-FX chain | ✅ Bloom, RGBShift, Film, Vignette |
| Beat timeline | ✅ Bass/mid/treble + beat detection |
| Primitive shapes | ✅ sphere, box, cylinder, cone, torus, crown, bars |
| GLB model loader | ❌ Not present |
| Skeleton/skinning | ❌ Not present |
| Character rigging | ❌ Not present |
| AI scene generator | ✅ Constrained to primitives only |

Available ObjectType values: `"crown" | "box" | "sphere" | "cylinder" | "cone" | "torus" | "bars"`

The `"crown"` is the most sophisticated — a THREE.Group with TorusGeometry band + 8 ConeGeometry spikes + OctahedronGeometry gem (emissive purple).

### 3.3 Unity MCP (`unity-mcp-bridge.mjs`)

Available tools: `create_scene`, `create_gameobject`, `add_component`, `capture_scene_view`, `capture_game_view`, `editor_status`, `create_animation_clip`, `create_animator_controller`, `add_animator_state`, `add_animator_transition`

Current Unity project: Crown prop only (cylinder band + 6 spike cones + apex orb). No humanoid character, no Avatar, no Animator controller for characters.

### 3.4 3D Generation Page (`Generation3DPage.tsx`)

- Generates GLB meshes via Hunyuan3D through ComfyUI
- Only "character" example is a robot: `"a futuristic robot, chrome metallic, highly detailed, standing pose"`
- No humanoid/avatar prompts or reference-image face-locking
- Prompt format: `[object], [material], [style], [orientation]` — object-focused, not character-narrative

---

## 4. Gap Analysis

| Need | Current State | Gap |
|------|--------------|-----|
| Quality character mesh | Cylinder placeholder | Need GLB import from Hunyuan3D/Blender |
| Character rigging | Stick armature only | Need proper bone hierarchy + skinning |
| PBR materials | Flat color | Need metallic/roughness/normal maps |
| Facial features | None | Need blendshapes or textured face |
| Clothing | None | Need separate mesh or textured detail |
| Style variation | Unused parameter | Need branching logic |
| Beat-synced body animation | Arm swing only | Need full-body dance/idle animations |
| Three.js character display | No GLB loader | Need GLTFLoader + animation system |
| Character consistency | No bible/lock | Need reference image + seed locking |
| Narrative shot variety | Static centered | Need act-specific cameras + composition |

---

## 5. Design Guidelines (from `sceneGuidelines.ts`)

Extracted from `MINDFUL_LAYERING_2026.md` and `VISUAL_STORYTELLING_2026.md`:

- **Max 3 focal movements per shot**; 800ms motion budget
- **Max 3 layers** (primary/secondary/ambient)
- **Color budget**: dominant ≤70%, accent ≤20%
- **Max 2 font families**, 3 size levels
- **Keyframes**: 6-12f micro, 12-20f text, never >500ms; use interpolate with bezier easing, NOT sin()

---

## 6. Storyboard Techniques (from `STORYBOARD_StillIRise.md`)

Concrete 2026 technique mappings:

| Technique | Parameters |
|-----------|-----------|
| Cinematic letterbox + retro film | letterbox 18px, slow push 0.99→1.01, cool 220° palette, grain 0.075 |
| Maximalist fluid light + kinetic hero | split-letter bounce sin(t*3.2), light leak 0.16 |
| Refined bento editorial + cutout collage | liquid glass variable blur, character parallax 8px |
| Retro VHS/Super8 + desaturated bridge | grain 0.075, vignette 0.52, halation |

> "2026 lesson: StudioMeyer — kinetic type + heavy glass + WebGL often demo-only; needs restraint + act-specific cameras, not one AbsoluteFill with opacity tweaks."

---

## 7. Recommended Implementation Path

### Phase 1: Character Mesh Generation
1. Extend `Generation3DPage.tsx` with character-specific prompt templates (humanoid, avatar, creature)
2. Add reference-image upload for face-lock consistency
3. Implement character bible (name, description, seed, reference image)
4. Use multi-view Hunyuan3D pipeline for quality geometry

### Phase 2: Blender Character Upgrade
1. Replace cylinder body with imported GLB mesh (from Phase 1)
2. Branch on `style` parameter: humanoid / robot / creature / abstract
3. Add PBR material pipeline (metallic/roughness/normal from Hunyuan3D bake)
4. Extend `animate_to_beats` for full-body dance animations (not just arm swing)

### Phase 3: Three.js Studio Character Integration
1. Add `"character"` to ObjectType union
2. Implement `createCharacterMesh` factory using `THREE.GLTFLoader`
3. Add animation mixer for GLB-embedded animations (idle, dance, gesture)
4. Add character-specific inspector controls: animation selector, playback speed, blend
5. Extend AI scene generator system prompt to allow skeleton/animation APIs for character objects

### Phase 4: Unity Character Bridge
1. Expose character prefab instantiation via Unity MCP
2. Add Animator controller creation for humanoid characters
3. Bridge beat-synced animation clips to Unity's animation system

### Phase 5: Narrative Composition
1. Implement act-specific camera positions per storyboard
2. Add character parallax (8px) and depth-of-field
3. Apply mindful-layering constraints (max 3 focal movements, 800ms budget)

---

## 8. Key Files for Implementation

| File | Role |
|------|------|
| `packages/backend/app/services/blender/builder.py` | Blender character generation (lines 325-480) |
| `packages/frontend/src/features/three-js-studio/ThreeJSStudio.tsx` | Main 3D canvas + render loop |
| `packages/frontend/src/features/three-js-studio/types.ts` | AnimObject / SceneConfig types |
| `packages/frontend/src/features/three-js-studio/sceneTemplates.ts` | 6 template definitions |
| `packages/frontend/src/features/three-js-studio/components/ObjectsTab.tsx` | Object list + add-shape UI |
| `packages/frontend/src/features/three-js-studio/components/InspectorTab.tsx` | Per-object property editor |
| `packages/frontend/src/features/three-js-studio/components/AISceneGenerator.tsx` | Ollama LLM scene generator |
| `packages/frontend/src/features/three-js-studio/services/sceneGuidelines.ts` | Design constraint injection |
| `packages/frontend/src/features/generate3D/Generation3DPage.tsx` | Text-to-3D generation UI |
| `tools/mcp/unity-mcp-bridge.mjs` | Unity MCP command bridge |
| `unity-project-mcp/Assets/Scripts/CoronationScene.cs` | Current crown prop example |
| `docs/knowledge-library/prompt-engineering.md` | Character bible + negative prompts |
| `docs/knowledge-library/hunyuan3d-setup.md` | Multi-view pipeline for quality meshes |
| `docs/visual-storytelling/VISUAL_STORYTELLING_2026.md` | Critique + design requirements |
| `docs/visual-storytelling/MINDFUL_LAYERING_2026.md` | Layering + composition rules |

---

## 9. Addendum 2026-09-03 — Real-Time Path Decision (Silhouette Builder)

The phased plan (§7) remains the offline/hero-asset path. For the **real-time visualizer**, a decision was taken after web research (full synthesis: `silhouette-character-animation.md`):

- Procedural SVG silhouette "Builder" figure — near-black puppet with act-palette rim light, puppeteered per-frame from the live audio ref + storyboard acts. No faces, no AI anatomy, zero React re-renders.
- Rationale: Jusska's "Limbo" video proves silhouette + lyric-linked motifs carry a whole music video; the game industry's Silhouette Test becomes our acceptance test; SVG `transform-box`/`transform-origin` joints need no skeletal toolchain (dbbasic-face pattern); iki/prompt-to-animation validate parameter-driven and anchor-locked approaches for later phases.
- Blender MCP is rescoped to hard-surface environments/props only. `builder.py::create_character` (cylinder body) is not to be extended — its output ceiling is "placeholder".

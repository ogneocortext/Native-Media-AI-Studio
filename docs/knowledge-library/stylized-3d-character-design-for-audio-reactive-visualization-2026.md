---
tags:
  - technical
aliases:
  - 3D character design
  - audio-reactive character
cssclasses:
  - technical-guide
date: 2026-11-07
type: synthesis
---

> [!info] Purpose
> How to design and build a stylized 3D character for a real-time
> audio-reactive music visualizer (React Three Fiber / Three.js) — the
> knowledge base for rebuilding the visualizer's BuilderFigure, which
> began as a 2D canvas silhouette and never became the 3D character it
> was intended to be.

---

## Overview

Research compiled 2026-11-07 from industry sources (Valve NPAR 2007,
game-art literature, three.js ecosystem, production audio-reactive
pipelines). Scope: a single hero character in a dark music-visualizer
scene on a GTX 1070 Ti-class GPU.

## 1. What separates "designed" from "placeholder"

- **Silhouette is the primary readability channel** (Valve TF2 NPAR
  2007): minimize visual noise, use value contrast, prefer rim
  highlights over dark outlines, interior detail echoes the silhouette.
- **Shape language**: round = friendly, angular = aggressive, square =
  stable. A hero wants a distinctive ASYMMETRIC silhouette — big head,
  oversized hands/feet, a prop. "Detail everywhere is as good as no
  detail."
- **Proportion dial — heads-tall**: realistic 7–8, stylized game
  4–6, chibi 2–3. Pick one ratio; verify it reads as a black blob at
  the actual on-screen size (~200 px wide).
- **Material**: `MeshToonMaterial` + 3–4-step gradient map
  (`NearestFilter` — linear filtering blurs the bands) is cheaper than
  PBR AND more stylized. `flatShading` on low-poly geometry is nearly
  free NPR. Outlines: inverted hull at small scale, or distance-faded
  post-process edges.
- **Rim light** beats outlines for separating the character from the
  background — one back `directionalLight`/`spotLight` or a fresnel
  term.

## 2. Audio-reactive animation architecture

Three input tiers from one `AnalyserNode` (never per-component):

| Signal | Character parameter | Motion quality |
|---|---|---|
| Kick/onset | Squash (scale y −5–10%, xz +), knee/hip flexion, root bob | Snappy ~100–200 ms, anticipation→impact |
| Bass sustained | Weight shift/sway on beat grid, torso lean | Smooth, tempo-locked, 2-beat period |
| Snare/clap | Head snap, chest pop, shoulder accent | One-shot ~150 ms |
| Hats/treble | Head bob, eye jitter, accessory micro-motion | Fast, small, ~8th-note cadence |
| Melody/mid | Arm/hand gesture accents | Phrase-level, crossfaded |
| Energy/section | Global amplitude multiplier, idle↔groove blend | Section-level, bar-aligned cuts on drops |

**The governing rule: audio modulates a base animation, never
replaces it.** Layered architecture (AAA idle recipe):

1. Base loop (`idle`/`groove`/`drop` clips at canonical 120 BPM,
   retimed to detected tempo — the Dawby/Rive model)
2. Breathing + weight-shift additives on their own timelines
3. Audio accent layer with per-layer attack/decay envelopes
   (~200–500 ms decay — instant reads as flicker, lagged reads as
   physical)

Per-bone spring/damped follow-through on top sells "alive" more than
extra keyframes. Secondary motion: breathing ~4 s cycle, weight shifts
with ease-in/out (never linear), anticipation = small counter-move
before an accent.

Beat detection: ~1 s of bass-band history, beat = bass > ~1.4× running
average; kick ≈ low-band transient, snare ≈ mid-band burst, hats ≈
high-band.

## 3. Performance budget (single hero, GTX 1070 Ti)

| Asset | Budget |
|---|---|
| Triangles | ≤20k stylized (8–20k desktop hero) |
| Bones | ~65 (Mixamo-style); ≤4 weights/vertex (glTF hard limit) |
| Draw calls | 1–3 for the character; ≤100–300 scene-wide |
| Morph targets | ≤50 active (face guidance in the companion doc) |
| Textures | ≤2048², single atlas, KTX2 preferred |

SkinnedMesh + AnimationMixer for clips; write procedural bone offsets
AFTER `mixer.update(dt)`. `SkeletonUtils.clone()` for clones (plain
`.clone()` breaks skeleton binding); `SkeletonUtils.retargetClip` for
cross-rig clips. LOD unnecessary at fixed visualizer camera distances.

## 4. Recommended pipeline (solo dev)

1. **Mesh**: author in Blender (4–5 heads tall, T-pose, ≤20k tris,
   single atlas) OR start from VRoid Studio / Ready Player Me / Meshy+
   retopo. Avoid raw AI meshes without retopo (700k+ tris).
2. **Rig**: FBX → Mixamo auto-rig (~65 bones) → download 4–8 clips
   (`idle`, `groove`, `wave`, `hit`, `walk`) → merge into one GLB.
3. **Runtime**: `useGLTF` + `AnimationMixer` crossfades; per-frame
   additive bone-space offsets from the audio feature bus; spring
   damping for follow-through (~100–300 lines — this is where "alive"
   comes from; clips alone look like a mannequin).
4. **Look**: toon material + rim light + 1 K atlas; verify silhouette
   at final camera distance BEFORE adding detail.

## 5. 2026–2027 trends

- **ML motion is arriving but isn't practical client-side yet**:
  NVIDIA MotionBricks (15k FPS neural locomotion), ARDY (SIGGRAPH 2026,
  promptable character animation), RTLive diffusion motion (30–120 ms
  latency in-browser). Direction: revisit in 12–24 months; today the
  stack is authored clips + procedural layering.
- **Rive mental model is stealable even in Three.js**: canonical-BPM
  loops + named triggers (`kick`/`snare`/`drop`) + numeric state inputs
  (`beat`/`bar`/`energy`/`section`) is a clean API boundary.
- **NPR/toon is the default stylized-web look**; VRM/VRoid ecosystem
  growing (three-vrm loader exists; ~52 morph face standard).
- **Asset sources**: Mixamo (free clips+rig) · Ready Player Me / VRoid
  (free base meshes) · Sketchfab · commission $50–300 · Meshy/Tripo
  (AI+retopo) · Blender+MB-Lab/Human Generator (free parametric).

## Related

- [[3d-visualization-best-practices-2026|3d-visualization-best-practices-2026]] :extends
- [[facial-expression-systems-for-stylized-real-time-characters-2026|Facial Expression Systems]] :see-also
- [[stylized-3d-environment-design-for-browser-music-visualizers-2026|Stylized 3D Environment Design]] :see-also
- [[audio-reactive-visualization-2026-11|audio-reactive-visualization-2026-11]] :see-also
- [[character-driven-visualization-research|character-driven-visualization-research]] :see-also
- [[unity-audio-visualization-2026|unity-audio-visualization-2026]] :cites

## Sources

- Valve, "Illustrative Rendering in Team Fortress 2" (NPAR 2007) —
  silhouette/rim-light canonical rules
- Dawby.app docs — audio-reactive character pipeline (120 BPM loops,
  named triggers, state inputs)
- AnimotionX, "Designing an AAA Idle" — layered idle architecture
- David Rosen (Wolfire), GDC Animation Bootcamp — procedural animation
- Khronos glTF 2.0 spec — skinning/morph limits
- three.js docs + Discourse — SkinnedMesh, morph targets, SkeletonUtils
- NVIDIA MotionBricks / ARDY (SIGGRAPH 2026) / RTLive — ML motion
  landscape
- MasterAllArts Three.js s3-08 — Mixamo → three.js pipeline
- Ready Player Me / VRoid / Meshy docs — base-mesh sourcing

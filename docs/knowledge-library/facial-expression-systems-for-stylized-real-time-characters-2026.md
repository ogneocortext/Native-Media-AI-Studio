---
tags:
  - technical
aliases:
  - facial animation
  - blendshapes
  - ARKit morph targets
cssclasses:
  - technical-guide
date: 2026-11-07
type: synthesis
---

> [!info] Purpose
> Facial expression systems for a stylized real-time 3D character in a
> browser music visualizer — what to build when the face is the weakest
> part of the character. Companion to
> [[stylized-3d-character-design-for-audio-reactive-visualization-2026]].

---

## Overview

Research compiled 2026-11-07. Scope: stylized (not photoreal) character
at medium visualizer distance, procedurally animated, synced to music.
No voice lip-sync needed — expression reacts to energy/sections.

## 1. Expression systems — fewer shapes, bolder poses

- **ARKit's 52 blendshapes are the lingua franca** — MetaHuman,
  Character Creator, VRoid/VTuber tooling, MediaPipe FaceLandmarker,
  and most web avatar pipelines all speak it. Use the *vocabulary*
  even when implementing fewer shapes.
- **You do not need 52 shapes.** VRM 1.0 defines ~20 presets
  (emotions + visemes + blink + lookAt); Roblox requires only 17 base
  poses; production avatars (Ready Player Me) ship 52 ARKit + 15
  visemes + extras. Stylized work converges on **~15–25 morph targets**:
  6–8 emotion poses, ~6 mouth/viseme shapes, 2 blink, 2 gaze.
- **Bake emotion as composite blend poses** (named recipes like
  `happy`/`excited`/`neutral`), not free-form muscle blending — the
  artist bakes appeal into each pose.
- **Morph targets > bones for faces**; hybrid (bones for eyeballs +
  morphs for lids/mouth) is the common pattern.
- Export Blender shape keys → GLB morph targets; map names via
  `mesh.extras.targetNames` → `morphTargetDictionary` once at load.

## 2. The procedural "alive" layer — highest ROI

**Blinking is the cheapest aliveness signal** — with specific numbers:

- Interval ~4.2 s average, randomized (Poisson-ish), never fixed timer
- Phases asymmetric: close 50–80 ms, hold 10–100 ms, open 150–200 ms
  (Disney Research 2009 measured real blinks — symmetric curves read
  mechanical)
- ~1 in 8 double-blinks; ~30% partial (0.7–0.9 closure); per-eye
  half-frame stagger
- ~30 lines of code — biggest aliveness-per-dollar in the project

Other cheap signals: breathing sway ~0.2–0.3 Hz, eye saccades every
1–3 s, micro-expression flickers (~0.3–0.5 s) on musical accents,
cross-fade expressions over 200–400 ms (never snap).

## 3. Mouth — amplitude-driven, not visemes

- If the character doesn't sing lyrics to camera: **skip viseme
  solving entirely**. Drive 3–6 mouth morphs from RMS/band energy,
  quantized to beat for musical feel.
- Cheap heuristics exist if vocals matter: FFT bands → ARKit viseme
  rules (~75–80% phoneme approximation, <2 ms/frame); spectral
  brightness → rounded vs wide vowels.
- Available-if-needed heavyweight path: SOFA/wav2vec phoneme
  alignment (KoePuppet-style) — document as future work only.

## 4. Distance rules — bigger and simpler, not subtler

- Visualizer camera = "social distance": expressions must be
  **exaggerated** to read. Eyes/brows/mouth *shape* read; fine detail
  doesn't — near-realistic-but-wrong is worse than clearly stylized.
- Semi-realistic face + crude morphs = uncanny valley. Go fully
  stylized or abstract.
- If face renders <~64 px tall: flat painted face or emissive eye
  glow beats a poorly-deforming morph face.
- Drive expression partly through **head/body** (tilt to beat, lean on
  drops, nod on kicks) — reads at any distance, costs nothing facial.

## 5. Performance

- ≤25 morph targets, face mesh ≤5k verts, WebGLRenderer (WebGPU shader
  compile stalls with ~52 morphs — 6–7 s observed).
- Update `morphTargetInfluences` once per frame in `useFrame` with lerp
  smoothing; precompute name→index map at load.
- If face is far away: swap/blend out morphs beyond a distance
  threshold.

## 6. Architecture that survives future upgrades

```
audio features → emotion state (valence/arousal/intensity)
              → blend-pose weights → morphTargetInfluences
blink/gaze/breathing layer runs independently, additively
```

Keep ARKit/VRM-compatible morph names so MediaPipe, VRM tooling, and
future audio→blendshape models (NVIDIA Audio2Face-3D, LAM
Audio2Expression, EmoFace — all output ARKit vocabulary) can drive the
same rig. Generative video faces (Runway Characters, SIGGRAPH 2026) are
impressive but video-space, not scene-graph — not applicable here.

## 7. 2026–2027 trends

- Audio→expression ML models all converge on ARKit vocabulary +
  "emotion label/intensity → blendshape params" control paradigm —
  the emotion-parameter layer above is where the field is heading.
- MediaPipe FaceLandmarker outputs ~52 ARKit blendshapes in-browser via
  WASM — cheapest path if webcam-driven expressions are ever wanted.
- three-vrm (`@pixiv/three-vrm`) works in R3F; if the character becomes
  VRM-based the whole expression stack is solved.
- Procedural > data-driven for stylized characters — research
  consensus (Emotional Voice Puppetry, EmoFace, AUBlendNet).

## Related

- [[stylized-3d-character-design-for-audio-reactive-visualization-2026|Stylized 3D Character Design]] :see-also
- [[stylized-3d-environment-design-for-browser-music-visualizers-2026|Stylized 3D Environment Design]] :see-also
- [[character-driven-visualization-research|character-driven-visualization-research]] :see-also
- [[3d-visualization-best-practices-2026|3d-visualization-best-practices-2026]] :see-also

## Sources

- Apple ARKit blendshape docs; Ludentes Face-Research ARKit/MediaPipe
  world doc
- VRM 1.0 spec (VRMC_vrm.expressions) + vrm.dev features
- Ready Player Me morph-target docs (ARKit + OVR LipSync sets)
- Roblox facial-animation docs (FACS poses, 17 base requirement)
- Disney Research, "Modeling and Animating Eye Blinks" (ACM TAP 2009)
- Unity "animated emoji" tutorial; Big Village Games lip-sync writeup
- AICO avatar lip-sync docs; Agora viseme guide; lipsync-engine
- project-panda VRM expression engine (5-layer pattern)
- EmoFace / Emotional Voice Puppetry / AUBlendNet papers
- three.js morph-target PRs #22293/#27768; WebGPU morph perf issue
- Runway Characters (SIGGRAPH 2026); NVIDIA Audio2Face-3D; LAM
  Audio2Expression; KoePuppet (SOFA alignment)
- MediaPipe FaceLandmarker docs; @pixiv/three-vrm

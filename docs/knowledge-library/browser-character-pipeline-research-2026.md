---
title: "Browser Character Pipeline — Research Agenda 2026"
date: 2026-11-06
tags:
  - 3d
---

# Browser Character Pipeline — Research Agenda 2026

> The research required to render 3D characters — animated,
> textured — in the browser (Three.js Studio), broken down by
> pipeline step. Written 2026-11-06 at the owner's request, checked
> against what the library already holds. The pattern the check
> found: **the creative layer is researched, the engineering layer
> is not.** [[character-animation-2026-summer-synthesis]] covers
> story-first puppetry, beatPhase sync, and character lock;
> [[pascal-3d-budget-discipline-2026]] fixes the numeric budgets
> (≤64 bones per skinned mesh, ≤8 active skinned meshes, ≤150 draw
> calls). Between those two layers sits everything that actually
> puts a character on screen — and it is 11 unresearched categories
> across 7 steps. Each item below names the questions and the shape
> of an acceptable answer: a verdict for *this* studio on *this*
> hardware, not a survey.

## Step 1 · Acquisition — where characters come from → T-VID-19

- **Sources + licensing.** Which GLTF character sources (marketplaces,
  Mixamo-class libraries, scans) are usable in published work, and
  what does gen3d output (Hunyuan-class) actually look like as a
  *character* — proportions, topology, UVs?
- **Auto-rigging routes.** Generated meshes arrive unrigged. Compare
  Mixamo / AccuRig / Blender auto-rig addons as the bones supplier:
  quality, skeleton compatibility, cost, automation surface.

## Step 2 · Rigging + skinning — the keystone → T-VID-19

- **One house skeleton.** A single standard skeleton is what makes
  animation clips shareable across characters. Decide: bone list and
  naming, twist bones, and how the ≤64-bone budget is spent.
  **This decision gates Steps 3 and 7** — retargeting targets it,
  pose passes encode it.
- **Skinning quality bar.** Weight-painting standards, the classic
  deformation failures (shoulders, hips, elbows), and a rig test a
  character must pass before entering the library.

## Step 3 · Animation → T-VID-20

- **Clip sources + retargeting.** Getting external clips onto the
  house skeleton without foot-sliding, scale drift, or broken root
  motion; what tooling does it (Blender retarget addons, three.js
  `SkeletonUtils`) and what stays manual.
- **Blending in three.js.** AnimationMixer crossfades, additive
  layers, and state machines (idle → groove → gesture) driven by
  song sections — patterns that survive more than one character.
- **Beat mapping, the engineering half.** The philosophy is covered
  (synthesis: beatPhase, robust to BPM change). Unresearched: mapping
  the measured beat grid (T-VID-03) onto clip phase in the mixer so
  motion lands on beats deterministically.

## Step 4 · Textures + materials → T-VID-21

- **Character PBR sets.** Skin, cloth, and hair approaches at browser
  budgets; texture resolution per character class (hero vs
  background) within the budget doc's ≤1 GB scene texture cap.
- **KTX2 workflow for characters.** T-VID-12 covers scene textures;
  a character carries several maps — the per-character budget math
  and compression settings need their own answers.
- **Hair + eyes.** The two classic real-time failure areas: hair
  cards vs shells vs strands, eye shading cheats that read as alive
  under simple lighting.

## Step 5 · Browser optimization → T-VID-21

- **Skinned LOD.** Bone-reduced LOD chains for characters (mesh LOD
  alone makes limbs collapse), and when a background character should
  become an impostor (budget doc) instead.
- **Draw-call anatomy.** Where the ≤150-call scene budget goes when
  2–3 characters share a scene: materials per character → calls,
  shadow pass doubling, the real per-character cost.

## Step 6 · Three.js runtime → T-VID-22

- **Mixer management at scale.** Multiple characters: clip caching,
  shared vs per-character mixers, GPU memory disposal when scenes
  swap. (Single-character loading already works — the factory's
  GLTF path is proven; scale is the unknown.)
- **Character lighting.** Shading that flatters skin and cloth under
  the studio's one shadow-casting directional: no SSS on this stack,
  so what carries it — rim, wrap lighting, gradient maps?

## Step 7 · Capture + pipeline fit → T-VID-22

- **Pose-pass encoding.** T-VID-13's frame package promises a pose
  pass; research how a skeleton becomes that pass (joint positions /
  rotations encoding, resolution, format) so the AI skin can follow
  the character's exact pose.

## Sequencing

T-VID-19 first — the house-skeleton decision silently constrains
retargeting (T-VID-20), pose encoding (T-VID-22), and the character
asset schema (T-VID-16). T-VID-21 is independent and can run parallel
in research time. All four are **research items**: reading and
verdict-writing, no generation, no renders — the standing
music-video hold is unaffected, and design/implementation items spin
out only on the owner's word.

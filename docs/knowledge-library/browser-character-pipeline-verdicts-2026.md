---
title: "Browser Character Pipeline — Verdicts 2026"
date: 2026-11-06
type: synthesis
tags:
  - production
  - 3d
  - research
aliases:
  - Browser Character Pipeline Verdicts 2026
cssclasses:
  - production-guide
---

# Browser Character Pipeline — Verdicts 2026

> The answers to [[browser-character-pipeline-research-2026]],
> distilled 2026-11-06 from TWO external AI deep-research reports
> run by the owner against the agenda's questions (Gemini and
> Perplexity, both search-grounded) and re-checked against this
> repo's own constraints — [[pascal-3d-budget-discipline-2026]],
> the hardware profile, and the studio code. Per the
> external-sources policy, the reports were studied privately and
> are not reproduced; what follows is the distilled substance in
> the project's own words, including where a report was wrong or
> generic and our numbers overrule it (§6). Where the two reports
> disagreed, the more rigorous position won and the disagreement
> is noted. Both reports' numbers are proposed engineering
> limits, not Pascal measurements — acceptance in this studio is
> always a local measurement against a golden scene.

## 1. Sourcing + conversion (T-VID-19)

**Verdict: hybrid sourcing, Mixamo first.** Mixamo is the primary
character + dance-clip source (standardized humanoid rig, large
dance library, free). The licensing nuance the report glossed:
Mixamo content is licensed for use *inside* commercial projects —
the raw assets may not be redistributed as assets. Supplements:
Quaternius (CC0) for low-poly extras; VRoid Hub / UTSUBO (VMD
motions) only when an anime aesthetic is the point. AI-generated
meshes (gen3d) enter unrigged and join the same conversion chain.

**License intake rules** (the strongest single section in either
report — adopted as policy): reject CC BY-NC outright; reject
CC BY-ND whenever re-rigging/retopology is needed (it always is);
CC BY-SA needs a deliberate compliance plan. **The browser trap:**
a rendered video is one thing, a downloadable GLB is another —
some licenses (e.g. Sketchfab standard terms) prohibit standalone
asset distribution, and a browser exposes asset bytes, so an asset
cleared for a *video* is not automatically cleared for *browser
delivery*. Keep provenance (source, dated license copy, creator
credit) beside every asset. AI-generator output rights are a
separate check per service/model, recorded at generation time —
generated output is never assumed commercially cleared. Related:
the reference Hunyuan3D-2 combined shape+texture pipeline reports
~16 GB memory, over this rig's 8 GB — local gen3d characters are
**shape-first, texturing as a separate step**, and the 2mini
variant's actual footprint gets verified on the rig before the
pipeline depends on it.

**Conversion chain (Blender is the hub):** FBX/VRM source →
normalize to the house skeleton (§2) → skin-weight validation
(**≤4 influences per vertex, weights normalized** — a hard WebGL2
limit) → decimate to class targets (hero ~50K tris, mid ~30K,
background ≤10K or impostor, per the budget doc) → glTF 2.0 (GLB)
→ **glTF-Transform** pass (meshopt geometry + KTX2 textures) →
browser-ready GLB, **<5 MB per character** including clips.
Every GLB carries a **resource manifest**: asset/source id,
license evidence, skeleton version/hash, material and triangle
counts by LOD, texture formats and mip bytes, clip dependencies,
QA results.

## 2. The house skeleton v1 (T-VID-19) — decision

**49 bones base, 61 hero variant, both under the ≤64 cap.**
Mixamo-compatible bone names (the primary source uses them;
name-mapping cost dominates every alternative), T-pose rest,
mirrored symmetry. Two candidate layouts were reconciled: the
first report's 54-bone skeleton spent 30 bones on full finger
chains with no twists; the second's 61-joint schema added face
joints and contract discipline but kept full fingers. This layout
takes the contract discipline, keeps twists where deformation
actually fails, trims fingers on the base rig, and drops the
end/leaf bone both layouts carried (no leaf bones in delivery):

| Group | Bones | Count |
|---|---|---|
| Core | Hips, Spine, Spine1, Spine2, Neck, Head | 6 |
| Face | Jaw, Eye.L, Eye.R (blink/expression via morphs, not more bones) | 3 |
| Arm (×2) | Shoulder, Arm, ArmTwist, ForeArm, ForeArmTwist, Hand | 12 |
| Fingers (×2) | Thumb ×3, Index ×3, Middle ×3 | 18 |
| Leg (×2) | UpLeg, ThighTwist, Leg, Foot, ToeBase | 10 |
| **Base total** (`HouseRig_v1`) | | **49** |
| Hero variant | + Ring ×3, Pinky ×3 per side | **61** |

**Contract settings:** meters, Y-up, facing +Z; container scale
(1,1,1) with armature scale applied before binding; T-pose with
palms down and recorded knee/elbow pre-bend; rest matrices, joint
order, and parent indices **frozen** — proportion variants share
clips only when their rest transforms match, otherwise they are
separately baked variants (the same names do not make hip
translations or contacts interchangeable). No IK controls, pole
targets, or helper rigs in delivery. Every candidate rig passes a
standard torture-test clip (arms overhead, ±90° pronation, fist,
deep squat, high knee, head ±70°, jaw + blink) with early
rejection on: unweighted vertices, weight sums off 1 by >0.001,
"candy-wrapper" wrists, shoulder collapse, crotch tearing.

**Freeze rule:** once clips are retargeted, the skeleton does not
change — any change re-opens every clip. Version it (`HouseRig_v1`)
and carry the version in every clip's metadata (§3).

## 3. Animation (T-VID-20)

**Retargeting is an offline Blender step**, with **Auto-Rig Pro
Remap** as the named tool (stored mapping presets, twist handling;
its dual-quaternion authoring previews do not match linear-blend
exports — approve deformation under linear blending). The route:
name-mapping onto the house skeleton + **two-bone IK foot-lock**
to correct the bone-length mismatch that causes foot sliding,
root motion extracted to the character's outer group (applied
exactly once; dance clips default to in-place), hip displacement
scaled once by a documented leg-length ratio. Bake at 60
samples/sec; 30 only after contact checks pass. Two intake
constraints the first report missed: **Mixamo has no batch API** —
fitting is human-assisted, so sourcing throughput is a manual
budget line; and AI-generated motion is **reference only** —
noisy, non-standard skeletons, chronic foot sliding. QA
thresholds per clip (human-scale): planted-foot speed <0.02 m/s,
stance drift <1 cm, sole height within ±1 cm, loop closure
within 0.5°, no animated bone scale.

**Clip metadata is part of the asset**: clip id, BPM, loop flag,
skeleton version, source, tags. Clips are 4–8 s loops at 30 fps;
≤2 MB of animation data per character.

**Beat architecture — the audio clock is the only clock, and
playback is reconstructable.** Animation time derives from
`AudioContext.currentTime` and the *measured* beat grid
(T-VID-03), never from the render loop; continuous beat position
interpolates the measured timestamps piecewise (B(t) between
beats i and i+1), and a second piecewise map converts clip beats
to clip seconds via the clip's own contact/accent markers — a
perfectly regular clip is the special case, not the assumption
(the first report's sample controller assumed uniform beats; that
math does not survive a tempo change). **Determinism rule:**
state at any timestamp is *recomputed* from the schedule, never
accumulated from event history — controlled actions get explicit
times/weights with fading and warping stopped, so seeking
backwards or rendering at 15/30/60 fps yields the same logical
pose. Crossfades are phase-aligned first, **warp off**, duration
a smoothstep over 0.25–0.5 beat clamped to 0.08–0.25 s.
Section intensity layers (idle/groove/dance + scheduled additive
gestures) are data — `{beatStart, beatEnd, clipId, phaseOffset,
layer, weightCurve}` — with additive gestures filtered to
upper-body tracks at weight 0.3–0.6. One mixer per character;
`AnimationAction`s are never shared; skinned hierarchies clone
via `SkeletonUtils.clone()`. This is the mixer-side engineering
of [[character-animation-2026-summer-synthesis]]'s beatPhase rule.

## 4. Textures + materials (T-VID-21)

**KTX2 is the delivery format** (already T-VID-12 policy; here are
the character settings): **ETC1S for albedo, UASTC for normal
maps**; albedo flagged sRGB, normal maps never (linear data — the
classic gotcha). Resolutions by class: hero 2048², mid 1024²,
background 512². (The report's encoder parameter names are
directional only — verify against the basisu / glTF-Transform
docs at implementation time.)

**Material structure**: one main atlas material + a separate
alpha-tested hair material + one shared eye material per hero.
Maps pack as **ORM** (occlusion R, roughness G, metallic B,
linear) beside base color (sRGB, de-lit) and tangent normals —
no separate specular/cavity/displacement maps in the initial
profile. Baselines: skin roughness 0.45–0.65, cloth 0.65–0.9,
eyes 0.08–0.18, metallic 0 for nonmetal regions.

**Memory is a ledger, not a file size.** KTX2 stays compressed
on the GPU only if the transcode target is a block format — if
the browser path falls back to RGBA8, three 2048² maps balloon
from ~16 MiB to ~64 MiB. Verify the actual transcode format on
the Pascal/browser path; never assume BC7. Residency targets:
hero ≤64 MiB, mid ≤24 MiB, background ≤8 MiB of unique textures,
counted once for shared assets, including PMREM/environment,
shadow maps, and control targets; planned steady state ≤750 MB
of the 1 GB scene budget, swap peaks below 1 GB (a new scene
never preloads a full second budget on top of the old).

**Draw calls are counted per pass, not per object.** A worked
three-hero frame (beauty + shadow + depth/control passes, set,
composite) totals ~104 of the ≤150 — comfortable; eight
characters only fit with reduced material groups and reduced
shadow participation. Verify with an explicit per-pass counter
or Spector.js, not by arithmetic alone.

**Hair and alpha**: hair cards run **opaque with `alphaTest`
~0.5** (eyelashes ~0.3, lace ~0.4) — never `transparent: true`,
whose per-object sorting breaks the moment cards overlap.
`alphaHash` exists in the studio's three.js version line as the
higher-quality option. Decide this *before* characters are built;
reworking transparency late means rebuilding hair geometry.

**Hair construction**: a solid cap plus limited alpha-tested
cards (≤5–10K hair triangles on a hero, one shared material,
depth-write on). Shell and strand systems are rejected for this
profile — repeated layers and control-pass ambiguity buy nothing
for a consistency-first pipeline.

**Skinned LOD** (the second report's chains, adopted): LOD is
generated offline — three.js LOD selection simplifies nothing by
itself, and bone reduction means rebuilding joint arrays, inverse
bind matrices, weights, and clip bindings, never deleting bones
from a live hierarchy. Chains: LOD0 full rig; **LOD1 (~31
joints)** — finger weights collapse to the hands; **LOD2 (~21
joints)** — toes collapse to feet, face/hair to head, twist
weights transfer to their main limbs. Selection by projected
height with ~15% hysteresis: full rig above ~350 px, LOD1
140–350, LOD2 60–140, impostor below ~60 **only for characters
that do not drive control passes** — a pose/depth source keeps
its real geometry (hidden control geometry, counted) or is
declared non-controlling. The semantic pose rig (§5) stays full
regardless of which beauty LOD is displayed.

## 5. Runtime (T-VID-22)

**Renderer baseline** (mostly already the studio's mount config):
WebGL2, ACES tone mapping, sRGB output, PCF-soft shadows, pixel
ratio capped at 2. One decision to test: the reports recommend a
**2048² shadow map over a tight stage** (~6 m ortho bounds,
normalBias starting ~0.01) where the studio currently runs 1024²
over a wide frustum — recorded as a headed test in T-VID-23, not
a silent change. Tight bounds matter more than raw resolution:
2048² over 6 m is ~2.9 mm texels.

**Skin without SSS — diffuse wrap**, implemented as an
`onBeforeCompile` modification of MeshStandardMaterial (the
practical three.js route), **wrap starting at 0.25** with shadow
attenuation retained on the wrapped term (the reports bracket
0.25–0.5; start conservative, tune against the golden scene —
0.5 unshadowed reads as glow). A capped, light-facing rim is the
only other sanctioned cheat; no toon ramp stacked on this profile.

**Disposal is mandatory on character/scene swap**, and it is
reference-counted, not naive: stop actions, `uncacheRoot`, then
dispose geometries/materials/textures only at zero references
(shared resources are the norm once characters share atlases);
material disposal never substitutes for texture disposal, and
bone textures + render targets are disposed explicitly. The
studio's factory does none of this today — a slow GPU-memory
leak across scene swaps. Registered as T-VID-23, whose
acceptance is the second report's test: 20 scene swaps with no
unbounded growth in renderer.info counts or the byte ledger.

**Pose pass — resolved** (the first report drifted to extracting
pose from foreign video, T-VID-07/10's route; the second answered
the actual question). The owned skeleton is evaluated **once**
per output frame and every pass derives from that single pose —
pose is never re-estimated from the rendered image. Three
simultaneous outputs: (1) an **OpenPose-format control image**
— the house joints mapped to the checkpoint's 18 body landmarks
and drawn with its palette/connectivity/raster style, using
marker offsets for anatomical landmarks (markers do not consume
skin-palette slots); (2) a **depth control image** from
view-space depth with fixed shot bounds, nearer-white per the
MiDaS-style convention, no tone mapping or per-frame
normalization; (3) a **Float32 numeric archive** (joint
positions/quaternions + camera/root metadata) as the portable
master for reprojection and future custom controls. Precision
limits are stated, not implied: an 8-bit depth image over a
0.5–10 m range quantizes to ~3.7 cm steps; stick figures encode
neither axial twist nor identity — appearance consistency stays
T-VID-16's problem. **Never** KTX2, lossy encoding, sRGB, or
tone mapping on control data. This is T-VID-13's pose-pass
contract input.

## 6. Corrections to the source

| Source claim | Verdict here |
|---|---|
| <50 draw calls, <250 MB textures, 5–10 characters | Generic-web targets. **Our measured budgets govern**: ≤150 calls, ≤1 GB scene textures, ≤8 skinned (budget doc) |
| 54-bone skeleton, full fingers, no twists | Rebalanced to 47/59 with twist bones (§2) |
| Beat controller math (uniform beats) | Wrong for real songs; interpolate the measured grid (§3) |
| VRAM table (~32 MB per character) | Conflates file size with decoded size; KTX2 stays GPU-compressed — account per the budget doc, measure with RenderStatsBadge |
| "Pose extraction" = OpenPose on video (report 1) | Different problem (foreign footage). Report 2's render-from-owned-skeleton answer adopted (§5) |
| Mixamo "free for commercial use" | True inside projects; raw-asset redistribution is prohibited, and there is no batch API (§1, §3) |
| "60 FPS with 5 characters" (report 1) | Unmeasured claim, disregarded — no transferable benchmark exists for this rig/browser/profile; acceptance is local measurement on the golden scene |
| Hunyuan3D output "ready to use" (implied) | Combined pipeline ~16 GB > 8 GB VRAM; shape-first locally, rights recorded per generation (§1) |
| Source lists | Report 1: bare domains, partly irrelevant. Report 2: cited but untested here. Both treated as practitioner-grade input, not measurement |

## 7. Adoption order

1. **Freeze the contract first**: coordinates, HouseRig_v1 (§2),
   license manifest; build one golden character + one asymmetric
   test clip.
2. **Validation and accounting before cast**: validators,
   per-pass draw-call counting, the texture byte ledger (§4).
3. **One character** passes deformation tests in the actual
   browser build; then the offline retarget/contact bake (§3).
4. **Beat scheduling + random-order seek tests** before any rich
   state machine (§3).
5. **KTX2 atlases + the three-material profile + single-shadow
   lighting**, with shader warm-up (§4–5).
6. **Multi-character ownership/caching/disposal** (T-VID-23);
   scale 2 → 3 → 8 only with explicit LOD budgets.
7. **Pose/depth formats locked** and validated against one chosen
   conditioning model (§5, feeding T-VID-13).
8. Only then: wrap/rim refinements, facial polish, more clips,
   distant impostors.

Expensive to reverse, in order: the skeleton + coordinate +
rest-pose contract; the time/root-motion/capture contract; the
asset-rights and material/UV contract. Everything else iterates.

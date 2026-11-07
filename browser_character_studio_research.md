# Local AI Music-Video Studio: Browser Character Production Report

Prepared for Nathaniel Smalley — 6 November 2026

## Executive verdict and operating contract

Build an offline-normalized asset pipeline: Blender plus Auto-Rig Pro for preparation and retargeting; one versioned 61-joint house skeleton; glTF 2.0/GLB with KTX2 textures; pinned three.js WebGLRenderer and matching addons; one mixer per independent character; absolute musical-time evaluation; and direct OpenPose-compatible pose rendering plus a separate depth pass.

The architectural priority is **determinism**, not photorealism. Do not run diffusion generation concurrently with the real-time renderer on this 8 GB GPU. Capture control frames first, unload browser resources when appropriate, and then generate video as a separate offline stage. This report does not promise real-time AI video generation.

All numerical allocations below are proposed engineering limits and acceptance thresholds, not measured GTX 1070 Ti benchmark results. No reliable source examined provides a transferable benchmark for this exact combination of rig, browser, shaders, viewport, and GPU. Acceptance therefore requires local measurement; meeting triangle and draw-call limits alone cannot guarantee a frame rate.

| Resource | Hard ceiling supplied by you | Recommended initial allocation |
|---|---:|---:|
| Draw calls | 150 per scene | Count the entire displayed/captured frame, including shadows, depth, pose, and fullscreen passes; aim for ≤120 |
| Visible triangles | 1.5 million | ≤800,000 in the beauty view initially; also log triangles processed across all passes |
| Skin joints | 64 per skinned mesh | 61 in the full house rig; validate every skin, not only the body |
| Animated characters | 8 simultaneously | Start with 2–3; eight use LOD and reduced materials, never eight unrestricted heroes |
| Texture memory | 1 GB per scene | Treat as decimal 1,000,000,000 bytes; aim for ≤750 MB including environment, shadow, depth, and color targets |
| Texture delivery | KTX2 | All authored sampled textures KTX2; generated render targets are not delivery assets |
| Display profile | Not specified | Begin at 1280×720, pixel ratio 1; 60 Hz target, with a separate deterministic 30 fps export profile |

Keep a resource manifest beside every GLB: asset/source identifier, license evidence, skeleton version/hash, material count, triangle count by LOD, texture dimensions/formats/mip bytes, clip dependencies, and QA results. Pin tool versions in a lockfile and keep a golden character/clip scene. Current online documentation is not a promise that an older installed release has the same options.

## PART A — Sourcing, auto-rigging, and the house skeleton

### A1. Single recommended approach

Acquire a small number of explicitly licensed humanoid source characters, then normalize all of them offline in Blender to your own export skeleton. Use Auto-Rig Pro as the main authoring/retargeting tool, but make a scripted house-skeleton export and validator—not a vendor's default skeleton—the contract. Accept FBX/Blend/OBJ input; require GLB only at the browser delivery boundary. Auto-Rig Pro documents rigging, binding, baked export, remapping, and import/export of mapping presets. [web:83][web:86][web:95]

This deliberately spends effort once per character instead of debugging heterogeneous skeletons during playback. Existing rigs are useful input, not automatic certification that a model meets your runtime contract.

### A2. Sources and licensing: what actually matters

The practical sourcing channels are commissioned/base-template characters, downloadable libraries, commercial character marketplaces, and scans converted into production assets. There is no source in this research establishing market-share rankings for production teams, so none is implied.

| Channel | Role in this studio | Acceptance rule |
|---|---|---|
| Commissioned or internally authored Blender base | Preferred long-term source | Contract explicitly covers mesh, textures, rig modification, commercial audiovisual output, and any future browser distribution |
| Mixamo library | Fast prototype characters and motion references | Adobe permits royalty-free use of its characters and animations in personal, commercial, and nonprofit projects, including films and games; preserve the applicable terms [web:45] |
| Sketchfab downloads | Select CC0 or commercial-compatible CC BY humanoids | Check the individual asset license; downloadable does not mean public domain; preserve creator credit and a dated license copy [web:54] |
| ActorCore/Reallusion and commercial marketplaces | Paid production candidates | Inspect each SKU's content/export/distribution terms, not just the rigging tool's license; AccuRIG export supports FBX/USD rather than being a native GLB pipeline [web:51] |
| Scanning/photogrammetry | Custom likeness only when needed | Budget for retopology, UV work, de-lighting, separate eyes/mouth/hair, and new skin weights; obtain explicit rights and likeness consent before using a recognizable person |

Licensing intake policy:

1. Reject CC BY-NC for this potentially commercial studio. Reject CC BY-ND when retopology, rebaking, rerigging, or texture changes are needed. Treat CC BY-SA as requiring a deliberate derivative-asset compliance plan, not as automatically unsuitable for every audiovisual use. The relevant CC license governs the details. [web:54]
2. Distinguish a rendered music video from distributing a downloadable GLB. Sketchfab's standard terms prohibit providing the licensed material as a standalone/extractable asset. A browser can expose asset bytes, so do not assume a video/game permission automatically authorizes shipping an asset library or character editor. For public browser delivery, choose permissive assets or obtain explicit written permission. Compression and obscured URLs are not a rights grant. [web:56]
3. Do not assume an uploader owns every logo, celebrity likeness, garment design, or texture. Store provenance and source images, not just a marketplace receipt. Escalate uncertain rights rather than claiming an asset is “license-clean.”
4. AI-tool code licenses, model-weight licenses, hosted-service terms, input-image rights, and output rights are separate intake checks. Do not describe Hunyuan3D or Tripo output as automatically commercially cleared. Record the exact service/model and terms at generation time; generated geometry still needs production cleanup.
5. Keep motion-library files inside the project; do not redistribute a raw motion collection merely because rendered use is permitted. Adobe's FAQ establishes project-use permission, not a blanket standalone redistribution authorization. [web:45]

### A3. Practical auto-rigging comparison

Quality here is a workflow assessment, not a measured head-to-head ranking: geometry topology and manual cleanup dominate the final result.

| Route | Practical strengths and likely failures | Skeleton compatibility | Automation verdict |
|---|---|---|---|
| Mixamo | Fast initial humanoid fitting; marker placement and a recognizable neutral pose are important; inspect fingers, shoulders, crotch, and clothing bridges | Treat downloaded rig as a source; map/bake into house rig, do not merely rename bones | Human-assisted web intake. No supported batch API was established in this research; do not depend on browser scraping. Practitioner discussions describe the manual fitting requirements [web:16][web:18] |
| AccuRIG | Guided calibration and motion preview; useful alternative intake for difficult humanoids; still inspect all weights | FBX/USD goes through Blender, then house export | Official workflow is UI-driven; a supported unattended CLI was not established. Purchased motions are a separate content entitlement [web:51][web:52] |
| Blender + Auto-Rig Pro | Recommended: editable fitting, binding, remap presets, twist handling, repeatable export | Export only your agreed deform hierarchy; retain the richer control rig in the Blend source | Automate mapping, baking, validation, and export after human fit/weight approval; pin addon operators because names have changed [web:83][web:87][web:95] |
| Blender Rigify / stock armature tools | Useful local control-rig authoring when avoiding a paid addon; not a guarantee of automatic fitting to arbitrary AI topology | Bake controls into the same house deform rig | Python can orchestrate a local pipeline, but fitting and skinning QA remain manual tasks |
| Research or AI riggers | Evaluate only on disposable intake fixtures | Require explicit joint mapping, rest-pose normalization, and weight checks | Not the production foundation until reproducibility, license, and runtime export pass your tests |

Auto-Rig Pro warns that removing twist bones redistributes their weights and changes deformation. Its docs also warn that dual-quaternion “Preserve Volume” previews do not match linear-skinning game exports. Perform approval with linear blending, not an attractive but nonrepresentative authoring preview. [web:85][web:88]

Hardware scope: Hunyuan3D-2's reference repository reports 6 GB for shape generation and 16 GB for combined shape plus texture. The reference combined pipeline does not apply on this hardware. Shape-only's stated memory figure is not proof of Pascal kernel compatibility, acceptable latency, or concurrent browser headroom. Import already-generated meshes into the production pipeline; do not make unverified local generator operation a dependency. [web:82]

### A4. The 61-joint house skeleton

Use a versioned schema named `studio_humanoid_v1`. Count all joints in the exported skin palette, including the root if included. Keep these names exact and unique within each character subtree.

| Group | Names / definition | Count |
|---|---|---:|
| Central chain | `root`, `hips`, `spine_01`, `spine_02`, `chest`, `neck`, `head` | 7 |
| Face | `jaw`, `eye_L`, `eye_R` | 3 |
| Arms | Per side: `clavicle`, `upperarm`, `forearm`, `hand` | 8 |
| Legs | Per side: `thigh`, `shin`, `foot`, `toe` | 8 |
| Fingers | Per side: `thumb_01..03`, `index_01..03`, `middle_01..03`, `ring_01..03`, `pinky_01..03` | 30 |
| Twist helpers | `upperarm_twist_L/R`, `forearm_twist_L/R` | 4 |
| Optional visual secondary | `hair_main` | 1 |
| Total | Three slots remain below the 64-joint ceiling | 61 |

Naming expansion is `upperarm_L`, `index_01_R`, etc. `hips` is a child of `root`; central chain continues upward; clavicles branch from `chest`; legs branch from `hips`; jaw and eyes branch from `head`; fingers from hands; toes from feet. Twist bones are deform side branches of the associated limb, not extra joints inserted into the main IK chain. `hair_main` branches from head. If unused, it can remain unweighted with a neutral track; do not silently reuse its index for something else.

Contract settings:

- Runtime glTF coordinates: meters, Y-up, character facing +Z; a 1 m axis fixture verifies conversion from Blender authoring coordinates. Apply object/armature scale before binding; exported character container scale is `(1,1,1)`.
- Standard neutral pose: one documented T-pose, palms down, straight wrists, modest knee/elbow pre-bend recorded in the reference file. Lock joint local basis/roll conventions; names alone cannot establish retarget compatibility.
- Canonical master proportions: choose one reference body and freeze rest matrices, joint order, and parent indices. Fashion/weight variants that preserve those joint rest transforms can share clips directly. Materially different limb proportions become separately baked target-proportion variants; the same names do not make hip translations or contacts interchangeable.
- Four normalized weights per vertex as a house constraint; remove zero/unused influences and renormalize after pruning. Maximum 64 palette entries for every exported skinned mesh. No IK controls, pole targets, leaf/end bones, or Blender helper rigs in delivery.
- Bake twist rotation offline with a validated swing/twist decomposition. Start with 50% axial rotation on each helper, then tune weights; never divide Euler angles indiscriminately. Clips lacking twist animation need offline twist generation.
- Retain jaw/eyes but use a small set of morphs for blink and expression instead of adding a dense facial skeleton. These are project design choices, not glTF requirements.

### A5. Step-by-step workflow and skinning gates

1. Archive source and license manifest; run mesh inspection before purchasing more motions.
2. Fix nonmanifold defects that interfere with binding, fused limbs/fingers, body-clothing intersections, and unusable UVs. Retopologize AI/scanned triangle soup where joints need coherent loops.
3. Fit the canonical landmarks in Blender, then bind and manually repair weights. Transfer weights to clothing and test clothing separately.
4. Bake the approved deform rig to the house hierarchy. Remove controls and constraints from delivery; keep the original control rig in the authoring file.
5. Run a standard 10-second torture-test clip: arms overhead, shoulder rotation, 90° and 140° elbows, pronation/supination ±90°, fist/spread, deep squat, high knee, planted-foot ankle bend, head turn ±70°, jaw open and blink.
6. Inspect wireframe, joint colors, weight heatmap, and normal-lit renders in Blender and in the actual three.js build. Test extreme poses at the intended camera distance, not only bind pose.
7. Export GLB, validate it, reload it fresh, and compare screenshots and sampled joints with the authoring reference.

Early rejection tests: no unweighted vertices; weight sums within 0.001 of 1; no more than four influences; no NaN transforms; no unexpected animated scale; all required names unique; palette ≤64; no sudden wrist “candy wrapper,” shoulder collapse, elbow spikes, thigh/crotch tearing, knee inversion, floating garments, or eyelids missing the eyeball. Use a 1 cm intersection/landmark deviation alert for roughly human-sized assets as a review trigger, not a universal aesthetic guarantee.

## PART B — Retargeting and beat-synced blending

### B1. Single recommended approach

Retarget and contact-correct offline in Blender using Auto-Rig Pro Remap; deliver approved house clips and beat/contact metadata. In three.js, evaluate animation from absolute song time, not accumulated render deltas. Use one independently controlled mixer per character, immutable cached clips, and a deterministic section/state schedule. Auto-Rig Pro supports stored bone mapping, while three.js provides `SkeletonUtils.retargetClip()` for programmatic retargeting; the latter is useful for previews and controlled import tools, not a substitute for foot-contact cleanup. [web:95][web:11][web:28]

### B2. Retarget workflow and quantitative checks

1. Import source motion and target in the same meter-scale scene. Measure height and leg length; fix the familiar 100× FBX centimeter error before retargeting.
2. Establish true source/target rest poses and local axis offsets. A source already in an animated first frame is not automatically a valid rest-pose reference.
3. Use a saved source-to-house map, including hips, spine, clavicles, fingers, and twist policy. Solve rotations in rest-corrected spaces; do not blindly copy local quaternions from differently oriented bones.
4. Scale hip displacement once using a documented target/source reference-length ratio. Do not animate bone scale to compensate for different body dimensions.
5. Bake at 60 samples/sec initially. Test 30 samples/sec export only after contact and fast-hand-motion error checks. Use linear/spherical interpolation supported by the delivery tracks; verify any addon's STEP export requirement rather than assuming its default bake settings suit your interpolated playback. Auto-Rig Pro's export docs explicitly describe per-frame baking and a GLTF STEP caveat. [web:83]
6. Extract planar root translation and yaw into a separate motion curve; retain hip vertical bounce. Default dance clips are in-place with stage placement controlled by an outer character Group. Traveling clips apply their root curve to that Group exactly once.
7. Mark foot-contact intervals. In Blender, lock each planted foot with IK and solve the hips/knees around it, then bake back to FK tracks. Runtime IK is not the first solution for a reusable music library.
8. Tag each clip with loop period in musical beats, actual clip-time beat/contact markers, allowed tempo range, left/right support phase, and compatible entry/exit beats.

Proposed early QA thresholds for a human-scale character: planted ankle/foot reference speed below 0.02 m/s, positional drift below 1 cm during a marked stance, sole height within ±1 cm of the intended floor, bone-length change below 0.1%, and no object scale departing from 1. Test in world space after stage-root motion, not only in local coordinates. Compare contact positions and rotations at both loop ends; inspect quaternion sign/shortest-path continuity if a limb spins through a seam.

For retargeting in a browser import tool, pin the three.js revision and read that revision's `SkeletonUtils` implementation. Current docs require the target of `retargetClip` to have a `skeleton` property; passing arbitrary GLTF scene roots is not the documented interface. Provide explicit mappings/options, validate hip handling with a short fixture, and export/cache the result rather than reretargeting every frame. Practitioner reports document behavioral pitfalls across revisions. [web:11][web:12][web:25]

### B3. Mixers, crossfades, additive layers, and state

Use a maximum of two normal base actions plus one additive upper-body gesture per character. Share `AnimationClip` data only when target track bindings and rest/proportion contracts match. Never share `AnimationAction` objects between characters. `clipAction()` caches actions for a clip/root pair; the mixer API explicitly supports one mixer for each independently animated object. [web:28]

For ordinary preview transitions, prepare the incoming action before fading:

```js
incoming.reset();
incoming.enabled = true;
incoming.setEffectiveTimeScale(1);
incoming.setEffectiveWeight(1);
incoming.play();
incoming.crossFadeFrom(outgoing, 0.20, false);
```

`crossFadeFrom` accepts a duration and an optional speed-warp flag. Set warp false for beat-locked playback: duration matching is not the same as matching musical contact phase. Phase-align the two clips before the fade. [web:26]

For deterministic export and seeking, do not rely on previously scheduled fade events. Recompute each active action's local time and effective weight from the section schedule at the requested timestamp; call `stopFading()` and `stopWarping()` for those controlled actions. Use a smoothstep fade over 0.25–0.5 beat, normally clamped to 0.08–0.25 seconds. Normalize the two base weights to sum to 1. Explicit time, weight, enabled, pause, and stop-fade controls are exposed by `AnimationAction`. [web:26]

Make additive gestures relative to a known reference pose using `AnimationUtils.makeClipAdditive()` in the pinned build. Filter the resulting tracks to spine/chest/clavicles/arms/head as needed; three.js action weights do not by themselves constitute an anatomical bone mask. Remove root, hips, and planted-leg tracks. Start additive weight at 0.3 and cap at 0.6 until deformation tests pass. Large arm swings may require a normal upper-body override rather than a small additive delta.

State policy:

- `idle`: intro/outro or silence; quiet loop, no random autonomous transitions.
- `groove`: verse, low-energy base; select at an annotated downbeat.
- `dance`: chorus/drop, compatible foot-support phase and approved tempo range.
- `gesture`: scheduled overlay with exact beat onset/end; underlying base continues.

Keep state transitions as data `{beatStart, beatEnd, clipId, phaseOffset, layer, weightCurve}`. More than one performer uses different authored clip choices or fixed beat offsets, never unseeded per-frame randomness. Same scene manifest, song timeline, and output frame number must yield the same logical pose independent of frame history.

### B4. Phase-lock to a measured beat grid

Store actual audio-relative timestamps `t[0], t[1], ...`, downbeat/bar labels, meter changes, confidence, and manual corrections. A BPM number cannot express pickup offsets, rubato, or changing tempo. Measure offline with a beat-analysis tool such as librosa or a DAW, then manually verify against transients and downbeats. This is a proposed tool role, not a claim that automatic beat tracking is infallible.

For `t[i] <= t < t[i+1]`, define continuous song beat position:

\[
B(t)=i+\frac{t-t_i}{t_{i+1}-t_i}.
\]

For a loop of `N` beats starting at beat `B0`, use positive modulo `p = mod(B(t)-B0+offset,N)`. Map `p` into clip seconds through a second piecewise-linear table of clip beat markers `(beat, clipTime)`. Only a perfectly regular clip should use `clipTime = p * duration/N`.

This two-map approach matters: song timing tells you when the musical event occurs, while clip markers tell you where the relevant movement occurs. Put a foot-contact marker or hand-accent marker at the desired beat, rather than assuming every evenly spaced animation frame represents an evenly spaced musical subdivision.

Illustration: song beat timestamps 10.00, 10.50, 11.00, 11.40 seconds imply beat intervals of 0.50, 0.50, 0.40 seconds. At 11.20 seconds, `B=2.5` relative to the first marker. A four-beat loop is at beat 2.5 even though the song has accelerated; no accumulated correction is needed.

Recommended evaluation sequence:

```js
function evaluateCharacter(character, songSeconds) {
  const states = scheduleAt(songSeconds); // reconstructable, not event-history driven
  for (const layer of character.layers) {
    const s = states[layer.id];
    const a = layer.action;
    a.stopFading(); a.stopWarping();
    a.enabled = !!s;
    if (!s) continue;
    a.paused = true;
    a.time = clipTimeAtSongTime(s, songSeconds);
    a.setEffectiveWeight(s.weight);
  }
  character.mixer.update(0);
  character.root.updateMatrixWorld(true);
}
```

Create and `.play()` these actions once during setup, so they remain scheduled; keep `enabled=true` for paused actions being sampled. Verify this exact pattern with your pinned build. Do not call `mixer.setTime()` after assigning independently mapped action times: it can replace the times you just computed. Mixer `setTime` is useful for whole-mixer timelines, not this per-clip nonlinear phase mapping. [web:26][web:28]

Preview uses a stable audio transport clock with explicit seek/pause offsets. Export samples `t = start + frameIndex/fps` and the same audio-origin convention. At tempo jumps the pose phase stays continuous, although velocity may change; choose a different clip or author a transition when playback-rate ratio falls outside an initial 0.8–1.25 window. Do not “smooth” musical event times away just to hide an unsuitable clip.

Early detection: a debug overlay shows song beat, clip beat, active support foot, action weights, and stage root. Seek backward and evaluate frames out of order; compare joint-transform arrays within a tolerance. Test the same timestamp after playback at 15, 30, and 60 render fps. Cross-machine pixel-bit-identical WebGL output is not guaranteed; deterministic logical poses and repeatable capture on the pinned machine are the attainable contract.

## PART C — Textures, hair, LOD, and browser budgets

### C1. Single recommended approach

Use restrained metallic-roughness PBR: one main atlas material, a separate alpha-tested hair material, and one shared eye material per hero. Deliver mipmapped KTX2: ETC1S for ordinary color maps, UASTC for normals and packed material maps, with a higher-quality UASTC exception for hero face/hair color when ETC1S artifacts are visible. Khronos explicitly recommends matching codec to data type; the practitioner guidance identifies normals and packed ORM as especially sensitive to ETC1S artifacts. [web:50][web:21]

### C2. Per-character allocations and maps

| Class | Visible triangles at selected LOD | Texture set | Resident texture target | Beauty draws |
|---|---:|---|---:|---:|
| Hero | 60k–100k | Main 2048² base/normal/ORM; hair 1024²; eyes 512² | ≤64 MiB | 3 |
| Midground | 25k–40k | Main 1024² base/normal/ORM; hair 512²; eyes 256² | ≤24 MiB | 2–3 |
| Background skinned | 8k–15k | 512² base/normal/ORM; merged or very simple hair | ≤8 MiB | 1–2 |
| Far impostor | Fixed quad | Shared 512² or 1024² atlas, if the camera allows | Shared pool ≤32 MiB | Batched where possible |

These are house targets, not source benchmarks. An eight-character example—two 100k heroes, two 40k midground characters, four 15k background characters—uses 340k character triangles and approximately 208 MiB under these residency caps, leaving room for the set while staying below eight animated skinned characters.

Main maps:

- Base color: de-lit color, sRGB; never bake a strong directional highlight into skin if lighting will change.
- Tangent normal: linear; preserve facial/cloth shape rather than subpixel pore detail. Use OpenGL-style tangent-space normals consistent with glTF; verify a lit sphere and a seam fixture. Three.js exporter explicitly handles this convention. [web:15]
- ORM: occlusion R, roughness G, metallic B; linear. Most skin/cloth is nonmetallic; a constant metallic value can save unnecessary content but not magically remove the need for roughness when that detail matters.
- Avoid separate high-resolution specular, cavity, thickness, displacement, and per-layer detail maps in the initial profile. Put modest variation into the three main maps.

Initial artistic settings: skin roughness 0.45–0.65, cloth 0.65–0.9, eye surface 0.08–0.18, metallic 0 for nonmetal regions. These are starting values under a calibrated light, not physical constants.

### C3. Compression, loading, and memory math

Use glTF Transform and Khronos KTX-Software (`toktx`/`ktx`, depending on installed release) for offline conversion; use glTF Validator for structural validation and the exact browser build for appearance validation. Khronos lists glTF Transform and gltfpack as authoring implementations. [web:50]

Recommended encoder recipe, expressed as settings rather than unverified cross-version CLI syntax:

1. Resize main atlases to 2048/1024/512 tiers; use dimensions divisible by four, preferably powers of two.
2. Generate a complete mip pyramid with correct color-space filtering and alpha-coverage preservation for cutout hair.
3. ETC1S color starting point: quality 180 on the usual 1–255 encoder quality scale, compression level 2; tune against actual visible face errors.
4. UASTC normal/ORM starting point: quality/effort level 2, Zstandard level 18; disable lossy RDO initially for normal/ORM. Test RDO only after a specular-light comparison and record the encoder's actual parameter definitions.
5. Confirm current CLI names and accepted ranges with the installed tool's help; KTX-Software and wrappers do not share an eternal identical flag interface.
6. Mark color maps sRGB and data maps linear in KTX metadata. Set `KHR_texture_basisu` required and omit PNG fallback in the delivery profile, so unsupported loading fails visibly instead of silently inflating memory. The extension specifies these metadata, dimension, and mip requirements and supports required-only delivery. [web:50]

Initialize one KTX2Loader, set its transcoder path, call `detectSupport(renderer)`, and pass it to GLTFLoader through `setKTX2Loader()` before loading. Keep loaders, WASM transcoder assets, and addons matched to the three.js revision. [web:13][web:14][web:17]

KTX2 download size is not GPU residency. Actual memory depends on the runtime transcode format. For block-compressed mips, sum `ceil(width/4) * ceil(height/4) * bytesPerBlock` for each level, with the appropriate block dimensions for the chosen format. For a 2048² chain, 4 bits/pixel is about 2.67 MiB and 8 bits/pixel about 5.33 MiB; uncompressed RGBA8 is about 21.33 MiB. Three 2048² maps therefore occupy about 16 MiB at 8 bits/pixel, but roughly 64 MiB if all fall back to RGBA8. These are format calculations, not measurements.

Do not assume BC7 merely because Pascal hardware supports modern desktop formats: browser extension exposure and the selected transcoder path decide what is used. Khronos warns that non-color UASTC may need uncompressed RGBA when suitable high-quality GPU formats are unavailable. Budget and test the actual result. [web:50]

Maintain a unique-texture byte ledger that includes shared assets once, full mip chains, PMREM/environment allocations, shadow maps, control targets, and transition overlap. Cap planned steady-state usage at 750 MB and projected swap peak below 1 GB. A new scene cannot preload another full budget on top of the old one.

### C4. Hair and eyes

Use a solid hair cap plus a limited number of alpha-tested cards: ≤5k–10k hair triangles for a hero, one shared hair material, initial `alphaTest=0.5`, depth writing enabled, no general alpha blending. Tune the cutoff against KTX2 mip coverage. Prefer front-facing geometry where possible; double-sided cards double fragment work and make broad overdraw easier to hide.

Reject shell hair and real-time strand systems for this profile: they spend repeated layers/geometry and create control-pass ambiguity without serving your consistency-first goal. RTX-dependent strand, ray-traced eye, or engine-only Unity/Unreal solutions do not apply on this hardware/runtime. This is a scope judgment, not a claim that every strand algorithm requires RTX.

Eyes: use two eye meshes merged into one material group, a painted iris/sclera atlas, geometric curvature, stable environment highlights, a small gaze target, and blink morphs. Avoid separate refractive cornea/transmission passes initially. Author gaze/blink curves or use seeded, timestamp-derived timing. Disable unscheduled random gaze during capture. Keep hair opacity and blink silhouette consistent in depth/material variants.

Early failure checks: white/black halos indicate alpha/color preprocessing problems; sparkling hair at distance indicates mip/coverage trouble; flat eyes indicate missing stable highlights or bad gaze alignment; shiny plastic cloth often indicates roughness/color-space errors. Inspect with neutral gray lighting before adding artistic grades.

### C5. Skinned LOD and draw-call accounting

Generate LOD meshes offline, transfer/prune weights, rebake any changed bind data, and validate deformation. Three.js LOD selection does not itself simplify geometry or remove bones. Keep the authoritative semantic pose rig stable for control export, even when a beauty LOD uses a reduced deform palette.

Suggested chains:

- LOD0: 61 joints, 60k–100k triangles.
- LOD1: 31 joints: central 7 + face 3 + arm 8 + leg 8 + arm twist 4 + hair 1. Finger weights collapse to hands; finger motion no longer deforms independently.
- LOD2: 21 joints: central 7 + arm 8 + two legs with thigh/shin/foot 6. Collapse toes to feet; collapse face/hair to head; transfer twist weights to their main limbs.

Bone reduction must rebuild joint arrays, inverse bind matrices, weights, and clip bindings. Merely deleting bones from a skeleton hierarchy corrupts skins or changes children’s transforms. Since the semantic rig may remain for pose output, bone-reduced beauty LOD does not automatically reduce all CPU animation work.

Use projected character height: full rig above ~350 px, LOD1 at 140–350 px, LOD2 at 60–140 px, and consider an impostor below ~60 px with 15% hysteresis. Bake these thresholds into camera-aware capture planning. Do not swap the depth/pose-driving character to a flat billboard if its real 3D silhouette or depth matters. Either retain the hidden control geometry and count its cost, or declare that distant character noncontrolling. Impostors work best for fixed or narrowly constrained camera views.

Conservative three-hero frame accounting, using three beauty material groups, two shadow-casting groups, and three depth groups per character:

| Work | Draw calls |
|---|---:|
| Character beauty: 3 × 3 | 9 |
| Character shadow: 3 × 2 | 6 |
| Character depth/control: 3 × 3 | 9 |
| Combined batched pose overlay | 1 |
| Set beauty | 35 |
| Set shadow | 20 |
| Set depth, if included | 20 |
| Composite/fullscreen | 4 |
| Total | 104 |

Two such heroes give 96 calls with the same set. Eight three-material characters would give 144 calls with that unchanged set and pose batching—technically below 150, but without useful headroom; use fewer material groups and reduced shadow participation for the eight-character profile. Counts are arithmetic allocations, not guarantees about an implementation. Transparent double-pass behavior, groups, extra lights, and hidden meshes can raise the actual number. Use an explicit per-pass frame counter and Spector.js capture to verify.

## PART D — Runtime, character lighting, and control export

### D1. Single recommended approach

Use a resource-managed three.js WebGL2 runtime with one mixer per independent character, a fixed inexpensive lighting rig, and one authoritative evaluated pose per output frame. Derive beauty, pose, depth, and numeric pose data from that same pose and camera. Avoid estimating pose again from the rendered image: you already possess better joint information.

### D2. Runtime workflow, caching, and disposal

1. Load each immutable GLB/texture set once per active cache entry. Cache approved clips by skeleton version, proportion variant, clip content hash, and bake settings.
2. Clone skinned hierarchies with `SkeletonUtils.clone()` rather than ordinary shallow object cloning. Share geometry/material/texture resources only when intentionally immutable; bones and independent action state belong to each performer. SkeletonUtils exists specifically for skeleton-aware operations. [web:11]
3. Allocate one mixer per independent character, at most eight; allocate actions once, not inside the frame loop. Reuse vectors/matrices and avoid per-frame track construction. Mixer clip/root caching is documented. [web:28]
4. Evaluate the schedule and all character poses once; apply any approved procedural eye/twist/IK corrections in a documented order; update world matrices and skin data; then run all output passes without advancing animation between them.
5. Select LOD from projected size, update culling bounds conservatively, and warm shaders before take playback. Measure worst-case dancing poses and camera cuts rather than only idle.
6. On removal, detach scene roots, stop actions, and call `uncacheRoot(root)` for a single-root mixer. Clear your own action/character references. `uncacheRoot` requires related actions to be stopped. [web:28]
7. Reference-count shared geometry, materials, textures, skeleton resources, and render targets. Dispose only at zero references. Material disposal does not substitute for texture disposal; three.js requires explicit disposal of geometries, materials, and textures. Dispose skeleton bone-texture resources and render targets when no longer owned. [web:67]
8. Close owned ImageBitmaps when no remaining asset needs them; GLTFLoader explicitly warns they are not automatically handled like ordinary garbage-collected resources. Dispose KTX2 worker/loader resources on application shutdown, not after every character. [web:13]

Acceptance test: swap between two scenes 20 times, let pending work settle, and compare texture/geometry counts plus your byte ledger. `renderer.info` is a useful trend/debug counter, not a complete GPU-memory meter. Stable nonzero internal renderer caches are not automatically a leak; unbounded growth is the alarm. Log all passes with auto-reset behavior controlled explicitly so counters do not silently describe only the final render.

Performance acceptance: record CPU and GPU frame times separately where timer-query support is available, with disjoint results discarded. Use browser profiling plus Spector.js. At the initial 720p profile, seek ≤16.7 ms 95th-percentile total frame time for 60 Hz; if missed, reduce resolution, shadow area/resolution, overdraw, and material count before raising geometry quality. Thirty fps is an alternative declared output profile, not evidence that a 60 Hz hard target has passed. Never present a measured result without the browser/version, resolution, scene, and enabled passes.

### D3. Lighting and shading with one shadow light

Start with `MeshStandardMaterial`, one shadow-casting directional key, a low-intensity hemisphere fill, and a neutral studio environment converted to PMREM. Keep the environment modest: a 256 px face/source tier initially; include PMREM storage in the memory ledger. If all authored sampled textures must arrive as KTX2, deliver the chosen environment representation as KTX2 and verify its mapping/PMREM path in the pinned renderer; do not quietly add an HDR/EXR delivery exception.

Initial artistic setup: key roughly 35° above and 30° to camera side, soft cool fill at roughly one-quarter of the key's perceived contribution, warm-neutral skin base, restrained background contrast. Exposure is fixed per shot. These ratios describe a visual starting point, not a portable conversion between light units and environment intensity across renderer revisions.

Shadow settings: one 2048² directional shadow map, tight orthographic bounds around the active stage—initially a 6 m × 6 m area—near 0.1 m, far 15 m, with conservative bias tuning against a floor fixture. At 2048 pixels over 6 m, nominal shadow texel width is about 2.9 mm. Start `normalBias` around 0.01 m and reduce if feet detach; tiny depth bias is scene-dependent. Fix acne/peter-panning by tightening bounds and testing scale before blindly increasing bias. Exclude eyes and sparse hair cards from casting initially; use the cap/body silhouette.

Skin without SSS: rely first on good normals, moderate roughness, broad environment fill, and color grading. If that remains too harsh, add one version-controlled `onBeforeCompile` modification to wrap only the direct diffuse lobe:

\[
w=\operatorname{clamp}\left(\frac{N\cdot L+0.25}{1.25},0,1\right).
\]

Retain shadow attenuation on the wrapped term; keep the standard specular lobe, and do not claim this is physically correct subsurface scattering. Add an inexpensive artistic rim proportional to `(1 - max(dot(N,V),0))^3`, restricted to a plausible light-facing side and capped at a small fraction of key brightness. Unrestricted emissive rims illuminate the wrong edges and will not obey shadows.

Do not stack a toon ramp on top of this initial PBR profile. If art direction later requires a ramp, a 4–8 band KTX2 ramp with nearest filtering is a deliberate shading-model change, not a free material setting that improves realistic skin. Shader chunks and color-management defaults change across three.js revisions; lock the renderer and test the shader patch after upgrades. Beauty-only rim/wrap must not enter numeric depth or pose outputs.

### D4. Pose image, depth, and numeric archive

The important format distinction: an OpenPose control image is a spatially rendered colored stick figure, not an image whose texels contain arbitrary quaternion values. The published ControlNet OpenPose checkpoint expects OpenPose-style bone images; its depth counterpart was trained using MiDaS-style grayscale depth with nearer areas light and farther areas dark. Match the exact selected model's conditioning convention. [web:74]

Recommended three simultaneous outputs:

| Output | Purpose | Initial format |
|---|---|---|
| Pose control | Existing pose-conditioned models | Lossless RGB8 PNG, 512×512 with recorded letterbox transform |
| Depth control | Depth-conditioned models | Matching lossless grayscale/RGB control image derived from view-space depth |
| Numeric archive | Reprojection, validation, future custom controls | Float32 joint positions/quaternions + camera/root metadata; optional lossless packed image |

Step-by-step:

1. Evaluate frame `n` at exact song timestamp; record song origin, frame rate, camera view/projection matrices, aspect, crop/letterbox transform, near/far, stage root, skeleton hash, and character IDs.
2. Map house joints to the 18 body landmarks used by the selected OpenPose annotator: nose, neck, right shoulder/elbow/wrist, left shoulder/elbow/wrist, right hip/knee/ankle, left hip/knee/ankle, right eye, left eye, right ear, left ear. Store nose/ear/shoulder landmark offsets or marker nodes; do not pretend every skin-joint origin is anatomically the desired landmark. Such markers need not consume skin palette slots.
3. Project world landmarks through the same camera. Convert normalized device coordinates to image pixels, invert Y once, and apply the exact crop/letterbox transform. Suppress behind-camera/out-of-frame landmarks instead of drawing long connecting limbs across the canvas.
4. Render all performers into one pose image with the checkpoint's joint order, limb connectivity, palette, and raster style. The original ControlNet renderer supplies concrete limb/color tables, radius-4 joints, width-4 limb construction, and special hand drawing; use it as a compatibility reference rather than inventing a new palette. At 512 px start with its native sizing. [web:81]
5. Define visibility policy in the schema: whether occluded landmarks remain present or are suppressed, and how people crossing are ordered. Test against the chosen model's actual preprocessor output. Do not silently change policy between shots.
6. Add hands only when needed. An OpenPose hand has 21 landmarks; your three phalanges per finger plus wrist require virtual tips/landmark offsets to produce that layout. A three-bone face rig cannot synthesize dense facial landmark motion without additional authored markers/morph-derived landmarks. Original hand rendering uses a separate 21-keypoint connection scheme. [web:81]
7. Render depth from the same skinned state with a depth-compatible material and the same alpha-test silhouette. Disable color grading, tone mapping, and display transfer on data outputs. Include set geometry only if the intended conditioning requires it, and count every call.
8. Preserve linear view-space depth in a numeric master. For the 8-bit control preview use fixed shot bounds, for example `d = clamp((z - 0.5)/(10 - 0.5),0,1)` and output `1-d` when the target convention is nearer-white. A physically linear depth map is not identical to MiDaS relative/inverse-depth statistics; compare sample outputs and tune the mapping for the chosen checkpoint, without frame-by-frame normalization flicker. [web:74]
9. Read back/export on a controlled capture queue. Synchronous GPU readback can stall; do not assume a 60 fps displayed take can also synchronously encode every pose/depth PNG within its frame budget. Buffer offline export and measure the whole capture path.

Existing implementation roles: the official ControlNet annotator provides the canonical body/hand drawing reference; `controlnet_aux` exposes OpenPose preprocessing for comparison; Mikubill's ControlNet integration includes JSON serialization workflows. These help validate compatibility, not guarantee identity preservation or temporally stable generated video. [web:81][web:74][web:75]

Precision and format limits:

- A 512 px-wide pose image gives a normalized horizontal pixel step of about 0.00196; half-pixel rounding uncertainty is about 0.00098. At 1024 px those halve. This is image-space precision, not a fixed world-space error under perspective. Body-only colored sticks do not encode finger pose, axial limb twist, depth ordering reliably, or persistent character identity.
- With fixed depth range 0.5–10 m, an 8-bit linear depth step is about 3.73 cm; a 16-bit step is about 0.145 mm. These quantization calculations do not mean an 8-bit-trained control model can consume 16-bit numerical precision directly, or that the full render pipeline preserves it.
- For a custom pose-data image, use a separate schema: a 64×2 RGBA texel layout per character, row 0 for XYZ plus validity and row 1 for quaternion XYZW. Eight characters fit into 64×16 texels with unused joints explicitly zeroed/invalid. Use RGBA32F internally only after checking framebuffer support; keep Float32 binary/JSON as the portable master, since ordinary PNG cannot store float32 samples.
- A portable packed image can encode each normalized position component as an unsigned 16-bit value across two RGB8 texels per joint, with fixed stated world bounds. A 20 m coordinate span has about 0.305 mm full-step quantization. Store quaternions as signed normalized 16-bit components in a separately specified layout, renormalize on decode, and maintain quaternion sign continuity. Angular error depends on pose and encoding; do not quote one universal angle bound.
- Never apply KTX2/Basis, lossy video encoding, sRGB conversion, tone mapping, texture filtering, or mip generation to a numeric pose archive. KTX2 delivery applies to authored appearance textures, not a license to lossy-compress control measurements. RGBA16F is not equivalent to uniformly spaced 16-bit integer positions.
- Arbitrary joint-position/quaternion texel images do not work with an ordinary OpenPose ControlNet without a custom adapter or training. Pose plus depth improves geometric guidance but does not guarantee character identity or eliminate video flicker. Keep appearance references and model-specific temporal controls as a separate AI-generation concern.

### D5. Early failure matrix

| Symptom | Detect before production | Corrective action |
|---|---|---|
| Different limbs after seek | Evaluate the same timestamp in random order | Eliminate event-history fades/randomness; reconstruct schedule and absolute clip phases |
| Pose one frame behind beauty | Compare projected wrist markers against beauty overlay | Evaluate once, then update world/skin transforms before every output pass |
| Mirrored or upside-down control | Render asymmetric raised-left-hand fixture | Fix axis conversion, projection Y flip, and crop transform exactly once |
| Flat or flickering depth | Inspect numeric depth histogram across frames | Linearize correctly, fix shot bounds, disable color transforms and per-frame normalization |
| Hair disappears from depth | Compare hair-mask edges between passes | Match alpha test, map, UVs, side, and skinning in depth material |
| Memory grows on scene swaps | Twenty-cycle resource/count test | Repair ownership, action uncaching, target disposal, and bitmap lifetime |
| Under 150 calls but slow | GPU capture and CPU profile, including capture readback | Reduce fill/overdraw/resolution/shadow workload; triangles and calls alone are insufficient |
| Bad generated pose despite correct skeleton | Compare your raster with the actual checkpoint preprocessor | Match joint schema, palette, line style, resolution, and visibility convention |

## Apply in this order

1. Freeze the coordinate system, 61-joint schema, rest pose, and asset-license manifest. Build one golden character and one asymmetric test clip.
2. Implement validation, draw-call/pass accounting, and actual resident-texture tracking before sourcing a large cast.
3. Make one character pass deformation tests in the browser; then establish the offline retarget/contact/root-motion bake.
4. Build absolute beat-grid scheduling and random-order seek tests before implementing a rich state machine.
5. Add KTX2 atlases, the three-material hero profile, simple single-shadow lighting, and shader warm-up.
6. Add multi-character ownership/caching/disposal and scale from two to three, then eight with explicit LOD budgets.
7. Lock pose/depth formats, camera metadata, and a frame-accurate capture queue; validate against one selected conditioning model before expanding AI tooling.
8. Only then add optional wrap/rim effects, facial refinements, extra clips, and distant impostors.

Three expensive-to-reverse decisions:

1. Skeleton/coordinate/rest-pose contract: it couples weights, all clips, retarget maps, semantic pose landmarks, and LOD palettes.
2. Time/root-motion/capture contract: audio origin, beat grid, root ownership, and frame timestamps determine every edit and control sequence.
3. Asset rights and source-to-delivery material/UV contract: unclear distribution rights or unsuitable atlas/topology choices can force replacement and rebaking across the cast.

Drive delivery status: the connected Drive search returned an error for the requested project folder, and this session exposed no Drive create/upload/update tool. This report has not been saved to Drive. No folder ID was guessed and no write was attempted.

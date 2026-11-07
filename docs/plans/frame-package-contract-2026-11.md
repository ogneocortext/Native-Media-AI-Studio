# Frame-Package Contract — Design 2026-11

**Status:** Proposed
**Area:** Video Pipeline & Storyboard (T-VID-13)
**Source:** `docs/knowledge-library/3d-bones-ai-skin-pipeline-2026.md` §3/§5 Gap 1;
`docs/knowledge-library/browser-character-pipeline-verdicts-2026.md` §5 pose pass;
`docs/knowledge-library/pascal-3d-budget-discipline-2026.md` +
`config/asset-budgets.json` (caps); `docs/plans/tasks/video-pipeline-and-storyboard.md` T-VID-13
**Decides:** none — design only; every implementation item spun out of this
document waits on the owner's word (live generation path).
**Last Updated:** 2026-11-07

## 1. Scope and non-goals

T-VID-05 designs scenes as data; this document designs **what the builder
emits**: the per-scene frame package that Route A (grading/composite,
T-VID-15) and Route B (control-conditioned generation lane, T-VID-14)
both consume. The contract is the seam — a builder implementer and a
lane implementer must each be able to build against this file alone.

Non-goals: no code, no renders, no engine changes, no frontend surface.
This spec does **not** cover foreign-footage passes — T-VID-10's depth
*estimation* is the analog for video we did not render; here the passes
are exact renders from owned geometry.

## 2. The package

One scene render produces one package:

```text
frame_package/v1/<scene_id>__<spec_hash8>/
  manifest.json              contract + provenance + per-pass descriptors
  camera.jsonl               one JSON object per frame (see §5)
  beauty/f%06d.png           sRGB 8-bit RGB beauty frames
  depth/f%06d.png            16-bit grayscale, linear (see §3.2)
  normals/f%06d.png          8-bit RGB, world-space normals (see §3.3)
  segmentation/f%06d.png     16-bit grayscale object index (see §3.4)
  segmentation_palette.json  id → {name, asset_id, asset_version}
  pose/f%06d.png             OpenPose-format control image (§3.5) — conditional
  pose_archive.f32           float32 joint archive (§3.6) — conditional
  pose_archive.json          archive layout descriptor — conditional
```

Pass directories exist **only for passes the scene spec requests**
(§6). `pose/` and `pose_archive.*` exist only when the scene binds at
least one rigged character — the builder decides per scene, and the
manifest records which rule fired (`pose: "auto"` → present/absent).

## 3. Pass semantics — the decisions

### 3.1 Frame indexing and naming

- Zero-padded six digits: `f000000.png` … `f%06d` where the index is
  the output frame number at the package's `fps`.
- Every pass of a frame shares the same index — `depth/f000042.png`
  describes `beauty/f000042.png`. No pass may renumber.
- The package covers a contiguous frame range starting at 0 relative
  to the scene render (scene-level trimming is a spec concern, not a
  package concern).

### 3.2 Depth

- **Encoding:** 16-bit grayscale PNG, single channel.
- **Value:** linear view-space depth normalized over **fixed shot
  bounds** declared per scene in the spec (`depth_near`, `depth_far`,
  metres; defaults 0.5 / 10.0 per the verdicts doc's quantization
  analysis). `px = round((d - near) / (far - near) * 65535)`, nearer =
  larger value (nearer-white, MiDaS-style convention).
- **Never:** per-frame normalization, tone mapping, sRGB transfer, or
  KTX2/lossy encoding (verdicts doc §5 — control data rules apply to
  every pass).
- **Precision stated, not implied:** 16-bit over 0.5–10 m quantizes to
  ~0.15 mm steps — two orders finer than the 8-bit figure the verdicts
  doc quotes; 16-bit is the floor, not a luxury.

### 3.3 Normals

- **Encoding:** 8-bit RGB PNG.
- **Value:** **world-space** normals encoded `n*0.5 + 0.5` per channel.
  World-space (not view-space) is the decision: relighting and
  re-shooting consumers need a stable frame across camera moves; a
  view-space normal pass would silently re-encode under every camera
  path change and T-VID-14's lane could not reuse it.
- Camera-space normals were considered and rejected for that reason.

### 3.4 Segmentation / object ID

- **Encoding:** 16-bit grayscale PNG; pixel value = stable object index
  (1-based; 0 = background/unassigned).
- **Palette:** `segmentation_palette.json` maps each index to
  `{name, asset_id, asset_version, role}`. Indices are assigned once at
  scene-spec build time from the spec's object list and are **stable
  across frames** — a spec rebuild that reorders objects must reuse
  indices or bump the contract minor version (§7).
- **Granularity:** per-object by default; `part` granularity (materials
  or named sub-meshes) is a spec option for shots where lane masking
  needs finer control than whole objects.

### 3.5 Pose (OpenPose control image)

- Emitted **only** for frames where a rigged character is bound and
  visible; the builder skips frames where no skinned mesh contributed
  pixels (the manifest's pass descriptor records `conditional: true`).
- **Format:** OpenPose body-format RGB image — house skeleton joints
  mapped to the checkpoint's 18 body landmarks, drawn with the
  checkpoint's palette/connectivity/raster style; anatomical marker
  offsets for landmarks that are not joints (markers do not consume
  skin-palette slots). This is the verdicts doc §5 pose-pass output
  (1) verbatim — the contract adopts it unchanged.
- **Source of truth:** the pose derives from the **evaluated owned
  skeleton once per frame** — never re-estimated from the rendered
  image (verdicts doc rule).

### 3.6 Pose archive (numeric master)

- `pose_archive.f32`: flat little-endian float32 array, layout
  `[frame][joint][10]` = position xyz + quaternion xyzw +
  confidence/weight reserved (2 floats). Joint order and count are the
  HouseRig_v1 skeleton (47 base / 59 hero bones); the exact ordered
  joint-name list is recorded in `pose_archive.json` and its sha256
  must match the character asset version's rig manifest.
- Purpose: the portable master for reprojection, future custom
  controls, and audit — an 8-bit stick figure encodes neither axial
  twist nor identity (verdicts doc), so anything downstream needing
  more than OpenPose reads this file, not pixels.
- Size: ~14 KB/frame at 59 joints — negligible next to image passes.

### 3.7 Camera metadata

`camera.jsonl` — one JSON object per frame, in frame order:

```json
{"f": 0, "intrinsics": {"fx": 0.0, "fy": 0.0, "cx": 0.0, "cy": 0.0, "width": 1920, "height": 1080}, "extrinsics_cam_to_world": [16 floats, column-major], "depth_near": 0.5, "depth_far": 10.0, "rig_id": "<camera-rig preset id or null>"}
```

- `extrinsics_cam_to_world`: full 4×4, column-major, metres, Y-up
  right-handed (glTF convention — the builder's native frame; no
  conversion layer for Three.js or bpy exporters that already emit
  glTF).
- `depth_near`/`depth_far` repeat the shot bounds per frame so a
  consumer never has to join against the spec; they are constant
  within a shot and may change only at shot boundaries.
- `rig_id` names the camera-rig preset when the move came from the
  T-VID-11 registry; `null` for spec-authored keyframe paths.

## 4. Formats and encodings — summary table

| Pass | Container | Precision | Colorspace | Conditional |
|------|-----------|-----------|------------|-------------|
| beauty | PNG | 8-bit RGB | sRGB | no |
| depth | PNG | 16-bit gray | linear (none) | no |
| normals | PNG | 8-bit RGB | linear (none) | no |
| segmentation | PNG | 16-bit gray | linear index | no |
| pose | PNG | 8-bit RGB | OpenPose palette | rigged chars |
| pose_archive | raw f32 + JSON | float32 | n/a | rigged chars |
| camera | JSONL | float64 text | n/a | no |

**Beauty is 8-bit sRGB PNG, deliberately.** A linear EXR/16-bit beauty
master is the correct long-term answer for grading latitude, but it
quadruples package size on the SATA SSD for a v1 contract; PNG keeps
the package inside the storage budget (§8) and matches what the
existing finishing chain (FFmpeg/Remotion) consumes natively. EXR
beauty is a v2 candidate, not a v1 option — the manifest's
`contract: "frame-package/v1"` string is what versions this decision.

## 5. Resolution relationship to beauty

- Beauty renders at the spec's output resolution (budget-doc governed).
- Control passes render at **full beauty resolution by default**;
  `depth` and `normals` accept a per-pass `scale` of `1.0` or `0.5`
  (spec-level, recorded in the manifest). Half-res is the pressure
  valve for the storage budget — it quarters those passes' pixel count
  and the lane upscales conditioning as needed.
- `pose`, `segmentation`, and `camera` are always full resolution /
  full rate — pose landmarks and object indices do not survive
  downsampling semantics.
- Aspect ratio never changes between passes; `scale` applies to both
  axes.

## 6. Scene-spec integration (the request side)

T-VID-05's scene spec gains a `passes` block per scene:

```json
"passes": {
  "beauty": true,
  "depth": { "scale": 0.5, "near": 0.5, "far": 10.0 },
  "normals": { "scale": 1.0 },
  "segmentation": { "granularity": "object" },
  "pose": "auto",
  "camera": true
}
```

- `pose: "auto"` = emit pose passes iff ≥1 rigged character is bound
  (the only sane default — a spec author should not have to predict
  visibility).
- The T-VID-05 validator checks the requested pass set against
  `config/asset-budgets.json` scene caps **as a write-bandwidth
  estimate**: `Σ(pass_pixels × bytes_per_pixel_estimate)` per frame
  must stay under the package's per-frame budget (§8). An over-budget
  pass request is rejected at spec validation with the offending pass
  named — before any engine starts, same posture as T-VID-12.
- Passes not requested produce no directory and no manifest entry —
  absence is meaningful, not an error.

## 7. Versioning and manifest

`manifest.json` is the contract's self-description:

```json
{
  "contract": "frame-package/v1",
  "scene_id": "...", "spec_id": "...", "spec_version": "...",
  "spec_hash8": "...",
  "frame_count": 0, "fps": 0, "duration_seconds": 0.0,
  "width": 0, "height": 0,
  "passes": {
    "depth": { "encoding": "png16-gray", "scale": 0.5,
               "near": 0.5, "far": 10.0, "conditional": false },
    "pose":  { "encoding": "openpose-rgb8", "conditional": true,
               "rule": "rigged-character-visible" }
  },
  "assets": [{ "asset_id": "...", "version": "...", "role": "hero",
               "budget_report": "..." }],
  "camera_rig": "...|null",
  "builder": { "engine": "blender-bpy|three-js", "version": "..." },
  "created_utc": "...",
  "storage_bytes": 0
}
```

- **Versioning rule:** `frame-package/v1` covers everything above.
  Adding a pass, changing an encoding/precision/colorspace, or
  reordering pose-archive joints = **major** bump. Adding optional
  manifest fields or a new conditional pass = **minor** (consumers must
  ignore unknown fields). `spec_hash8` is the first 8 hex of the
  canonical-JSON sha256 of the scene spec — it makes "same spec ⇒ same
  package layout" checkable.
- **Determinism:** frame indices are positional, not timestamped;
  builders must step frames deterministically (the
  `three-js-render-motion-2026` discipline applied to the bpy side —
  T-VID-17 owns the capture spec that guarantees it).

## 8. Storage budget (SATA SSD reality)

Per-frame estimates at 1920×1080, PNG:

| Pass | ~bytes/frame (full res) | ~bytes/frame (0.5×) |
|------|------------------------|---------------------|
| beauty | 1.5–3 MB | n/a (always full) |
| depth (16-bit) | 0.4–0.9 MB | 0.1–0.25 MB |
| normals (8-bit) | 0.6–1.2 MB | 0.15–0.3 MB |
| segmentation (16-bit) | 0.1–0.3 MB | n/a (full res) |
| pose (8-bit) | 0.05–0.15 MB | n/a |
| pose_archive | ~14 KB | n/a |
| camera | ~0.5 KB | n/a |

Full pass set, full res, 30 fps × 240 s (7,200 frames): **≈ 20–38 GB**.
That is the honest number — it is why the contract makes passes
*selectable* and `scale` a first-class knob rather than shipping
everything always. Worked example: beauty + half-res depth +
segmentation + pose ≈ 7–12 GB for the same song — inside a sane SSD
budget. The hardware profile's SATA-SSD risk notes already bound write
lanes; builders must write sequentially per pass directory (never
interleave passes per frame — random small writes are the actual
hazard, not total bytes).

## 9. Consumer map (what each downstream reads)

| Consumer | Reads | For |
|----------|-------|-----|
| T-VID-14 Route B lane | depth, pose, segmentation (+ palette) | ControlNet conditioning; never re-derives geometry |
| T-VID-15 look rigs / Route A | beauty, camera, segmentation | grading, composite, LUT application |
| T-VID-16 identity layer | pose_archive, segmentation palette | character consistency references |
| T-VID-17 capture spec | manifest + all pass descriptors | engine/sample/resolution-ladder decisions |
| T-VID-12 budgets | manifest `assets[].budget_report`, storage_bytes | budget-vs-actual accounting |
| finishing chain (existing) | beauty sequence → FFmpeg/Remotion | master conform |

T-VID-14 implementers should note: the lane consumes **exact** passes —
no estimation stage exists or is needed on this route (contrast
T-VID-10's foreign-footage depth estimation).

## 10. Failure surfaces and validator checks

The package validator (lands with the builder; contract fixes what it
checks) verifies, before a package is accepted downstream:

1. Manifest `contract` string parses; `frame_count × fps` matches
   `duration_seconds` within one frame.
2. Every declared pass directory exists with exactly `frame_count`
   files named `f%06d.<ext>` in sequence — no gaps, no extras.
3. Pixel dimensions match `width × scale` per pass; bit depth and
   colorspace match the manifest descriptor (a tone-mapped or sRGB
   depth pass is a contract violation, not a style choice).
4. `segmentation_palette.json` covers every nonzero index present in
   the pass; palette indices stable across frames (spot-check frames).
5. `camera.jsonl` has exactly `frame_count` lines; `depth_near/far`
   constant within shots; `extrinsics` orthonormal within epsilon.
6. `pose_archive.json` joint list sha256 matches the bound character
   asset's rig manifest.
7. `storage_bytes` within the manifest's declared estimate ±10%.

## 11. Open questions (for the owner, not blockers)

- Beauty codec: PNG v1 vs ProRes/EXR v2 — revisit if grading latitude
  proves limiting on real scenes.
- Multi-shot packages: v1 is one package per scene render; a song-length
  sequence of shots is N packages. A roll-up index format is deferred
  until T-VID-05 specs produce multi-shot scenes.
- Depth `far` bound: fixed 10 m default suits interior shots; exteriors
  may need spec-level override (already supported via the passes block).

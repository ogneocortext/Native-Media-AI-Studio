# Lighting + Look Rigs — Design 2026-11

**Status:** Proposed
**Area:** Video Pipeline & Storyboard (T-VID-15)
**Source:** `docs/knowledge-library/3d-bones-ai-skin-pipeline-2026.md` §5 Gap 3;
`docs/knowledge-library/pascal-3d-budget-discipline-2026.md` (lighting caps);
`config/asset-budgets.json` `scene_caps`;
`docs/plans/camera-rig-presets-2026-11.md` (T-VID-11 vocabulary to reconcile)
**Decides:** none — design only; registry JSON and spec-field consumption
wait on the owner's word.
**Last Updated:** 2026-11-07

## 1. Scope and non-goals

T-VID-11 gave the I2V prompt path typed camera rigs. This document gives
the **scene side** the same thing: named lighting rigs, a lens set, and
look/grade presets that T-VID-05 scene specs reference by name — so
cinematography is vocabulary, not per-scene improvisation. It also names
Route A's missing grade step.

Non-goals: no code, no registry JSON authored to disk, no renders. The
camera *move* vocabulary stays T-VID-11's; this document owns
lighting/lens/look only.

## 2. The reconciliation call (T-VID-11 left it to this doc)

T-VID-11's registry entries carry `{move, lens{focal_mm, fragment},
lighting{setup, fragment}, look{grade, fragment}}` — prompt-side strings.
The scene side needs **parameters**, not fragments. The call:

- **One numeric vocabulary, two representations.** `focal_mm` is the
  same physical quantity on both paths — the lens set (§4) is the
  canonical list; T-VID-11's `lens.focal_mm` field already uses it, and
  its `fragment` ("shot on a 35mm lens") is derived data, not a second
  vocabulary. No parallel focal-length lists.
- **Looks are shared by id.** T-VID-11's `look.grade` is a free string;
  this registry makes it a **look id** (§5). A camera rig can then say
  `"look": {"grade": "teal-orange", ...}` and a scene spec says
  `"look": "teal-orange"` — same name, same grade, both paths. The
  camera-rigs schema needs no change: `grade` was always a string;
  it now *means* a registry id. Validation on both sides checks
  membership.
- **Lighting rigs are scene-side only.** The I2V path cannot place
  lights — its `lighting.setup` fragment stays prose ("soft key
  lighting") while the scene rig `soft-key` carries positions,
  intensities, and color temps. Where a name exists on both sides it
  refers to the same *concept* (`soft-key` ↔ "soft key lighting"), but
  only the scene side has parameters. This is reconciliation, not
  duplication: one concept, two representations, each honest about
  what it can express.

## 3. Registry shape

One file, `config/cinematography-rigs.json` (implementation item),
mirroring T-VID-11's loading rules: versioned, kebab-case unique ids,
validated on load, fail-fast with the id named.

```jsonc
{
  "version": 1,
  "lighting_rigs": [ { "id": "...", "lights": [...],
                       "dynamic_lights": 0, "baked": [...], "tags": [] } ],
  "lens_set":       [ { "id": "...", "focal_mm": 0, "f_stop": 0,
                        "look_note": "...", "fragment": "shot on a ... lens" } ],
  "looks":          [ { "id": "...", "grade": { ... },
                        "route_a_step": "...", "fragment": "..." } ]
}
```

`fragment` fields exist so T-VID-11's prompt path can compose suffixes
from the same rows — one registry serves both consumers.

## 4. Lens set v0

Aligned to T-VID-11's `focal_mm` numeric field (full-frame equivalent,
the convention prompt fragments already use):

| id | focal_mm | f_stop | implied look |
|----|----------|--------|--------------|
| `lens-souped` | 14 | — | extreme wide, architectural distortion |
| `lens-wide` | 24 | — | environmental wide, mild stretch at edges |
| `lens-normal` | 35 | — | neutral field of view, "the honest lens" |
| `lens-portrait` | 50 | — | mild compression, intimate |
| `lens-tele` | 85 | — | portrait compression, background flattening |
| `lens-deep-tele` | 135 | — | strong compression, surveillance/unease |

Scene specs reference `"lens": "lens-portrait"` or override with raw
`{"focal_mm": 85}` for one-offs; the builder resolves id → parameters.
`f_stop`/depth-of-field is spec data for the builder (Eevee DOF or
baked in looks); the I2V path ignores it — prompt fragments carry only
focal length, matching today's suffix vocabulary.

## 5. Look presets v0 + Route A's grade step

Each look: `{id, grade{...}, route_a_step, fragment}`.

| id | grade (scene/finish terms) | fragment (I2V suffix) |
|----|----------------------------|------------------------|
| `look-neutral` | no transform, sRGB out | `""` (empty — lossless like T-VID-11 seeds) |
| `look-cool-teal` | shadows→teal, highlights restrained, −5% sat | `cool teal color grade` |
| `look-warm-golden` | +8% sat, warm highlights, gentle S-curve | `warm golden color grade` |
| `look-noir` | desaturated, hard S-curve, crushed blacks | `high contrast black and white noir grade` |
| `look-dream` | lifted blacks, soft highlight rolloff, +pastel | `soft dreamy pastel color grade` |

**Route A's grade step, named:** the finishing chain gains a `grade`
stage between composite and master — it reads `look.grade` from the
scene spec (resolved through this registry) and applies it as a **LUT
(.cube) or shader pass in the existing FFmpeg/Remotion finishing path**.
The grade is data (`look` id + optional `grade_strength` 0–1), applied
once, deterministically — not a per-frame improvisation. LUT files
live under `assets/looks/<id>.cube` when a look needs one; parametric
grade fields cover looks that don't.

## 6. Lighting rigs v0 — every rig fits the cap, proven

Budget rule (pascal doc §3 + `config/asset-budgets.json` scene_caps):
**≤3 dynamic lights**; everything else baked (lightmap/AO/emissive).
Emissive materials and baked contribution are **not** dynamic lights —
they cost zero light-object slots. Each rig below declares its dynamic
count; the registry validator asserts `dynamic_lights ≤ 3` at load.

Positions are spec terms relative to the subject anchor (`key`,
`fill`, `back`, `practical-*`), resolved by the builder — rigs are
reusable across aspect ratios and blocking changes.

| id | Setup | Dynamic lights | Baked/emissive | Use |
|----|-------|---------------|----------------|-----|
| `lighting-three-point` | key 45° cam-left above, fill cam-right low, back behind subject | **3** (at cap) | none | default dramatic coverage |
| `lighting-high-key` | large soft key + bounce fill, minimal shadow | **2** | ambient wash baked | bright/commercial/clean |
| `lighting-low-key` | single hard side key, negative fill | **1** | deep ambient baked | noir/chiaroscuro |
| `lighting-golden-hour` | low warm key (≈3200 K), cool ambient counter | **2** | sky/ambient baked | dusk exterior feel |
| `lighting-practical-neon` | one practical motivated source + emissive set pieces | **1** | neon emissive materials | night/interior neon |
| `lighting-rim-only` | back/rim only, front near-black | **1** | silhouette ambient baked | mystery/reveal |
| `lighting-flat-even` | broad even key, no directional shadows | **1** | ambient baked | UI/diagrammatic scenes |

Seven rigs, dynamic counts {3,2,1,2,1,1,1} — all ≤ 3. A scene needing
more variety composes rigs per-shot (rigs are per-scene/per-shot spec
fields, not global): the cap binds **per rendered frame**, and shots
in one scene may use different rigs.

## 7. Spec representation (what T-VID-05 consumes)

Scene spec gains three named fields, resolved at build time:

```json
"camera": { "rig": "<T-VID-11 id> | null", "lens": "lens-portrait",
            "path": null },
"lighting_rig": "lighting-three-point",
"look": "look-cool-teal",
"grade_strength": 0.85
```

- Validator checks every id against `cinematography-rigs.json` at spec
  validation — unknown id fails with the field named (same posture as
  T-VID-11's resolver).
- `lighting_rig` may be a single id or a per-shot list once T-VID-05
  defines shots; v0 is single-id.
- The builder maps rig → concrete light objects; Route A's grade stage
  maps `look` → LUT/parametric grade. Neither consumer re-derives
  cinematography from prose.

## 8. Failure surfaces

| Case | Behavior |
|------|----------|
| Unknown rig/lens/look id | spec validation error naming the field and id |
| Rig exceeds dynamic-light cap | impossible by construction — registry load asserts ≤3; a rig that can't fit doesn't ship |
| Look id referenced by T-VID-11 camera rig but absent here | camera-rig validation fails (shared membership check) |
| `grade_strength` outside 0–1 | spec validation clamps to range with warning |

## 9. Non-goals

No HDRI/skybox assets (environment lighting is T-VID-05's IBL concern,
not rig data); no per-light animation curves (rigs are static
placements — motion comes from the camera/subject, not the rig); no
volumetric/fog parameters (a look-grade concern at most); no LUT
authoring — looks reference `.cube` files, they don't embed them.

## 10. What implementation spins out (all owner-gated)

1. `config/cinematography-rigs.json` with the §4–§6 seed rows.
2. T-VID-05 spec fields (`lighting_rig`, `lens`, `look`,
   `grade_strength`) + validator membership checks.
3. Builder-side rig→light resolution (Blender bpy / Three.js).
4. Route A `grade` stage in the finishing chain + `assets/looks/`
   LUT directory.
5. Cross-registry validation: T-VID-11 `look.grade` values ⊆ look ids.

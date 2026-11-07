# Scene Vocabulary + Material Library — Design 2026-11

**Status:** Proposed
**Area:** Video Pipeline & Storyboard (T-VID-18)
**Source:** `docs/knowledge-library/three-js-studio-scene-quality-2026.md` (evidence);
`packages/frontend/src/features/three-js-studio/hooks/useMeshFactory.ts`;
`packages/backend/app/api/ai.py` (`/generate-scene` stub);
`docs/knowledge-library/pascal-3d-budget-discipline-2026.md` +
`config/asset-budgets.json`;
`docs/plans/character-identity-layer-2026-11.md` (character assets);
`docs/plans/lighting-look-rigs-2026-11.md` (looks/emissive discipline)
**Decides:** none — design only; implementation waits on the owner's
word. §6 recommends removing the `/api/ai/generate-scene` stub (zero
callers verified); the removal itself lands only with owner approval.
**Last Updated:** 2026-11-07

## 1. Scope and non-goals

The Three.js Studio's content ceiling is structural: 7 fixed-size
shapes, one 5-scalar material, no texture maps, and a GLTF path the
generator never routes through. This document designs the vocabulary
the builder (T-VID-05 spec → factory) can express: parameterized
primitives, a named PBR material library, GLTF asset references as
first-class vocabulary — and the factory refactored into a *consumer*
of that library rather than the library itself.

Non-goals: no code, no scene renders, no T-VID-05 spec schema (this
document defines the *vocabulary the spec plugs into*, not the spec).

## 2. Parameterized primitives

Every primitive becomes `{type, params}` where **sizes are spec
fields**, resolved against budget bounds at validation — never factory
constants. Audit of what earns a place:

| type | params (all spec fields) | budget bound |
|------|--------------------------|--------------|
| `sphere` | radius, widthSegs≤64, heightSegs≤64 | radius ≤ stage radius; tris ≤ 8K |
| `box` | w, h, d | each dim ≤ stage radius ×2 |
| `cylinder` | radiusTop, radiusBottom, height, radialSegs≤64 | height ≤ stage radius ×3 |
| `cone` | radius, height, radialSegs≤64 | as cylinder |
| `torus` | radius, tube, radialSegs≤64, tubularSegs≤128 | tube ≤ radius |
| `capsule` *(new)* | radius, length, capSegs | soft-form stand-in for figures |
| `plane` *(new)* | w, h | cards, backdrops, floor overlays |
| `ico` *(new)* | radius, detail≤4 | low-poly variant spheres/astrophysics |
| `bars` | count, spacing, heightVar?, thickness | **composite preset** — N bars from params, not one bar |
| `crown` | spikeCount, bandRadius, bandTube, gemRadius | **composite preset** — built from primitives by the factory, proportions parameterized (today's hardcoded 8×0.08×0.5 is the default) |
| `text` *(new)* | content, size, fontRef | DOM-texture or troika path — decision deferred to implementation; v0 may ship `plane`+texture instead |
| `modelUrl` → `asset` | asset ref (§4) | GLTF path — already real, becomes schema'd |

**What did not earn a place:** lathe/extrude/custom BufferGeometry —
those are GLTF asset territory (§4); a spec that needs bespoke
geometry needs an asset, not a new primitive. Primitive count stays
small on purpose: vocabulary ceiling was the disease, parameterization
is the cure — one well-parameterized `cylinder` beats seven
special-cased shapes.

## 3. Material library — `config/material-library.json`

Named PBR materials; objects reference `material: "mat-<id>"` or
inline overrides `{ref, tint?, roughnessMul?}`.

```jsonc
{
  "id": "mat-brushed-steel",
  "base_color": "#9aa3ad",
  "metalness": 0.9, "roughness": 0.35,
  "maps": { "color": "assets/materials/steel_c.ktx2",
            "normal": "assets/materials/steel_n.ktx2",
            "roughness": "assets/materials/steel_r.ktx2" },
  "emissive": { "color": "#000000", "intensity": 0.0 },
  "bloom_safe": true
}
```

Seed library v0 (~10 entries spanning the studio's actual needs):
`mat-ceramic` (rough dielectric), `mat-brushed-steel`,
`mat-glass-frosted` (transmission note — Three.js transmission is
costly; v0 uses opacity-faked glass), `mat-plastic-matte`,
`mat-rubber`, `mat-gold`, `mat-carbon`, `mat-emissive-strip`
(bloom-safe emissive), `mat-holographic` (iridescence-ish via env),
`mat-fabric`. Each entry: scalar PBR fields + optional KTX2 texture
set (color/normal/roughness — the three maps the budget doc's texture
rules govern: ≤2048² hero surfaces, KTX2 mandatory, ≤1 GB scene total).

**Emissive discipline (ties to T-VID-15):** `emissive.intensity` is
capped by `bloom_safe` classification — entries intended to feed
`UnrealBloomPass` declare `bloom_safe: true` with intensity ≤ the
pass's knee; everything else stays ≤0.2 so bloom doesn't turn flat
scenes into hot-spot soup (cause #4 in the evidence doc). Looks
(T-VID-15 `look-*`) grade *after* render; materials shouldn't bake
the grade in.

## 4. Asset vocabulary — GLTF refs as first-class

Scene spec objects may carry `"asset"` instead of `type`:

```json
{ "asset": { "id": "asset-floor-panel", "version": "1.0.0" },
  "transform": {...}, "material_overrides": {...} }
```

- **Admission ticket:** an asset enters the vocabulary only with a
  passing `tools/check-asset-budget.py` report for its declared role
  (T-VID-12) — budget report is part of the asset manifest, not a
  suggestion.
- **Characters** use `character-asset/v1` (T-VID-16) — mesh + rig +
  identity + LOD chain; the factory's existing `GLTFLoader` +
  `AnimationMixer` path consumes them unchanged (it already works —
  the generator just never routed through it).
- **Props/set dressing** get a lighter `asset-ref` schema
  (`{id, version, path, sha256, role, budget_report}`) — same
  pinning/immutability rules, no identity block.
- Resolution: `assets/<kind>/<id>/` directory + manifest; the
  frontend resolves ids through a generated index (build-time, not
  runtime directory scans).

## 5. Factory-as-consumer

`useMeshFactory.ts` refactors from *definition site* to *resolver*:

- Primitive geometry constants move into the vocabulary table (§2) —
  the factory reads `{type, params}` and constructs; `crown`'s spike
  loop becomes parameter-driven from its preset defaults.
- Material construction moves to the material library — the factory
  resolves `mat-<id>` → `MeshStandardMaterial` (+ texture maps via
  KTX2Loader where the renderer supports it; fallback = same scalars,
  no maps — recorded, not silent).
- `modelUrl` free-form strings are replaced by `asset` refs —
  versioned, hashed, budget-admitted. Raw URLs remain accepted during
  transition but log a deprecation warning.
- **No geometry constants or material scalars defined inline** —
  that is the acceptance rule, checkable by grep: the factory file
  contains no `Geometry(` constructor arguments or `MeshStandardMaterial`
  literal scalars after refactor.

## 6. The stub endpoint — decided: remove

`POST /api/ai/generate-scene` (`ai.py:32`) returns a **hardcoded
placeholder scene** — a red box, ambient+directional lights, fixed
camera — while claiming "Scene generated for: {prompt}". Verified
2026-11-07: **zero frontend callers** (grep across `packages/frontend/src`
finds nothing; only docs mention it).

**Decision: remove the route.** Rationale: a route that advertises AI
generation and returns static fiction is worse than no route — it
will eventually be wired to a caller that trusts it. T-VID-05's real
spec-driven generator will own scene generation when it lands; until
then the honest surface is absence. `GET /api/ai/status` stays (it
reports real service state). Removal is a small diff: the handler,
its request/response models if unused elsewhere, and the TODO block.

## 7. Spec representation (summary for T-VID-05)

```json
"objects": [
  { "type": "cylinder", "params": {"radiusTop":0.6,"radiusBottom":0.6,"height":3.4},
    "material": "mat-brushed-steel", "transform": {...} },
  { "asset": {"id":"asset-pedestal","version":"1.0.0"},
    "material_overrides": {"tint":"#8b5cf6"}, "transform": {...} },
  { "type": "bars", "params": {"count": 24, "spacing": 0.4},
    "material": "mat-emissive-strip", "transform": {...} }
]
```

Validator checks (lands with T-VID-05): type/asset-id membership,
param bounds vs budget caps, material-id membership, asset
budget-report presence, override whitelist (no identity fields —
T-VID-16's rule applies to character assets here too).

## 8. Failure surfaces

| Case | Behavior |
|------|----------|
| Unknown primitive/material/asset id | spec validation error, field named |
| Param exceeds budget bound | spec validation rejects with the bound |
| Asset without budget report | admission fails — no report, no vocabulary slot |
| KTX2 unsupported in renderer | factory falls back to scalar material + warning (recorded, not silent) |
| GLTF load failure | existing procedural fallback character stays (already implemented) |
| `/generate-scene` called post-removal | 404 — correct: the route never existed honestly |

## 9. Non-goals

No node-graph/material-editor UI (specs are the authoring surface);
no sculpting/custom geometry tools (assets cover that); no physics/
destruction (not a studio feature); no HDRI environment authoring
(lighting rigs T-VID-15 own environment intent); no procedural
generation *inside* the factory (the LLM/spec composes; the factory
resolves — generation quality is T-VID-05's validator problem).

## 10. What implementation spins out (all owner-gated)

1. `config/material-library.json` + `assets/materials/` KTX2 sets.
2. Vocabulary table module (primitives + composite presets) consumed
   by `useMeshFactory`.
3. Asset-ref schema + generated index + frontend resolver.
4. Factory refactor to consumer-only (grep-verifiable acceptance).
5. `/api/ai/generate-scene` removal (decided here — small, safe,
   zero callers).
6. T-VID-05 spec fields + validator membership/bounds checks.

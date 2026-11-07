# Character Identity Layer — Design 2026-11

**Status:** Proposed
**Area:** Video Pipeline & Storyboard (T-VID-16)
**Source:** `docs/knowledge-library/3d-bones-ai-skin-pipeline-2026.md` §5 Gap 4;
`docs/knowledge-library/browser-character-pipeline-verdicts-2026.md` (HouseRig_v1,
asset licensing, pose-archive binding);
`docs/plans/frame-package-contract-2026-11.md` §3.6 (rig-manifest hash);
`docs/plans/control-conditioned-lane-2026-11.md` §2 (IP-Adapter absent on disk)
**Decides:** none — design only; schema files and lane wiring wait on the
owner's word.
**Last Updated:** 2026-11-07

## 1. Scope and non-goals

Today a "character" is scattered state: a GLB here, rig notes there,
reference images nobody curated. This document designs the character
asset as **one versioned definition** — mesh, proportions, materials,
rig, and identity reference set in a single schema — consumed by both
layers: the builder (geometry consistency) and the generation lane
(identity conditioning). "Same character, new scene" becomes a spec
operation, not a hope.

Non-goals: no code, no asset files, no model downloads. **IP-Adapter
weights are not on disk** (verified T-VID-14 §2) — this design fixes the
*interface*; the conditioning implementation lands when the owner
approves acquiring weights.

## 2. The asset schema

`assets/characters/<id>/character.json` — one file per character,
versioned as a unit:

```jsonc
{
  "schema": "character-asset/v1",
  "id": "char-<slug>",                    // kebab-case, immutable once published
  "version": "1.0.0",                     // semver — rules in §3
  "display_name": "...",

  "identity": {
    "reference_set": {
      "images": [
        { "path": "refs/front-neutral.png",  "role": "front",          "sha256": "..." },
        { "path": "refs/three-quarter.png",  "role": "three-quarter",  "sha256": "..." },
        { "path": "refs/side-neutral.png",   "role": "side",           "sha256": "..." }
      ],
      "digest": "sha256-over-sorted-image-hashes",   // the conditioning identity
      "curation": "character-ref-curation/v1"        // rule version, §4
    },
    "proportions_hash": "sha256(canonical skeleton + mesh bounds)",
    "identity_note": "free text — what makes this character *this* character"
  },

  "geometry": {
    "mesh":    { "ref": "mesh.glb", "sha256": "...", "source": "gen3d|manual|licensed",
                 "license": { "origin": "...", "rights": "..." } },
    "rig":     { "skeleton": "HouseRig_v1", "bones": 59,
                 "manifest_sha256": "...", "bind_pose": "t_pose" },
    "lod_chain": ["mesh_lod0.glb", "mesh_lod1.glb", "mesh_lod2.glb", "sprite.png"]
  },

  "materials": {
    "palette_ref": "materials.json | null",
    "notes": "..."
  },

  "budget": {
    "role": "hero",                          // consumed by config/asset-budgets.json
    "budget_report": "<check-asset-budget output ref>"
  }
}
```

Every hash is **content-verified at load**: the schema is a manifest of
bytes, not a pointer to vibes. A `sha256` mismatch is an integrity
violation (§6), never a warning.

## 3. The consistency contract

**`id + version` ⇒ three identities, simultaneously:**

| Layer | Guaranteed identical by | Mechanism |
|-------|------------------------|-----------|
| Geometry | `geometry.mesh.sha256` + `proportions_hash` | builder loads the pinned GLB; bounds/skeleton hash re-verified at build |
| Rig/pose | `geometry.rig.manifest_sha256` | T-VID-13's `pose_archive.json` joint list must hash-match this manifest — the frame-package contract already binds it (§3.6 there) |
| Appearance/identity | `identity.reference_set.digest` | lane conditioning consumes the ordered, hashed ref list — same digest ⇒ same conditioning payload |

**Version semantics (who may bump what):**

- **MAJOR** — anything touching `identity` or `geometry` proportions:
  new reference set, new mesh, rig change, proportion change. A major
  bump is a *new character that happens to share a name lineage*;
  scenes pinned to the old version remain reproducible forever.
- **MINOR** — materials, palette, LOD chain, texture resolution within
  role caps, license metadata. Silhouette and identity conditioning
  unchanged.
- **PATCH** — documentation/notes fixes only.

**Approval:** MAJOR requires the owner's explicit approval in the task
ledger (same gate posture as every live-path change here). MINOR/PATCH
may land with a ledger note. A version's files are **immutable once
published** — edits happen on a new version, never in place. This is
what makes "pin `1.2.0`" mean anything a year later.

## 4. Reference-set curation rule (`character-ref-curation/v1`)

What constitutes an identity, concretely:

- **Minimum set:** 3 images — `front` (mandatory), `three-quarter`,
  `side`, all neutral expression, consistent framing (head-and-shoulders
  or full-body consistently), neutral background, even lighting. The
  conditioning model averages identity across views; mixed
  lighting/expression/framing is the documented drift source.
- **Optional second tier:** expression sheet (2–4 expressions) and one
  full-body proportion reference — added only when a scene needs them;
  they join the digest, so adding them is a MINOR bump at most (identity
  set grows, doesn't change).
- **Prohibited:** AI-generated self-references (identity laundering —
  the model conditions on its own output and drifts), frames grabbed
  from generated video (compresses identity into the lane's own
  artifacts), watermarked/low-res sources.
- **Change procedure:** candidate refs → new version directory →
  owner approves → publish. The old version's `refs/` is never touched.

## 5. Spec instancing (what T-VID-05 authors write)

```json
"characters": [
  {
    "instance_id": "hero-1",
    "asset": { "id": "char-veyra", "version": "1.2.0" },
    "transform": { "position": [0,0,0], "rotation_y_deg": 180, "scale": 1.0 },
    "overrides": {
      "materials.palette_tint": "#7a4fd0",
      "animation.clip": "idle_sway",
      "visibility": true
    }
  }
]
```

**Override whitelist** (validator-enforced): `transform.*`,
`materials.palette_tint`, `animation.clip`, `visibility`, per-instance
LOD bias. **Forbidden — identity fields, rejected at validation:**
mesh/rig/proportions/reference_set changes, bone-count changes,
proportion-affecting scale on the skeleton (uniform object scale is
fine; non-uniform or bone-level edits are not). An override that would
drift identity is a spec error naming the field — the whole point of
the layer is that per-scene customization cannot reach the identity.

Multiple instances of one asset are legal (crowds, mirrors); the
budget doc's InstancedMesh rule (≥4 instances) applies at build.

## 6. Failure surfaces

| Case | Behavior |
|------|----------|
| Unknown `id`/`version` | spec validation error, asset ref named |
| `sha256` mismatch on any pinned file | integrity violation — build/lane refuses, names the file |
| Version yanked/deprecated | spec still resolves (published versions are immutable); deprecation is a manifest flag, not deletion |
| Override touches identity field | spec validation rejects with field name |
| Reference image missing/uncurated | `reference_set` load fails; lane falls back to geometry-only **with a recorded warning** — never silently conditions on a partial set |
| `pose_archive` rig-manifest hash ≠ asset `rig.manifest_sha256` | frame-package validator check 6 fails (T-VID-13 §10) — the two contracts already interlock |

## 7. Consumer map

| Consumer | Reads | Gets |
|----------|-------|------|
| T-VID-05 builder | `geometry.*`, `budget.role` | mesh, rig, LODs, proportions — identical every build |
| T-VID-13 frame package | `geometry.rig.manifest_sha256` | pose-archive binding (already specced) |
| T-VID-14 lane | `identity.reference_set.digest` + ordered images | conditioning payload (IP-Adapter-class when weights land; interface fixed now) |
| T-VID-12 budgets | `budget.role`, `budget_report` | per-asset cap enforcement |
| T-VID-17 capture | whole asset | golden-character fixture for engine decisions |

## 8. Non-goals

No face-specific conditioning model choice (IP-Adapter vs. alternatives
is a lane-implementation decision once weights exist — the schema's
`digest` + ordered refs is model-agnostic); no morph targets or
expression-rig schema (v1 expressions are reference images only);
no crowd/variant system (instance overrides cover v1); no asset
marketplace/distribution format (license fields record rights; they
don't package them).

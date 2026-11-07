---
tags:
  - technical
  - 3d
  - assets
aliases:
  - texture pipeline
  - KTX2 textures
  - material textures
cssclasses:
  - technical-guide
date: 2026-11-07
type: concept
---

> [!info] Purpose
> How textures are authored, compressed, and ingested for the 3D pipeline —
> the production half of the texture rules in
> [[pascal-3d-budget-discipline-2026|the Pascal budget doc]]. Covers encoder
> choice, naming, the downscale→KTX2→validate workflow, and where the
> tooling currently stands.

---

## Overview

The budget doc sets hard rules — scene textures ≤ 1 GB VRAM, KTX2
mandatory for shipped textures, hero surfaces ≤ 2048², background ≤
1024² — and `tools/check-asset-budget.py` enforces them after the fact.
This document covers the *authoring* side: how a texture gets from a
generator's raw output (Hunyuan3D/TripoSR ship large uncompressed PNG/JPG
maps) to a budget-compliant KTX2 set that the material library and
Three.js renderer can consume.

## The rules (unchanged, restated for producers)

| Rule | Value | Source |
|---|---|---|
| Scene texture memory | ≤ 1 GB | `config/asset-budgets.json` |
| Single texture | hero ≤ 2048² · mid ≤ 2048² · background ≤ 1024² | same |
| Format | KTX2 for every shipped texture | same |
| Map set | color / normal / roughness (`*_c`, `*_n`, `*_r`) | `docs/plans/scene-vocabulary-material-library-2026-11.md` |
| Location | `assets/materials/<name>_c.ktx2` etc. | same |

`check-asset-budget.py` reads `config/asset-budgets.json` and FAILs a GLB
whose embedded textures violate the caps (verified live: `stage.glb`
fails as background — 15.7K tris, 4096px texture). The doc's job is to
make sure textures pass *before* they reach that check.

## Encoder choice

- **toktx (KTX-Software CLI)** — the reference encoder. Produces `.ktx2`
  with Basis Universal supercompression; supports `-t` threads, `--lowercase
  no`, encode targets for desktop GL (`-t` target format). **Recommended**
  for this repo: scriptable, deterministic output, no GUI.
- **basisu** — the upstream Basis encoder; what toktx wraps for `.basis`
  files. Use only if toktx is unavailable; its CLI surface is less stable.
- **Not acceptable**: PNG/JPG/TGA shipped as-is (the exact failure mode
  the budget doc calls out — "large uncompressed texture, no texture
  budget at all" on Hunyuan output).

Three.js consumption: `KTX2Loader` + the Basis transcoder
(`three/examples/jsm/libs/basis`) — the renderer decodes GPU-compressed
mipmaps directly. Where KTX2 is unsupported, the material factory falls
back to scalar PBR + warning (never silent), per the material-library
design doc.

## Naming and layout

```
assets/materials/
  steel_c.ktx2      # base color (sRGB)
  steel_n.ktx2      # tangent-space normal (linear)
  steel_r.ktx2      # roughness/metallic packed or scalar-derived (linear)
```

- Suffixes map 1:1 to the material-library `maps` keys
  (`color`/`normal`/`roughness`).
- One KTX2 per map — do not ship a single packed atlas unless the
  material spec grows an atlas slot.
- Color maps encode sRGB; normal/roughness encode linear — toktx
  `--encode` flags or the loader's `SRGBColorSpace` assignment must
  match or textures render washed out / too dark.

## Ingest workflow (target state — tooling pending T-VID-12)

For each generated or authored asset:

1. **Classify role** — hero / mid / background / far (far = impostor
   card, never a mesh; see budget doc).
2. **Extract source maps** — Hunyuan3D/TripoSR GLBs embed textures;
   export to PNG/JPG first (Blender headless or `gltf-transform`
   extract).
3. **Downscale to role cap** — hero/mid ≤ 2048², background ≤ 1024².
   Lanczos/Bicubic; do not ship the generator's native resolution.
4. **Encode KTX2** — `toktx --bcmp --assign_oetf srgb -i <src>
   <name>_c.ktx2` for color; linear encode for `_n`/`_r`.
5. **Place + reference** — `assets/materials/`, wire into
   `config/material-library.json` as `mat-<id>`.
6. **Validate** — `python tools/check-asset-budget.py <asset.glb>` must
   pass before the asset is considered ingested.

## Current tooling status

| Piece | Status |
|---|---|
| Budget config + validator | ✅ `config/asset-budgets.json`, `tools/check-asset-budget.py` |
| Material library spec | ✅ `docs/plans/scene-vocabulary-material-library-2026-11.md` (design) |
| KTX2 encoder/injest script | ❌ not built — spec'd under T-VID-12 gated scope |
| `assets/materials/` directory | ❌ does not exist yet |
| KTX2Loader wiring in renderer | ❌ designed, not implemented |

The ingest script (downscale → encode → validate → register) is the
missing middle; it is part of T-VID-12's owner-gated gen3d ingest work.
Until then, texture work is manual: encode with toktx by hand and let
`check-asset-budget.py` verify.

## Related

- [[pascal-3d-budget-discipline-2026|Pascal 3D Budget Discipline]] — the
  rules this pipeline enforces
- [[3d-generation-options-2026|3D Generation Options]] — where raw
  textured assets come from
- [[hunyuan3d-setup|Hunyuan3D Setup]] — the generator whose uncompressed
  texture output motivated the KTX2 rule
- [[three-js-studio|Three.js Studio]] — the renderer that consumes
  KTX2Loader

# Silhouette Character Animation for Beat-Synced Visuals

> Added: 2026-09-03 — web research synthesis behind the "Builder" silhouette decision.
> Parent audit: `character-driven-visualization-research.md` (phased GLB/rigging plan stays valid for hero assets; this doc covers the real-time performance path).

## Why silhouettes, not humanoids

Real-time beat-synced music visuals punish realistic characters three ways: generative 3D humans have melted faces/fused limbs, rigging + animation authoring is expensive, and near-human figures fall into the uncanny valley under stage lighting. Silhouettes invert all three — no faces to get wrong, no skinning to author, and abstraction reads as intentional art direction. Prior art:

- **Jusska "Limbo" video** — a band with no animation skill shipped a full animated video as B&W silhouettes, compositing fire bursting from bodies and **lyric-linked imagery** (worms appear exactly when sung). Proves: silhouette + lyric-reactive motifs carry a whole music video.
- **Limbo / Night Sky games** — entire commercial aesthetics built on silhouette + fog + rim light, made by tiny teams.
- **The "Silhouette Test" (game design)** — if a character isn't readable by its shadow alone, the design is too weak. Adopt as our acceptance test: every Builder pose must read at thumbnail scale in pure black.

## Craft rules (foxrenderfarm silhouette guide, 2026)

1. **Exaggerated, explicit poses** — subtlety is invisible in silhouette; push every joint 20–30% past naturalism.
2. **Limbs separated from torso (negative space)** — an arm overlapping the body merges into a "blob"; working poses must keep elbows/knees outside the torso silhouette.
3. **Motion carries the performance** — posture + gesture + timing replace facial expression. Beat bounce, hammer hits, and breath cycles are the acting.
4. **Composite, don't detail** — silhouettes sit on fog layers, glow, grain; add ONE minimal color accent (our act-palette rim light).
5. **2D digital cutout = puppets with joint pivots** — SVG groups with `transform-box: fill-box` + per-joint `transform-origin` (dbbasic-face pattern). No skeletal toolchain needed.
6. **3D silhouette variant** — fully-black 3D figures let the camera move while the look holds; reserved for later Blender/Unity acts.

## Architecture patterns worth stealing

| Source | Pattern | Our adoption |
|--------|---------|--------------|
| `zeikar/iki` (open Live2D alternative) | Parameter-driven puppet: parts + linear bindings to named params | Storyboard mood/beat → named puppet params (`bounce`, `sway`, `workPulse`) |
| `askrobots/dbbasic-face` | Character = SVG + JSON manifest; animation scheduled on the **audio clock**; amplitude fallback when phonemes missing | Builder poses as data; all motion reads the compensated audio clock / live audio ref, never wall time |
| `bolasatu/prompt-to-animation` | **Anchor-locked consistency**: one anchor portrait, every expression/gesture derived from it | Phase 2 path: generate ONE anchor silhouette PNG, derive pose variants from it instead of procedural drawing |
| `semantic-foragecast-engine` | Beats → phonemes → gestures pipeline; Grease Pencil 2D mode ~2x faster than 3D | Beat→gesture mapping table per motif; Blender Grease Pencil as the offline-render alternative |
| `Lulzx/pip-and-bean` | Deterministic seeded scenery; geometric **stage audit** against a stage contract | Our capture harness + ASCII/pixel-diff checks are the same idea; extend with composition rules (figure never center-frame in acts I–III) |
| Morphic / AI-video character lineup | Lock profile shape once, reference it in every shot | Builder proportions frozen in one `BUILDER_PROPORTIONS` constant |

## Builder figure design (this repo)

- **Who**: the lone night-shift builder from the lyrics — sitting at a workbench (acts I–III), standing/bobbing (payoff), arms raised center-frame (triumph only).
- **How**: SVG puppet, near-black fill (`#050508`), rim-light stroke from the act palette, workbench + lamp-glow props in early acts.
- **Motion**: beat bounce (decayed pulse, same pattern as shader `u_beat`), hammering loop on beats during `assembly`, breath sway otherwise, head-bob on `payoff`. All driven per-frame from `liveAudioDataRef` — zero React re-renders.
- **Storytelling beats (Jusska principle)**: hammer hits land ON beats during "piece by piece" refrains; lamp glow swells with energy; figure migrates left-bench → center only at triumph (composition = narrative).

## Verification (2026-09-03, capture harness + DOM probes)

- Renders at correct box with no page errors and no overlap with lyrics/controls.
- Strict silhouette test passes: head/torso/limbs distinct at thumbnail scale in all acts.
- Joint telemetry matches acts: seated/hunched (act I), hammer swing shR 62°→23° / elR −42°→−69° cycling on the ~400 ms beat grid with hammer prop visible (act II), arms raised 151°/159° with bench faded (act V).
- Rim light follows act palette; lamp glow pumps with energy + beat pulse.

## Explicit non-goals

- No faces, hands, fingers, cloth sim, or lip-sync on the Builder (silhouette contract).
- No AI-generated anatomy anywhere in the real-time path (anchor PNG phase-2 only, reviewed by a human first).
- Blender MCP stays on hard-surface environments/props, never characters.

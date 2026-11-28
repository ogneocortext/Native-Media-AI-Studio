---
tags:
  - technical
  - 3d
  - three-js
aliases:
  - Three.js Interior Room Quality 2026
cssclasses:
  - technical-guide
date: 2026-11-28
type: synthesis
---

> [!info] Purpose
> The visual and technical standard for building The Room (see
> `docs/the-room-scoping.md`): how a small three.js interior stops looking
> amateur. Written 2026-11-28 from a gap audit of this library plus two
> sourced research passes (engineering values; art direction). Where a value
> is derived rather than published, it says so. The Room build packet is
> graded against this document.

**Stack it assumes:** three 0.186, @react-three/fiber 9, @react-three/drei 10,
@react-three/postprocessing, one GTX 1070 Ti class GPU (Pascal, 8 GB GDDR5,
~256 GB/s) driving a 1440p display. Pascal is raster-strong and
bandwidth-moderate: geometry and material richness are cheap here; full-screen
post passes and shadow passes are the meter that runs.

---

## 1. What this library already knew (audit summary)

Covered before this doc: renderer discipline (ACES + exposure, one rolloff
applied once at the end), seven named lighting rigs with color temperatures,
the one-shadow-caster rule, a named PBR material library design, selective
bloom values, and two agreeing performance budget sets (<=150 draw calls,
<=1.5M tris, <=40 materials, <=3 dynamic lights). Missing or shallow: IBL
choice and intensity, shadow bias/camera tuning numbers, interior
architecture and furniture scale, R3F page construction, interior camera
defaults, cheap AO, and a screenshot grading loop. Sections 2-6 fill those
gaps.

## 2. Renderer and page construction (R3F)

- Canvas: `dpr={[1, 1.5]}`, `shadows="percentage"` (r182+: PCF is the soft
  default; bare `shadows`/`soft` warns), `gl={{ antialias: false, stencil: false, powerPreference: "high-performance" }}`.
- Camera: `fov 42, near 0.1, far 30`, start position `[4.2, 1.6, 4.2]`.
- OrbitControls for an interior: target `[0, 1.1, 0]`, minDistance 1.2,
  maxDistance 7.5, polar angle clamped 0.35..pi/2+0.08, pan clamped to the room.
- Suspense inside the Canvas; drei `Loader` outside it.
- Post stack: **@react-three/postprocessing, not three's examples composer**
  (EffectPass merges effects into fewer passes; the composer forces the
  renderer to NoToneMapping, so the ToneMapping effect goes last — double
  tonemapping is the standing trap).
  Chain: `EffectComposer multisampling={4}` (the default 8 is the single
  biggest bandwidth item at 1440p), Bloom `mipmapBlur threshold 1 intensity 0.6`,
  Vignette + Noise merged (near-free), ToneMapping ACES last. **No DOF, no SSAO.**
- Fallback tier (PerformanceMonitor / AdaptiveDpr): dpr 1.25, then
  multisampling 0 + SMAA, then Bloom off.

## 3. Light: IBL, the one shadow, and the evening recipe

- **IBL:** a custom drei `Environment` built from Lightformers, never a
  daylight HDRI preset at intensity 1.
  `Environment resolution={256} frames={1} environmentIntensity={0.3}` with two
  warm rect Lightformers (intensity 3, `#ffd9a0`) at lamp/window positions and
  one dim cool rect (0.7, `#7787a8`); `background={false}`.
  Fallback: RoomEnvironment at `environmentIntensity={0.2}`.
  (r163+ trap: `scene.environmentIntensity` governs the scene environment;
  `material.envMapIntensity` only a material's own envMap.)
- **The one shadow:** a single Spot key, `castShadow`,
  `shadow-mapSize 2048` (~3 mm texel over a 6 m span), `shadow-bias -0.0002`,
  `shadow-normalBias 0.02`, shadow camera near 0.3 / far 12, tight frustum.
  Add `BakeShadows` when lights and furniture do not move. No SoftShadows/PCSS.
  **No shadow-casting point lights** (a point shadow is six passes).
- **Evening recipe (physical lights, decay=2, useLegacyLights removed):**
  Environment fill at 0.3; spot key `#ffd2a1` intensity 45 (candela), angle 0.6,
  penumbra 0.8, castShadow; two point practicals `#ffa757` (~2700K) at
  intensity 10 and 15, distance 6, decay 2, no shadow; emissive bulb/shade
  meshes at 2-4. **No ambientLight.** These candela values are physics-derived
  (I/d^2 at room distances), not a published canonical recipe — validate on the
  hero bookmark and tune exposure before touching intensities.
- **Tone mapping:** ACESFilmic, exposure 1.0 (acceptable 0.9-1.1) for an
  ungraded warm evening. AgX is the contested alternative: more neutral, needs
  exposure 1.15-1.25 plus a saturation bump, and three ships no Punchy look.
  This settles the library's ACES-vs-AgX disagreement **for this room**: ACES.
  (Blender-matching pipelines may still prefer AgX; that is a different job.)

## 4. Architecture and dressing (meters, 1 unit = 1 m)

- Room 5.0 x 4.0, ceiling 2.7. Walls 0.20 exterior / 0.12 interior, modeled
  with real thickness and jambs, never single planes. Door 0.90 x 2.10.
  Window sill 0.85-0.90, head 2.25. Skirting 0.12 x 0.018.
- Dressing: 2 zones, 12-18 architectural props in groups of 3; rug 2.4 x 3.0
  with all front legs of the seating on it; art center 1.45 m (the 57-inch
  rule), 0.15-0.20 m above a sofa back; three lamps (2 table + 1 floor) forming
  a triangle; a 0.9 m main walkway kept clear.
- Narrative objects are a separate, smaller budget than props: see section 6.

## 5. Materials and textures without an artist

- Sources: **Poly Haven** and **ambientCG**, both CC0, 2K PBR sets first.
  Procedural canvas textures are for plaster, plain fabric, and variation
  overlays only, not hero surfaces.
- Discipline: color maps sRGB, data maps linear (NoColorSpace), OpenGL-format
  normals; repeat set by physical size, not by eye; anisotropy 8.
- KTX2 where shipping compressed: a 2048x2048 texture is ~5.3 MiB in KTX2 vs
  ~21.5 MiB uncompressed. Total texture VRAM budget for the room: <=1.5 GB.
- Grounding/AO: baked `aoMap` is the primary (costs ~nothing per frame).
  Plus exactly one of: drei `ContactShadows frames={1} resolution={512} blur={2} opacity={0.6}`
  under the seating group, or `AccumulativeShadows` (60 frames) if directional
  floor shadows are wanted. **No SSAO/GTAO/N8AO in the shipping chain**: N8AO
  measured 5-6 ms at 1080p full-res Medium on a GTX 1080 scales to untenable
  at 1440p on this card; it is an optional faster-GPU tier only, and enabling
  it costs DPR 1.25 to pay for it. (The ms figures are scaled arithmetically
  from GTX 1080 measurements, not measured on a 1070 Ti.)

## 6. Art direction: The Night Library x The Listening Room (owner ruling, 2026-11-28)

The owner ruled a combination of two researched directions. A (Night Library)
owns the shell; C (Listening Room) owns the center.

- **One sentence:** a walnut-and-indigo library at night, built around two
  seats and the record player between them; she reads in plum velvet under the
  arch of the book wall, and most of the room stays in warm shadow.
- **Palette (60-30-10, five colors):** cream `#F7F1E5` 60%; walnut `#5C3D2E`
  the wood body; indigo `#0D0D24` where darkness pools (niche backs, the night
  window, one cushion — never patterns or matching sets); plum velvet
  `#4A3566` on her chair, carrying the room's violet role; aged brass
  `#B08D57` at 2-3 touchpoints only. Cognac `#A65E2E` leather on the second
  seat reads as part of the walnut family under 2700K, not a sixth color.
  Violet is a ~3% whisper, rhymed exactly twice elsewhere, small.
- **The one motif:** an arch, and only in the bookcase niche behind her seat.
- **Focal hierarchy:** (1) her seat as a lit vignette (chair + lamp + side
  table + indigo arch backdrop + rug), seen at a 30-45 degree diagonal from
  entry; (2) the record player's glow between the seats; (3) everything else
  in shadow. ~5:1 brightness ratio reads as a distinct focal point; 10:1 is
  theatrical and too much. The seated view is the real design surface (~95% of
  time in the room): her in forward vision, door out of view, no lamp or window
  directly behind her head.
- **Light as mood:** pools, not coverage. Three pools: hers 100%, activity
  (player) 60-70%, arrival 30-40%. 40-60% of visible surfaces in soft,
  warm-dark shadow at any view; below ~30% shadow the room reads showroom,
  above ~70% it reads gloomy. No lit ceiling. A second state, *Late* (her pool
  + one ember pool), is the emotional peak state even if only *Arrival* ships
  first.
- **Presence blocking:** the two seats 1.4-1.8 m apart (personal-distance
  proxemics), angled 30-45 degrees, eye-level parity when both are seated,
  enclosure behind her, only a low soft mediator between (the player cabinet).
  She separates from the room by value (cream on indigo), never by spotlight,
  and the same 2700K warmth falls on her as on everything else.
- **Dressing for presence, not for a camera:** 7-9 narrative objects in 3
  clumps, each belonging to one person's life, placed where use would put
  them; stop ~10% before it feels finished. Tests: the *Unpacking* test (would
  it survive a move?), the squint test, the one-sentence test, and keep one
  thing visibly in progress so the room is not a shrine. Keep 30-40% of visual
  space deliberately empty and ~40% of the floor clear; the focal wall may be
  60-70% filled, other walls 15-30%, at least one wall <=10%.
- **References worth stealing from:** Lofi Girl (lamp warmth against indigo
  night, figure absorbed not performing); Whisper of the Heart and Kiki's
  Delivery Service (routine detail); Coffee Talk (night-cafe geometry);
  Unpacking (objects as biography); What Remains of Edith Finch (time-capsule
  rooms — inverted: keep something in progress); In the Mood for Love
  (frame-within-frame, costume as palette). Howl's Moving Castle is the
  clutter warning: intentionality at 1/20th its density.

## 7. The grading loop (how a build is held to this doc)

- Four to five fixed camera bookmarks (entry standing 1.6 m, seated 1.2 m,
  her vignette diagonal, the player close, the wide) are both the visitor's
  camera presets and the QA positions. Free-orbit FOV stays locked at 42;
  bookmarks may use 32-45.
- A build is graded from screenshots at every bookmark against a written
  checklist: environment not washed out (IBL 0.3), one shadow source only,
  palette within the five colors, her vignette the brightest pool, 40-60%
  soft shadow, nothing floating, rug anchoring both seats, walkway clear,
  narrative objects <=9, ceiling unlit.
- Deterministic scene state for screenshots (fixed seed state, fixed lighting
  state *Arrival*), so grades compare like with like across revisions.
- One revision pass per grade, naming the single worst item. Two failed
  attempts at the same item means re-brief the spec, not another re-roll.

## 8. Open flags

- The evening candela recipe and environmentIntensity 0.3 are physics-derived
  starting points, not published standards; first light on the hero bookmark
  is the validation.
- AO timings are scaled from GTX 1080 data; measure on the actual card when
  the optional tier is ever tried.
- The material library in `scene-vocabulary-material-library-2026-11.md`
  remains a design, not code; this doc does not implement it.
- Window existence and position in the room are a build-packet decision; the
  art direction assumes a window that stays indigo night. If there is no
  window, the cool Lightformer rect and the secondary glow move to the player
  alone.

## Sources

Engineering pass and art pass, both run 2026-11-28 with per-claim sourcing
(three.js and drei documentation, pmndrs postprocessing docs, Poly Haven and
ambientCG, interior-design and production-design sources). Full reports with
source lists are held in the owner's research notes for this date; the
load-bearing values above are stated with their ranges so this doc stands
alone in the library.

## Related

- [[three-js-studio-scene-quality-2026|three-js-studio-scene-quality-2026]] :see-also
- [[three-js-render-motion-2026|three-js-render-motion-2026]] :extends
- [[three-js-studio|three-js-studio]] :part-of
- [[3d-bones-ai-skin-pipeline-2026|3d-bones-ai-skin-pipeline-2026]] :see-also
- [[texture-pipeline-ktx2-authoring-and-ingest-2026|texture-pipeline-ktx2-authoring-and-ingest-2026]] :extends

---
tags:
  - visualization
  - modes
  - research
  - music-video
---

# Visualizer Mode Research — What to Build Next (2026-11-03)

**Question from the owner:** what kinds of visualization modes should the
studio implement? This doc answers from (a) the current catalogue, audited
for skew and gaps, and (b) web research into what actually works in 2026 —
the Milkdrop lineage, current creator tools, and short-form/YouTube format
evidence. Companion to
`docs/knowledge/visualizer-smoothness-plan-2026-11-03/README.md`: new modes
must be designed against that plan's data contracts (enveloped bands,
decaying onset envelope, beat phase) from day one.

## The current catalogue, and its skew

Canvas2D (13): bars, mirrored-bars, segmented-led-bars, stereo-split-bars,
stacked-frequency-bands, dot-peak-matrix, waveform, radial, spectrogram,
lissajous, constellation, particles, aurora.
WebGL/R3F styles (13+): Geometric, AudioReactiveCore, OrbitalParticles,
EnergyWaves, FrequencyRings, PulseRings, SpectrumBars, VinylDisc,
AuroraRibbon, OceanWaves, Fractal, Storm, Inferno, ThreeParticles,
BlobField, InstancedParticles — plus ShaderCanvas (custom GLSL),
LyricOverlay, and stemSpatial assignment.

The skew: **five of thirteen Canvas2D modes are bar-chart permutations**,
and most WebGL styles are spectrum/particle scenes. The catalogue is heavy
on *displays of the spectrum* and light on *scenes that perform the song*.
Everything below is a genuine gap, not a rename of something present.

## The strategic fact from the research

A visualizer's perceived quality is its *content library*, and hand-authoring
loses that race by orders of magnitude. The Ritmolux engine's ADR-0113
states it plainly: their ten scene systems and 39 shipped presets face a
Milkdrop community library "measured in tens of thousands (a single publicly
circulated collection is 52,000 `.milk` files)… no amount of engine work
closes a three-order-of-magnitude content gap by authoring." Milkdrop has
been the benchmark for 25 years (Geiss, 2001) precisely because the preset
*idiom* — frame feedback, warp, per-preset equations — generates endless
variety from one engine. Any slate that ignores the feedback/preset idiom
is choosing the expensive road.

## Recommended slate (ranked)

### 1. Feedback/Warp — the Milkdrop idiom, one engine, many looks

**What:** a fragment-shader mode where each frame feeds back into the next
through a warp (zoom/rotate/flow-field resample), with spectrum geometry
drawn into the loop. Parameter sets (warp field, palette, draw elements)
become "presets" — dozens of distinct looks from one implementation.
**Why here:** it is the most proven visualizer paradigm in existence, it is
the furthest point from the current catalogue's bar-chart skew, and it fits
electronic/DnB relentlessly-forward motion. ShaderCanvas already hosts
custom GLSL; the repo even has a GLSL compile-check gate to develop
against. **Surface:** WebGL fullscreen quad. **Data:** enveloped bands,
onset envelope, beat phase, section intensity.
**Two paths — owner's call:**
- **A. Native warp engine (recommended).** One feedback shader + a preset
  format of our own (JSON parameters). Full style control, no dependency,
  presets are cheap to author and can be generated/varied by agents.
- **B. Embed Butterchurn.** The WebGL Milkdrop player (MIT) replays the
  actual classic preset library — instant catalogue of thousands. Cost: a
  heavy third-party engine whose look is *the* most recognizable in the
  field (instantly "Winamp"), preset licensing is a per-author patchwork,
  and it bypasses our analysis data (it runs its own FFT), so no stems,
  no sections, no beat-phase anticipation.
**Effort:** A = medium (one shader system + preset plumbing). B = low-medium
(integration + UI), but strategically a cul-de-sac.

### 2. Kinetic Typography — lyrics as the visual, not an overlay

**What:** a mode where the song's words *are* the scene: line/word-level
animation (snap, stack, scale, scatter) driven by vocal-stem energy and
beat phase, over a minimal reactive ground. LyricOverlay today decorates
other modes; this makes typography the performance.
**Why here:** the owner's songs are hook- and lyric-forward (deadpan
one-liners are the brand), the studio already has line timing (LRC
pipeline) and per-stem energy. Format evidence: lyric videos are the
standard first video for a track (search traffic for "[song] lyrics",
singalong/share behaviour); kinetic typography is the established
high-energy variant, and muted-first viewing (shorts/autoplay) rewards
visuals that read silently. Vendor claims of 2–5× views vs audio-only
uploads are directional, not audited — treat as "format is proven,"
not as a multiplier promise.
**Surface:** Canvas2D or DOM-over-canvas. **Data:** lyric line/word
timing, vocal stem energy, beat phase, section state.
**Effort:** medium — the timing data exists; the work is a small
choreography vocabulary (reuse `motion/` moves).

### 3. Stem Scene — one visual agent per stem

**What:** each stem gets its own visual layer/agent in a shared scene:
drums = percussive geometry that strikes on hits, bass = a ground mass
that heaves, vocals = the central form (or the typography of mode 2),
other/atmosphere = background field. `stemSpatial.ts` already assigns
stems spatially; this gives them bodies.
**Why here:** it is the one mode nobody else can copy off the shelf —
generic visualizers see a mix; this studio *has the stems* (Demucs
pipeline, stem mixer, per-stem analysers). For a channel whose story is
"AI music production, shown honestly," a visual that literally shows the
song's parts is brand and content in one.
**Surface:** R3F (instanced where possible). **Data:** per-stem band
energy/onsets (existing), stemSpatial layout, sections.
**Effort:** medium-high — the data plumbing exists; scene design is the work.

### 4. Spectral Terrain Flyover

**What:** a ridged-FBM terrain flown over endlessly; the spectrum shapes
the ridgeline, bass drives speed, sub drives heave, treble adds rim
sparkle. Pure GLSL displaced grid.
**Why here:** ranked #1 "wow-per-cost" in the Synesthesia project's
research-backed style catalogue; it reads instantly in a thumbnail, suits
driving tempos, and is a *journey* visual (forward motion) where the
current catalogue is mostly *stage* visuals (things pulsing in place).
**Surface:** WebGL shader. **Data:** enveloped bands, RMS energy, beat phase.
**Effort:** medium-low — a known shader form, no scene graph.

### 5. Kaleidoscope — as a post pass, not a mode

**What:** 6/8/12-fold mirror symmetry applied as a VisualizationFX pass
over any existing mode, intensity driven by section/onset.
**Why here:** near-zero marginal cost (one shader pass), psychedelic
payoff for electronic material, and as a *pass* it multiplies every
existing mode instead of adding one more entry to the list. Creator
tools ship it exactly this way (Visuval's post stack).
**Surface:** VisualizationFX. **Data:** section intensity, onset envelope.
**Effort:** low.

### 6. (Optional) Art-Field Particles — the track's artwork becomes the scene

**What:** sample the track's cover/art image into an instanced particle
field; particles hold the image at rest and disperse/react with the music,
reforming between sections.
**Why here:** every track gets a unique visual identity from its own art
— a publication multiplier for a catalogue of songs, on top of the
existing InstancedParticles base. (The veffects project uses the same
photo→particle-field trick.)
**Surface:** R3F instanced. **Data:** bands/onsets for dispersal, sections
for reform points. **Effort:** medium.

## Explicitly not recommended

- **More spectrum-bar variants.** Five permutations is saturation; the
  marginal mode adds nothing a viewer can feel.
- **Piano-roll / note-highway modes.** Need reliable polyphonic note
  transcription; the analysis stack (Essentia) does not provide it, and a
  wrong note highway looks broken, not approximate. Revisit only if a
  transcription model enters the pipeline.
- **Retro oscilloscope/VU scenes.** waveform + lissajous already cover
  the territory; nostalgia garnish is not a gap.
- **A second blob/ferrofluid.** BlobField exists.
- **Scene-cut auto-rotation (VJ mode)** is a *playback policy*, not a
  mode — it belongs with T-VIZ-19's section work, not this slate.

## Sequencing

- Modes 1, 4, 5 live on the WebGL surface — they can proceed in parallel
  with the smoothness plan, but inherit its T-VIZ-18 DPR governance.
- Modes 2, 3 consume the envelope/beat-phase contracts — spec them
  against T-VIZ-15/16/19 outputs now, build after those land, so they
  never need a smoothing retrofit.
- Register as T-VIZ-20+ task items only the modes the owner picks.

## Sources (2026-11-03)

- Ritmolux ADR-0113, *MilkDrop presets are translated ahead of time onto
  a warp-mesh idiom* (content-gap argument, Butterchurn converter facts) —
  https://github.com/igorkonovalov/ritmolux/blob/HEAD/docs/adrs/0113-milkdrop-presets-are-translated-ahead-of-time-onto-a-warp-mesh-idiom.md
- vizz.fm, *Milkdrop Visualizer Online* (Milkdrop history, preset system) —
  https://vizz.fm/milkdrop-visualizer/
- Webamp docs, *Milkdrop* (Butterchurn in-browser, preset cycling) —
  https://docs.webamp.org/docs/features/mikdrop/
- Visuval.io (65+ presets; raymarched tunnels, ferrofluid, feedback
  MilkDrop, kaleidoscope as post FX) —
  https://discourse.threejs.org/t/visuval-io-a-3d-music-visualizer-for-content-creators/92288
- Synesthesia spec blueprint (ranked 3D styles: Neon Terrain Flyover #1
  wow-per-cost; Fractal Warp Tunnel; Bass Vortex Galaxy) —
  https://github.com/tessie1993/music-visualizer-2/blob/HEAD/specs/SPEC_BLUEPRINT.md
- MelonS-Agents, *Music-Shorts Formats Landscape 2026* (audio-reactive
  abstract motion graphics; kaleidoscopic formats; kinetic typography;
  muted-first viewing) —
  https://github.com/melons/melons-agents/blob/HEAD/docs/research/2026-05-21-music-shorts-formats-landscape.md
- Freebeat, *How to Choose the Right Music Visualizer for Your Genre*
  (genre→format fit; lyric typography for vocal-forward tracks) —
  https://freebeat.ai/articles/how-to-choose-the-right-music-visualizer-for-your-genre

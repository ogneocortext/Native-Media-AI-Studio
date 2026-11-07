---
title: "Visual Style System — House Looks for Scenes, Visualizer & Storyboards 2026"
date: 2026-11-07
type: concept
tags:
  - creative
  - design
aliases:
  - Visual Style System 2026
cssclasses:
  - creative-guide
---

# Visual Style System — House Looks 2026

> Written 2026-11-07 at the owner's request ("visual styles are
> lacking in my docs"). Companions: [[color-strategy-2026]],
> [[dark-ui-color-system-2026]], [[shader-color-science-2026]]
> (color science — deep, already covered),
> [[3d-bones-ai-skin-pipeline-2026]] (look rigs, T-VID-15),
> [[three-js-studio-scene-quality-2026]] (the material ceiling).

## 1. Current state: color science yes, looks no

The library knows a great deal about *color* — contrast law,
dark-UI tokens, shader tonemapping — and the owner has a brand
palette kit (v0.1 draft: Paper `#FBFAF7`, Ink `#1F2430`, Violet
Deep `#3A2270`, Violet `#5533A8`, Cyan `#22D3EE`, Magenta
`#E14E8A`; violet carries structure, cyan/magenta carry energy
as accents only, one allowed gradient Violet → Cyan → Magenta).
The frontend has an accent vocabulary (blue = interactive,
pink = creation, cyan = info; the blue → pink sweep is the
signature motion on progress bars).

What does not exist anywhere: a **look** — a named, complete
visual style that a scene, a visualizer preset, a storyboard,
and an AI-skinned render can all be *in*, specified once and
shared. Today each surface improvises: the scene generator's
stage drifts to bloom + violet on near-black because nothing
tells it otherwise; HyperFrames scenes carry palette slots
(`base`/`primary`/`accent`) that storyboard data fills ad hoc;
the visualizer's shader presets each embed their own color
decisions. Same studio, four unrelated answers to "what does
this track look like."

## 2. The style record: what a look must specify here

A style in this pipeline is a record with seven fields — every
one expressible through knobs that exist today, and honest
about the one that doesn't (materials, until T-VID-18):

1. **Palette** — five tokens: base, primary, accent, energy,
   text. Drawn from the brand kit unless the style declares an
   exception.
2. **Lighting** — key intensity/color temperature, ambient
   level, shadow stance (the stage has exactly one shadow-
   casting directional today; styles must be designed for it).
3. **Material character** — within the 5-scalar ceiling:
   color / roughness / metalness / emissive ranges per role.
   (Texture-driven character waits on T-VID-18; a style that
   needs textures to read is a style this pipeline can't run
   yet, and the catalog below doesn't pretend otherwise.)
4. **Post** — bloom strength, the signature sweep's presence,
   vignette/grain stance.
5. **Motion character** — how measured bands and beats map to
   movement: which band drives scale, how fast smoothing runs,
   whether motion is pulses, flows, or cuts. (The bands are
   real now — T-PLT-47's HyperFrames wiring; styles specify
   against measured data, not the old synthetic ramp.)
6. **AI-skin language** — the same look as generation prose for
   Route B: medium, palette in words, texture, and the style's
   line in the standing AVOID list.
7. **Best-for** — the track types and surfaces it serves.

## 3. The starter catalog — nine house looks

Each is a proposal in the record format, sourced from the
owner's own canon and kit — curation is his call (§5). The
first six were written from the canon; §3.7–3.9 were created
2026-11-07 from the §6 track comparison, at the owner's
direction, to close the gaps the real catalog exposed.

### 3.1 Studio Console — the house default
- **Palette:** Console BG `#131826` base, Violet `#5533A8`
  structure, Cyan `#22D3EE` + Magenta `#E14E8A` as energy
  accents only, Console FG `#E9EDF6` text. (The brand kit,
  worn as a look.)
- **Lighting:** low ambient, one cool key; emissives do the
  talking. **Material:** mid-roughness, low metal, emissive
  accents. **Post:** restrained bloom, signature sweep on
  transitions. **Motion:** band-driven pulses, medium smoothing
  — data-forward, nothing decorative. **Skin:** "minimal
  electronic stage, deep console-dark, violet structure light,
  cyan and magenta accent light only, flat restraint, no glow
  haze." **Best-for:** default for any track without a stronger
  claim; the studio's recognizability lives here.

### 3.2 Arcade Velocity — the ride-track look
- **Trait source:** the owner's energy canon — NFS Underground
  2 / Midnight Club 3 / Burnout Paradise HUD and menu energy,
  Pendulum-era drum & bass artwork discipline.
- **Palette:** near-black base, saturated primary accents
  pushed past the kit (hot orange joins cyan/magenta as a
  declared exception), white text. **Lighting:** hard key,
  high contrast, shadows off or crushed. **Material:** low
  roughness, graphic flatness over realism. **Post:** strong
  bloom on accents only, speed-line motion energy, no grain.
  **Motion:** transient-led — cuts and snaps on beats, bass
  band drives scale hard, minimal smoothing. **Skin:** "early-
  2000s arcade racing HUD energy, hard graphic shapes, saturated
  accent color on black, motion-blur speed, no realism."
  **Best-for:** the 140–150 BPM ride tracks; anything whose job
  is momentum.

### 3.3 Vice Sunset — redesigned 2026-11-07 under the anti-slop rule
- **Why it was rebuilt:** as first written (gradient sky,
  pastel chrome, bloom) it *was* the vaporwave cliché — the
  single most generated "style" in AI media and a §4 pattern
  wearing a catalog number. The owner directed a redesign
  under the rule that now governs the whole system (§4).
- **Trait source, re-read:** GTA Vice City / Wave 103 as
  *place and broadcast*, not genre poster — Ocean Drive's
  deco district, pastel architecture, 1980s film and TV
  texture. The era is in the buildings and the film stock,
  not in a neon sky.
- **Palette:** pastels with capped saturation — the opposite
  of neon. Deep teal base `#14424A` (declared), dusty pink
  primary (kit Magenta as a 40%-saturation tint), seafoam
  accent (kit Cyan as a tint), Paper as the cream. Skies and
  backgrounds are **flat banded color fields** (deco stripes),
  never blended gradient washes — this look spends the kit's
  gradient allowance on *bands*, not blends. **Lighting:**
  golden-hour film key, flat and soft; long light, matte
  surfaces, no specular neon. **Material:** matte pastel
  stucco and deco geometry; chrome only as thin trim, never
  the subject. **Post:** fine film grain, slight broadcast
  softness, light vignette — **no bloom, no glow**.
  **Motion:** slow broadcast pans, downbeat swells, generous
  smoothing, title-safe negative space. **Skin:** "1980s
  Miami deco district photographed on film, matte pastel
  architecture, dusty pink and seafoam, deep teal shadows,
  flat banded color fields, fine film grain, no neon, no
  gradient sky, no palm silhouettes, no vaporwave."
  **Banned by name in this look:** the outrun sun disc,
  chrome grid floors, palm-tree silhouettes, gradient-wash
  skies, neon signage glow. **Best-for:** era pieces under
  pastel discipline; The Last Original's palette duty (its
  restraint finally matches); storyboard pastel work. Screen
  Name Days stays Dial-Up — different decade, different look.

### 3.4 Analog Print — the editorial look
- **Trait source:** the owner's anti-slop image rules —
  risograph / screen-print as a named medium with physical
  constraints.
- **Palette:** three inks maximum from the kit (Violet Deep +
  Magenta + Paper is the reference trio; Cyan swaps in per
  track). **Lighting:** flat — light is graphic, not modeled.
  **Material:** matte everything; emissive zero. **Post:** no
  bloom; halftone + grain + slight misregistration are the
  texture. **Motion:** stepped, frame-held movement (posterized
  time), band data drives ink-density rather than glow.
  **Skin:** "risograph print, three spot inks, halftone grain,
  misregistered layers, paper texture, flat illustration, no
  3D render, no glow." **Best-for:** YouTube-facing visuals,
  thumbnails' big sibling, lyric-led pieces — the look most
  aligned with the channel's print-forward brand moments.

### 3.5 Monochrome Signal — the data look
- **Palette:** Ink `#1F2430` + Paper `#FBFAF7` + exactly ONE
  accent (Cyan or Magenta, chosen per track, never both).
  **Lighting:** single source, honest shadows. **Material:**
  the full roughness range in grayscale — value contrast does
  the work color usually does. **Post:** no bloom; the
  signature sweep appears in the one accent only. **Motion:**
  the spectral data *is* the visual — curves, bands, and
  waveforms rendered as first-class graphics, not decoration
  behind objects. **Skin:** "black and white signal graphics,
  one cyan accent, waveform and spectrum as graphic elements,
  Swiss editorial restraint, no color wash." **Best-for:**
  analytical pieces, quiet tracks, and any visual that should
  read as *measured* — the natural partner to the spectral
  timeline and stem-uniform surfaces.

### 3.6 Night Broadcast — the current drift, disciplined
- **Trait source:** the dark-UI color system, worn by a scene;
  also what the scene stage already falls into (bloom, violet
  gem, near-black) — formalized so it stops happening by
  accident.
- **Palette:** dark-UI tokens as scene colors — deepest base
  in the catalog, violet structure, cyan info accents,
  magenta reserved for creation moments (the frontend's
  vocabulary, extended into 3D). **Lighting:** the lowest
  ambient in the catalog; the one directional reads as a
  broadcast key. **Material:** emissive-forward, roughness
  high except on accent pieces. **Post:** the strongest bloom
  in the catalog — but budgeted, accents only, never a wash.
  **Motion:** slow pulses on measured bands, downbeat-led.
  **Skin:** "dark broadcast studio, violet and cyan light on
  near-black, emissive accents, controlled bloom, no cosmic
  backdrop, no particles." **Best-for:** night-ride footage,
  DJ-set visuals, the visualizer's home turf.

### 3.7 Dial-Up — the early-web look (created from §6)
- **Trait source:** Screen Name Days' world — the AIM-era
  internet of screen names, away messages, T9 texting, forum
  threads, and Sharpie-labeled burned mixes. Not 1980s, not
  modern: the desktop of 1999–2004 as a place.
- **Palette:** CRT base `#0B0E0B` (declared exception), kit
  Cyan `#22D3EE` as phosphor primary, buddy-list amber
  `#FFB000` accent (declared exception), chrome gray `#9AA3B2`
  structure, Console FG text. **Lighting:** screen-glow only —
  flat emissive UI light, no modeled key; the monitor is the
  light source. **Material:** flat UI panels and beveled
  chrome edges; pixel geometry over smooth geometry.
  **Post:** scanlines, slight CRT vignette, chromatic fringing
  on edges, tracking-glitch offsets on transients; pixel-sharp
  — bloom would blur the era away. **Motion:** stepped and
  chunky: window pops, typing reveals, a cursor blinking on
  the beat grid; measured bands drive EQ-bar UI elements, not
  glows. **Skin:** "early-2000s desktop UI, CRT monitor glow,
  pixel type and beveled chrome windows, buddy-list panels,
  scanlines, flat screen light, no modern minimalism, no neon
  cyberpunk." **Best-for:** Screen Name Days (its home — the
  track this look exists for), any early-web era piece;
  alternate for Human in the Loop's digital-nostalgia edge.

### 3.8 Future Gloss — the polished bright look (created from §6)
- **Trait source:** the catalog's gloss family — Prototype
  Heart's electro-pop cinema, Patch Notes' "polished wide
  modern production," Unproductive's bright major-key lift.
  Three real tracks were homeless in a catalog of dark looks;
  this is the light one.
- **Palette:** Paper `#FBFAF7` base — the catalog's only
  light-base scene look — Violet `#5533A8` structure, Magenta
  `#E14E8A` primary energy, Cyan `#22D3EE` secondary, Ink
  text. **Lighting:** bright, even key; soft shadows; the
  anti-Broadcast. **Material:** glossy feature pieces (low
  roughness), satin elsewhere; emissive as *sheen*, never
  glow. **Post:** tight minimal bloom; the kit's one designed
  gradient permitted in accents; no grain, no haze.
  **Motion:** swells, not pulses — energy blooms on drops,
  melodic arcs, medium-long smoothing, downbeat lifts.
  **Skin:** "glossy electro-pop, bright clean studio light,
  polished chrome and satin surfaces, magenta and cyan accents
  on paper white, glitch-cut details, no darkness, no grit."
  **Best-for:** Prototype Heart (home), Patch Notes,
  Unproductive (v6-mini); future bright masters and the
  channel's daylight face.

### 3.9 Drift — the phonk look (created from §6)
- **Trait source:** Unproductive (Valley Phonk) and Rinse and
  Repeat — Memphis drift phonk: distorted 808s, detuned
  cowbell, eerie bells, chopped soul samples, lo-fi texture.
  Night Broadcast is *clean* dark; this is dirty dark, and
  the catalog has both.
- **Palette:** asphalt base `#12100E` (declared exception),
  Violet Deep `#3A2270` structure dimmed by haze, Magenta
  `#E14E8A` as the haze accent, Cyan rare and distant, washed
  Console FG text (low contrast is the aesthetic — so Drift
  is never the look for text-led pieces). **Lighting:** low
  and hazy, practicals through smoke, shadows soft and lost.
  **Material:** rough and dusty; emissive near zero; grain is
  the material (carried by post until T-VID-18). **Post:**
  heavy grain, VHS chroma bleed, strong vignette, bloom OFF —
  haze replaces it. **Motion:** swung and lazy — halftime
  weight, triplet shuffle in the cuts, bass band driving slow
  swells through long smoothing. **Skin:** "Memphis drift
  phonk, lo-fi grain, dusty vinyl and VHS chroma bleed, deep
  808 darkness, eerie bell tones, night-drive haze, no clean
  gloss, no neon." **Best-for:** Unproductive (Valley Phonk)
  (home), Rinse and Repeat; alternate for Ad Nauseam's grit.

## 4. Anti-styles — the governing rule

**The owner's governing rule (2026-11-07): avoiding AI slop
patterns goes through everything** — every look in this
catalog, every record in the future registry, and every
generated asset in any medium, not just image briefs. A style
that cannot state how it avoids the patterns below does not
enter the registry; §3.3's redesign is the worked example of
a look being rebuilt until it could.

From the owner's standing image rules, applied to motion:
no glow/neon-gradient wash as a *background* (the default AI
tell — cyan-magenta on dark blue-purple); no bokeh/particles
filler; no lens flare; no floating-in-void composition; no
generic 3D-render gloss. Note the deliberate distinction: the
kit's Violet → Cyan → Magenta gradient is a *designed accent*
with structure colors and a job — a background gradient wash
is the same hues with neither. A style that fails this section
fails review regardless of its other virtues.

## 5. Adoption: styles as data, curated by the owner

The catalog becomes real as a **registry** — one structured
file of style records (the hardware profile is the working
precedent: declared once, consumed by services) that the four
surfaces read: scene generation picks a style per track and
takes its palette/lighting/post from the record; HyperFrames
palette slots fill from the record instead of ad-hoc data;
visualizer presets declare the style they implement; T-VID-15's
look rigs are the 3D expression of the same records, so Route A
and Route B render the *same* look two ways. That registry is
registered as **T-VID-24** (design-first, same gate as its
siblings).

The nine looks above are proposals at the owner's usual terms:
he curates — strikes, renames, re-palettes — before any of
them is treated as house law, and the registry's first version
contains only the looks that survive his pass.

## 6. Checked against the actual catalog (2026-11-07)

The owner asked for the catalog to be compared against the
tracks actually generated, not hypothetical ones. Sources: the
repo track-lyrics library (each render's captured Suno style
prompt + BPM) and the session packages. Fourteen tracks:

| Track | Sonic character (from its prompt) | Primary look | Also serves |
|---|---|---|---|
| The Last Original (sets 1–2) | Sparse synthwave, 130, dry intimate vocal, "raw human mix, not overproduced" | Monochrome Signal | Vice Sunset (palette only — see below) |
| Human in the Loop | G-funk × riddim, 145, talkbox, dark digital + warm analog | Studio Console | Night Broadcast |
| Rinse and Repeat | Phonk hip-hop, trade-off verses, chantable hooks | Drift | Analog Print |
| Unproductive (v6-mini) | Future bass, 140, bright major-key lift, cathartic drop | Future Gloss | Studio Console |
| Unproductive (Valley Phonk) | Memphis drift phonk, 136, eerie bells, lo-fi grit | Drift | Night Broadcast |
| Ad Nauseam | Hip-hop double-time, 145, heavy 808, haunting strings | Night Broadcast | Analog Print (satire) |
| Patch Notes | Indie electronic × future bass, 150, polished wide modern | Future Gloss | Arcade Velocity |
| Out for Delivery | Satirical synth-pop, 130, playful exasperated | Analog Print | Studio Console |
| Prototype Heart | Electro-pop × cinematic bass, 128, glitch vocals, robotic harmonies, anthem chorus | Future Gloss | — |
| Stay Until the Lights Come On | Psychedelic bass / melodic dubstep, 145, wobble, vinyl fragments | Night Broadcast | Arcade Velocity |
| Screen Said Wait (set 5) | Metalstep DnB, double-time, crushing reese, dark aggressive | Arcade Velocity | Monochrome Signal (subject: a screen's message) |
| Don't Recommend | Industrial darkwave / EBM, 145, relentless sequencer, factory clang | Monochrome Signal | Arcade Velocity (motion) |
| Built My Own | Self-built-life anthem (Nov 2026 session) | Studio Console | Arcade Velocity |
| Screen Name Days | Era romance — screen names, away messages, T9, burned mixes (ungenerated) | Dial-Up | — |

### What the comparison forces

1. **A missing era.** Screen Name Days has no look: its world
   is early-web Y2K (CRT glow, pixel chrome, buddy-list UI,
   CD-R Sharpie), which is *not* Vice Sunset's 1980s coast.
   Candidate seventh look, born from this comparison:
   **Dial-Up** — phosphor-green/cyan on CRT black, pixel UI
   geometry, scanline texture, chunky stepped motion.
   **Resolved the same night at the owner's direction:
   created as §3.7.**
2. **Vice Sunset is nearly trackless.** Only The Last
   Original leans toward it, and only in palette — that
   track's production is dry and restrained, the opposite of
   Vice Sunset's gloss. As written it is the catalog's strike
   candidate; its honest remaining job is era *palette* duty
   inside other looks. **Redesigned 2026-11-07 at the
   owner's direction (§3.3): rebuilt under the anti-slop
   rule from place-and-broadcast traits, its vaporwave
   elements banned by name — it stands as the catalog's
   era-pastel register rather than a primary-carrier.**
3. **Arcade Velocity is not a niche.** Four-plus tracks live
   at 145–158 BPM with transient-led energy; Velocity is the
   generated catalog's energy default. It and Night Broadcast
   overlap in palette and separate in *motion* — cuts and
   snaps versus slow pulses — so the registry should treat
   motion character as the discriminating field between them.
4. **Prototype Heart is the gloss outlier.** The catalog has
   no glossy-pop look, and Console fits it only by stretching
   (machine theme, robotic harmonies). Either Console gains a
   declared gloss variant or Prototype Heart stands as a
   deliberate one-off; pretending the fit is clean would be
   exactly the improvisation this system exists to end.
   **Resolved the same night: Future Gloss created (§3.8) —
   and the comparison's third creation, Drift (§3.9), splits
   the phonk pair out of Night Broadcast, whose cleanliness
   never matched their grit.**
5. **Style attaches to the render, not the lyric set.**
   Unproductive exists as a bright future-bass take and a dark
   phonk take — one lyric set, two looks. Registry rule: a
   style assignment is per track *render*, inherited from the
   take's production character, never from the song title.

Net effect, after the three creations: the working catalog
is balanced — Future Gloss 3 primaries, Studio Console /
Night Broadcast / Drift / Monochrome Signal 2 each, Analog
Print / Arcade Velocity / Dial-Up 1 each plus alternates.
Arcade Velocity remains the energy register rather than a
separate room (it is the also-serves on five rows). Vice
Sunset, redesigned under the governing anti-slop rule, is
the era-pastel register: no primaries today, real alternates,
a clear job. That pass (T-VID-24) now starts from this
evidence instead of from taste alone.

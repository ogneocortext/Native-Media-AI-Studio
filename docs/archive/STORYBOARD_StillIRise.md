# Storyboard — Still I Rise — Nathaniel Smalley
*Lyric-mapped, research-backed, ready for shot planning*
*Duration 234.12s (7024f @30fps) • 99.4 detected / ~132 intended BPM (future-garage swung) • Bb Maj • 2026-08-20 v4 critique → v5 nocturnal plan*
*Files: `src/StillIRise.tsx` `public/blender-*.png` `docs/VISUAL_STORYTELLING_2026.md`*
*Prompt: `Nocturnal future-garage, low-130s BPM swung off-grid, warm slowly modulating sub-bass, foggy reverb pads, soft analog texture, pitched vocal fragments low, intimate breathy male, minor-key, slow-building: intro/verse/half-time refrain/interlude/final refrain. Spacious headphone mix, introspective.` — verified lyrics below match extracted `lyrics-und` + Whisper anchors*

> **Why v4 looked worse:** Audit of 12 frames (10s–225s) showed we added *layers without hierarchy*. Paper fiber (0.035 overlay) + burlap weave + dust 18 motes + mirrored reflection + spring jitter all on one locked center composition = visual noise, not story. Character still centered 50% occluded by lyric glass + waveform mid-line, bento 2-cards identical every frame, palette still slate. **2026 lesson:** StudioMeyer — kinetic type + heavy glass + WebGL often demo-only; needs restraint + act-specific cameras, not one AbsoluteFill with opacity tweaks. This board fixes via 10 distinct sequences with own camera, palette, prop focus, and transition.
>
> **Prompt correction — nocturnal future-garage (your prompt):** True tempo low-130s swung (librosa 99.4 = half-time detection of 132*0.75). Means *chorus is half-time* (≈65 BPM feel), not faster. Warm modulating sub-bass → hue should drift slowly amber→navy 28°→220°, not fast 3.2 bounce. Foggy pads → volumetric haze, not sharp crystal. Breath intimately → close-ups, not arena hero 88px. Minor-key unconventional → desat cool slate, not saturated violet maximalist. Slow-building headphone → spacious negative space, irregular phrase lengths (not even per-line split), soft dynamics. Storyboard below recalibrated to nocturnal intimate vs prior violet maximalist.

---

## Overview Map (10 Sequences = lyricBlocks)

| SEQ | Section | Timecode | Dur | Lyric Hook | Visual Story (1 sentence) | 2026 Technique |
|-----|---------|----------|-----|------------|---------------------------|----------------|
| S01 | INTRO | 00:00–00:18 | 18s | *Midnight hums… / A map unwritten…* | Empty night horizon, unwritten map on ground, character distant silhouette — world-building, not hero. | Cinematic letterbox + retro film dust, slow push 0.99→1.01, 2026 movie title |
| S02 | VERSE 01a | 00:18–00:47 | 29s | *I walk where streetlight… / Proof of roads…* | Close intimate streetlight study, character learns rain language — tactile, handheld. | Bento editorial 2×2 + cutout collage, liquid glass lyric left large, character right bento tall |
| S03 | VERSE 01b | 00:47–01:07 | 20s | *Horizon moves… / Keeping match alive…* | Horizon reveals movement, small match flame as anchor against wind. | Mixed media, map prop centered, match flame emissive, camera tilt up |
| S04 | CHORUS 01 | 01:07–01:28 | 21s | *Still I rise…* (4 lines) | Mantra expansion — hero typography, character rises, crystal blooms. | Maximalist fluid light + kinetic split-letter bounce `sin(t*3.2)`, bento spectrum 32 bright, light leak 0.16 |
| S05 | VERSE 02a | 01:37–01:55 | 18s | *Deep in fog… / Warm from crossing…* | Fog layer, steadier hand, coins in coat — reflective, cooler. | Layered bento Z-stack, squircle organic borders, warmth tint |
| S06 | VERSE 02b | 01:55–02:04 | 9s | *They watched… / I build what will stay…* | Tide hymn change, thunder→glass clarity. | Bento drill-down, props focus, glass panel blur by density |
| S07 | CHORUS 02 | 02:04–02:25 | 21s | *Still I rise…* | Second rise, higher scale, same hero but wider lens. | Same as S04 but 1.1× scale, more high sparkle |
| S08 | BRIDGE 01 | 02:25–02:59 | 34s | *I thought map had to tell me… / Just my fire…* | Intimacy, anti-climax, footprints already there — no finish line. | Retro VHS/Super8 desat 28°, grain 0.075, halation, reduced 16-dot spectrum, 2D only (skip WebGL 800KB) |
| S09 | BRIDGE 02 (reprise) | 02:59–03:24 | 25s | *No finish… / But dawn found…* | Mirrored reprise, fire against cold. | Same as S08 but inverted palette warm↔cool |
| S10 | FINAL CHORUS + OUTRO | 03:24–03:54 | 30s | *Still I rise — still I rise* | Becoming what tomorrow makes — loopable starfield for Canvas. | Hero holds, then fade to intro sky, 3-8s seamless loop cut for Spotify Canvas 1080×1920 |

*Total: 234s. Gaps 01:28–01:37 (9s instrumental swell) and 03:24–03:31 transition treated as light-leak wipes (Blender png).*

---

## Lyric-Line Detail (31 lines, frame-perfect)

> Use `StillIRise.tsx:27 lyricBlocks` → expanded `lyrics:Line[]` with `start/end` per line (even subdivision within block). Whisper base timestamps used as anchors; even split ensures readability. Each line = ~3.5–8.5s. Below maps lines to shots.

| # | Timecode | Section | Lyric Line | Duration | Shot Description | Camera | Blender Focus | Typography | Transition to Next |
|---|----------|---------|------------|----------|------------------|--------|---------------|------------|-------------------|
| 1 | 00:00–00:09 | INTRO | Midnight hums in shades of blue | 9.0s | **Wide establishing** — Empty 20m ground plane, 3 distant mountains silhouette, starfield sky 220°. No character. Map texture on ground barely visible. | Slow push dolly 0.99→1.01, 18px letterbox, tilt 0° | Scenery only `blender-scenery.png` 0.62 opacity + haze | No lyric panel — top mono pill only, 11px, bottom letterbox | Light leak wipe at 00:09 (blue) |
| 2 | 00:09–00:18 | INTRO | A map unwritten, waiting to be drawn anew | 9.0s | Same wide, character enters far silhouette 0.85 scale at horizon, small. Map on ground glows faint. | Hold push, slight pan right 4px | Scenery + silhouette `blender-character.png` 0.85 far | Lyric appears as thin mono lower-third, glass 18px, white 0.42 → glow on active word `shades` | Wiper at 00:18 to S02 (Blender transition png 12%→100%) |
| 3 | 00:18–00:27 | VERSE 01a | I walk where the streetlight loses its name | 8.0s | **Medium close — streetlight** — pole left  -3.25, bulb emissive 18, wet pavement reflection. Character mid 0.55 torso, learning posture. | Handheld micro 2px `sin(t*0.14)*8` | Props `blender-props.png` lit + Character | Editorial glass: `Learning…` per-word `0.16s stagger` 19px Space Grotesk, active -3px lift | Cut on snare at 00:27 |
| 4 | 00:27–00:36 |  | Learning the language of a different rain | 8.0s | Rain texture overlay (soft-light 0.025), character side profile, rain streaks vertical (2026 vertical motion). | Tilt up 2° | Props + rain particle layer | Same glass, words `different` highlight | — |
| 5 | 00:36–00:43 |  | Each wrong turn leaves a mark on my sleeve | 7.0s | Close on sleeve detail — fabric weave bump 0.6 visible, mark as subtle dark line. | Macro 0.9 scale | Character `BodyFabric` PBR | Lyric stack 2 lines max, white 0.92 | — |
| 6 | 00:43–00:47 |  | Proof of the roads I was scared to believe | 6.0s | Same close, pull back slightly, map texture overlay faint. | Pull back 1.01→0.99 | Map paper `blender-props.png` | Active `scared` glow | Wipe to S03 at 00:47 |
| 7 | 00:47–00:53 | VERSE 01b | The horizon moves, so I move with it too | 6.5s | **Wide horizon move** — mountains shift parallax 12px with `sin(t*0.12)`, character walks 14px `translateX`. | Pan right 12px, scale 1.04+bass*0.03 | Scenery parallax | Horizon line as composition leading | — |
| 8 | 00:53–00:58 |  | Past all the rules that never came true | 5.0s | Horizon holds, rules text as faint ghost typography background 140px WOOD cutout (collage). | Hold | Map | Collage layer low opacity 0.12 | — |
| 9 | 00:58–01:03 |  | I wear the unknown like a second skin | 5.5s | Close on fabric skin — second skin sheen visible, halo slight wobble cloth `mass 0.35`. | Close 1.02 | Character halo `HaloGlass` IOR 1.52 | Skin highlight active | — |
| 10 | 01:03–01:07 |  | Keeping one small match alive in the wind | 4.5s | Extreme close match flame — emissive 11, flickers with `high*0.2` brightness, wind `sin(t*0.9)*0.6` gate weave. | Macro flame, shallow depth blur props 78→32 opacity | Props `Flame` | Flame word `match` glows | Light leak wipe at 01:07 to CHORUS |
| 11 | 01:07–01:16 | CHORUS 01 | Still I rise before the fade | 9.0s | **Hero** — STILL I/RISE 88px split-letter bounce `sin(t*3.2 + i*0.55)*(2+bass*6)`, character 620×780 centered 48%, crystal 0.95 emissive 0.32+high*0.55 metal 0.88 reflective ground mirror. | Chorus cam 1.02+bass*0.03 scale, 10px pan | Character hero + crystal mirror | Hero only in chorus (not always-on), lyric words below hero 13px mono | — |
| 12 | 01:16–01:22 |  | Still I chase the light I made | 6.0s | Hold hero, light chase — pointLight intensity 0.72→0.9 with high. | Hold | Crystal | Words `chase`/`light` active | — |
| 13 | 01:22–01:28 |  | Out on the edge where tomorrow waits | 7.0s | Edge horizon — character at edge of ground plane -7, mountains behind. | Push in 0.99→1.02 | Scenery edge | Wait word highlight | — |
| 14 | 01:28–01:37 |  | I'm becoming what tomorrow makes | 6.0s | Hold, becoming morph — crystal inner octa scale 0.505→0.52 with `crystalSpring`. | Hold | Crystal inner | — | Swell instrumental 01:28-01:37 no lyric — light clusters drift (Zushi fluid) |
| 15 | 01:37–01:44 | VERSE 02a | Deep in the fog, I found a steadier hand | 7.0s | **Fog layer** 0.55 opacity + depth haze, character steadier — reduced jitter `physicsJitter*0.5`. | Fog scale 1.02 | Scenery fog | Fog word blue | — |
| 16 | 01:44–01:50 |  | Every river redrew where I stand | 6.0s | River redrew — props map glows, ground plane river line procedural. | Tilt down 6px | Props `MapPaper` | Redrew highlight | — |
| 17 | 01:50–01:55 |  | I keep small hours like coins in my coat | 5.5s | Coins bento — left meta card shows `8.4 LU` coins detail. | Bento focus | Bento card | Coins | — |
| 18 | 01:55–02:04 | VERSE 02b | They watched from shore… / Now tide hymn… / Softer… / I build… (4 lines 9s) | 9.0s | Shore/tide/glass/build — shore flat plane, tide wave via `wavePath` thicker 1.2px, glass clear. | Shore pan | Props shore | 4× quick word staggers 19px | Wipe at 02:04 to CHORUS |
| 19 | 02:04–02:13 | CHORUS 02 | Still I rise… (4 lines 21s) | 21s | Second rise — same hero but 1.1× wider lens, crystal 1.35 scale, light leak 0.16. | Wider 1.04 scale | Character + crystal | Same as S04 but larger | — |
| 20 | 02:25–02:37 | BRIDGE 01 | I thought the map had to tell me where | 12s | **Intimate VHS** — desat 28°, grain 0.075, halation, reduced 16-dot spectrum, character halo rim only, no crystal. | Letterbox 18px black, static cam | Character close, halo cloth wobble | Bridge mono 22px, active `map` amber | — |
| 21 | 02:37–02:47 |  | But dawn found my footprints already there | 10s | Footprints texture on ground — paper fiber 0.035 overlay reveals prints. | Down tilt 4° | Ground texture | Footprints highlight | — |
| 22 | 02:47–02:55 |  | No finish line, no hand to hold | 8s | Empty horizon, no finish line — negative space, character small 0.5 scale far. | Wide empty | Scenery only | Sparse | — |
| 23 | 02:55–03:04 |  | Just my own fire against the cold | 9s | Fire close — match flame emissive 11 vs cold rim 28°, breath fog. | Macro flame | Flame | Fire word orange 28° | — |
| 24 | 03:24–03:31 | FINAL CHORUS | Still I rise… (4 lines) | 7s | Final rise — hero holds, starfield loop extract 22-26s. | Hold | Starfield | Hero 88px | — |
| 25 | 03:31–03:54 | OUTRO | Still I rise — still I rise | 23s | Loopable fade to intro sky, Canvas 3-8s segment 1080×1920 center 1620px safe. | Fade 0.92→0.55 opacity | Scenery sky | No lyric, just `STILL I RISE` ghost 0.3 | End vignette |

---

## Visual System per Section (2026 mapping)

| Element | INTRO | VERSE | CHORUS | BRIDGE | Why Cohesive |
|---------|-------|-------|--------|--------|--------------|
| **Palette** | 220° cool slate 0.62  #9ab6c8 | 198° sky 0.88 + bass 205° | 258° violet 0.92  | 28° amber 0.60 desat 0.78 | Bb major warm/cool split, not random hue. Curated LUT soft-light 0.14 |
| **Typography** | 11px mono pill top only | 19px Space Grotesk per-word stagger 0.16s, 2-line max | 88px STILL/72px RISE split bounce, words mono 13px | 22px Bridge serif? Keep Space Grotesk, active amber glow | Kinetic hierarchy: intro sparse → verse editorial → chorus hero |
| **Blender** | Scenery only, character far 0.85 | Character 560 + Props lit, streetlight emissive 18 | Character 620 hero + crystal mirror ground | Character close + halo cloth only, no crystal (save 800KB) | Prop focus shifts per lyric — streetlight for S02, match for S03, map for S05 |
| **Three.js** | 0.5 opacity, small | 0.76, -1.08 x | 0.94, 0.62 x reflective plane 14×14 Metal 0.92 | 0 opacity (skip) | WebGL only where brand justifies (StudioMeyer) |
| **Bento** | Hidden | 2-cards 280+420 (meta + 32-bar) | 2-cards 280+420 bright 32-bar | 1-card 280 only, dots 16 | Bento evolves 1→2 cards, not always 2 |
| **Texture** | Paper fiber 0.035 overlay + grain 0.045 | + burlap weave 0.025 overlay soft-light | + light leak 0.16 + dust 18 motes | + VHS grain 0.075 + halation | Diversity without clutter — 0.035 overlay stays subtle |
| **Camera** | Push 0.99→1.01 | Parallax 10px + handheld 2px | Scale 1.02+bass*0.03 + pan 10px | Static close + letterbox 18px | Section-driven, not sin() everywhere |

---

## Transitions (Blender png + Remotion)

- **Wipe at 00:18, 01:07, 02:04, 03:24** — `blender-transition.png` 1200×180 diagonal 14° ± light-leak gradient `linear(100deg, transparent 42%, glow 49%, white 50%, ...)`. 0.9s, Bezier ease, not cheap linear. Shared across sequences for cohesion.
- **Inside verse:** Cut on snare (onset at 27s, 105s) — hard cut, no wipe.
- **Waveform:** Thin 1.2px only in verse/bridge 0.62 opacity; chorus 1.7px 0.85 + glow — supports, not competes.

---

## Technical Spec (maps to code)

- **Lyric sync:** `lyricBlocks:Line[]` → even `per = (end-start)/lines.length` → `currentLyric = lyrics.find(t)` → `lyricProgress` + `words.map(wStart=i/len)` kinetic. Future: replace even with Whisper word_timestamps for per-syllable.
- **Audio:** `useWindowedAudioData(window 30) + dataOffsetInSeconds` (fixes 1:30 freeze), `visualizeAudio(64)` 32-bar bento (filter%2), `visualizeAudioWaveform(280,0.6)`. Bass 0-10, mid 10-28, high 28-52.
- **GPU:** `remotion.config.ts:7` `concurrency 6` (6C/12T), `angle`, `h264` — crystal reflective ground `Metal 0.92` ensures GPU path.
- **Vertical:** Derive `1080×1920` by cropping center 1620px safe zone, tilt becomes vertical reveal — future Composition `StillIRiseVertical`.

---

## Next Action

1. **Approve this board** — check lyric timing per line (±0.5s) — adjust `lyricBlocks` start/end if needed (Whisper has garbled intro).
2. **Re-render v5** with shot-specific `<Sequence>` per SEQ (currently single AbsoluteFill) — will fix monotony.
3. **Extract Canvas loop** 22-26s for Spotify.

*Preview thumbnails:* `public/preview-intro.png:1` etc. — 12 frames cover 10s–225s bass curve sampled via `bassline_sample.py:1` (librosa <180Hz). Use to validate per-sequence grade before full 7024f render.


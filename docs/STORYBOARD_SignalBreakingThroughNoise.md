# Storyboard — The Signal Breaking Through the Noise — NeoCortext
*Lyric-mapped, librosa-verified, ready for shot planning*
*Duration 242.32s (7269f @30fps) • 136 BPM • 528 beats • 2026-08-31 librosa 0.11 analysis: 8 sections energy-mapped*
*Files: `src/Composition.tsx` `public/signal.mp3` `public/blender-*.png` `output/test-...-analysis.json`*
*Prompt: `A melancholic yet euphoric 136 BPM Progressive Trance about surviving grief and silence and finding your own frequency — infinite dawn landscape, electric blue horizon. Smooth breathy female lead, whispered male in breakdown, four-on-the-floor kick, supersaw chords, minor-key arpeggiator.`*

> **Why previous looked same:** Single AbsoluteFill with orb+figure center-locked, sine pulse 9.2, linear grid, one palette, no act camera. **2026 fix:** 8 distinct sequences with own camera/palette/prop/typography — like StillIRise v5 (10 sequences). Act-specific treatment, not opacity tweaks.

---

## Overview Map (8 Sequences = librosa sections + lyricBlocks)

| SEQ | Section | Timecode | Dur | Energy | Lyric Hook | Visual Story (1 sentence) | 2026 Technique |
|-----|---------|----------|-----|--------|------------|---------------------------|----------------|
| S01 | INTRO (intro) | 00:00–00:30.5 | 30.5s | 0.20 | *I used to stand at the edge…* (Whisper 16.88–20.36) | Empty infinite dawn horizon — no character, unwritten map on ground, electric blue horizon line flickers at 0.2 energy. | Letterbox 18px, slow push 0.985→1.015, dust 12 motes, cool slate 220° |
| S02 | VERSE 01 (verse) | 00:30.5–01:00.36 | 29.8s | 0.548 | *I drew my maps in silence…* | Character enters far 0.55 at horizon, borrowed light traces map — intimate handheld. | Bento 2-cards 280+420 meta/spectrum, streetlight→map prop, tilt 2° |
| S03 | CHORUS 01 (chorus) | 01:00.36–01:30.79 | 30.4s | 0.923 | *I am the signal breaking through the noise* | First euphoric lift — supersaw bloom, crystal orb ignites, hero frequency. | Maximalist fluid light, split-letter `sin(t*3.2)` 92px, light leak 0.18, 32-bar |
| S04 | CHORUS 02 (chorus) | 01:30.79–02:01.24 | 30.4s | 0.923 | *The city changed… code rewrote the sky* (Verse02 lyrics ride second chorus musically) | City-code sky parallax, doors close/open — wider lens same hero. | Same as S03 but 1.06× wider, ember density +30% |
| S05 | BRIDGE (bridge/breakdown) | 02:01.24–02:31.45 | 30.2s | 0.282 | *Still here / Still moving* (whispered male) | Stripped — desat 32°, VHS halation, no crystal, whispered intimacy. | VHS grain 0.075, 16-dot spectrum, 2D only, rim halo only |
| S06 | CHORUS 03 (chorus) | 02:31.45–03:01.67 | 30.2s | 1.0 | *I am the signal… I am the frequency* (peak) | Peak euphoria — all lights full, orb core white, dawn breaks. | Scale 1.02+bass*0.04, 34 embers, gold screen 0.06, waveform 1.7px |
| S07 | CHORUS 04 (chorus) | 03:01.67–03:32.04 | 30.4s | 0.84 | *Rising / Let it break through* | Sustained lift — same peak but softer, dawn fully risen. | Same light but 0.9× intensity, warm 36° instead of 258° |
| S08 | OUTRO (outro) | 03:32.04–04:02.32 | 30.3s | 0.794 | *The borrowed light became my own…* | Resolve — dawn horizon fully warm, map becomes song, character owns light. | Fade to intro sky 0.62→0.35, loopable starfield, no hero, ghost typography 0.3 |

*Beats: 528 @136 BPM, 13.2f per beat. Transitions: wipe at every section boundary (7 wipes) via `blender-transition.png` diagonal 14°, 0.9s.*

---

## Lyric-Line Detail (32 lines, frame-perfect)

Use `Composition.tsx: lyricBlocks` → `lyrics:Line[]` even subdivision within block. Transcription anchor: Whisper 16.88 “Used to stand…” aligns with S01 mid.

| # | Timecode | Section | Lyric Line | Shot | Blender | Typography |
|---|----------|---------|------------|------|---------|------------|
| 1-4 | 00:00–00:30.5 | INTRO | I used to stand… / Watching the old world… / I drew my maps… / And somewhere in the static… | Wide establishing — empty 20m ground plane, blue horizon 218°, no character until 00:16 | Scenery only 0.62 + haze | Mono pill 11px top only |
| 5-8 | 00:30.5–01:00.36 | VERSE 01b | The city changed… / But I was learning… / Every door… / I built myself from frequencies… | Medium close — character 0.55, map prop lit | Character + props | Editorial glass 19px stagger 0.16s |
| 9-12 | 01:00.36–01:30.79 | CHORUS 01 | I am the signal… / I am the light… / Static in my veins… / I am the frequency ×2 | Hero — STILL I/RISE 88px split bounce, crystal 0.95 emissive, orb core | Hero crystal mirror 14×14 metal 0.92 | Hero 88/72 split bounce `sin(t*3.2 + i*0.55)*(2+bass*6)` |
| 13-16 | 02:31.45–03:01.67 | CHORUS 03 peak | same 5 lines | Peak — wider 1.02+bass*0.04, light leak 0.18 | Same but 1.1× scale | Same hero but warm 36° gold |
| 17-22 | 02:01.24–02:31.45 | BREAKDOWN | Still here… ×6 | VHS intimate — close halo, no crystal | Close halo cloth wobble | Mono 22px amber glow |
| 23-26 | 03:32.04–04:02.32 | OUTRO | The borrowed light… ×4 | Dawn resolve — starfield loop, map→song | Scenery sky only | Ghost 0.3, no lyric panel |

## Visual System per Section (Signal dawn → trance)

| Element | INTRO (0.20) | VERSE (0.548) | CHORUS (0.923-1.0) | BREAKDOWN (0.282) | OUTRO (0.794) |
|---------|--------------|---------------|-------------------|-------------------|---------------|
| Palette | 218° electric blue 0.62 #6aa9d6 | 205° cyan 0.76 | 258° violet 0.94 → 36° gold 0.92 on peak | 28° amber desat 0.72 #b08a5a | 36° warm resolve 0.79 |
| Typography | 11px mono pill | 19px stagger 0.16s | 88px hero split | 22px bridge amber | 36px resolve ghost |
| Blender | Scenery 0.62 only | Character 560 + props 420 | Hero 620 + crystal mirror | Close halo only, no crystal | Scenery sky haze |
| Three.js | 0.5 small | 0.76 offset -1.08 | 0.94 reflective | 0 opacity | 0.6 starfield |
| Bento | Hidden | 2-cards 280+420 (32-bar) | 2-cards bright 32-bar | 1-card 280 dots 16 | Hidden fade |
| Camera | Push 0.985→1.015 letterbox | Parallax 10px + handheld 2px | Scale 1.02+bass*0.03 + pan 10px | Static VHS | Drift 0.99→1.01 |

## Transitions
- Wipe at every librosa boundary (30.5,60.36,90.79,121.24,151.45,181.67,212.04) — `blender-transition.png` diagonal, Bezier, 0.9s — shared cohesion.

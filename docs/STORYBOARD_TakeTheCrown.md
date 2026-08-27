# Storyboard — Take the Crown — NeoCortext
*Lyric-mapped, research-backed, ready for shot planning*
*Duration 124.0s (3720f @30fps) • 152 BPM • E Maj (0.755 conf) • -13.4 LUFS remastered (orig -14.0) • LRA 2.6 LU (orig 3.6) • 2026-08-20 v1 → v2 remaster 2026-08-20*
*Files: `src/TakeTheCrown.tsx` `public/crown-cover.png` `public/crown-still-*.png` `renders/take-the-crown-v1.mp4` `renders/take-the-crown-v2-remastered.mp4` `public/take-the-crown-remastered.mp3` `public/stems/*.mp3`*
*Env: `.conda/audio-remaster` (project-local) — torch 2.6.0+cu124 + demucs 4.1.0, CUDA GTX 1070 Ti*
*Prompt: `Coronation anthem, 152 BPM four-on-floor drive, E-major triumphant, gold-on-ash, embers rising, "take the crown" mantra.` — canonical lyrics from embedded `lyrics-und` + Whisper anchors.*

> **Why this board works:** Same lesson as Still I Rise v5 — *act-specific treatment, not one locked composition*. This song is a 152 BPM coronation anthem: short (2:04), high-energy throughout (LRA 3.6 LU = very consistent loudness). Visuals must ramp from dark ash → burning embers → gold crown reveals, matching the *Step out the shadow → Rising from the ash → Take the crown* narrative. Six distinct acts, each with own ember density, crown scale, palette intensity, and typography.

---

## Overview Map (6 Sequences = lyricBlocks)

| SEQ | Section | Timecode | Dur | Lyric Hook | Visual Story (1 sentence) | 2026 Technique |
|-----|---------|----------|-----|------------|---------------------------|----------------|
| S01 | INTRO | 00:00–00:30 | 30s | *(no lyrics, "Oh" 0–2s)* | Dark ash field, crown far and dim at 0.85 scale, sparse 10 embers — emptiness before the coronation. | Cinematic letterbox 20px, slow push 0.97→1.02, cool ember 10, no hero text |
| S02 | DROP 01 | 00:30–00:40.5 | 10.5s | *Step out the shadow / Burn it to the ground / Watch the new king / Take the crown* | Crown pushes in, gold rim ignites, kinetic "TAKE THE CROWN" hero splits letters on the 152 BPM beat. | Kinetic split-letter 92px `sin(t*3.4)` + gold emissive rim, 34 embers, drop letterbox off |
| S03 | VERSE | 00:40.5–01:00.3 | 19.8s | *Used to let the doubt… / Nobody's victim, nobody's fool* (8 lines) | Back to intimate — crown recedes to 0.88, gold dims to slate-gold, lyric panel focus per-word. | Editorial glass panel, per-word 0.16s stagger 20px, 18 embers, cool-amber mix |
| S04 | BUILD | 01:00.3–01:27 | 26.7s | *(instrumental swell, whisper silent)* | Crown spins up, embers accelerate, gold gradient builds — anticipation for the final drop. | No lyrics; crown `rotation t*0.34`, embers 26, warm glow 0.2, light-leak wipes |
| S05 | DROP 02 | 01:27–01:45.5 | 18.5s | *Rising from the ash… / Yeah we take the crown* (8 lines) | **Maximalist climax** — crown 1.02 scale gold flare, 34 embers, hero "TAKE THE CROWN" + per-word drop lyrics. | Maximalist: 92px hero + 8-line per-word, ember 34, gold screen 0.055, ring 1.25+bass*0.7 |
| S06 | OUTRO | 01:45.5–02:04 | 18.5s | *(post-vocal, "Take the crown" resolved)* | Fade — crown dims, embers settle, "TAKE THE CROWN" stays as monument. | Fade 105.5→116 to 0.45, title card "OUTRO — RISE COMPLETE", letterbox returns |

*Total: 124s. Instrumental gap 01:00.3–01:27 = 26.7s build (Whisper found no vocals there — treated as swell, crown spins). Whisper anchor cross-check: "I ain't holding back" at 90.32s = 01:30 → matches S05 block start 01:27.*

---

## Lyric-Line Detail (20 lines, frame-perfect)

> Use `TakeTheCrown.tsx:39 lyricBlocks` → expanded `lyrics:Line[]` with `start/end` per line (even subdivision within block). Whisper base timestamps used as anchors; even split ensures readability.

| # | Timecode | Section | Lyric Line | Duration | Shot Description | Camera | Crown Focus | Typography | Transition to Next |
|---|----------|---------|------------|----------|------------------|--------|-------------|------------|-------------------|
| 1 | 00:30–00:32.6 | DROP 01 | Step out the shadow | 2.6s | Crown scales 0.85→1.0, gold rim ignites from ash. | Push +4px `sin(t*0.24)` | Crown center 0.35y, band emissive 0.3 | Per-word 13px mono under hero | Beat cut at 00:32.6 |
| 2 | 00:32.6–00:35.2 | DROP 01 | Burn it to the ground | 2.6s | Gold flare sweep across crown base, embers surge. | Beat spring on drop | Torus ring emissive `0.3+bass*0.45` | Per-word active `glowColor` | Cut on bass 00:35.2 |
| 3 | 00:35.2–00:37.8 | DROP 01 | Watch the new king | 2.6s | Orb on crown apex blooms white-gold. | Crown rotate +0.12 rad | Orb emissive `0.75+high*0.5` | Per-word | Light-leak wipe 00:37.8 |
| 4 | 00:37.8–00:40.5 | DROP 01 | Take the crown | 2.7s | Hero "TAKE THE CROWN" first appears, crown rings pulse. | Ring scale `1.25+bass*0.7` | Ground ring gold 0.16 | **HERO 92px split-letter** | Wipe to VERSE 00:40.5 |
| 5 | 00:40.5–00:43 | VERSE | Used to let the doubt creep up in the mind | 2.5s | Crown recedes 0.88, gold dims, lyric panel focus. | Pull back 0.99→1.01 | Crown dim `brightness 0.5` | Editorial glass 20px per-word | Cut on phrase |
| 6 | 00:43–00:45.5 | VERSE | Used to leave the best parts of me behind | 2.5s | Ash settles, crown silhouette darker. | Slow drift +6px | Crown 0.88 dim | Per-word | Cut |
| 7 | 00:45.5–00:48 | VERSE | Look in the mirror, face the ghost | 2.5s | Gold glint on crown band only. | Tilt up 2px | Band emissive low | Per-word | Cut |
| 8 | 00:48–00:49.2 | VERSE | Do what scares you the most | 1.2s | Tight — crown apex fill frame. | Zoom 1.03 | Orb focus | Per-word active | Cut on snare |
| 9 | 00:49.2–00:50.8 | VERSE | Sweat on the wheel, grip on the edge | 1.6s | Embers pick up, warm tint. | Handheld 2px | Crown mid | Per-word | Cut |
| 10 | 00:50.8–00:52.4 | VERSE | Pushed every limit right over the ledge | 1.6s | Embers surge 18→22. | Slight push | Rim glow | Per-word | Cut |
| 11 | 00:52.4–00:54 | VERSE | I took the pain and I made it a tool | 1.6s | Crown tilts 0.12 rad, gold returns. | Rotate +0.05 | Band gold | Per-word | Cut |
| 12 | 00:54–00:56 | VERSE | Nobody's victim, nobody's fool | 2.0s | Crown snaps upright, rings ignite. | Reset +0.08 | Ring pulse | Per-word → last line bold | Wipe to BUILD 01:00.3 |
| 13 | 01:00.3–01:27 | BUILD | *(instrumental)* | 26.7s | Crown spins `t*0.34`, embers 26, gold gradient builds. No lyrics — pure anticipation. | Orbit crown | Crown rotate fast, orb bright | Bottom mono pill "BUILD" only | Light-leak wipe at 01:27 |
| 14 | 01:27–01:29.3 | DROP 02 | Rising from the ash | 2.3s | Embers explode to 34, crown scale 1.02. | Push +4px | Gold flare | Per-word + hero intro | Beat cut |
| 15 | 01:29.3–01:31.6 | DROP 02 | Pedal to the floor | 2.3s | Crown spin max, rings flare. | Beat spring | Ring 1.25+bass*0.7 | Per-word | Cut on bass |
| 16 | 01:31.6–01:33.9 | DROP 02 | I ain't holding back | 2.3s | Hero "TAKE THE CROWN" max 92px, gold screen flash. | (anchor: Whisper 90.32s=01:30) | Orb white-gold | **HERO full** | Cut |
| 17 | 01:33.9–01:36.2 | DROP 02 | Not anymore | 2.3s | Embers fly outwards, crown tilts aggressive. | Tilt 0.12 | Crown full gold | Per-word | Cut |
| 18 | 01:36.2–01:39.5 | DROP 02 | Burn it to the ground | 3.3s | Full gold burnout — screen flash 0.055. | Zoom 1.02 | Ring flare max | Per-word | Cut |
| 19 | 01:39.5–01:42.7 | DROP 02 | Watch the new king | 3.2s | Crown centered throne-wide, orb bright. | Pull back | Crown 1.02 | Per-word | Cut |
| 20 | 01:42.7–01:45.5 | DROP 02 | Take the crown / Yeah we take the crown | 2.8s | Hero + per-word together — coronation complete. | Hero holds | Gold full | **HERO + per-word** | Fade to OUTRO 01:45.5 |

---

## Production Notes

- **Palette (E-major gold):** drop `hsl(42 92% 60%)` gold, verse `hsl(198 88% 62%)` cool-amber mix, intro `hsl(30 70% 46%)` ember. bg `#0a0706` ash. Accent ≤20% frame; dominant 70% ash.
- **Three.js crown:** cylinder band `#c99a33` metal 0.92 + 6 spikes `#e8b23c` cones 0.19/0.95 + apex orb `#fff3c4` emissive 0.75 + 2 gold torus rings (emissive reacts to `bass`/`high`).
- **Motion budget (restrained):** primary 300ms, secondary 200ms, opacity/transform only; max 3 focal layers (bg, crown, lyric/hero). Embers = third layer, capped 10/18/26/34 by act.
- **152 BPM beat:** `BEAT_FRAMES = 60/152*30 ≈ 11.8f` → beat spring on `frame % 12`, bass >0.3 gate. Crown rings scale on `bass*0.7`.
- **Render v1:** `remotion render src/index.ts TakeTheCrown renders/take-the-crown-v1.mp4 --gl=angle --codec=h264 --overwrite` → 132.1 MB, 124.05s, 1920×1080 30fps, h264+aac. Copies: `output/take-the-crown-music-video.mp4`, root `take-the-crown-music-video.mp4`.
- **Remaster v2 (2026-08-20):** htdemucs stems `output/stems/htdemucs/take-the-crown/{bass,drums,other,vocals}.wav` (21.8 MB each) via `.conda/audio-remaster` CUDA; per-stem EQ/compression (`highpass/lowpass + acompressor + equalizer`) + amix → `C:\Users\AOMEGA~1\AppData\Local\Temp\opencode\crown-mixed.wav` (21.8 MB) → loudnorm I=-14 TP=-1.5 LRA=9 linear (measured I -13.91 TP 0.75 LRA 3.5) → `public/take-the-crown-remastered.mp3` 4.96 MB 320k, verified -13.4 LUFS / LRA 2.6 / TP -1.4. Stems converted to `public/stems/*.mp3` 2.98 MB each for per-stem reactivity: drums→crown pulse `drumPulse`, bass→ground rings `bassEnergy`, vocals→orb+hero `vocalsEnergy`, other→embers `otherEnergy`. Fix: `visualizeAudio bars 24→32` (power-of-two). Still `public/crown-remastered-still-verse.png`, full `renders/take-the-crown-v2-remastered.mp4` 131.8 MB verified 124.05s h264+aac, copies `output/take-the-crown-music-video-remastered.mp4`.
- **Previews:** v1 `take-crown-10s.mp4` (86–96s), v2 `take-crown-remastered-10s.mp4` 5.5 MB, 6 thumbs `tc-*.jpg`.
- **Analysis:** `output/take-the-crown-analysis.json` (152 BPM, E key, -16.9 RMS dB, centroid 2535.9 Hz, 298 beats), `output/take-the-crown-whisper.json`, `output/stems/stem-stats.json`.
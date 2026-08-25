# 3D Rendering & Music Video Production Knowledge Library

**Purpose:** Centralized knowledge for AI agents to create compelling music videos for YouTube  
**Last Updated:** 2026-08-24  
**Target Platform:** YouTube (16:9 landscape + 9:16 vertical Shorts)

---

## Table of Contents

1. [Pipeline Architecture](#pipeline-architecture)
2. [Audio Analysis](#audio-analysis)
3. [Visual Generation](#visual-generation)
4. [3D Scene Construction](#3d-scene-construction)
5. [Beat Synchronization](#beat-synchronization)
6. [Character & Scene Consistency](#character--scene-consistency)
7. [Prompt Engineering](#prompt-engineering)
8. [Render & Export](#render--export)
9. [YouTube Optimization](#youtube-optimization)
10. [Troubleshooting](#troubleshooting)

---

## Pipeline Architecture

### Recommended Workflow (2026 Standard — Expanded Aug 2026)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        MUSIC VIDEO PRODUCTION PIPELINE v2                    │
│                    (Aug 2026 web synthesis + app constraints)                │
├─────────────────────────────────────────────────────────────────────────────┤
│  Phase 1: PRE-PRODUCTION (20 min) — now stem-native + integrated            │
│  ├── Upload audio (MP3/WAV/FLAC) → auto-analyze: tempo/beats/sections/mood │
│  ├── NEW: Stem separation (Demucs) → 8 stems → per-stem visual mapping     │
│  │       drums→pulse/scale, bass→shake, vocals→kinetic, chroma→palette     │
│  ├── Select type: Lyric / Visualizer / Narrative (+ Cinematic vs Social)    │
│  ├── Choose master: 9:16 vertical-first (center 1620 safe) → derive 16:9  │
│  └── Gather 3-5 refs + lock style frame (palette 2-3 tones, 2 fonts)       │
│                                                                             │
│  Phase 2: GENERATION (60-90 min) — 2 tracks, real-time preview first        │
│  ├── Generate per section (intro/verse/chorus/bridge/outro)                │
│  ├── Track A: Image→Video via Wan 2.2 5B (480p, 6-8GB fits 1070 Ti) or     │
│  │           Hunyuan3D → Blender stage → EEVEE Next / Cycles                │
│  ├── Track B: AnimateDiff 16-32f loop or SVD 2-4s for subtle motion         │
│  ├── NEW: Real-time 512p proxy preview via Remotion visualizeAudio()       │
│  ├── Review & select variations + ControlNet transfer if needed             │
│  └── Prompt repair log: save fails + "no drums" style repairs, versioned  │
│                                                                             │
│  Phase 3: POST-PRODUCTION (45 min) — mindful layering, <3 focal             │
│  ├── Arrange clips (Series/Sequence), cuts land on strong beats/downbeats  │
│  ├── Transitions: cut on snare internal, soft wipe + leak at sections      │
│  ├── Subtitles/lyrics word-aligned kinetic (spring/interpolate, no CSS)    │
│  ├── Color grade: dominant 70% slate, accent ≤20%, section-aware LUT       │
│  └── QA stills at 10/45/75/105/135/165/195/225s before 7024f render       │
│                                                                             │
│  Phase 4: DISTRIBUTION (15 min) — integrated multi-modal export matrix      │
│  ├── Export matrix: 16:9 hero + 9:16 Shorts + 3-8s Canvas loop + thumbs×3  │
│  ├── Create thumbnail A/B variants (168×94 test, hook moment + title)      │
│  ├── Metadata: title <60ch curiosity+keyword, desc timestamps, genre tags  │
│  └── Upload + schedule: 1 long/month + 1-3 Shorts/week (compounding)       │
│  Visualizer lift: 2-5× over static album-art per Shimga May 2026           │
└─────────────────────────────────────────────────────────────────────────────┘
```
> See [[ai-video-trends-2026]] for 5 trends source detail and [[youtube-optimization#youtube-algorithm-factors—2026-update|YouTube 2026 algorithm]] for CTR/satisfaction/Shorts.

### Song Structure Mapping

| Section | Typical Duration | Visual Treatment |
|---------|-----------------|------------------|
| Intro | 5-15s | Establish mood, slow builds, wide shots |
| Verse | 15-30s | Narrative progression, medium shots |
| Pre-Chorus | 5-10s | Building tension, closer shots |
| Chorus | 15-30s | Peak energy, high impact, close-ups |
| Bridge | 10-20s | Visual pivot, abstract/surprise |
| Outro | 5-15s | Wind down, defocus, final frame |

---

## Audio Analysis

### Key Metrics to Extract

```python
# Required audio features for music video generation
audio_features = {
    "tempo_bpm": "beats per minute (60-180 typical)",
    "beat_timestamps": "array of beat positions in seconds",
    "sections": [
        {"type": "intro", "start": 0.0, "end": 12.5},
        {"type": "verse", "start": 12.5, "end": 38.0},
        {"type": "chorus", "start": 38.0, "end": 63.5},
        # ...
    ],
    "energy_curve": "0.0-1.0 per time segment",
    "valence": "musical positivity (sad=happy)",
    "danceability": "how suitable for dancing",
    "key": "musical key (C major, A minor, etc.)",
    "duration_seconds": "total track length"
}
```

### Beat Synchronization Rules — 2026 Stem-Native

1. **Strong beats / downbeats** → Cut to new shot (use DBNBeatTracker or librosa PLP for downbeat confidence)
2. **Sustained notes** → Hold shot, let viewer absorb (no 5 simultaneous sines — hierarchy 1 primary/1 secondary)
3. **Chorus entry** → Most important visual anchor — maximalist light clusters, hero type 72-88px, spectrum bright
4. **Build-ups** → Accelerating cut pace, but cap motion <800ms initial viewport, <500ms per element (Monotonomo budget)
5. **Drops** → Maximum visual impact — map bass (>0.36 RMS) → scale pulse + ground reflection intensity, high centroid → sparkle
6. **Fade out** → Reduce visual density in parallel + extract 3-8s loop for Canvas
7. **NEW — Stem mapping:** Each stem/band → different param (not just low/mid/high): drums→scale, bass→shake/contact shadow, spectral centroid→palette temperature, onset→cut, mfcc→instrument-driven prop visibility. Requires pre-pass stem separation.

### Energy Curve Visualization

```
Energy
  1.0 ┤        ┌───┐       ┌───┐
  0.8 ┤        │   │       │   │
  0.6 ┤   ┌────┤   │  ┌────┤   │
  0.4 ┤───┤    │   │──┤    │   │
  0.2 ┤   │    │   │  │    │   │
  0.0 ┼───┴────┴───┴──┴────┴───┴──→ Time
      Intro Verse Chorus Bridge Chorus Outro
```

---

## Visual Generation

### Video Types

| Type | Description | Best For |
|------|-------------|----------|
| **Lyric Video** | Words highlighted karaoke-style | Wordy songs, language learning |
| **Visualizer** | Imagery pulses with music | Instrumentals, lo-fi, ambient |
| **Narrative MV** | Continuous story sequence | Story-driven songs, concepts |

### Shot Size Guide

| Shot Size | Description | Emotional Effect |
|-----------|-------------|------------------|
| Extreme Wide | Subject tiny in environment | Isolation, scale, awe |
| Wide | Full subject + surroundings | Establishing, context |
| Medium | Subject from waist up | Emotion, connection |
| Close-up | Face or object detail | Intensity, importance |
| Extreme Close-up | Eyes, hands, objects | Drama, intimacy |

### Camera Movement Types

| Movement | Description | Use Case |
|----------|-------------|----------|
| Static | No camera movement | Calm moments, performance |
| Push In (Dolly) | Camera moves toward subject | Building intensity |
| Pull Out (Dolly) | Camera moves away | Revelation, ending |
| Pan | Camera rotates horizontally | Reveal, follow action |
| Tilt | Camera rotates vertically | Reveal scale, power |
| Tracking | Camera follows subject | Action, movement |
| Orbit | Camera circles subject | Showcase, drama |

### Transition Types

| Transition | Description | Best Placement |
|------------|-------------|----------------|
| Hard cut | Instant switch | Strong beats, chorus entry |
| Dissolve | Gradual blend | Time passage, dream sequences |
| Wipe | One image pushes off another | Location changes |
| Zoom | Scale change between shots | Energy builds |
| Morph | Subject transforms | Bridge, surreal moments |
| Fade | To/from black | Intro, outro |

---

## 3D Scene Construction

### Blender MCP Integration

```python
# Blender scene construction workflow
scene_config = {
    "stage": "concert_platform_with_led_walls",
    "lighting": "dynamic_rig_with_beat_sync",
    "camera": "cinematic_24mm_anamorphic",
    "characters": ["main_performer", "crowd_silhouettes"],
    "props": ["microphone", "speaker_stacks", "fog_machine"],
    "environment": "nightclub_interior_or_outdoor_festival"
}
```

### Scene Lock System

To maintain consistency across shots:

1. **Character Bible**: Define each character with:
   - Name, age, gender, ethnicity
   - Hair color/style, clothing
   - Distinguishing features
   - Reference image

2. **Scene Library**: Define each location with:
   - Location description
   - Time of day
   - Lighting conditions
   - Reference image

3. **Per-Shot Assignment**: Each shot selects:
   - One character from bible
   - One scene from library
   - One camera angle
   - One action description

### 3D Asset Generation

For Hunyuan3D-2mini (8GB VRAM optimized):

```
Prompt structure for 3D assets:
"[object], [style], [detail_level], [orientation]"

Examples:
- "a futuristic robot, chrome metallic, highly detailed, standing pose"
- "a neon microphone, cyberpunk style, glowing accents, floating"
- "a DJ console, modern minimalist, LED indicators, top-down view"
```

---

## Character & Scene Consistency

### The 4-Step Character Consistency Method

1. **Upload reference image** of lead character
2. **Lock face** across all shots using reference
3. **Use @character-name** in prompts to specify who appears
4. **Verify consistency** by reviewing all shots together

### Scene Consistency Rules

1. **Build a scene library** (3-5 scenes max)
2. **Each shot selects one scene** from the library
3. **Don't swap locations** mid-video without transition
4. **Maintain lighting continuity** within scenes

### Visual Grammar

Every video needs consistent visual grammar:
- **Color palette**: 1-2 dominant colors throughout
- **Lighting style**: Consistent across all shots
- **Film grain/texture**: Apply uniformly
- **Aspect ratio**: Same for entire video

---

## Prompt Engineering

### Structured Prompt Format

```
[Shot size] + [Camera angle] + [Subject] + [Action] + [Setting] + [Lighting] + [Mood]
```

### Examples by Genre

**Happy/Upbeat Track:**
```
"Medium shot, eye-level angle, a joyful shrimp character dancing, 
underwater disco club, colorful neon lighting, energetic and fun"
```

**Electronic/Dance:**
```
"Close-up, low angle, a futuristic DJ performing, 
massage festival stage, laser lights, high energy and euphoric"
```

**Chill/Lo-fi:**
```
"Wide shot, bird's eye view, a cat studying at desk, 
cozy bedroom at night, warm lamp lighting, peaceful and relaxed"
```

### Prompt Quality Checklist

- [ ] Shot size specified
- [ ] Camera angle specified
- [ ] Subject clearly described
- [ ] Action/posing described
- [ ] Setting/location defined
- [ ] Lighting described
- [ ] Mood/emotion conveyed
- [ ] Present tense verbs used
- [ ] Single flowing paragraph
- [ ] Detail matches shot scale

### Common Prompt Mistakes

| Mistake | Fix |
|---------|-----|
| Generic adjectives ("beautiful", "atmospheric") | Specific descriptions ("golden hour backlight", "fog-filled alley") |
| No shot size | Add "medium shot" or "close-up" |
| No camera angle | Add "eye-level" or "low angle" |
| Too many subjects | Focus on one main subject per shot |
| Inconsistent style | Lock style with reference image |

---

## Render & Export

### Export Formats

| Platform | Resolution | Aspect Ratio | Format |
|----------|------------|--------------|--------|
| YouTube | 1920x1080 or 3840x2160 | 16:9 | MP4 (H.264) |
| YouTube Shorts | 1080x1920 | 9:16 | MP4 (H.264) |
| TikTok | 1080x1920 | 9:16 | MP4 (H.264) |
| Instagram Reels | 1080x1920 | 9:16 | MP4 (H.264) |

### Quality Settings

| Use Case | Bitrate | FPS |
|----------|---------|-----|
| Casual sharing | 8-12 Mbps | 24-30 |
| Standard quality | 16-24 Mbps | 24-30 |
| Professional | 35-48 Mbps | 24-30 |
| Maximum | 68+ Mbps | 24-60 |

### Thumbnail Creation

1. **Choose frame with strong visual impact**
2. **Confirm it reads clearly at thumbnail size**
3. **Overlay song title or short hook**
4. **Avoid blurry frames or motion blur**
5. **First 3 seconds = highest-hook moment**

---

## YouTube Optimization

### Title Formats

```
[Artist] - [Song Name] (Official Music Video)
[Song Name] [Genre] [Visual Style] 
[Emotional Hook] | [Artist] - [Song Name]
```

### Description Template

```
🎵 [Song Name] by [Artist]
🎬 Music video created with AI

📝 Lyrics:
[First few lines...]

🔗 Links:
Spotify: [link]
Apple Music: [link]

⏱️ Timestamps:
0:00 - Intro
0:15 - Verse 1
0:38 - Chorus
...

#MusicVideo #AIArt #[Genre] #[Artist]
```

### Tags

```
music video, official music video, [artist name], [song name], 
[genre], ai music video, ai generated, music visualizer, 
[new music 2026], [mood] music
```

### First 3 Seconds Rule

- Open with the most striking chorus moment
- Design the opening to be the highest-hook moment
- Viewers decide whether to keep watching in 3 seconds
- Don't start with slow intro

---

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Visuals out of sync with music | No beat analysis | Add beat detection step |
| Style changes between sections | No style lock | Use reference images |
| Character face changes | No character lock | Upload reference image |
| Location drifts | No scene lock | Build scene library |
| Flat energy throughout | Same cut pace everywhere | Speed up chorus, slow down verses |
| Subtitles overlap subject | Fixed position | Dynamic positioning |
| Video feels like slideshow | No camera movement | Add Ken Burns or camera moves |

### GPU Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "GPU unavailable" display | nvidia-ml-py not installed | `pip install nvidia-ml-py3` |
| Generation OOM | Model too large for VRAM | Reduce resolution or use smaller model |
| Slow generation | CPU fallback | Check CUDA installation |

### Blender MCP Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "Could not connect" | Addon not enabled | Enable in Preferences > Add-ons |
| "Server not running" | MCP server stopped | Click "Start MCP Server" in sidebar |
| Protocol version mismatch | Outdated addon | Run `uvx blender-mcp install-addon` |

---

## Quick Reference: AI Agent Checklist

When creating a music video, ensure:

- [ ] Audio analyzed for beats, sections, tempo
- [ ] Video type selected (lyric/visualizer/narrative)
- [ ] Reference images gathered (3-5 style refs)
- [ ] Prompts use structured format
- [ ] Different treatment per song section
- [ ] Chorus has peak visual impact
- [ ] Character consistency locked
- [ ] Scene consistency maintained
- [ ] Cuts land on musical events
- [ ] Subtitles word-aligned (if lyric video)
- [ ] Export in correct format for platform
- [ ] Thumbnail designed for click-through
- [ ] Title/description/tags optimized

---

## Resources — Added Aug 2026

- **VidTune (CHI'26)**: Contextual thumbnails for music review
- **SunoMV Workflow**: 6-stage pipeline (lyrics → shots → characters → scenes → camera → export)
- **SoundStager (CHI'26)**: Timeline-based sound design with scene grouping
- **Storyflow**: 4-pass storyboarding (concept → references → shot vision → frames)
- **Mimic Music Videos**: AI production planning guide
- **AIMusicVideoGenerators 2026-03-15**: 5 trends (real-time, music-native, bifurcation, 4K, multi-modal)
- **Wavespeed 2026-05-27 / ThunderCompute 2026-08-18**: Model landscape + Wan 2.2 MoE 5B fits 8GB
- **Shimga 2026-05-14**: Visualizer 2-5× over static (YouTube rec)
- **HookScores 2026-02-25 + OutlierKit 2026-02-10**: 3-layer algorithm, satisfaction > watch time
- **Blender 5.1/5.2 + SuperRenders + iRendering**: EEVEE Next rewrite, +10% GPU perf, backend selection

> Detailed synthesis: [[ai-video-trends-2026]]

---

*This knowledge library should be updated as new tools and techniques emerge.*

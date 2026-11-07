---
name: music-video-vision
description: >-
  Analyze rendered music-video frames with the local Ollama vision model
  using production-specific prompts (composition, lighting, color,
  beat-synced framing) — never generic "describe this image" prompts. Use
  after Blender/Unity renders, lyric-video checks, or shot-composition
  review. For generic UI/page screenshot analysis use
  vision-page-analysis instead.
---

> [!warning] CRITICAL: Do not send generic placeholder prompts to Ollama.
> Prompts like "describe this image" or "what is in this screenshot" produce
> non-actionable output. Always use the mode-specific prompts documented below
> or write a task-specific prompt that asks for concrete, prioritized fixes.

# Music Video Vision Analysis

> [!info] Purpose
> Analyze rendered frames, 3D scenes, and video stills specifically for music video production.
> Routes images through local Ollama vision model with music-video-specific prompts.

## When to use

- After rendering a frame from Blender/Unity and wanting feedback on composition
- Checking lighting quality and mood for a specific song section
- Verifying camera angles and framing for beat sync
- Analyzing color palette consistency across shots
- Getting feedback on 3D scene composition
- Checking text/subtitle placement in lyric videos

## Music Video Analysis Perspectives

### 🎬 Composition Analysis
Apply these rules when analyzing frames:

| Rule | Description | What to look for |
|------|-------------|------------------|
| Rule of Thirds | Subject should be on intersection points | Is the main subject centered or off-center? |
| Leading Lines | Lines should guide eye to subject | Are there natural lines directing attention? |
| Head Room | Space above subject's head | Is there appropriate head room? |
| Look Room | Space in front of subject's gaze | Is there room for the subject to "look into"? |
| Depth | Foreground, midground, background layers | Does the frame have depth? |

### 🎨 Lighting Analysis
| Aspect | Good | Bad |
|--------|------|-----|
| Key Light | Creates dimension, shadows add depth | Flat, no shadows / harsh, crushed shadows |
| Rim Light | Separates subject from background | No separation, subject blends in |
| Color Temperature | Consistent mood (warm=cool, cool=intense) | Mixed temperatures creating confusion |
| Exposure | Highlights and shadows balanced | Blown highlights or crushed blacks |

### 🎵 Beat Synchronization Visual Cues
| Song Section | Visual Treatment | Energy Level |
|--------------|------------------|--------------|
| Intro | Slow builds, wide shots, establishing | Low |
| Verse | Medium shots, narrative progression | Medium |
| Pre-Chorus | Building tension, closer shots | Medium-High |
| Chorus | Peak energy, close-ups, maximum impact | High |
| Bridge | Visual pivot, abstract/surprise | Variable |
| Outro | Wind down, defocus, fade | Low |

### 🎥 Camera Movement Guide
| Movement | Best For | Mood |
|----------|----------|------|
| Static | Calm moments, performance | Stable, grounded |
| Dolly In | Building intensity | Intimate, urgent |
| Dolly Out | Revelation, ending | Revealing, expansive |
| Pan | Reveal, follow action | Dynamic, exploratory |
| Orbit | Showcase, drama | Cinematic, dramatic |
| Handheld | Energy, documentary feel | Raw, authentic |
| Crane | Grand reveals, transitions | Epic, sweeping |

## Commands

### Basic Frame Analysis
```bash
node tools/vision/analyze.mjs <image_path> --mode music-video
```

### Section-Specific Analysis
```bash
# Analyze for a specific song section
node tools/vision/analyze.mjs <image_path> --section chorus --prompt "Is this frame high-energy enough for a chorus?"
```

### Comparison (Before/After)
```bash
node tools/vision/analyze.mjs frame_a.png frame_b.png --mode compare
```

### Batch Analysis (Consistency Check)
```bash
# Analyze multiple frames for consistency
node tools/vision/analyze.mjs frame_*.png --mode consistency
```

### Responsive/Format Check
```bash
# Check how frame looks on different platforms
node tools/vision/analyze.mjs <image_path> --mode responsive --viewport 1920x1080 --label "YouTube"
node tools/vision/analyze.mjs <image_path> --mode responsive --viewport 1080x1920 --label "Shorts"
```

## Prompt Templates

### Standard Music Video Frame Analysis
```
Analyze this music video frame for:
1. COMPOSITION: Is the subject well-framed? Apply rule of thirds. Is there depth?
2. LIGHTING: What is the mood created by lighting? Is it consistent with a [SECTION] section?
3. COLOR: What is the dominant color palette? Does it match the intended mood?
4. ENERGY: On a scale of 1-10, how energetic does this frame feel? Is that appropriate for a [SECTION]?
5. IMPACT: What is the strongest visual element? What draws the eye first?
6. ISSUES: What are the top 3 things that could be improved?
```

### Beat Sync Analysis
```
Analyze this frame for beat synchronization:
1. Does this frame feel like it lands on a strong beat?
2. Is there visual energy that matches a musical accent?
3. Would this frame work for a hard cut on a beat?
4. What camera movement would enhance the sync?
```

### Lyric Video Analysis
```
Analyze this lyric video frame:
1. Is the text readable at a glance?
2. Does the text overlap with the main subject?
3. Is the text animation smooth (if applicable)?
4. Is the font size appropriate for mobile viewing?
5. Does the text color contrast well with the background?
```

## Analysis Output Format

When analyzing frames, structure feedback as:

```
## Frame Analysis

### Composition: [Score]/10
[Feedback on framing, rule of thirds, depth]

### Lighting: [Score]/10
[Feedback on lighting quality, mood, consistency]

### Color: [Score]/10
[Feedback on palette, mood, consistency]

### Energy: [Score]/10
[Feedback on visual energy for the song section]

### Top 3 Improvements
1. [Most important fix]
2. [Second priority]
3. [Nice to have]

### Beat Sync Notes
[How well this frame would work for beat synchronization]
```

## See Also

- [[knowledge-library/music-video-production|Music Video Production Guide]]
- [[knowledge-library/prompt-engineering|Prompt Engineering]]
- [[knowledge-library/3d-rendering|3D Rendering]]
- [[knowledge-library/blender-mcp|Blender MCP Integration]]
- [[knowledge-library/youtube-optimization|YouTube Optimization]]

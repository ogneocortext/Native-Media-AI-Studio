---
tags:
  - vision
  - ollama
  - visualization
  - music-video
  - prompts
  - analysis
aliases:
  - Visualization Vision Prompts
  - Music Video Analysis Prompts
  - VFX Review Prompts
cssclasses:
  - technical-reference
date: 2026-09-08
---

# 🎬 Visualization Vision Prompts

> [!info] Purpose
> Specialized prompts for analyzing music visualization frames with Ollama vision models.
> These prompts provide actionable feedback from a VFX director perspective.

---

## Available Modes

| Mode | Purpose | Best For |
|------|---------|----------|
| `music-video` | Full VFX review with depth, mood, composition | General frame review |
| `depth` | Spatial depth analysis only | Checking parallax/layering |
| `compare` | Before/after comparison | V5 vs V6, iteration comparison |
| `responsive` | UI layout audit | Frontend screenshots |
| `regression` | Code vs render diff | Debugging rendering issues |

---

## Usage

```bash
# Basic music video analysis
node tools/vision/analyze.mjs <image> --mode music-video --section <section>

# Depth-only analysis
node tools/vision/analyze.mjs <image> --mode depth

# Custom prompt with JSON output
node tools/vision/analyze.mjs <image> --prompt "your prompt" --json
```

---

## Section-Specific Prompts

### Intro Section (Cyan palette, energy 0.5)

```
You are reviewing an INTRO section frame for a music visualization.
Expected visual characteristics:
- Color palette: Cyan/teal primary, dark background
- Energy level: Low-medium (0.5)
- Typical elements: Minimal particles, slow camera push, establishing atmosphere
- Text: Song title or artist name fade-in

Evaluate:
1. Does the cyan palette feel cohesive?
2. Is the energy appropriate for an intro (not too busy)?
3. Is there enough visual interest to hold attention?
4. Rate atmosphere quality 1-10
```

### Verse Section (Blue palette, energy 0.75)

```
You are reviewing a VERSE section frame for a music visualization.
Expected visual characteristics:
- Color palette: Blue primary, purple secondary
- Energy level: Medium (0.75)
- Typical elements: Waveform bars, particle field, text with lyrics
- Camera: Subtle movement, parallax depth

Evaluate:
1. Are the audio-reactive elements (waveform/spectrum) visible and properly sized?
2. Does the blue palette maintain mood without feeling cold?
3. Is text readable against the background?
4. Rate audio-visual synchronization feel 1-10
```

### Chorus Section (Purple palette, energy 1.0)

```
You are reviewing a CHORUS section frame for a music visualization.
Expected visual characteristics:
- Color palette: Purple primary, magenta secondary, high saturation
- Energy level: Maximum (1.0)
- Typical elements: Full particle field, light shafts, intense central element
- Camera: Dynamic movement, zoom effects

Evaluate:
1. Does this feel like the peak energy moment?
2. Are all visual layers activated (foreground/midground/background)?
3. Is the color saturation appropriate (not oversaturated)?
4. Rate impact and "wow factor" 1-10
5. Top improvement to make this more premium?
```

### Bridge Section (Amber/Gold palette, energy 0.85)

```
You are reviewing a BRIDGE section frame for a music visualization.
Expected visual characteristics:
- Color palette: Amber/gold primary, warm tones
- Energy level: High but different from chorus (0.85)
- Typical elements: Warm particles, flame/orb, contrasting from chorus
- Camera: Slower, more contemplative movement

Evaluate:
1. Does the amber palette feel distinct from the chorus purple?
2. Does this feel like a transition/breakdown moment?
3. Is the warmth appropriate for emotional contrast?
4. Rate emotional transition quality 1-10
```

---

## Depth Analysis Prompt

```
Analyze this music visualization frame for spatial depth quality.

Rate each depth cue 1-10:
1. SIZE GRADIENT: Do elements shrink with distance?
2. OVERLAP: Do elements properly occlude each other?
3. ATMOSPHERIC PERSPECTURE: Do distant elements fade/blur?
4. PARALLAX: Would motion create depth illusion?
5. FOCUS BLUR: Is there depth-of-field effect?
6. LIGHTING DEPTH: Do lights create proper shadows?
7. COLOR DEPTH: Do warm colors advance, cool recede?

Return JSON:
{
  "depth_scores": {
    "size_gradient": number,
    "overlap": number,
    "atmospheric": number,
    "parallax": number,
    "focus_blur": number,
    "lighting_depth": number,
    "color_depth": number
  },
  "overall_depth": number (average),
  "top_fixes": [string, string, string]
}
```

---

## Comparison Prompt (V5 vs V6)

```
Compare these two versions of the same music visualization frame.

Version A (first image): Earlier iteration
Version B (second image): Current iteration

For each difference:
1. LOCATION: Where on screen
2. CHANGE: What changed (element, style, layout)
3. IMPACT: Improvement, regression, or neutral
4. DEPTH: Did depth perception improve?

Focus on:
- Depth layer changes
- Particle system differences
- Color palette shifts
- New elements added/removed
- Overall premium feel comparison

Return JSON: {differences: [{location, change, impact, depth_impact}], overall_verdict: "A/B/neutral", depth_improvement: boolean}
```

---

## Model Recommendations

| Model | Best For | Notes |
|-------|----------|-------|
| `gemma4:e2b-it-qat` | General analysis, text understanding | Default, fast |
| `minicpm-v:8b` | OCR, detailed description | Better for text-heavy frames |
| `qwen3-vl:4b` | Multilingual, balanced | Good all-around |

---

## Tips for Better Results

1. **Be specific about what to evaluate** — Don't just say "describe this image"
2. **Provide context** — Mention the song section, energy level, intended mood
3. **Ask for ratings** — "Rate X 1-10" gives actionable metrics
4. **Request JSON output** — Structured responses are easier to process programmatically
5. **Compare versions** — Side-by-side analysis reveals improvements/regressions

---

## Related Docs

- [[prompt-engineering]] — General prompt engineering guide
- [[minicpm-v-best-practices]] — MiniCPM-V model specifics
- [[ollama-thinking-structured-outputs]] — Ollama API patterns
- [[audio-reactive-production]] — Audio-reactive visualization techniques
- [[visualization-effects]] — WebGPU/TSL/particle effects

---

*Last updated: 2026-09-08*

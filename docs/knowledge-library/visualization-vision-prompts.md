---
tags:
  - creative
  - visualization
  - ai
aliases:
  - Visualization Vision Prompts
  - Music Video Analysis Prompts
  - VFX Review Prompts
cssclasses:
  - creative-guide
date: 2026-10-24
type: source
---

# 🎬 Visualization Vision Prompts

> [!info] Purpose
> Specialized prompts for analyzing music visualization frames and UI screenshots
> with local vision models. Two prompt families exist — one tuned for **gemma4**'
> s native JSON output (concise, element-focused audits), one tuned for
> **qwen3.5**'s hybrid-thinking reasoning (detailed spatial/UX breakdowns).
> Prompts live in `tools/vision/prompts/` (`gemma4-ui.mjs`, `qwen35-ui.mjs`)
> and are wired through `tools/vision/analyze.mjs`.

---

## Prompt Families

| Family | Model | Best For | Output Format | Thinking |
|--------|-------|----------|---------------|----------|
| `gemma4-ui` | `gemma4:e2b-it-qat` | UI element ID, layout, color, typography, fast audits | JSON (`format: "json"`) | Off |
| `qwen35-ui` | `qwen3.5` (via Atomic Chat port 1337) | Complex reasoning, spatial analysis, compare/regression | Structured text | On |

### Gemma 4 Prompts (`tools/vision/prompts/gemma4-ui.mjs`)

Gemma 4 strengths: native multimodal vision, native JSON structured output,
variable resolution budgets, control tokens (`<|turn>`, `<|system>`). Do's:
be specific, name regions, provide constraints. Don't: vague "analyze this",
expect exact counts for dense objects.

Prompt structure (four layers from vision research):
1. **Locate** — region/subject to inspect
2. **Task** — concrete verb-led job
3. **Steps** — ordered observe→describe→reason→conclude
4. **Output** — structured JSON with named fields

Named heuristics (checkable rules, not taste): 8pt grid spacing, WCAG 4.5:1
contrast, line-height multiples of 4px, internal padding <= external margin.

Modes: `ui`, `responsive`, `regression`, `compare`, `ocr`, `table`, `chart`.

Example:
```bash
node tools/vision/analyze.mjs  --mode ui --backend ollama --model gemma4:e2b-it-qat --json
```

### Qwen3.5 Prompts (`tools/vision/prompts/qwen35-ui.mjs`)

Qwen3.5 strengths: hybrid-thinking (reasoning before answer), spatial reasoning,
GUI grounding, computer use, detailed visual reasoning. Do's: enable thinking
for detailed UX breakdown, output structured text sections (not JSON — JSON is
not supported when thinking is on), use think-then-act: observe whole screen,
then drill into regions.

Modes: `ui`, `responsive`, `regression`, `compare`, `ocr`, `chart`, `music-video`, `depth`, `consistency`.

Example:
```bash
node tools/vision/analyze.mjs  --mode compare --backend atomic --model unsloth/Qwen3_5-4B-GGUF-Qwen3_5-4B-Q4_K_M
```

---

## Available Modes

| Mode | Purpose | Primary Model | Best For |
|------|---------|---------------|----------|
| `ui` | Full UI/UX audit | gemma4 | Detailed UI audits |
| `responsive` | UI layout audit | gemma4 | Layout issues, touch targets |
| `regression` | Code vs render diff | qwen3.5 | Debugging rendering issues |
| `compare` | Before/after comparison | qwen3.5 | V5 vs V6, iteration comparison |
| `multicomp` | Multi-image diff | qwen3.5 | Multi-image sets |
| `ocr` | Deterministic transcription | gemma4 | OCR, table-to-markdown |
| `table` | Table extraction | gemma4 | Deterministic extraction |
| `chart` | Chart trend analysis | gemma4 | Deterministic extraction |
| `music-video` | Frame analysis | qwen3.5 | Music visualization frames |
| `depth` | Spatial depth analysis | qwen3.5 | Checking parallax/layering |
| `consistency` | Design system audit | qwen3.5 | Visual consistency across frames |

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

| Model | Backend | Best For | Notes |
|-------|---------|----------|-------|
| `gemma4:e2b-it-qat` | Ollama (11434) | General analysis, text understanding, fast audits | Default vision model; native JSON output |
| `qwen3.5:4b` | Atomic Chat (1337) | Complex reasoning, spatial analysis, compare/regression | Hybrid thinking; structured text output |
| `minicpm-v:8b` | Ollama (11434) | OCR, detailed description | Better for text-heavy frames |

---

## Tips for Better Results

1. **Match the model to the task** — gemma4 for fast element audits (JSON output); qwen3.5 for complex reasoning (structured text).
2. **Be specific about what to evaluate** — Don't just say "describe this image"
3. **Provide context** — Mention the song section, energy level, intended mood
4. **Ask for ratings** — "Rate X 1-10" gives actionable metrics
5. **Request JSON output** — Structured responses are easier to process programmatically (gemma4 only)
6. **Compare versions** — Side-by-side analysis reveals improvements/regressions (qwen3.5)
7. **Append grounding suffix** — "Describe only what is actually visible. Do not infer beyond the pixels."

---

## Related Docs

- [[ollama-utilization-2026]] — Ollama model routing, VRAM-aware scheduling
- [[vision-model-reliability-2026]] — qwen3-vl reasoning loop, gemma4 primary, 2026-10-10 pruning
- [[ollama-thinking-structured-outputs]] — Ollama API patterns, thinking mode
- [[prompt-engineering]] — General prompt engineering guide
- [[audio-reactive-production]] — Audio-reactive visualization techniques
- [[visualization-effects]] — WebGPU/TSL/particle effects

---

*Last updated: 2026-10-24*

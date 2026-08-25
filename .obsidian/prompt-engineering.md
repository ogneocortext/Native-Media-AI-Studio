---
tags:
  - prompt-engineering
  - ai-generation
  - music-video
  - best-practices
aliases:
  - Prompt Engineering Guide
  - AI Prompt Guide
  - Generation Prompts
cssclasses:
  - guide
date: 2026-08-24
---

# ✍️ Prompt Engineering

> [!info] Scope
> Effective prompts for AI music video generation.
> Covers text-to-image, text-to-video, and 3D model generation.

---

## Prompt Structure

### Universal Formula

```
[Shot Size] + [Camera Angle] + [Subject] + [Action] + [Setting] + [Lighting] + [Mood] + [Style]
```

> [!example] Complete Prompt
> `Medium shot, eye-level angle, a joyful shrimp character dancing, underwater disco club, colorful neon lighting, energetic and fun, cinematic 35mm film`

---

## By Music Genre

### 🎉 Happy / Upbeat

**Keywords:** `upbeat`, `bright`, `colorful`, `energetic`, `joyful`, `vibrant`, `sunny`, `celebration`

**Examples:**
```
"A happy shrimp dancing in an underwater party, colorful coral reef, 
bright sunlight filtering through water, bubbles and confetti, 
joyful atmosphere, vibrant colors, cinematic 4k"

"Upbeat music festival, colorful lights, crowd silhouettes, 
neon confetti, energetic atmosphere, wide angle lens, 
golden hour lighting, 35mm film grain"
```

### 🌊 Calm / Chill

**Keywords:** `peaceful`, `serene`, `soft`, `gentle`, `relaxing`, `ambient`, `dreamy`, `ethereal`

**Examples:**
```
"Serene underwater scene, gentle currents, soft blue lighting, 
a shrimp floating peacefully, ethereal atmosphere, 
slow motion feel, shallow depth of field"

"Dreamy sunset over calm ocean, soft pastel colors, 
gentle waves, peaceful atmosphere, anamorphic lens flare, 
cinematic 24fps"
```

### 🌑 Dark / Moody

**Keywords:** `moody`, `atmospheric`, `cinematic`, `dramatic`, `intense`, `mysterious`, `noir`

**Examples:**
```
"Dark moody underwater scene, a shrimp silhouette against 
deep blue abyss, single spotlight, cinematic noir lighting, 
dramatic shadows, 35mm film"

"Stormy ocean surface, dark clouds, lightning in background, 
dramatic atmosphere, high contrast, cinematic color grading, 
teal and orange palette"
```

### 🤖 Electronic / Synthwave

**Keywords:** `neon`, `futuristic`, `cyberpunk`, `glitch`, `synth`, `digital`, `retrowave`

**Examples:**
```
"Cyberpunk underwater city, neon lights reflecting off 
futuristic buildings, a shrimp with cybernetic enhancements, 
synthwave color palette, pink and cyan lighting, digital art"

"Retro 80s music video aesthetic, neon grid floor, 
chrome surfaces, laser lights, a shrimp DJ performing, 
synthwave atmosphere, VHS tape grain"
```

### 🌿 Natural / Organic

**Keywords:** `organic`, `earthy`, `warm`, `sunset`, `nature`, `flowing`, `botanical`

**Examples:**
```
"Underwater garden, bioluminescent plants, a shrimp exploring 
coral formations, natural sunlight rays, warm golden tones, 
National Garden photography style"

"Tropical ocean reef, vibrant coral ecosystem, a shrimp 
swimming among sea turtles, natural lighting, National 
Geographic documentary style, 4k detail"
```

---

## Camera Language

### Shot Sizes

| Shot Size | Description | Emotional Effect | Use Case |
|-----------|-------------|------------------|----------|
| EWS (Extreme Wide) | Subject tiny in environment | Isolation, scale | Establishing shots |
| WS (Wide) | Full subject + surroundings | Context, grandeur | Scene setting |
| MS (Medium) | Subject from waist up | Connection, emotion | Dialogue, performance |
| CU (Close-up) | Face or object detail | Intensity, importance | Emotional moments |
| ECU (Extreme Close-up) | Eyes, hands, objects | Drama, intimacy | Dramatic emphasis |

### Camera Angles

| Angle | Description | Effect |
|-------|-------------|--------|
| Eye Level | Camera at subject height | Neutral, relatable |
| Low Angle | Camera below subject looking up | Power, dominance |
| High Angle | Camera above subject looking down | Vulnerability, overview |
| Bird's Eye | Camera directly above | God's view, pattern |
| Dutch Angle | Camera tilted | Tension, unease |

### Camera Movement

| Movement | Description | When to Use |
|----------|-------------|-------------|
| Static | No movement | Calm moments, performance |
| Dolly In | Camera moves toward subject | Building intensity |
| Dolly Out | Camera moves away | Revelation, ending |
| Pan | Camera rotates horizontally | Reveal, follow action |
| Tilt | Camera rotates vertically | Reveal scale |
| Tracking | Camera follows subject | Action, movement |
| Orbit | Camera circles subject | Showcase, drama |
| Crane | Camera moves up/down | Grand reveals, transitions |

---

## Prompt Quality Checklist

- [ ] **Shot size specified** — `medium shot`, `close-up`, `wide angle`
- [ ] **Camera angle specified** — `eye-level`, `low angle`, `bird's eye`
- [ ] **Subject clearly described** — Who/what is in the frame
- [ ] **Action/posing described** — What the subject is doing
- [ ] **Setting/location defined** — Where the scene takes place
- [ ] **Lighting described** — `golden hour`, `neon`, `soft ambient`
- [ ] **Mood/emotion conveyed** — `energetic`, `peaceful`, `dramatic`
- [ ] **Style reference** — `cinematic`, `35mm film`, `anime`, `photorealistic`
- [ ] **Present tense verbs** — `dancing` not `danced`
- [ ] **Single flowing paragraph** — No bullet points in final prompt
- [ ] **Detail matches shot scale** — Close-ups need more detail

---

## Negative Prompts

### Universal Negative Prompt

> [!tip] Standard Negative
> Use this as a baseline for all generations:

```
blurry, low quality, distorted, deformed, ugly, bad anatomy, 
bad proportions, extra limbs, disfigured, poorly drawn face, 
mutation, mutated, watermark, text, signature, out of frame, 
oversaturated, underexposed, overexposed, grainy, noisy
```

### Genre-Specific Negatives

| Genre | Additional Negatives |
|-------|---------------------|
| Happy | `dark`, `gloomy`, `sad`, `depressing` |
| Electronic | `organic`, `natural`, `rustic`, `vintage` |
| Natural | `artificial`, `synthetic`, `digital`, `CGI` |
| Dark | `bright`, `cheerful`, `colorful`, `happy` |

---

## Common Mistakes

> [!warning] Avoid These

| Mistake | Why It Fails | Fix |
|---------|--------------|-----|
| Generic adjectives | "beautiful", "atmospheric" give AI no direction | Use specific descriptions |
| No shot size | AI doesn't know framing | Add `medium shot` or `close-up` |
| Too many subjects | AI gets confused | One main subject per shot |
| Inconsistent style | Mixing `anime` and `photorealistic` | Pick one style and stick with it |
| Past tense | "the shrimp danced" | Use present tense: "the shrimp dancing" |
| Too long | 200+ word prompts get diluted | Keep under 75 words for most models |

---

## Advanced Techniques

### Weighted Prompts

> [!note] Emphasis
> Use `(word:1.3)` to increase importance or `(word:0.7)` to decrease:

```
a joyful shrimp (dancing:1.3), underwater disco club, 
(colorful neon lighting:1.2), (energetic:1.1), 
cinematic 35mm film, 4k detail
```

### Style Anchoring

> [!tip] Reference Styles
> Start with a style reference for consistency:

```
[in the style of Spider-Verse], a shrimp character swinging 
through a neon city, comic book aesthetic, bold outlines, 
vibrant colors, dynamic action pose
```

```
[in the style of Studio Ghibli], a peaceful shrimp floating 
through an underwater forest, soft pastel colors, hand-drawn 
aesthetic, gentle lighting, dreamy atmosphere
```

### Seed Locking

> [!important] Reproducibility
> Use the same seed to reproduce similar results across generations:

```python
# Good seed for happy shrimp character
seed = 42

# Generate variations with same seed but different prompts
# This maintains character consistency
```

---

## Character Consistency

> [!tip] Maintain Character Identity
> For a recurring character (like your happy shrimp):

1. **Create a character bible** with detailed description
2. **Use reference images** for face lock
3. **Include character name** in every prompt
4. **Lock seed** for similar starting points
5. **Use same base prompt structure** across shots

**Example Character Bible:**
```
Character: "Happy Shrimp"
- Species: Cartoon shrimp
- Color: Bright orange with pink accents
- Expression: Big smile, sparkly eyes
- Outfit: Tiny sunglasses, Hawaiian shirt
- Personality: Energetic, friendly, dance-loving
- Signature move: The "shrimp shuffle" dance
```

---

## See Also

- [[music-video-production]] — Full production workflow
- [[3d-rendering]] — 3D model generation prompts
- [[comfyui-workflows]] — ComfyUI-specific prompting
- [[youtube-optimization]] — Title/description optimization

---

*Last updated: 2026-08-24*

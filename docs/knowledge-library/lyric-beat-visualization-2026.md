# Code-Driven Lyric + Beat Visualization — Research & Best Practices

> **Source:** Web research + repo audit (2026-09-08)
> **Purpose:** Actionable patterns for building HyperFrames / HTML-composition lyric videos
> that are beat-synced, deterministic, and driven by pre-extracted audio + LRC data.

---

## 1. Core Architecture Principles

### 1.1 Pre-extract everything. Never analyze at render time.
- **Why:** HyperFrames / deterministic renderers replay frames by seeking the timeline.
  `AudioContext`, `fetch()`, or `Math.random()` during render = non-deterministic output.
- **What to pre-extract:**
  - `beat_times` (seconds) + `bpm` + `duration`
  - `keyframes` = `[round(t * fps) for t in beat_times]`
  - Per-frame RMS energy curve (60–300 points normalized 0–1)
  - Frequency band energies (8–16 bands: sub-bass, bass, low-mid, mid, upper-mid, presence, brilliance, air)
  - Onset strength curve (for vocal / lyric line detection if LRC is missing)
- **Repo tools that already do this:**
  - `tools/analyze_and_sync.py` → `tools/lib/audio.py` → `beat_data.json`
  - `packages/backend/app/services/audio_analyzer.py` → `AudioAnalysisResult`
  - `extract_amplitude_envelope_simple()` → 60-point envelope

### 1.2 Data contracts (what the composition reads)

```json
{
  "tempo": 143.6,
  "duration": 218.76,
  "fps": 24,
  "beat_times": [8.429, 8.847, ...],
  "keyframes": [202, 212, ...],
  "energy_curve": [ { "time": 0.0, "value": 0.42 }, ... ],
  "bands_per_frame": [ { "time": 0.0, "bands": [0.8, 0.6, ...] }, ... ],
  "lyrics": [
    { "start": 5.72, "end": 11.68, "text": "Blue light's the only thing still awake in here", "section": "intro" },
    { "start": 33.28, "end": 57.80, "text": "Started this thing back when the leaves were green", "section": "verse" }
  ]
}
```

---

## 2. Lyric Sync Strategies

### 2.1 LRC Parsing
```js
function parseLRC(lrc) {
  const lines = lrc.split("\n");
  const result = [];
  const timeRegex = /^\[(\d+):(\d+\.\d+)\](.*)/;
  for (const line of lines) {
    const match = timeRegex.exec(line);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseFloat(match[2]);
      const text = match[3].trim();
      if (text) {
        result.push({ time: minutes * 60 + seconds, text });
      }
    }
  }
  return result;
}
```

### 2.2 Lyric Timing → GSAP
- **Line-level sync:** Place each lyric line at its LRC timestamp using `tl.to()` / `tl.set()`.
- **Word-level karaoke:** Split line into words; animate `opacity` / `scale` per word using
  `tl.call()` inside a loop over the line's duration.
- **Active line highlight:** Use binary search (O(log n)) to find the current lyric at render time,
  or pre-build the timeline so each word's animation is absolute-time keyed.

### 2.3 Karaoke Highlight Baseline (from HyperFrames skill research)
| Energy | Highlight | Exit | Cycle |
|--------|-----------|------|-------|
| High | Accent color + glow + 15% scale pop | Scatter / drop | Alternate every 2 groups |
| Medium | Karaoke (subtle white) | Fade + slide | Alternate every 3 |
| Low | Warm tones, slow transition | Collapse | Alternate every 4 |

**Rules:**
- All levels use karaoke as baseline; only intensity changes.
- Emphasis words (keywords, ALL CAPS) break the pattern with stronger animation.
- Never strobing white on beats; never rainbow cycling.
- 3–6% scale variation for text; 10–30% for backgrounds/shapes.

---

## 3. Beat-Driven Visuals

### 3.1 Audio → Visual Mapping
| Audio Signal | Visual Property | Effect |
|--------------|-----------------|--------|
| Bass (bands[0–1]) | `scale`, `translateY` | Pulse on beat |
| Treble (bands[6–7]) | `textShadow`, `boxShadow` | Glow intensity |
| RMS / overall amplitude | `opacity`, `backgroundColor` | Breathe, lift |
| Mid (bands[4–8]) | `borderRadius`, `width` | Shape morphing |

### 3.2 Beat Pulse Implementation (GSAP)
```js
// Per-frame sampling — REQUIRED for true audio reactivity
for (let f = 0; f < AUDIO.frames.length; f++) {
  tl.call(
    (function (frame) {
      return function () {
        const bass = frame.bands[0];
        el.style.transform = `scale(${1 + bass * 0.15})`;
      };
    })(AUDIO.frames[f]),
    [],
    f / AUDIO.fps
  );
}
```

**Anti-pattern:** Single `gsap.to(el, { scale: 1.2, duration: totalDuration })` — this does NOT react to audio.

### 3.3 Beat Grid from `beat_data.json`
```js
const BEATS = beatData.beat_times;
const BPM = beatData.tempo;
const DURATION = beatData.duration;

// Build a GSAP timeline with labels at each beat
const tl = gsap.timeline({ paused: true });
BEATS.forEach((t, i) => {
  tl.addLabel(`beat${i}`, t);
  tl.call(() => onBeat(i), [], `beat${i}`);
});
```

---

## 4. HyperFrames-Specific Patterns

### 4.1 Composition Contract
```html
<div id="root"
     data-composition-id="built-this-from-a-dream"
     data-width="1920"
     data-height="1080"
     data-duration="218.76"
     data-fps="24">
  <!-- lyrics, visuals, audio -->
</div>
<script>
  window.__timelines = window.__timelines || {};
  window.__timelines["built-this-from-a-dream"] = tl;
</script>
```

### 4.2 Audio Data Loading (Deterministic)
```js
// Inline the data (no fetch())
const AUDIO = {
  fps: 24,
  duration: 218.76,
  tempo: 143.6,
  beats: [8.429, 8.847, /* ... */],
  frames: [
    { time: 0.0, bands: [0.82, 0.71, 0.55, 0.42, 0.30, 0.22, 0.15, 0.10] },
    /* ... one entry per frame ... */
  ]
};
```

### 4.3 Text Glow Fix (from research)
`textShadow` on a parent container with semi-transparent children renders a visible glow
rectangle behind **all** children. Fix: apply `scale` to the container for beat pulse,
but apply `textShadow` to individual active words only.

---

## 5. Section / Energy-Aware Styling

### 5.1 Detect Sections from LRC Markers
```js
const SECTION_MARKERS = {
  "intro":   { color: "#4a9eff", glow: "#0066ff", intensity: 0.6 },
  "verse":   { color: "#00ffcc", glow: "#00aa88", intensity: 0.8 },
  "chorus":  { color: "#ff6600", glow: "#ff3300", intensity: 1.4 },
  "bridge":  { color: "#aa66ff", glow: "#6600cc", intensity: 1.0 },
  "drop":    { color: "#ff0066", glow: "#ff0044", intensity: 1.6 },
};
```
- Map each LRC line to a section by nearest section marker timestamp.
- Use section palette for background, glow, and accent colors.
- Modulate intensity by section energy (from `energy_curve` average over section span).

### 5.2 Ken Burns / Camera Movement
- **Verse:** slow drift (`camSpeed = 0.04`)
- **Chorus:** faster push-in (`camSpeed = 0.08`) + shake
- **Bridge:** intimate close-up (`camSpeed = 0.02`)
- Parallax offset driven by bass energy.

---

## 6. Common Pitfalls & Fixes

| Pitfall | Fix |
|---------|-----|
| Lyrics drift by 200ms on 48 kHz files | Use `librosa.load(sr=None)` — native sample rate |
| Detected BPM is 2× actual on rap/hi-hats | Use autocorrelation beat tracker, not interval median |
| Beat lands on peak, not attack | Use `backtrack=True` in librosa beat tracker |
| Lyrics off on calm/ballad tracks | Pace by phrase + energy, not hard beat grid |
| `textShadow` glow bleeds across all lyrics | Apply glow to active word spans only |
| Async `fetch()` breaks timeline | Inline all data or build timeline synchronously |
| Infinite GSAP `repeat: -1` without duration | Always set finite `data-duration` on root div |
| DOM bloat with 500+ beats | Use Canvas for per-beat rendering; limit DOM nodes to < 20 |

---

## 7. Toolchain References

- **Librosa beat tracking:** `librosa.beat.beat_track(y, sr, hop_length=512, backtrack=True)`
- **Energy envelope:** `librosa.feature.rms(y, hop_length=512)` → normalize 0–1
- **Spectral features:** `librosa.feature.spectral_centroid`, `rolloff`, `bandwidth`
- **HyperFrames CLI:** `npx hyperframes lint`, `npx hyperframes render --fps 24 --quality draft`
- **GSAP timeline:** `gsap.timeline({ paused: true, defaults: { duration: 0.5, ease: "power2.out" } })`
- **Position parameter:** `"-=0.3"` overlap, `"<"` parallel with previous, `0` absolute

---

## 8. Suggested Composition Structure for "Built This From A Dream"

1. **Background layer:** deep radial gradient + slow-moving aurora curtains driven by bass.
2. **Beat flash layer:** full-screen radial flash on every beat onset; bigger on downbeats.
3. **Lyric layer:** karaoke word-by-word reveal; active line centered; inactive lines dimmed.
4. **Central visual:** orb / flame / geometric shape that pulses with beat + scales with energy.
5. **Particle field:** 30–60 particles; direction/speed modulated by section (rise = up, rain = down).
6. **Spectrum bars:** 48-bar vertical spectrum at bottom; hue mapped across frequency range.
7. **Vignette + scanlines:** subtle film-grain overlay for cinematic feel.

**Section map from LRC:**
- `00:05.72` Intro
- `00:33.28` Verse
- `01:37.80` Verse
- `02:17.92` Drop
- `02:57.16` Final Drop

# Storyboard System — LRC-Driven Visual Narrative

> Implemented 2026-09-03. Code: `packages/frontend/src/features/visualizer/storyboard.ts`, `components/StoryActCard.tsx`. Verified with the capture harness (see §5).

## 1. What it is

`buildStoryboard(trackName, lyrics, analysis)` turns lyric sections + CUDA energy into a time-indexed shot list (narrative acts). `getStoryState(board, elapsed)` is a pure O(log n) lookup safe to call per frame. For *Built This From A Dream* it produces a real arc — ISOLATION → THE BUILD → ASCENT → IGNITION → ARRIVAL (artifact: `output/viztest/storyboard.built-this.json`).

## 2. Design rules that matter

- **LRC tags are authored truth.** CUDA `sections` are fallback only — they mislabel (e.g. five straight "chorus" spans where the LRC marks verses and drops).
- **Shots split on section change AND long instrumental gaps** (>8 s inside a >30 s run). A 12 s hole is an editorial cut in disguise; this is what separates verse 1 from verse 2 here.
- **Keyword voting is position-gated** (setup → confrontation → resolution thirds). Background refrains ("watch it grow" inside verse 1) must not trigger premature climaxes.
- **Back-to-back motif repeats escalate** (assembly → ascent) instead of stalling on duplicate titles.
- **Moods are contrast-stretched per track.** Raw analysis energy is compressed (this track: 0.15–0.39 across the whole arc); beat moods are min-max normalized to 0.05–0.95 or every act plays at one intensity.

## 3. Consumers (storytelling grammar)

| Consumer | Behavior |
|----------|----------|
| `StoryActCard` | Cinematic title card + lyric hook, first 2.8 s of each act |
| Letterbox bars (`globals.css`) | Slide in on `cinematic` beats (drops/payoffs/triumphs) — aspect change as act punctuation |
| `LrcVizController` | Act mood lifts intensity ±0.25; palette lerps 35% toward act color; orbital drift follows act camera hint |
| `__VIZ_TEST__.getState().storyboard` | Full board export for review tooling |

## 4. Timing architecture (fixed 2026-09-03)

All timed lookups go through the interpolated, latency-compensated clock (`audioTiming.ts`) — never raw `currentTime` (coarse 50–250 ms ticks, no output-latency compensation). Per-frame consumers read live refs, not React state:

- `liveAudioDataRef` — full-rate audio bands/beat; React mirror throttled to 10 Hz for DOM only.
- `lrcSyncLiveRef` / scene-local `lrcSyncLiveRef` — per-frame LRC (the 150 ms phrase window is invisible at state-update rates).
- `storyLiveRef` — per-frame storyboard beat.

## 5. Bugs found by the capture harness (all fixed, all measured)

| Bug | Symptom | Fix | Measurement |
|-----|---------|-----|-------------|
| ShaderCanvas loop death | Render effect lacked `fragmentShader` dep; init effect cancelled the loop on every preset change → canvas frozen forever after track select | Added dep + blank-name preset fallback | Inter-frame diff 0.00 → 45.12 |
| Single-frame `u_beat` | Beat flag lives ~16 ms; 0.15 flash invisible | Decayed ~8-frame pulse, 0.55 flash, bass/beat amp pumping | Brightness range 0.0 → 77.5 on beat grid |
| Double smoothing | Analyser 0.8 + attack/release stacked ~100–200 ms trail | Analyser 0.55, attack 0.7/release 0.2, shared constants | Beat-peak alignment ±50 ms vs CUDA grid |

## 6. Capture harness (methodology notes — read before trusting captures)

- `packages/frontend/browser-test/capture-viz-timing.mjs` — headed Chromium + autoplay flag, verified playback (`currentTime` advancing), verified seeks (±1.5 s retry), full-page screenshot cropped per-frame to the canvas box, overlay chrome hidden.
- **Element screenshots of non-preserved WebGL canvases return STALE bitmaps.** Always full-page + crop.
- **`audio.play()` resolves before media loads.** Wait for `currentTime > 0.5` and verify seeks land, or bursts capture silence.
- **Vision-model frame comparisons hallucinate on near-identical inputs.** Cross-check motion claims with pixel stats (sharp resize → raw → mean/inter-frame diff) or 64-wide ASCII renders; use vision for content/aesthetics, not diffs.
- Beat flags in capture logs are 10 Hz state samples — they miss most beats. Correlate brightness peaks against CUDA `beat_times` instead.

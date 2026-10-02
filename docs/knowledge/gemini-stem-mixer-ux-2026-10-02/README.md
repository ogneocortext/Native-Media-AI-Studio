# Stem Mixer UX — Gemini Research Handoff (2026-10-02)

**For the implementing agent:** this is UX design guidance, not DSP guidance.
The DSP side (Demucs extraction, vocal chain settings) was already decided
in `docs/knowledge/gemini-tutorial-guidance-2026-09-30/` — do not re-derive it.
Build on it.

## Provenance

- Source: Gemini 3.8 Flash (`gemini-3.8-flash`), free tier, via Google AI Studio
- Date: 2026-10-02. Chat: https://aistudio.google.com/prompts/1WOfsC4mkGWgxTtq1HBKC4SknPC0QLusS
- Two prompts in one chat: (1) minimalist stem-mixer UX for 4 Suno-extracted
  stems, (2) follow-up extending scope to ALL tracks in the media library
  (mixed sources, only 4 tracks have stems so far).
- Status: guidance to evaluate and validate, not verified implementation.
  Treat performance numbers (Demucs ~40–60 s/track, ~3 GB VRAM) as estimates
  to confirm on the local GTX 1070 Ti.

## Why this exists

A previous stem-mixer implementation attempt produced a lot of new code but
a confusing frontend that was hard to utilize. It failed on UX, not audio.
This brief exists to constrain the rebuild: **≤12 interactive elements on
the mixer screen, total.** If a design exceeds that, it has failed the brief.

## Response 1 — Minimalist mixer (11 controls)

### Per-stem controls: exactly 2 per stem (8 total)

1. **Volume fader** (vertical slider, −24 dB to +6 dB, snap at 0 dB) —
   rebalancing levels is the entire user goal; one gesture does it.
2. **Mute/isolate** (clickable stem avatar icon) — instant zeroing for
   karaoke/instrumental checks without losing fader position.

### Deliberately left OUT

- **Pan knobs** — Suno stems already carry artificial stereo imaging;
  panning extracted stems causes phase cancellation/comb filtering.
- **Parametric EQ** — non-engineers notch out fundamentals by mistake and
  hollow the mix.
- **Compressor knobs** — Suno tracks are already brickwall-compressed;
  user compression just distorts.
- **Reverb/delay sends** — extracted Suno vocals already contain heavy
  pseudo-reverb; more reverb compounds mud.
- **Solo buttons** — latched multi-solo states confuse non-engineers and
  deaden audio; mute covers the need with zero ambiguous state.

### Default state (must sound better than raw Suno with zero input)

| Stem | Default |
|---|---|
| Vocals | +1.5 dB (Suno vocals sit submerged) |
| Drums | 0.0 dB (transient anchor) |
| Bass | −0.5 dB (tames Suno low-end mud) |
| Other | −1.5 dB (holds most Demucs swirl/noise) |

Backend (transparent, no UI): True-Peak brickwall limiter at −1.0 dBFS,
playback target −14 LUFS, so slider boosts can't clip.

### Progressive disclosure: there is none

No "Advanced" drawer. Instead, one **3-way segmented preset pill** that
macro-adjusts the 4 faders:

| Preset | Vocals | Drums | Bass | Other |
|---|---|---|---|---|
| Balanced (default) | +1.5 | 0.0 | −0.5 | −1.5 |
| Vocal Boost | +3.5 | −0.5 | −1.0 | −2.5 |
| Karaoke / B-Roll | −inf | +1.0 | +0.5 | 0.0 |

### Suno artifacts: handled invisibly in the backend

Never expose artifact-chasing sliders. The pipeline does this silently:

1. **Other stem:** top-end roll-off above ~9 kHz kills Demucs chirps.
2. **Bass stem:** folded to mono below 140 Hz kills low-end phase smear.
3. **Vocals stem:** gentle downward expander on pauses cleans synthetic
   reverb hiss — no user-facing gate threshold.

### Target workflow (~30 seconds)

1. 0:00–0:05 — user opens Stem Mixer; playback loops with Balanced defaults
   (immediately crisper than the Suno original).
2. 0:05–0:15 — nudges vocal fader up 2 dB.
3. 0:15–0:25 — press-and-hold **Compare** to A/B against the raw track.
4. 0:25–0:30 — hits **Continue to Video**.

### Full control inventory (11 total)

1–8. Four faders + four mute buttons (per table above).
9. Style preset pill (Balanced / Vocal Focus / Karaoke).
10. **Compare** (press-and-hold/toggle) — routes playback to the raw
    unseparated track without touching slider state.
11. **Reset** (ghost button) — restores the 4 faders to preset defaults.

### Interaction rules

- Sliders snap magnetically near 0 dB (±0.5 dB); dropping to minimum reads
  as −inf (soft mute).
- Muted strips dim to 40% opacity; slider position is preserved so unmute
  restores the balance instantly.
- Double-click a slider thumb to reset that stem to its preset default.

### State model (TypeScript sketch — adapt, don't cargo-cult)

```ts
export interface StemMixerState {
  preset: 'balanced' | 'vocal_focus' | 'karaoke';
  comparingOriginal: boolean;
  stems: {
    vocals: { gainDb: number; muted: boolean };
    drums:  { gainDb: number; muted: boolean };
    bass:   { gainDb: number; muted: boolean };
    other:  { gainDb: number; muted: boolean };
  };
}
```

## Response 2 — Library-wide scope (12 controls)

### Track rows carry extraction status — no separate manager screen

| State | Row badge |
|---|---|
| Not extracted | Ghost button `[+ Extract Stems]` |
| Queued | `[⏳ Queued (#N)]` with `[×]` cancel |
| Processing | Micro progress bar in the button: `[Separating… 42%]` |
| Ready | Active badge `[🎛️ Stems Ready]` → opens mixer |
| Failed | `[⚠️ Failed · Retry]`; tooltip shows the error |

Triggering: per-track on demand is primary. If unextracted tracks exist, one
header-level secondary button appears: `[Extract Missing (X)]`. **No blind
auto-extraction on import** — Demucs takes ~40–60 s per 3-minute song and
~3 GB VRAM; auto-running the library would lock the GPU and stall renders.

### Extraction queue: serial, FIFO, single worker

Python backend: one worker (`asyncio.Queue` or `ThreadPoolExecutor(max_workers=1)`).
Strict serial processing prevents CUDA OOM on the 8 GB card.

### Mixer opened mid-extraction: placeholder, not broken faders

Show a clean progress screen (percent, model name, ~seconds remaining,
Cancel). At 100% it transitions seamlessly into the live mixer.

### Per-track mix state lives next to the stems

```
library/
  {track_id}/
    original.mp3
    stems/
      vocals.wav  drums.wav  bass.wav  other.wav
      stem_mix.json   <-- canonical mix state for this track
```

Read on track select (fall back to profile defaults if absent); write on a
300 ms debounce via `POST /api/tracks/{id}/mix-settings`. Co-location keeps
backups and library moves trivial — no DB lock-in.

### Polish profiles: one pill, zero extra knobs

Non-Suno tracks must NOT get Suno artifact-taming (it would muffle a clean
master). One 2-way pill on the toolbar: `[AI Polish | Neutral]`, auto-detected
(Suno metadata → AI Polish; manual import → Neutral), user-overridable.

| | AI Polish (Suno) | Neutral (human/studio) |
|---|---|---|
| Default faders | +1.5 / 0.0 / −0.5 / −1.5 | all 0.0 dB |
| Other stem | roll off >9 kHz | full spectrum |
| Bass stem | mono below 140 Hz | preserve stereo |
| Vocals stem | downward expander on pauses | transparent gate only |

### Extended control inventory (12 total — the ceiling)

1–8. Four faders + four mutes. 9. Style preset pill. 10. Polish profile pill
(AI Polish / Neutral). 11. Compare. 12. Reset.

## Suggested implementation order

1. Backend: serial extraction queue + `stem_mix.json` read/write endpoints.
2. Library rows: status badges + `[+ Extract Stems]` + `[Extract Missing (X)]`.
3. Mixer screen: 4 faders + 4 mutes + preset pill + Compare + Reset with the
   default table above. No advanced drawer.
4. Polish profile pill with auto-detection.
5. Invisible artifact pipeline (Other roll-off, bass mono fold, vocal
   expander) behind the AI Polish profile.

## Implementation status (2026-10-02, after comparing against `StemMixer`)

This brief is guidance to evaluate, so each item was checked against the code
before implementing. **Some of it was already true, and one claim was wrong
about the current implementation.**

### Already present — no work needed

| Brief item | Reality |
|---|---|
| "Serial, FIFO, single worker" extraction queue | **Exists.** `SourceSeparator` has `asyncio.Queue` + one `_queue_worker` task, `enqueue()` returns a job handle. Docstring: *"Process separation jobs serially to cap GPU memory."* `GET /api/audio/separate-jobs/{job_id}` polls it. |
| "No blind auto-extraction on import" | **True.** Separation is only triggered by an explicit `Load Stems` / `Retry` button. |
| Playback should prefer MP3 | **True.** `pickStemUrls()` prefers `stems_mp3`, WAV fallback. |

### Implemented

- **dB fader scale** (−24…+6 dB) replacing the previous linear 0–1 slider, with a
  live `+1.5 dB` readout and double-click-to-reset per stem. Previously a user
  could not tell whether a stem was at unity or at 0.94 — the new offsets are
  small enough that a number is required to make them actionable.
- **`dbToGain` / `gainToDb` / `snapDb`** in `stemMixPresets.ts`, converting to linear
  gain only at the `GainNode` boundary. The amplitude-vs-power trap (`/20` vs
  `/10`) is now in one place and mutation-checked.
- **Default = Balanced preset.** The mixer previously started at flat unity,
  contradicting "must sound better than raw with zero input". Now
  vocals +1.5 / drums 0.0 / bass −0.5 / other −1.5.
- **3-way preset pill** (Balanced / Vocal Boost / Karaoke) and a ghost **Reset**,
  replacing the need for an advanced drawer.
- **Magnetic snap** near 0 dB (±0.5 dB), strict `<` so exactly ±0.5 dB is
  reachable.

### Corrected — the brief's 4.4-adjacent claim about MP3 does not apply

The brief assumes analysis-path playback fetches WAV because
`StemsAnalysisResponse` lacks `mp3_url`. Verified: `Visualizer.tsx` consumes those
URLs **only** for `energy_curve`; it builds no `Audio` element and sets no
`.src`. Playback is `StemMixer` → `getAudioStems()` → already MP3-first. No
waste to reclaim, so no `mp3_url` was added.

### Deliberately NOT implemented — needs a decision first

- **EQ stays.** The brief excludes parametric EQ because non-engineers "hollow
  the mix with it". The existing EQ is *not* per-stem knobs exposed as faders —
  it is a preset row that applies one curve to all four stems, plus band sliders
  that only render once a preset is chosen. Removing it is a product decision,
  not a mechanical one, so it is left in place and called out here rather than
  silently deleted. It is the main remaining conflict with the ≤12-control brief.
- **`stem_mix.json` persistence + `POST /api/tracks/{id}/mix-settings`.** Genuinely
  absent (`MixSettings` appears nowhere in the tree). Real work: a new endpoint,
  a file format, and a debounced write. Not started — it is the largest item here
  and deserves its own change.
- **Serial queue for `separate-file`.** **Corrected on second look:** the single-pass
  path *is* serialised. `SourceSeparator.separate()` does not run Demucs inline —
  it calls `self.enqueue(...)` and waits, with the comment *"Single-pass via job
  queue (caps GPU memory)"*. So the `separate-file` endpoint is covered.
  **However `mode="hierarchical"` is not**: `separate()` returns
  `_separate_hierarchical(...)` *before* reaching `enqueue()`, and that method calls
  `_separate_mdx_net` directly. Two concurrent hierarchical separations would run
  two Demucs models at once on a 8 GB card — exactly the CUDA OOM the queue exists
  to prevent. `StemMixer` does expose a separation-mode selector, so this path is
  reachable from the UI. **This is the most concrete real gap found.**
- **AI Polish / Neutral profile pill, limiter at −1.0 dBFS, −14 LUFS target,
  Other-stem 9 kHz roll-off, bass mono-fold below 140 Hz.** All backend DSP work
  with no UI exposure specified. Needs a scoping decision.
- **Library-row status badges, `[Extract Missing (X)]`.** The brief's "no separate
  manager screen" direction conflicts with the current dedicated panel.

### One correction to the brief itself

The brief gives the control budget as ≤12. The current `StemMixer` in the
"ready" state has 4 mute buttons + 4 faders + 3 EQ presets + Load/Retry +
Enhance + 2 enhancer knobs = **14 before the new pill**, 17 after. The brief's own
argument (remove what non-engineers misuse) supports cutting the EQ row, but that
is a change in perceived capability and should be made deliberately.

- Exact Demucs model/speed tradeoff on the local 1070 Ti (validate the
  40–60 s/track estimate; see Sep 30 guidance on `--shifts`).
- Whether `stem_mix.json` schema should version (`v1` key) for future
  migration safety.
- Compare-button behavior: press-and-hold vs. toggle — pick one, not both.

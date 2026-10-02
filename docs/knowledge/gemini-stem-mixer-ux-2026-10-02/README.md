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

## Open questions for the implementing agent to resolve

- Exact Demucs model/speed tradeoff on the local 1070 Ti (validate the
  40–60 s/track estimate; see Sep 30 guidance on `--shifts`).
- Whether `stem_mix.json` schema should version (`v1` key) for future
  migration safety.
- Compare-button behavior: press-and-hold vs. toggle — pick one, not both.

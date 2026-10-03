# Visual Storytelling

Production documents for the music-video pipeline: the playbook, the per-track
storyboards, and the shot-level design rules.

These were previously split between `docs/visual-storytelling/` and the
`docs/` root, so finding "the storyboards" meant searching two places and a
reader could not tell which of two `STORYBOARD_TakeTheCrown.md` files was
current. Everything that is a *document* now lives here.

| File | What it is |
|---|---|
| `VISUAL_STORYTELLING_2026.md` | The playbook: research, shot planning, lyric mapping |
| `MINDFUL_LAYERING_2026.md` | Design principles for layering type, image and motion |
| `STORYBOARD_StillIRise.md` | Storyboard — Still I Rise (`still-i-rise-*.json` hold the analysis and Whisper timings) |
| `STORYBOARD_TakeTheCrown.md` | Storyboard — Take The Crown |
| `STORYBOARD_Unity_TakeTheCrown.md` | Unity-flavoured variant of the Take The Crown storyboard |
| `STORYBOARD_SignalBreakingThroughNoise.md` | Storyboard — Signal Breaking Through The Noise |
| `STORYBOARD_SYSTEM.md` | The *code* system: `buildStoryboard` / `getStoryState`, LRC-driven shot generation. Not a production storyboard — it documents the implementation. |

## Two things that look like duplicates but are not

**`packages/frontend/public/docs/` holds copies of four of these files.** They are
deliberate, not drift. `AISceneGenerator.tsx` fetches
`/docs/STORYBOARD_StillIRise.md` and `ArtDirection.tsx` fetches
`MINDFUL_LAYERING_2026.md` at runtime, so those static copies must exist at that
path. Editing a file here does **not** update the served copy; they are kept in
step by hand.

**`STORYBOARD_TakeTheCrown.md` and `STORYBOARD_Unity_TakeTheCrown.md` are two
different storyboards** for the same track - one Remotion, one Unity - not two
revisions of one document.

## Data files

`still-i-rise-analysis.json` and `still-i-rise-whisper.json` are generated
analysis output (BPM/energy and Whisper segment timings), kept alongside the
storyboard they support.

---
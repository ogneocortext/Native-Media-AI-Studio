# Work item: music track stack integration

Status: Proposed (part 1 landed 2026-09-22 as `lyric_safety.py` + knowledge files)
Area: `packages/backend/app/services/music_prompt_generator.py`, `packages/frontend/src/features/music-prompts/`, `tools/audio-analysis/`, `docs/knowledge-library/`

## What landed already (2026-09-22, no agent action needed)

- `packages/backend/app/services/lyric_safety.py` — contamination +
  pronunciation-hardening scanner (instruction prefaces, production-direction
  words, ALL-CAPS chants, period abbreviations, dense-vocals-at-high-BPM).
  Flag-for-review; bracketed section tags are stripped before scanning.
- Wired into `validate_output()`: findings surface as warnings on every
  `/api/music-prompts/generate` result.
- `docs/knowledge-library/pronunciation-guide-2026.json` — loaded into the
  generator's system prompt (`Pronunciation hardening` block + per-engine note).
- `docs/knowledge-library/credit-economics-2026.json` — per-provider daily
  credits, rollover, balance visibility, observed costs, spend strategy
  (Suno 50/day no-display, HappyShrimp scarce-but-visible, MiniMax 300/song,
  Flow free-plan clamping).
- `tools/audio-analysis/` — the reference-track analysis pipeline
  (`analyze.py`, `compare_stems.py`, `vocal_profile.py`, `rerender.py`) copied
  in with a README so agents can run/extend it locally.

## Follow-up 1: reference-track analysis → prompt brief prefill

**Problem:** the Music Prompt Generator brief is hand-filled; the analyzer can
measure BPM, key, LUFS, sub-bass share, and stereo width from a reference.

**Design:**
- New endpoint `POST /api/music-prompts/analyze-reference` accepting an audio
  upload; runs `tools/audio-analysis/analyze.py` in a subprocess (or ports the
  core to a service); returns `{bpm, key, key_confidence, lufs, sub_share,
  stereo_width, duration_s}`.
- Frontend: "Analyze reference" button on the generator page pre-fills
  tempo/key and appends measured production deltas to the brief (e.g. sub
  share 56% vs 66% target → "deep mono sub-bass" hint).
- Keep the analyzer out of the request thread (subprocess + job queue, per D8);
  cap upload size; reuse the existing queue if present.

**Acceptance:** upload a track → brief tempo/key pre-filled with measured
values; analysis failure degrades to empty brief, never a 500.

## Follow-up 2: surface lyric-safety findings inline in the UI

**Problem:** findings currently arrive as warning strings in the result panel;
easy to miss before copy-paste.

**Design:** render `warnings` from `/api/music-prompts/generate` grouped by
kind (contamination vs pronunciation vs limits) with the offending line
quoted. No new API needed — the data is already in the response.

**Acceptance:** generating lyrics containing "Do not change any words" shows
an inline contamination warning quoting line 1.

## Follow-up 3: golden lyric packages → presets

**Problem:** worked examples (Patch Notes v3.5, Unproductive Valley Phonk,
Human in the Loop packages) live outside the repo; agents can't learn from them.

**Design:** add 2–3 presets to `docs/knowledge-library/music-prompt-presets.json`
distilled from those packages (theme/genre/mood/tempo/vocal/instruments +
the lyric-writing choices that survived engine rendering). Match the existing
preset schema exactly; do not invent new fields.

**Acceptance:** new presets appear in the generator's preset dropdown grouped
under their platform.

## Follow-up 4: credit-aware generation strategy in the UI

**Problem:** `credit-economics-2026.json` is agent knowledge only; the user
juggles four providers' daily budgets by hand.

**Design:** surface a compact "credit notes" hint per selected engine in the
generator (e.g. HappyShrimp: "scarce — check balance first"). Read from the
JSON via the existing `/api/music-prompts/templates` response; no new endpoint.

**Acceptance:** selecting HappyShrimp shows its scarcity note; selecting Suno
shows the v6-mini sketch → v6 flagship keeper guidance.

## Constraints

- Do not change D1–D8, ports, environments, or `unity-visualizer/`.
- The scanner stays flag-for-review: never auto-rewrite user lyrics.
- Keep knowledge JSONs load-failure-safe (a missing file must never break generation).
- Lyrics fields may contain only intended lyrics, supported section tags, and
  required prefixes — never warnings, notes, or production instructions.

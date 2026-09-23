# Audio analysis tools

Reference-track analysis pipeline used to ground music prompts in measured
numbers instead of vibes. Analyze a reference (or a generated candidate) and
feed the results — BPM, key, LUFS, sub-bass share, stereo width — into the
Music Prompt Generator brief or into mix-fix prompts.

## Scripts

- `analyze.py <audio> <outdir>` — tempo, key (top-2 candidates), dynamics
  (LUFS, RMS dBFS), spectral balance, stereo width, clipping. Decodes via
  ffmpeg, analyzes with librosa. Writes JSON + spectrogram.
- `compare_stems.py <outdir> <stem1> [stem2 ...]` — runs the analysis on each
  stem and prints a side-by-side balance table (e.g. drums vs bass vs vocals
  vs other). Built for Demucs-separated stems.
- `vocal_profile.py <vocal-stem> [outdir]` — vocal occupancy, vocal frequency
  ranges, f0 range for a vocal stem.
- `rerender.py <wav> <outdir>` — re-render the spectrogram figure with
  consistent hop_length.

## Requirements

- `ffmpeg` on PATH
- Python with `librosa`, `numpy`, `matplotlib`

On Windows (PowerShell), create a venv and install:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install librosa numpy matplotlib
```

## How the numbers feed prompts

Measured deltas from real comparisons (Sep 2026) became prompt upgrades:

- Flow phonk render: sub-bass share 56.3% vs 66% target → prompt now asks for
  "deep mono sub-bass"
- Stereo width narrower/sparser than Suno reference → "wide portamento/
  talkbox synths" in the style field
- Tempo 136 vs 126 target → lock BPM numerically in the brief

## Planned integration

`docs/plans/music-track-stack-integration.md` tracks the bigger item:
analyzing a reference track straight from the Music Prompt Generator
(`/api/music-prompts/analyze-reference`) and pre-filling the brief form
with measured BPM/key/energy/mood.

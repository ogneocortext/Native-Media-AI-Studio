# Gemini Guidance — KARRA Stock-Plugin Mixing → "Suno Vocal Enhancer" Preset

- **Source video:** "How to Record & Mix Vocals in FL Studio (99% STOCK PLUGINS!)" — KARRA — 46,100 likes
  https://www.youtube.com/watch?v=siDJWWsPxEI
- **Gemini chat:** https://aistudio.google.com/prompts/1IZ0GmymmzpVbUDydk-17cKv7CCtG2i8A
- **Model:** Gemini 3.5 Flash Lite, 2026-09-30. Answered with grounded web-search sourcing; did not refuse the video.
- **Prompt style:** implementation guidance to build upon (steal / adapt / improve), not a video recap.

---

## 1. The Standard Vocal Chain Distilled (Stock Preset Form)

Based on professional stock-plugin tracking/mixing tutorials (like standard DAW templates featuring pitch correction, subtractive EQ, compression, de-essing, additive EQ, and spatial effects), here is the ordered processing chain:

1. **Pitch Correction / Tuning:** Ultra-fast chromatic/scale correction (e.g., stock pitch or Waves Tune/Autotune Live style settings: Retune speed = 0-10ms, Humanize = 0).
2. **Subtractive EQ (Cleanup):** High-pass filter (HPF) around 80Hz–100Hz (18/24 dB/octave); narrow cuts at muddy low-mids (250Hz–400Hz) and harsh nasal resonances (1kHz–2kHz).
3. **Primary Compressor (Control):** Optical or VCA style. Ratio = 3:1 to 4:1; Attack = 15ms–30ms (to let transients through); Release = Auto or 100ms–200ms; Target gain reduction = 3dB–6dB.
4. **Secondary Compressor (Leveling / Catching):** Fast peak compressor/limiter. Ratio = 8:1+; Attack = Fast (1ms–5ms); Release = Fast; catching stray peaks.
5. **De-Esser:** Split-band or dynamic EQ tuned to sibilance range (typically 5kHz–8kHz), reducing peaks by 4dB–8dB.
6. **Additive EQ (Character / Air):** Broad, gentle boost (+2dB to +4dB) with a wide Q shelf above 10kHz–12kHz for "air" and presence; optional wide boost at 2.5kHz–3.1kHz for vocal cut.
7. **Spatial FX (Sends/Returns):** Pre-delay reverb (20ms–40ms pre-delay, 1.2s–1.8s decay, cut lows under 300Hz and highs above 8kHz) and stereo ping-pong delay (1/4 or 1/8 note sync with high-cut filter).

## 2. Direct Translation: Python DSP (SciPy/Torchaudio/Librosa) & FFmpeg

Mapping these stock processes into code without a DAW requires specific filters:

- **High-Pass / Subtractive EQ:**
  - Python/SciPy: `scipy.signal.butter(N=4, Wn=85/(fs/2), btype='highpass')` applied via `scipy.signal.sosfilt`. For notch filters targeting resonances: `scipy.signal.iirpeak(w0, Q, fs)`.
  - FFmpeg: `highpass=f=85:p=2`, followed by parametric filters using `equalizer=f=320:width_type=q:w=1.5:g=-2.5`.
- **Compression:**
  - Python/SciPy: Write a custom sample-by-sample or block-based envelope follower using `np.abs()`, a smoothing filter (attack/release coefficients), and a static transfer function curve mapping dB-in to dB-out based on threshold and ratio.
  - FFmpeg: `acompressor=threshold=-18dB:ratio=3:attack=20:release=150:makeup=2`.
- **De-Esser:**
  - Python/SciPy: Sidechain a high-pass filtered copy of the signal (or a bandpass centered at 6kHz) into a downward compressor operating on the main broadband signal.
  - FFmpeg: `compand` filter with a multi-stage configuration, or frequency-conscious sidechain compression via asendcmd / avectorscope, though FFmpeg's bandreject combined with a dynamic compressor works well. Simpler route: deesser native filter if available, or chain an equalizer inside a sidechain setup.
- **Additive "Air" EQ:**
  - Python/SciPy: `scipy.signal.shelpek` or peaking filter with high cutoff frequencies.
  - FFmpeg: `treble=g=3:f=10000:width_type=q:w=0.5`.

## 3. Adapting the Chain for AI-Generated (Suno) Vocals

Suno stems have fundamental structural differences from clean studio recordings. Applying a generic vocal chain blindly will amplify flaws.

- **Problem 1: Baked-in Compression & Distortion.** Suno mixes are heavily compressed and often clip internally before stem separation.
  - **Adjustment:** Remove heavy compression stages. Instead of adding more compression, use an expansion/transient recovery step (or upward expansion via a multiband processor like a programmatic OTT-style script) to restore micro-dynamics, or a soft-clipper/saturation stage to round off digital harshness.
- **Problem 2: Digital Harshness / Mid-Range Boxiness (2.5kHz–4kHz).** AI models frequently over-generate grating upper-mid frequencies.
  - **Adjustment:** Add an automatic dynamic resonance suppressor (or multi-point dynamic EQ cuts) targeting the 2.5kHz–4.2kHz band whenever amplitude spikes occur there.
- **Problem 3: Pseudo-Reverb & Phase Artifacts (Demucs Bleed).** Stem separation (Demucs) on Suno tracks leaves behind "musical foam"—swirling phasing artifacts and smeared tail-reverb baked directly into the dry vocal stem.
  - **Adjustment:** Increase the High-Pass Filter cutoff (push from 80Hz up to 110Hz–130Hz to clean up low-end mud/bleed from drums/bass stems). Apply a gate/expander with a smooth-release floor to clamp down on silent gaps and minimize tail artifacts. Avoid adding more reverb unless heavily filtered.

## 4. Fully Automatic Architecture: Heuristics vs. Fallbacks

To run headlessly on your Ryzen 5 / GTX 1070 Ti setup without manual parameter twisting, partition your automation logic:

**Fully Heuristic-Driven (Deterministic Code):**

- **Gain Staging & True Peak Normalization:** Measure integrated LUFS and Peak using pyloudnorm or `ffmpeg -af astats`. Normalize input vocals to a consistent baseline (e.g., -24 LUFS RMS) before processing.
- **HPF & Spectral Tilt Estimation:** Use `librosa.feature.spectral_centroid` or spectral roll-off to find the fundamental register of the singer. If it's a high female voice, safely slide the HPF to 120Hz; for deep male vocals, keep it at 80Hz.
- **De-esser Threshold:** Analyze the RMS ratio of the 5kHz–8kHz band relative to the total broadband RMS. If the high band exceeds a threshold ratio, dynamically scale the de-esser reduction depth.

**Requires Fallbacks / User Control:**

- **Key/Scale Detection for Pitch Correction:** If you apply pitch snapping blindly without knowing the song key, it will horribly mangle non-diatonic notes.
  - **Fallback Strategy:** Use librosa chroma feature analysis to estimate the tonic and scale. If confidence is low (< 70%), disable hard pitch correction entirely and rely only on subtle smoothing or bypass it, exposing a manual override toggle in your UI.
- **Vocal-to-Instrumental Balancing:** Deciding how loud the vocal sits relative to the Suno drums/bass/other stems.
  - **Fallback Strategy:** Use a target-masking heuristic (e.g., keeping vocal LUFS 3–5 dB above the instrumental stem's mid-band energy), but provide a simple macro slider in your studio UI (-3dB to +3dB relative balance) for user adjustments.

## 5. The "Suno Vocal Enhancer" Preset (Production-Ready Spec)

Here is your concrete, automated processing chain tailored specifically for Suno AI stems, optimized for implementation via Python (scipy / torchaudio) or chainable FFmpeg filters:

```
[Suno Vocal Stem Input]
    |
1. DC Offset Removal & High-Pass Filter (HPF)
   - FFmpeg: highpass=f=110:p=2
    |
2. AI Harshness Dynamic Tamer (Dynamic Notch / Multi-band EQ)
   - Target bands: 2600 Hz and 3800 Hz (Width Q = 3.0, Max attenuation = -4 dB tied to input envelope)
    |
3. Spectral De-Esser (Sibilance Control)
   - FFmpeg: bandreject=f=6500:w=3000 (controlled via sidechain compression or dynamic ducking)
    |
4. Parallel Air & Presence Boost (Additive EQ)
   - FFmpeg: equalizer=f=3100:width_type=q:w=1.5:g=+1.5, treble=g=+2.5:f=10000:width_type=q:w=0.6
    |
5. Gentle Transparent Leveling (Soft Compression)
   - FFmpeg: acompressor=threshold=-20dB:ratio=2.5:attack=15:release=120:makeup=1.5
    |
6. True-Peak Limiter / Safety Ceiling
   - FFmpeg: alimiter=limit=-1.0dB
    |
[Clean, Modern, Radio-Ready AI Vocal Output]
```

**Python Implementation Blueprint (scipy / numpy snippet for Step 2 & 4):**

```python
import numpy as np
from scipy.signal import butter, sosfilt

def apply_suno_vocal_chain(audio_array, sample_rate):
    # 1. High-Pass Filter at 110Hz to strip Demucs low-end bleed/mud
    sos_hpf = butter(4, 110 / (sample_rate / 2), btype='highpass', output='sos')
    filtered = sosfilt(sos_hpf, audio_array)

    # 2. Static Notch for Suno 3.2kHz digital harshness spike
    w0 = 3200 / (sample_rate / 2)
    Q = 4.0
    b, a = scipy.signal.iirpeak(w0, Q)
    filtered = scipy.signal.lfilter(b, a, filtered)

    # 3. High-shelf "Air" boost (+2.5dB at 10kHz)
    # Implemented via high-shelf filter coefficients
    # ... (Computed via biquad shelf formulas)
    return filtered
```

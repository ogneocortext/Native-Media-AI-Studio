# Gemini Guidance — UVR5 Headless Stem Separation

- **Source video:** "How to extract vocals from ANY song with Ultimate Vocal Remover (UVR 5)" — soundlearn — 21,342 likes
  https://www.youtube.com/watch?v=ykOKwz3eRUQ
- **Gemini chat:** https://aistudio.google.com/prompts/1RkhNQg2MilsPJi54YGe_yM7JA9pcKj6w
- **Model:** Gemini 3.5 Flash Lite, 2026-09-30. Answered with grounded web-search sourcing; did not refuse the video.
- **Prompt style:** implementation guidance to build upon (steal / adapt / improve), not a video recap.

---

## 1. What UVR5 Does Beyond Plain Demucs & What to Steal

Plain Demucs (like htdemucs or htdemucs_ft) treats separation as a single-pass multi-task problem, predicting all 4 stems (vocals, drums, bass, other) simultaneously. While fast, it often suffers from cross-talk (e.g., bleeding high-hats in the vocal stem) and digital phase-smearing because it relies on standard spectrogram/waveform masking without task-specific optimization.

UVR5 achieves superior isolation by utilizing completely different neural network architectures and operational workflows:

- **Architecture Diversity (MDX-Net & VR Architecture):** MDX-Net combines a U-Net style backbone with 1D/2D convolutions and frequency-domain regression optimized via segment-level processing. VR Architecture uses densely connected convolutional networks optimized specifically for extracting singular elements (like stripping out vocals via high-pass filtering masks or aggressive phase cancellation).
- **Ensemble & Aggregation Logic:** UVR5 can run parallel passes using different models and merge their spectrogram outputs using mathematical logic like Max Spec (taking the maximum magnitude per frequency bin to eliminate bleed) or Average Spec.
- **Chunking & Overlap-Add (OAL) Tricks:** Instead of processing an entire song at once (which causes memory overflow and boundary artifacts), UVR5 slices audio into overlapping segments (e.g., segment sizes of 256 or 512 with overlaps of 4 to 8 chunks). It then stitches them back using cross-fading/windowing to eliminate boundary clicks.
- **Secondary Pass Modifiers (De-echo / De-reverb):** UVR5 chains auxiliary models specifically trained to clean up residual artifacts left behind by primary extractors.

**What's worth stealing for your headless backend:**

1. **Specialized Single-Target Execution:** Stop relying solely on 4-stem Demucs. Isolate one target at a time using domain-specific models (e.g., use a dedicated vocal model to pull vocals, then run a separate drum/bass extractor on the residual instrumental).
2. **Overlap-Add Chunking:** Implement robust chunking parameters in your Python wrapper to protect your 8GB VRAM.
3. **Max-Spec Ensembling (Conceptually):** Running two distinct architectures sequentially or blending their outputs yields far cleaner results than a raw single model pass.

## 2. Adapting UVR5 for a Headless Python API

Since you are building a local FastAPI/Flask backend instead of a desktop GUI, you need to map UVR5's UI paradigms into programmatic pipelines.

**What to KEEP:**

- The underlying model weights and inference code. Do not reinvent the models; leverage Python packages like `audio-separator` (which packages MDX-Net, VR, and RoFormer models cleanly for programmatic use) or directly call underlying PyTorch inference scripts.
- Parameter exposure. Expose configuration parameters (`segment_size`, overlap, denoise) via your `/api/audio/separate` JSON payload so your frontend StemMixer UI can toggle quality modes.

**What to ADAPT:**

- State management & caching. UVR5 processes files synchronously and dumps them to disk. Your API needs an async or background worker queue (e.g., Celery or `asyncio.to_thread`) because stem separation on an 8GB GTX 1070 Ti will take 30–90 seconds per track. Return a job ID and use WebSockets or polling to update the StemMixer UI.

**What to do DIFFERENTLY:**

- Bypass desktop-only bottlenecks. UVR5 forces redundant format conversions. Your pipeline should read the source MP3, load it straight into an in-memory PyTorch tensor via torchaudio or librosa at 44.1kHz mono/stereo, pass it to the GPU, and write out directly as high-bitrate MP3/FLAC copies designated for your web player.

## 3. Model Strategy for Suno MP3s on GTX 1070 Ti (8GB VRAM)

Suno AI-generated tracks have distinct characteristics: they often feature compressed high frequencies, phase inconsistencies, and slight digital "grit" or phasing in the mix bus. On an 8GB GTX 1070 Ti, modern heavyweights like full-size BS-RoFormer models will either trigger out-of-memory errors or crawl at painfully slow speeds.

Optimal configuration for quality-per-minute on your hardware:

- **For Vocals (Lead & Backing):** Use MDX-Net (`UVR-MDX-NET-Voc_FT` or `Kim_Vocal_2`). They run exceptionally well on 8GB VRAM, handle compressed AI artifacts cleanly, and avoid the heavy memory footprint of RoFormers while retaining high vocal clarity.
- **For Drums & Bass:** Use Demucs (`htdemucs_ft`) or specialized MDX-Net Inst models. `htdemucs_ft` fine-tuned variant hits a sweet spot on Pascal architecture cards, splitting drums and bass cleanly without crushing low-end transients.
- **The Hardware Strategy:** Keep a strict resource constraint profile. Set `segment_size=256` or `128` to keep VRAM consumption under 6.5GB, leaving headroom for Windows 11 desktop rendering.

## 4. Artifact Control: Minimizing Phase-Smearing and Harshness

AI-generated music (from Suno or Udio) natively suffers from phase-smearing, comb filtering, and harsh high-end artifacts due to neural vocoders and compressed latent diffusion outputs. Running standard separation over them blindly multiplies these artifacts, resulting in underwater-sounding vocals or crunchy cymbals.

Pre- and post-processing steps to add around your separation pipeline:

1. **Pre-Separation Spectral Conditioning (Input Clean-up):**
   - Before hitting the separation model, apply a gentle high-pass filter below 30Hz to remove sub-audible DC bias and rumble that confuse neural network attention maps.
   - Apply a light dynamic-range optimization or subtle multi-band transient shaper if the Suno track is heavily clipped or brickwall-limited.
2. **Post-Separation Phase Correction & De-bleeding:**
   - **Spectral Gating / Expander:** Stem separation often leaves low-level "ghost" bleed (e.g., faint cymbals leaking into the vocal stem). Apply a mild frequency-conscious spectral gate on the vocal stem to suppress quiet frequency bins where vocals aren't active.
   - **Dynamic EQ / De-Harshness:** AI vocals frequently carry a digital piercing resonance around 2.5kHz–4kHz and 8kHz. Run an automated dynamic resonance suppressor or a dynamic EQ profile on the isolated vocal stem to tame digital harshness.
   - **Phase Alignment & Sum Check:** Ensure that when your StemMixer re-combines the stems (Vocals + Drums + Bass + Other), they sum back together cleanly without introducing phase cancellation or comb filtering against the original mix.

## 5. Concrete Improved Pipeline Design for Native Media AI Studio

```
[Suno MP3 in Media Library]
       |
       v
Stage 1: Ingest & Pre-Processing (Python Backend)
  - Load MP3 via torchaudio / ffmpeg subprocess.
  - Resample to 44.1 kHz stereo float tensors.
  - Apply mild subsonic high-pass filter (< 30 Hz).
       |
       v
Stage 2: Two-Stage Hierarchical Separation (GTX 1070 Ti Optimized)
  - Pass A (Vocal Extraction): Run `UVR-MDX-NET-Voc_FT` (segment_size=256, overlap=4).
      -> Outputs: `vocals.wav` and `instrumental_residual.wav`
  - Pass B (Instrumental Breakdown): Run `htdemucs_ft` exclusively on `instrumental_residual.wav`.
      -> Outputs: `drums.wav`, `bass.wav`, `other.wav`
       |
       v
Stage 3: Artifact Mitigation & Restoration (The "Anti-AI-Grit" Layer)
  - Vocals: Apply spectral de-noising / gentle dynamic EQ cut at 3.2 kHz (taming Suno digital harshness).
  - Drums/Other: Apply transient recovery and high-shelf smoothing to reduce phase-smearing artifacts.
       |
       v
Stage 4: Encoding & UI Synchronization
  - Export processed stems down to optimized 320 kbps MP3 copies for the StemMixer web player.
  - Update local SQLite library state (`stems_ready = True`) and notify UI via API callback.
```

**Why this beats a stock script:** By separating Vocals first using a dedicated MDX-Net architecture, you avoid the severe vocal bleed that plagues standard 4-stem Demucs runs on AI-generated tracks. By feeding only the instrumental residual into Demucs for drums/bass/other, you isolate frequencies cleanly. Finally, adding the Artifact Mitigation Layer (Stage 3) specifically targets the digital harshness intrinsic to Suno audio, ensuring your re-mixed media studio output sounds noticeably cleaner, punchier, and more professional than the raw generation.

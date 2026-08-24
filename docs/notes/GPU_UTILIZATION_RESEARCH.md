# GPU Utilization Research Notes

*Research gathered 2026-08-23 for Native Media AI Studio music video pipeline.*

## Hardware Profile
- **GPU**: NVIDIA GeForce GTX 1070 Ti (8GB VRAM, sm_61, 19 SMs)
- **CUDA Toolkit**: 12.4 (C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4)
- **Driver**: 582.66, CUDA Version: 13.0 supported
- **PyTorch**: 2.5.1+cu124 (in `runtime/venvs/.venvs/venv_backend`)
- **Also available**: venv with PyTorch 2.6.0+cu124 (root venv)
- **Compute capability**: 6.1 (Pascal) — CUDA 13 dropped Pascal support but CUDA 12.4 works

## Blender GPU Rendering

### Cycles (CUDA + OptiX)
- CUDA 13.0+ dropped Maxwell/Pascal/Volta (sm_5X, sm_6X, sm_70) for kernel compilation
- Blender Cycles patches: use CUDA 11 toolkit for PTX kernel compilation when CUDA 13 is installed
- OptiX 9.0+ requires `optixTraverse` instead of `optixTrace` for direct callables
- Minimum driver: 535 for OptiX; 575+ recommended for CUDA 12.9
- **Key**: Blender 5.2+ supports CUDA 12.x; use `--split-compile=0` for faster kernel builds

### EEVEE (Real-time)
- Optimized for Grease Pencil / 2D animation (~2x faster than 3D)
- Supports bloom, SSR, volumetric shadows, ambient occlusion
- Works well for preview rendering while Cycles handles final output

## Music Video Generation Pipelines (Reference Projects)

### 1. semantic-foragecast-engine (GitHub)
- Configuration-first, modular 4-phase pipeline
- Phase 1: Audio preprocessing (librosa beat detection)
- Phase 2: Blender scene building (Python API via MCP)
- Phase 3: FFmpeg video encoding
- Phase 4: 2D Grease Pencil animation mode
- Render times: 4 min (ultra-fast 320x180) to 50 min (1080p production) for 30s video
- **Key insight**: Beat-synced gestures, phoneme lip-sync, timed lyrics via YAML config

### 2. comonteur (GitHub) — Blender MCP + AI Agent
- Real Blender output with F-curves on real data paths
- Timeline-based editing with dope sheet, graph editor, NLA
- Word-accurate captions from TTS timing marks
- Shot-based workflow: build shots → render review frames → iterate
- Ownership system: agent respects manual edits (doesn't overwrite)
- Uses HyperFrames for previs (HTML/GSAP → instant iteration)

### 3. Mixar (Blender-based 3D editor with AI video gen)
- Seedance 2.5 model: up to 9 stills + 3 clips per generation, 4-30s at 480p/720p
- Guide frames render from viewport camera → submitted with prompt
- Jobs run in queue (non-blocking)
- Generated clips become graph nodes for iterative generation

### 4. epsilver/lyric-video-blender
- WhisperX forced-alignment transcription (word-level timestamps)
- Demucs vocal separation
- Blender addon with word-by-word or grouped lyric modes
- Style browser for animation presets

## 3D Asset Generation from Text (for Props/Scenes)

### TRELLIS
- Text/image-to-3D generation
- Used by SAGE (agentic 3D scene generation)
- Produces simulation-ready meshes

### Hunyuan3D-Buffalo 1.0
- Unified 3D understanding + generation + editing
- 87M training corpus (text-to-3D pairs + editing pairs)
- Text-to-3D generation with part-level control

### FlashWorld (ICLR 2026 Oral)
- 7 seconds on A100, 4 seconds on H100 for full 3D scene
- From single image or text prompt
- Memory: 9GB (with --offload_vae) to 51GB
- Could generate scene backgrounds quickly

### WorldGen
- End-to-end text-to-traversable-3D-world
- Navmesh-guided holistic reconstruction
- Decomposes into individual objects for editing
- ~5 min per scene on GPU

### SAGE (Scalable Agentic 3D Scene Generation)
- MCP-based agent orchestration
- Generator tools: floor plans, layouts, text-to-3D assets
- Critics: visual (semantic/spatial coherence) + physics (Isaac Sim)
- Self-correction loop

### Native3D
- End-to-end 3D scene generation (no 2D intermediate)
- Unified mesh-texture joint representation
- Direct3D encoder + DiT diffusion backbone

## CUDA Audio Processing

### torch.stft() for GPU-accelerated FFT
- `torch.stft(waveform, n_fft, hop_length, return_complex=True)`
- Magnitude → spectral centroid, rolloff, bandwidth
- Onset envelope: frame-to-frame log-magnitude difference
- All ops run on GPU with PyTorch CUDA

### librosa (CPU) features that map to CUDA:
- RMS energy → torch.mean(power, dim=0) on STFT
- Spectral centroid → weighted frequency mean
- Spectral rolloff → cumulative energy threshold
- Onset strength → frame differencing of log-magnitude
- Beat tracking → librosa still needed (no GPU equivalent)

## Practical GPU Work for This Project

### Priority 1: GPU Audio Analysis
- torch.stft() for real-time spectrum visualization
- Batch analysis of multiple tracks
- Onset detection for beat-sync events

### Priority 2: Blender Scene Generation via MCP
- Build 3D stages from text prompts (concert, abstract, nature, urban, space)
- Character rigs with poseable skeletons
- Beat-synced animation (light pulses, object bounces, arm swings)
- Lyric text objects with timed visibility

### Priority 3: GPU Rendering Coordination
- Cycles CUDA for final quality renders
- EEVEE for real-time preview
- Compositor: bloom, color grade, vignette
- Frame sequence → FFmpeg encoding

### Priority 4: Image Preprocessing
- GPU resize/normalize for ComfyUI pipeline
- torch.nn.functional.interpolate for batched resizing
- Format conversion (HWC↔CHW, uint8→float, [0,255]→[-1,1])

## Blender Scene Types (Designed)
1. **Concert**: Reflective floor, back wall, spotlights, colored accent lights
2. **Abstract**: Mirror floor, floating geometric shapes, volumetric light
3. **Nature**: Terrain with displacement, sun light, organic backdrop
4. **Urban**: Street with buildings, neon signs, gritty atmosphere
5. **Space**: Void floor, floating crystals/asteroids, dramatic rim lighting

## Key Technical Decisions
- **Script generation approach**: Generate Python code strings → execute via Blender MCP
- **Why**: Blender MCP runs bpy API; we generate the bpy code server-side
- **Animation strategy**: Keyframe insertion at beat timestamps (frame = beat_time * fps)
- **Rendering**: PNG sequence → FFmpeg H.264/H.265 encoding
- **Memory management**: 8GB VRAM is sufficient for scene rendering (not AI model inference)

## References
- Blender Cycles CUDA 13 patch: github.com/blender/cycles/commit/f6d3338
- semantic-foragecast-engine: github.com/semanticintent/semantic-foragecast-engine
- comonteur: github.com/davidB/comonteur
- FlashWorld: github.com/imlixinyang/flashworld (ICLR 2026 Oral)
- SAGE: CVPR 2026 (agentic 3D scene generation with MCP)
- Hunyuan3D-Buffalo: arxiv.org/html/2608.02711
- WorldGen: CVPR 2026 (text-to-traversable-3D-world)
- Native3D: arxiv.org/html/2606.07117v1
- lyric-video-blender: github.com/epsilver/lyric-video-blender
- Mixar: mixar.app/blog/ai-video-generator-blender

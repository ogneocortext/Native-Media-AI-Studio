---
tags:
  - technical
  - platform-runtime
aliases:
  - Runtime Models
cssclasses:
  - technical-guide
date: 2026-11-12
type: entity
---

> [!info] Purpose
> Inventory of models in the repo-local `runtime/models/` directory. These are lightweight models for text encoding, voice synthesis, and VAE approximation used by the runtime inference stack.

---

## Overview

**Location:** `runtime/models/`  
**Total Size:** 0.09 GB (91 MB)  
**Last Audited:** 2026-11-12

This directory contains small, specialized models used by the runtime inference services (not ComfyUI, not ACE-Step). Most files are under 1 MB.

## Model Inventory

### Text Encoder
| Model | Path | Size | Purpose |
|-------|------|------|---------|
| model.safetensors | `text_encoder/model.safetensors` | 0.09 GB | Lightweight text encoder for runtime inference (likely a distilled CLIP or BERT variant) |

### VAE Approximation
| Model | Path | Size | Purpose |
|-------|------|------|---------|
| model.pt | `vision/stable-diffusion/stable-diffusion-webui/models/VAE-approx/model.pt` | ~0 GB | Fast VAE approximation for real-time preview (from sd-webui) |

### Voice Models (TTS)
| Model | Path | Size | Purpose |
|-------|------|------|---------|
| english_female.pth | `voice/english_female.pth` | ~0 GB | English female voice model |
| japanese_female.pth | `voice/japanese_female.pth` | ~0 GB | Japanese female voice model |
| japanese_female_model.pth | `voice/japanese_female_model.pth` | ~0 GB | Japanese female voice (alt) |
| proper_model.pth | `voice/proper_model.pth` | ~0 GB | Reference voice model |
| voice_model.pth | `voice/voice_model.pth` | ~0 GB | Generic voice model |

### Voice Configs
| Config | Path | Purpose |
|--------|------|---------|
| basic_config.json | `voice/basic_config.json` | Base TTS configuration |
| config.json | `voice/config.json` | Main TTS config |
| english_config.json | `voice/english_config.json` | English TTS settings |
| english_working_config.json | `voice/english_working_config.json` | Working English config |
| japanese_female_config.json | `voice/japanese_female_config.json` | Japanese female config |

### WebUI Test Files
| File | Path | Purpose |
|------|------|---------|
| empty.pt | `vision/stable-diffusion/stable-diffusion-webui/test/test_files/empty.pt` | Test fixture |
| package.json | `vision/stable-diffusion/stable-diffusion-webui/package.json` | WebUI metadata |

## Usage Context

- **Text encoder:** Used by backend services needing fast text embedding without Ollama round-trip
- **VAE approx:** Real-time latent preview in web UI (decodes latents to RGB without full VAE)
- **Voice models:** TTS synthesis for narration/voiceover generation in video pipeline
- **All models are tiny** (<100 MB total) — no VRAM pressure on 8 GB GPU

## Related

- [[comfyui-workflows]]:see-also — Main ComfyUI model inventory (131.9 GB)
- [[tools-checkpoints-models-2026]]:see-also — ACE-Step and embedding models (13.8 GB)
- [[stable-diffusion-local-models-2026]]:see-also — Standalone SD 1.5 + AnimateDiff (4.75 GB)
- [[voice-synthesis-api-2026]]:see-also — Voice API documentation (F5-TTS zero-shot cloning)
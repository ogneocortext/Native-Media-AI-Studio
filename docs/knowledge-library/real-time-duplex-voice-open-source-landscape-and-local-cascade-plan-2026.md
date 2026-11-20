---
tags:
  - ai
aliases:
  - Real-time duplex voice: open-source landscape and local cascade plan (2026)
cssclasses:
  - ai-guide
date: 2026-11-20
type: comparison
---

> [!info] Purpose
> Survey of open-source real-time / full-duplex speech-to-speech models (researched 2026-11), their hardware requirements, and the recommended local cascade architecture for this rig (GTX 1070 Ti, 8 GB VRAM, Pascal sm_61). Decides what is feasible for a "duplex" voice mode in Studio and what is not.

---

## Hardware constraint

GTX 1070 Ti: 8 GB VRAM, Pascal (sm_61) — **no bf16**, fp16 only, and VRAM is shared with Ollama/ComfyUI workloads. Anything needing ≥12 GB realistically is out.

## True full-duplex models (native simultaneous listen+speak)

| Model | Params | License | Duplex | 1070 Ti? |
|---|---|---|---|---|
| Moshi/Moshika/Moshiko (Kyutai) | 7B + Mimi codec | code MIT/Apache, weights CC-BY | ✅ ~160 ms theoretical, ~200 ms on L4 | ❌ Kyutai FAQ: "For 8GB GPU, this is not possible." ~24 GB PyTorch; Rust int8 backend still too big (codec + depth transformer + KV cache). 12 GB possible via offload tricks (issue #54) |
| PersonaPlex 7B (NVIDIA, 2026-01) | 7B, Moshi-based | MIT code, NVIDIA Open Model weights | ✅ barge-in/overlap, voice+role prompts | ❌ A100/H100-class; `--cpu-offload` exists but not realtime on Pascal |
| NemotronLabs VoiceChat 11B (NVIDIA) | 11B | OpenMDW 1.1 | ✅ + tool calls | ❌ datacenter GPUs (A100–B200, RTX 6000) |
| Qwen3-Omni 30B-A3B (Alibaba) | 30B, 3B active | Apache-2.0 | turn-taking; true duplex only via research D2 framework | ❌ ~79 GB BF16 |
| MiniCPM-o 4.5 (OpenBMB) | 9.37B | Apache-2.0 | ✅ native full-duplex A/V live streaming, proactive comments | ⚠️ borderline — only realistic native-duplex candidate; needs omni.cpp/GGUF quant, vLLM-Omni serving wants datacenter GPUs |
| LFM3-Omni-2B (Liquid AI) | 2.17B (~4 GB BF16) | free <$10M revenue | half-duplex (text or speech out, 32K ctx) | ✅ fits, but not true duplex |
| D2 framework (arXiv 2610.17124) | converts Qwen3-Omni / LLaMA-Omni to FD | research | ✅ 99.2% turn-taking @ 521 ms | inherits base-model size; research-stage |

Note: **Pocket TTS and F5-TTS cannot do duplex** — they are conditioned TTS with no audio input path. Moshi's Mimi codec ≠ Pocket TTS; different Kyutai artifacts.

## Recommended architecture: cascade + barge-in

The pragmatic path that runs on this rig and reuses existing services:

```
Mic → Silero VAD → faster-whisper (CUDA fp16) → Ollama LLM → Pocket TTS stream → Speaker
        └── speech-onset during playback = barge-in → abort stream, feed to context
```

- **STT**: `faster-whisper` (CTranslate2, CUDA fp16 — Pascal-compatible; already in `nma-studio-cuda`). Partial transcripts ~160 ms p50 on `small.en`/`medium.en`.
- **LLM**: existing Ollama stack — latency lever is warm model + capped reply length.
- **TTS**: Pocket TTS via existing `/api/voice/pocket/speak` proxy — ~170 ms warm TTFB, 24 kHz streaming.
- **VAD/barge-in**: `silero-vad` (pip, tiny ONNX, CPU) — speech onset during TTS playback aborts the stream = felt duplex without a duplex model.
- **Transport**: FastAPI WebSocket owning VTS+LLM+TTS, PCM audio to/from the page.
- **Realistic voice-to-voice**: ~600 ms–1.2 s. Not Moshi's 200 ms, but genuinely interruptible conversation.

Reference implementations: `lhl/voicechat2` (modular SRT/LLM/TTS over WebSocket — closest match), `jamesbordane57/llmrtc-voice-agent-demo` (browser mic + barge-in + latency panel; Ollama+faster-whisper+Piper, swap Piper→Pocket TTS), HF `speech-to-speech` realtime mode wrapper (`bigsk1/realtime`), `ashray-00/vox` (measured latency breakdown — LLM TTFT and TTS TTFA dominate).

## Decision

1. **Now**: cascade on existing stack (Silero VAD + faster-whisper + Ollama + Pocket TTS) behind a WebSocket — achievable in-repo.
2. **Track**: MiniCPM-o 4.5 via omni.cpp/GGUF as the native-duplex experiment if GPU upgrades or a consumer quant path matures.
3. **Skip on this hardware**: Moshi, PersonaPlex, Nemotron VoiceChat, Qwen3-Omni — all need ≥12 GB VRAM.

## Related

- [[2d-visualization-2026|2d-visualization-2026]] :see-also
- [[advanced-visualization-techniques-2026|advanced-visualization-techniques-2026]] :see-also
- [[facial-expression-systems-for-stylized-real-time-characters-2026|facial-expression-systems-for-stylized-real-time-characters-2026]] :see-also
- [[higgsfield-comfyui-challenge-2026|higgsfield-comfyui-challenge-2026]] :see-also
- [[notification-system-improvements-2026|notification-system-improvements-2026]] :see-also

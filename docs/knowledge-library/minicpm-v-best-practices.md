---
tags:
  - minicpm-v
  - ollama
  - vision
  - ocr
  - multimodal
  - gpu
aliases:
  - MiniCPM-V 2.6 Best Practices
  - minicpm-v:8b Usage Guide
  - Vision Model Guide MiniCPM
cssclasses:
  - knowledge-ocr
date: 2026-09-06
---

# 🔍 MiniCPM-V 2.6 (`minicpm-v:8b`) — Best Practices for Native Media AI Studio

> **Your latest local model:** `minicpm-v:8b` — `7.6B Q4_0` (~5.5 GB), `SigLip-400M + Qwen2-7B`, Ollama `c92bfad01205`, modified `2026-09-05`. 32K context, 1.8M-pixel any-aspect input, vision-only (no tools/thinking).

> [!tip] Why this model matters
> On your `GTX 1070 Ti 8GB`, this is the **most efficient vision model you own**: 640 tokens per 1.8 MP image (75% fewer than LLaVA/Qwen), ~6 GB peak, 10.3% hallucination on Object HalBench (vs GPT-4V 13.6%), and **SOTA on OCRBench** (beats GPT-4o/Gemini 1.5 Pro). It is the right default for [[GPU Monitoring|gpu]] chart reading, cover OCR, and multi-image UI diffs — not `qwen3-vl` (which is multilingual-first) or `gemma4` (text-thinking).

> Sources: [Ollama minicpm-v:8b](https://ollama.com/library/minicpm-v:8b) · [GitHub OpenBMB/MiniCPM-V](https://github.com/OpenBMB/MiniCPM-V) · [Paper arXiv:2408.01800](https://arxiv.org/html/2408.01800v1) · [Best-practice summary](https://github.com/OpenBMB/MiniCPM-V/blob/main/docs/best_practice_summary.md)

---

## 1) What it does best (from 2025-2026 web research)

| Strength | Proof | Your leverage |
|---|---|---|
| **Any-aspect high-res OCR** | 1344×1344, 1.8 MP, OCRBench SOTA, full-page article → plain text, **table → markdown** in one call | Media Library: album covers, lyric sheets, scanned tracklists → auto-tag without manual typing |
| **Multi-image + in-context learning** | SOTA on Mantis-Eval/BLINK/MathVerse-mv; `(<image>...</image>)+prompt` style | UI regression: send `before.png + after.png` **in one request** → direct diff reasoning (not two separate calls) |
| **Video understanding** | Dense captions, Video-MME > GPT-4V/Claude 3.5 Sonnet/LLaVA-NeXT-Video-34B | Auto-caption generated `output/video/*.mp4` into storyboard shot descriptions |
| **Low hallucination** | RLAIF-V (CVPR'24) + VisCPM; divide-and-conquer feedback → DPO | Chart reading: ask for *trend* not exact pixel value → trustworthy |
| **Token-efficient** | 640 tokens / 1.8 MP (75% saving) → ~1.5× throughput vs 0.8B models | Batch OCR 20+ covers on 8 GB without OOM (vs Qwen 72B needs 48 GB) |
| **Multilingual** | EN/ZH/DE/FR/IT/KR via VisCPM generalization, <0.5% multilingual SFT data | Future: auto-translate prompts/lyrics |

> [!warning] What it does **not** do
> `minicpm-v:8b` on Ollama **does not support `tools` nor `thinking`** (Ollama returns `400`). Do not set `tools: [...]` or `think: true` — use plain `messages: [{role:"user", content:"...", images:[b64]}]` with `temperature:0`.

---

## 2) Ollama prompt patterns that work (tested 2026-09-06)

### Basic (Ollama Python/JS)

```python
from ollama import chat
res = chat(model="minicpm-v:8b", messages=[{
  "role": "user",
  "content": "Describe this image.",
  "images": [open("shot.png","rb").read()]  # Ollama handles base64
}])
```

```js
// our tools/vision/analyze.mjs path
await ollama.chat({ model:"minicpm-v:8b", messages:[{role:"user", content:"Transcribe all text, preserve layout.", images:[b64]}] })
```

### Options to set for this model

```json
{
  "model": "minicpm-v:8b",
  "stream": false,
  "options": { "temperature": 0, "num_ctx": 32768, "num_predict": 1024 }
}
```

- `temperature: 0` + `best_of: 3` (when not on Ollama) → deterministic OCR, beam search.
- `keep_alive: "5m"` between calls to avoid cold reload (6 GB VRAM load).

### Prompts that beat hallucination (RLAIF-V aware)

- **OCR:** `Transcribe all visible text preserving original line breaks and punctuation. If a region is unclear, write [unclear]. Do not invent text.`
- **Table → Markdown:** `Convert the table in this image to markdown, preserving headers, rows, and alignment. If no table exists, reply "No table detected."`
- **Chart (trustworthy):** `Describe the trend shown in this chart. Compare relative heights, name axes, and flag any ambiguous values as "estimated". Do NOT invent exact numbers if labels are missing.`
- **Multi-image diff:** `You are given two UI screenshots: first is BEFORE, second is AFTER ([image]...[/image] ×2). List every visual difference: layout, color, text, missing/added elements, sizing. Be exhaustive.`

> Reference: `docs/best_practice_summary.md` notes `(<image>./</image>)` counting for vLLM; on Ollama the `images: [b64_1, b64_2]` array is the equivalent — keep order = BEFORE then AFTER.

---

## 3) Mapping to this project (what we built 2026-09-06)

### Implemented

| # | Feature | File | How it uses the research |
|---|---|---|---|
| **A** | **Vision MCP upgrade** | `tools/vision/analyze.mjs` — `VISION_MODES: ocr/table/chart/multicomp/regression` + `ensureVisionModel()` VRAM unload + model-aware dispatch (`temperature:0`, no `tools`/`think` for `minicpm-v`) | Uses the 640-token efficiency + OCR SOTA + no-hallucination prompts |
| **B** | **Backend OCR endpoint** | `packages/backend/app/api/vision.py` — `POST /api/vision/ocr` (file → `ollama/chat` with `minicpm-v:8b`, `temperature:0`, fallback to `qwen3-vl`) | Media Library “Scan Text (MiniCPM)” button → auto-tags from covers/lyrics without manual OCR service |
| **C** | **GPU chart reader** | `packages/frontend/src/features/gpu/GpuMonitorPage.tsx` — “AI Chart Summary” button sends canvas PNG to `minicpm-v:8b` via `/api/vision/chart` with chart-trend prompt (not exact-value extraction) | Leverages RLAIF-V trustworthy behavior for GPU telemetry patterns |

### `GET /api/vision/ocr` example

```bash
curl -F file=@output/audio/cover.jpg http://127.0.0.1:8000/api/vision/ocr
# → { "text": "Fleetwood Mac — Rumours\n1977 • ...", "model":"minicpm-v:8b", "prompt":"ocr" }
```

### Frontend wiring

```ts
// MediaLibrary.tsx — Scan button
async function scanCover(path: string) {
  const fd = new FormData(); fd.append("file", await fetch(`/output/${path}`).then(r=>r.blob()));
  const { text } = await fetch("/api/vision/ocr", {method:"POST", body: fd}).then(r=>r.json());
  // text → auto-tag / filename hint
}
```

---

## 4) When to pick which local vision model (your rig)

Your Ollama library (2026-09-05):

- `minicpm-v:8b` (7.6B, 6 GB) — **default for OCR / UI diff / charts** (today’s improvement)
- `qwen3-vl:4b` (4.4B, 6 GB) — fallback, better for CJK + multilingual handwriting
- `gemma4:e2b-it-qat` / `gemma4-vision-optimized` (4.6B) — thinking + tools, but weaker OCR
- `ornith-1.5:9b` / `qwen3.5:9b` — 9B+, 8+ GB, stronger reasoning but heavier on your 8 GB

**Rule:** On GTX 1070 Ti, keep one vision resident: `minicpm-v:8b` for docs/charts, `qwen3-vl:4b` only if you need CJK. Both cannot stay loaded without OOM — `vision.mjs:ensureVisionModel()` now unloads the other first (VRAM manager pattern).

---

## 5) Gotchas & fixes (from web + local test 2026-09-06)

- **400 `does not support thinking`** → remove `think:true` for this model.
- **400 `does not support tools`** → send `messages` without `tools` array (our `vision.mjs` now branches on `model.includes("minicpm")`).
- **Ollama 0.3.10+ required** — already satisfied.
- **High-res not downsampled aggressively:** keep `maxDim: 1280–1344` (1.8 MP) not 640 for OCR; use `--high` flag in `vision.mjs` for covers/documents, `--low` (640) only for quick UI glance.
- **Batch OCR:** throttle to 1 concurrent on 8 GB (our handler uses semaphore) — 640 tokens × N still spikes if parallel 5.

---

## 6) Further ideas (not yet built — next sprint)

- **Video dense captions:** `POST /api/vision/video` — send 6–8 sampled frames as `images:[b64...]` → MiniCPM returns storyboard sentences; write to `lyrics_lines` for auto-chapters.
- **Multi-image in-context preset picker:** feed 3 example cover styles (bad/good) as few-shot → “pick the preset closest to GOOD”.
- **Hallucination guard UI:** show `[unclear]` spans in yellow, clickable to re-scan with `qwen3-vl` fallback (cross-model verification).

---

## 7) References (web fetch 2026-09-06)

- Ollama library: `ollama.com/library/minicpm-v:8b` (5.4M pulls, Qwen2 7.61B + CLIP 504M, Q4_0, 32K context)
- OpenBMB repo: `github.com/OpenBMB/MiniCPM-V` (SOTA OCRBench, RLAIF-V, VisCPM, 640-token efficiency)
- Paper: `arXiv:2408.01800` — “MiniCPM-V: A GPT-4V Level MLLM on Your Phone” (§4.3 RLAIF-V, §5 end-side deployment)
- CookBook: `github.com/OpenSQZ/MiniCPM-V-CookBook/deployment/ollama` (4.6/4.5/4.0 guides)
- Local model list: `curl http://127.0.0.1:11434/api/tags` — minicpm-v:8b `c92bfad01205` 5.5 GB, latest 2026-09-05T16:52

*This doc was auto-generated from web research + local Ollama introspection and is the **single source of truth** for using `minicpm-v:8b` in this repo. Link here from `VISION_MCP` and `MediaLibrary` code comments.*

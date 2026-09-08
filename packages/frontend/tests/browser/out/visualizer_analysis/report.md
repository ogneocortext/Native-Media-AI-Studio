# Visualizer Analysis — 9/5/2026, 12:08:33 PM
- Mode: shader | Track: auto | Duration: 3s @ 2fps | Threshold: 20
- Model: qwen3-vl:4b | Prompt: comprehensive

## Quantitative Motion
- Frames: 6 (5 pairs)
- Avg changed: **68.90%** | Median: 72.44% | Min: 44.67% | Max: 82.16% (frame_001.png -> frame_002.png)
- StdDev: 12.79% | Max pixel delta: 246 (96.5%)
- Motionless pairs: 0/5 (0.0%) | Black/flat frames: 0/0
- Verdict: **HEALTHY_MOTION** — Motion looks continuous.

### Per-pair trend
| Pair | Changed % | Max delta |
|------|----------:|----------:|
| frame_000.png -> frame_001.png | 44.67% | 246 |
| frame_001.png -> frame_002.png | 82.16% | 242 |
| frame_002.png -> frame_003.png | 69.86% | 227 |
| frame_003.png -> frame_004.png | 75.39% | 234 |
| frame_004.png -> frame_005.png | 72.44% | 229 |

### Next steps (from quant)
- Motion looks healthy — proceed to vision quality pass.

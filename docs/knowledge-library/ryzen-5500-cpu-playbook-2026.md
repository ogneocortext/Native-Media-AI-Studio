---
tags:
  - performance
  - audio
aliases:
  - Ryzen 5 5500 CPU Playbook 2026
  - CPU Playbook
cssclasses:
  - performance-guide
date: 2026-11-06
type: synthesis
status: current
---

# Ryzen 5 5500 CPU Playbook

The third hardware doc: [[pascal-gpu-optimization-2026]] covers the
1070 Ti's inference side and [[pascal-3d-budget-discipline-2026]] its
render side. This one covers the CPU — the chip every CPU-bound
pipeline in the studio actually runs on (audio separation,
transcription, encoding, decimation, dev tooling) — and the resource
that actually runs out on it, which is not speed. It is threads.

## 1. The chip (verified 2026-11-06)

| Fact | Value | What it decides |
|---|---|---|
| Cores / threads | 6 / 12 (Zen 3, Cezanne die, iGPU disabled) | The thread budget in §2 |
| Clocks | 3.6 GHz base / 4.2 GHz boost | Single-core-bound steps (Blender decimate) live here |
| Cache | 3 MB L2 + **16 MB L3** | Half a Ryzen 5 5600's L3 — cache-sensitive code feels it first |
| Memory | DDR4-3200, dual-channel, ~51.2 GB/s ceiling | §6 |
| PCIe | **3.0 only**, x16 for the GPU | §7 — upgrade math |
| Socket / TDP | AM4 / 65 W | §7 — the board's ceiling |
| Integrated graphics | **None** | The 1070 Ti is the only display output; no fallback |

Rig verification (CPU-Z, owner-supplied, 2026-11-06): board is an
ASUS TUF GAMING B550-PLUS WIFI II, BIOS 3611 (2024-09-30); the CPU
reports revision CZN-A0 with AVX2 / FMA3 / AES / SHA present (the
instruction set §3's int8 guidance assumes); the 1070 Ti (MSI card,
Micron GDDR5) negotiates a full PCIe 3.0 **x16** link.

## 2. The thread budget

The one rule everything else follows: **12 threads is not 12 cores.**
An SMT sibling is a fractional core — it shares the execution units
with its twin. Software that sizes itself to "all logical processors"
and means it will oversubscribe this chip the moment two such jobs
meet, and today nothing in the stack stops that: there are **no
thread caps anywhere in the backend** (no `set_num_threads`, no
`OMP_NUM_THREADS` — verified by grep, 2026-11-06), and the audio
pipeline's Demucs runs inherit PyTorch's defaults, which claim every
logical core they can see.

Standing rules:

1. **One heavy job owns the chip.** A job in the solo lane (§4) may
   use its defaults. Two heavy jobs never run uncapped at once.
2. **When a job must share, cap it in physical cores**: 6, not 12 —
   `OMP_NUM_THREADS=6` / `torch.set_num_threads(6)` for torch jobs,
   `cpu_threads=6` for CTranslate2, `-threads 6` for ffmpeg.
3. **Batch work is sequential, not parallel.** Ten Demucs tracks run
   one after another at full speed; running three at once gives each
   a third of the chip plus contention overhead, and all three finish
   later than the queue would have.
4. **Measurement runs need a quiet chip.** Headed frame-time checks
   (the T-VIZ-17/18 p95 work) are CPU-timing-sensitive: a background
   Demucs or encode job poisons the measurement. Heavy CPU work and
   headed verification never share a window.

## 3. Per-workload settings

**Demucs (audio venv, torch CPU).** Current measured baseline:
`python -m demucs --two-stems vocals` separates a vocal stem in
~4 minutes for a 2:20 track at defaults (pipeline measurement,
2026-11-01). Solo: leave defaults. Concurrent with anything: cap to
6 threads via the environment before launch. Batch: sequential
(§2.3).

**faster-whisper (transcription route).** CTranslate2 on CPU:
`compute_type="int8"` (Zen 3 has the AVX2/FMA path int8 wants),
`cpu_threads=6`, `workers=1` for single-file work. Transcription is a
solo-lane batch job; its output feeds the transcript-first editing
workflow, so it queues rather than competes.

**Local LLM CPU fallback.** GPU remains the primary route (Atomic
Chat; 4B class synchronous, 9B warm — per the standing routing
rules). When a model does run on CPU (llama.cpp / Ollama), set
threads to **6 physical cores**; 12 buys little and can cost
latency. Prompt processing is the CPU-bound phase; generation on CPU
is a batch tool, never an interactive one.

**Blender decimation (gen3d ingest).** The Decimate modifier's work
is effectively single-core per process — no flag makes one Blender
process use the chip. Batch throughput scales by running **parallel
Blender processes** (2–3 at these mesh sizes, watching RAM), which is
the opposite shape from the torch rule in §2.3: processes, not
threads, and only because each process is single-threaded.

**Dev tooling (Kilo: tsc / vitest / ESLint).** Defaults are fine in
the solo lane. During a batch-lane window, expect dev checks to slow
and vice versa — schedule full test suites into the batch lane rather
than letting them collide with an encode or a separation run.

**Backend services.** GPU-side generation still spends CPU on
pre/post-processing and data loading: keep dataloader workers ≤ 2.
On a 6-core chip, a dataloader sized for a workstation starves the
very pipelines §4 is trying to protect.

## 4. Concurrency lanes

| Lane | Occupants | Rule |
|---|---|---|
| Solo | Demucs run · x264 master encode · full test suite · headed verification | Owns the chip; nothing else heavy starts |
| Split | Transcription (capped 4) + light dev work · one Blender decimate process + interactive work | Every occupant capped; caps sum to ≤ 6 physical cores |
| Never | Two uncapped torch jobs · Demucs ∥ x264 master · any heavy job ∥ headed frame-time measurement | Reschedule, don't "try it and see" |

## 5. The encode decision: NVENC vs x264

Settled once, here:

- **Drafts, previews, iteration renders → NVENC** (the 1070 Ti's
  encoder). It costs the CPU nothing, it is fast, and Pascal-era
  NVENC quality — a generation behind Turing and later — is not the
  bottleneck for anything that will be re-encoded or thrown away.
- **Final masters → x264**, medium-preset class, as a solo-lane
  batch job. CPU encoding buys better quality per bit, and a master
  is the one artifact whose bits are never wasted: YouTube re-encodes
  from what is uploaded, so upload quality is where quality is kept.
- **Never x264 during interactive work.** The master encode is
  scheduled, not squeezed in.

## 6. Memory and storage

- 32 GB capacity is not a constraint for any current workload; leave
  it alone.
- Bandwidth is the quiet ceiling: DDR4-3200 dual-channel tops out
  near 51.2 GB/s, which is what the data-locality rules in
  [[pascal-3d-budget-discipline-2026]] §6 spend. **Configuration
  verified (CPU-Z, 2026-11-06):** the 32 GB is a Corsair Vengeance
  LPX kit (CMK32GX4M2E3200C16, Samsung dies, dual-rank) populated
  2×16 GB in slots A2/B2, channel mode 2×64-bit, XMP active and
  running at its rated DDR4-3200 CL16-20-20-38 1T with the memory
  controller 1:1 at 1600 MHz. This is the correct configuration —
  there is no hidden single-channel penalty to find here.
- The system SSD is SATA (~550 MB/s): model and asset load times are
  disk-bound, not CPU-bound. A slow model load is not a CPU problem
  and no thread setting will fix it.

## 7. Platform facts for future decisions

- **GPU upgrades are not PCIe-choked here.** PCIe 3.0 x16 ≈ PCIe
  4.0 x8 in bandwidth; for this studio's workloads a future card at
  x16 Gen 3 loses little. Judge a GPU upgrade on VRAM and raster,
  not on the slot. (This machine's x16 link width is verified, §1 —
  the slot is not silently running at x8.)
- **Gen 4 NVMe drives run at Gen 3 speeds** in this platform — buy
  capacity and endurance, never a Gen 4 speed premium.
- **AM4 is the ceiling and the opportunity:** the board tops out at
  the Ryzen 5000 series on the same DDR4 — the drop-in path exists
  (up to and including the X3D parts) if CPU ever becomes the
  binding constraint, with no platform swap required.
- **No iGPU** (§1): if the 1070 Ti is out of the machine, there is
  no picture. Any GPU swap plan includes that window.

## 8. Measurement

The numbers that belong in [[hardware-benchmark-harness]] and should
be re-baselined there when settings change: Demucs minutes per track
(defaults vs capped), faster-whisper real-time factor at int8/6
threads, x264 master-preset encode fps, NVENC encode fps. This doc
states the rules; the harness owns the evidence for them.

## Sources

Chip specifications cross-checked 2026-11-06 against multiple
specification listings of AMD's published data (NanoReview,
CPU-Monkey, and retailer spec tables agree on every value in §1).
Workload measurements are the studio's own (audio pipeline notes,
2026-11-01). No external books were needed or used — this is a
consolidation of the project's own pipelines plus vendor facts.

## Related

- [[pascal-gpu-optimization-2026]] — GPU inference companion
- [[pascal-3d-budget-discipline-2026]] — GPU render companion; §6 is the render-loop half of this doc's thread rules
- [[hardware-benchmark-harness]] — where this doc's numbers are re-baselined
- [[music-gen-hardware-fit-2026]] — model/hardware fit context

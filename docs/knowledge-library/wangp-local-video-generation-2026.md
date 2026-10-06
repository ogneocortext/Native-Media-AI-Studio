---
tags:
  - technical
  - ai
  - performance
aliases:
  - WanGP Local Video Generation 2026
  - Wan2GP Evaluation
  - Local Text-to-Video on 8GB VRAM
cssclasses:
  - technical-guide
date: 2026-10-06
---

# WanGP — Local Video Generation on Consumer GPUs (Evaluation 2026-10-06)

> [!info] Purpose
> Evaluation of [WanGP](https://github.com/deepbeepmeep/Wan2GP) (formerly
> Wan2GP, v17.00 as of 2026-10-06) as a **local, no-API** source of generated
> video plates for Native Media AI Studio: backgrounds, B-roll, and
> transparent overlays composited by the HyperFrames/FFmpeg pipeline.
> Prepared by Orion from the upstream README; not yet installed or benchmarked
> on the studio workstation — treat timings as claims to verify.

## What it is

WanGP is a self-described "one-stop super app for the best open source
generative models across video, image, audio, and text-to-speech," built
explicitly for the "GPU poor": select models run with as little as **6 GB of
VRAM**, and GTX 10xx cards have a dedicated install path. ~10k GitHub stars,
1,834 commits, very actively maintained (v17.00 released 2026-10-06).

**Video models:** Wan 2.1/2.2 (+derivatives), MiniMax H3, LTX-2/2.3/2.5,
HunyuanVideo 1/1.5, LongCat, Kandinsky, LTXV.
**Image models:** Krea 2, Qwen Image, Flux 1/2, HiDream, Ideogram 4.
**Audio:** Ace-Step 1/2/XL (same family as the ACE-Step 1.5 music model),
**YuE2** (song generation billed as SUNO 5-class, runs in **4.5 GB VRAM** —
see below), Stable Audio 3, MiniMax Music, several TTS engines.

**v17.00 VRAM numbers** (from [@deepbeepmeep](https://x.com/deepbeepmeep/status/2107211034494697900),
2026-10-05): MiniMax H3 15s @1080p went from 25 GB to **11 GB VRAM**, up to
25% faster, no quality loss. Per [@cocktailpeanut](https://x.com/cocktailpeanut/status/2084486741742809093):
H3 needs **5-6 GB for 5s** (124 frames), **8-9 GB for 15s at 832x480**.
An 8 GB card sits comfortably in the 5s-clip band — matches the "short
plates" verdict below.

## Fit for the studio workstation (GTX 1070 Ti 8 GB, 32 GB RAM, Windows 11)

| Factor | Assessment |
|---|---|
| VRAM floor | 6 GB minimum for select models → 8 GB clears it |
| GTX 10xx support | Explicit: dedicated install section, "Older Nvidia GPU support: use GTX 10XX" |
| Pascal caveat | 1070 Ti is sm_61, no tensor cores — expect slow generation, no FP16 acceleration. The repo's own `python-environment-management` doc covers the Pascal PyTorch wheel matrix; WanGP's GTX path presumably handles it, verify on install |
| Realistic workload | Short clips at 480p, stills for image-to-video. LTX family is the speed pick (distilled, low-VRAM); Wan 2.x is heavier |
| RAM offload | 32 GB system RAM allows aggressive layer offloading, which is how 8 GB cards survive these models |
| Windows | One-click `install.bat` / `run.bat`; no WSL required |

**Verdict:** viable as an offline asset generator for short plates and stills.
Not viable for long-form or 1080p on this card — and it doesn't need to be:
the studio composites in HyperFrames/FFmpeg, so WanGP only has to produce
short loops and plates.

## Integration paths (all local, no third-party API)

1. **Headless batch CLI** (recommended first): `run.bat` headless mode launches
   image/video/audio batches from the command line. The studio backend can
   shell out to generate a plate for a storyboard scene, then composite it.
   Lowest coupling, easiest to gate behind a feature flag.
2. **WanGP API**: a local HTTP API to "add generative capabilities to your own
   apps." This is localhost, not a cloud API — it complies with the
   no-third-party-API rule. Evaluate after the CLI path proves the quality.
3. **Generation queue + galleries**: queue up plates for a whole track and
   collect them later; the gallery UI lets a human approve plates before they
   enter the asset library.

## Features directly relevant to the studio

- **LTX-2.5 Alpha Gen**: extracts a soft alpha matte from any video → PNG
  frames or ProRes 4444 with transparency. This is the local, open implementation
  of the transparent-overlay idea in [[social-platform-video-research-2026]] —
  no Premiere plugin fork required.
- **LTX-2.5 Layout to Render**: turn a rough viewport animation/playblast into
  a finished shot (layout video drives camera/placement, a reference image sets
  the look). Potential bridge: studio's Three.js preview → finished AI plate.
- **Built-in prep tools**: mask editor, background remover, pose/depth/flow
  extractors — the unglamorous tooling a plate pipeline needs.
- **Ace-Step music models**: same family as the ACE-Step 1.5 music generator;
  if the studio ever wants local music beds, they're in the same app.
- **YuE2 song generation**: billed as SUNO 5-class output at 4.5 GB VRAM
  ([@cocktailpeanut](https://x.com/cocktailpeanut/status/2099906093946118624)).
  A local song generator inside the same app as the video models collapses
  the studio's music+video stack into one local install — worth A/B'ing
  against Suno v6-mini once the music side needs local generation.
- **Temporal upsamplers** (RIFE, FlashVSR): squeeze more perceived quality out
  of 480p generations.

## Risks and open questions

- **License**: GitHub reports NOASSERTION; the README says "free to use
  locally" and "will never ask you to pay a license fee." Read `LICENSE.txt`
  before bundling or redistributing anything — local use is the safe case.
- **Model licenses**: WanGP is the runner; individual checkpoints (Wan,
  Hunyuan, Flux) carry their own licenses. Commercial-use review per model.
- **Disk**: video checkpoints are tens of GB each. The ACE-Step note from the
  video research (11 GB) applies here too — budget disk per model family.
- **Speed on Pascal**: unverified. First benchmark should be: LTX-2.x,
  480p, 5 seconds, time it. If it's >10 min, restrict WanGP to stills +
  image-to-video.
- **No affiliation warning**: upstream warns about copycat sites — install
  only from the official GitHub repo or wangp.ai / wan2gp.ai.

## Suggested evaluation order

1. Install via `install.bat` (GTX 10xx path), generate one 480p LTX clip, time it.
2. Test headless CLI with a fixed prompt + seed → check determinism for plates.
3. Test LTX-2.5 Alpha Gen on a clip → transparent overlay into a HyperFrames composition.
4. Only then: evaluate the local API for backend integration.

## See also

- [[video-model-test-protocol-2026]] — existing LTX/Mochi 8GB viability protocol for this exact GPU (GTX 1070 Ti, Pascal sm_61); run WanGP candidates through it
- [[social-platform-video-research-2026]] — transparent overlays, reference-video breakdown
- [[hyperframes-results-improvement-2026]] — F4 art direction (plates feed this)
- `docs/knowledge-library/python-environment-management.md` — Pascal wheel matrix
- https://github.com/deepbeepmeep/Wan2GP — upstream

_Last updated: 2026-10-06_

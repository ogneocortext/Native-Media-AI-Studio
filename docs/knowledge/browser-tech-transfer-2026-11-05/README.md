---
tags:
  - visualization
  - webgpu
  - wasm
  - research
  - architecture
---

# Browser Tech Transfer — What the NFSU2 Browser Port Gives the Visualizer (2026-11-05)

**Question from the owner:** the fan port of Need for Speed: Underground 2
running in a browser (nfsu2.xyz, "Underground 2 Revived") uses interesting
tech — what is it, and what of it applies to this repo's visualizations and
3D visuals synchronized to tracks?

**Short answer:** the port's headline technique (static recompilation) does
not transfer — there is no legacy binary here to port. Three things do:
the ahead-of-time principle behind it (already this repo's architecture),
WebGPU compute (one bounded spike, registered as T-VIZ-40), and — only if a
profile ever indicts the JS analysis path — Wasm DSP. The browser-caching
trick is already landed for analysis (T-VIZ-37). Details and evidence
below; every verdict is grounded in the current tree, not in the state of
the repo when this question was first sketched on 2026-11-05 (the gate
items T-VIZ-15/16/18/19 landed the same week — see §3).

## 1. What the port actually does

Sources: the project's own pages and repositories (th0mk/nfsu2-web,
TalhaMudo/NFSU2Recomp), the nfsu2.net field guide (checked 2026-10-28),
XDA's coverage (2026-11-04), cross-checked 2026-11-05.

- **Static recompilation, not emulation.** The PC game's x86 code was
  translated to C ahead of time (NFSU2Recomp, following the
  XenonRecomp/N64Recomp method), then compiled to WebAssembly. Nothing
  interprets the original binary at runtime; that is why it reaches up to
  120 fps in a tab.
- **WebGPU graphics.** The game's Direct3D 9 rendering was adapted to
  WebGPU; sound runs on Web Audio. WebGPU is a hard requirement (recent
  Chrome/Firefox).
- **Streamed delivery + browser-side caching.** The build and ~2 GB of
  game data are served by the project host and cached in browser storage,
  with a settings panel to preload or delete. The GitHub repositories ship
  **no** game code or data — self-hosting requires the user's own v1.2
  `SPEED2.EXE`. (That split is also the project's legal posture: the
  hosted site distributes EA's data; the code does not. Not this repo's
  problem, but it is why "the tech" and "the site" have different
  expected lifetimes.)
- **Threading via cross-origin isolation** (SharedArrayBuffer), and a
  custom WebSocket multiplayer layer. The port was built with substantial
  Claude Code assistance, per the project itself.

## 2. Transfer verdicts

### 2.1 Static recompilation — does not transfer; its principle does

There is no binary to recompile: this repo's visuals are authored, not
ported. What transfers is the performance philosophy — *do the expensive
translation once, ahead of time, so the runtime loop is dumb and fast*.
The studio already works this way (Demucs stems, librosa analysis, section
and beat grids computed at import; the render loop consumes precomputed
curves — T-VIZ-19's interpolated spectral timeline is the same idea at the
sampling layer). Treat any proposal that moves heavy computation into the
per-frame loop as a regression by definition.

### 2.2 WebGPU — partially here already; the unlock is compute; one spike

Current state of the tree (verified 2026-11-05):

- An **opt-in WebGPU path already exists**: `?webgpu=1` or
  `localStorage["nma.visualizer.webgpu"] = "1"`, default stays WebGL
  (`webgpu/WebGPURendererDetector.ts`).
- **TSL post-processing already exists**: `webgpu/WebGPUPostFX.tsx`
  (bloom, chromatic aberration, vignette, grain in three r185 TSL) and
  renders nothing on the WebGL fallback; the T-VIZ-18 governor already
  accounts for both post paths.
- **The blocker is documented in the detector itself**: three r185's
  WebGPURenderer has no GLSL path (NodeMaterial/TSL only), and the scene's
  particle system and backdrop dome are GLSL `ShaderMaterial`s — forcing
  WebGPU would black-screen those layers. That, not renderer plumbing, is
  why WebGPU is opt-in today.

So the remaining WebGPU question is narrow and concrete: **what does a
compute-driven layer buy over the current fragment/vertex approach?**
Compute shaders are the actual unlock — particle populations and feedback
simulations that today need ping-pong fragment tricks (ShaderCanvas lane)
or CPU/vertex updates can live entirely on the GPU. That is also what the
parked Art-Field Particles idea (mode research §6, deliberately
unregistered) was waiting on. It does **not** require porting the mode
library; it requires porting *one* GLSL layer to TSL as a measurement.

Registered as **T-VIZ-40** (see §3). Explicit non-goals: no library-wide
GLSL→TSL port, no default flip away from WebGL, no ShaderCanvas-lane work,
no Canvas2D changes.

### 2.3 Wasm DSP — a measured second step, not a presumption

The port's pipeline shape (native code → Wasm) maps onto this repo's live
analysis path: FFT, spectral flux, onset detection. But T-VIZ-16 landed
that path in JS (`spectralFlux.ts`, unsmoothed twin analyser,
`getFloatFrequencyData`), with a worker path already present in
`useRealAudio`, and no profile has indicted it. Repo rule: measure before
claiming a defect. Verdict: **no Wasm work is registered.** If a headed
profiling session ever shows the JS flux/envelope path costing frames at
the governor's 20 ms p95 budget, a Wasm spike becomes a new item at that
time, scoped to the indicted function only. One design constraint to
record now, before anyone designs around it: threaded Wasm
(SharedArrayBuffer) requires cross-origin isolation (COOP/COEP headers)
on the serving app — cheap locally, but it must be planned, not
discovered mid-implementation.

### 2.4 Browser asset caching — already landed where it mattered

The port caches gigabytes in browser storage with a manage/delete UI.
The studio analogue for analysis already shipped: **T-VIZ-37** caches
analysis in localStorage so repeat visits skip the ensure-analysis
round-trip (backend DB/disk cache verified behind it). The remaining
piece — stems and rendered previews in OPFS/IndexedDB — is a storage
convenience, not a sync or quality improvement, and is **not** registered;
revisit only if project-reopen latency becomes a measured complaint.

## 3. The spike: T-VIZ-40

**Gate history.** When the owner approved this write-up (2026-11-05), the
spike was framed as gated behind the T-VIZ-15/16/19 data contracts, per
the smoothness plan's "no WebGPU rewrite" non-goal. Those contracts
landed 2026-11-05/06 (envelope stage, float dB + onset path, beat-phase
anticipation; T-VIZ-18 governor alongside), so the gate is **cleared**.
One precondition remains, in the repo's own recurring pattern: the
headed-session measurements T-VIZ-15/16/18 deferred. The spike therefore
starts by taking the WebGL baseline it will be judged against.

**Scope — one layer.** Port the R3F particle layer that the detector
names as a WebGPU blocker (the GLSL `ShaderMaterial` particle system used
by the viz-styles scenes) to a TSL/NodeMaterial equivalent whose particle
update runs in a WebGPU compute pass, behind the existing opt-in. The
backdrop dome is explicitly out of scope (second blocker, separate
decision if the spike pays off).

**Acceptance sketch** (full Plan in the task item): with the opt-in on,
no black-screened layers in the ported scene; frame time at DPR cap
inside the T-VIZ-18 governor budget (20 ms p95) with a measured
improvement or capability gain over the WebGL baseline taken in step 1 —
if there is neither, the spike's correct outcome is a written negative
result and no merge; with the opt-in off, zero behavior change. A spike
that cannot fail is not a spike.

**Why this is worth one item and no more:** WebGPU is where the
catalogue's one parked idea (art-field particles) and any future
simulation-style modes live, and the repo is one GLSL layer away from
being able to measure it honestly. It is not worth a platform migration:
WebGL remains the default and the compatibility floor, Firefox's WebGPU
is recent, and every existing mode works today.

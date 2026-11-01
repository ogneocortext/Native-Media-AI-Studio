---
tags:
  - creative
  - 3d
  - ai-agents
aliases:
  - 3D Viz Code Harnesses
  - Code Harnesses for 3D
cssclasses:
  - technical-guide
date: 2026-11-01
type: concept
---

# Agent Code Harnesses for 3D and Visualization

Owner question, 2026-11-01: what open code exists to expand this
project's agent harness specifically for **driving the 3D and
visualization surfaces** (Blender, Unity, Three.js/WebGL shaders),
in pieces separable from the main app and called when needed.
Bounded scan of three lanes; verdicts below. Companion doc:
[[programmatic-tool-calling-2026]] (the general harness patterns).

## Lane A — Blender code generation

- **LL3M** (arXiv 2508.08228, Aug 2025; Blender 4.4) — the
  architecture template. A multi-agent team writes interpretable
  Blender Python: a **planner**, a **retrieval** agent backed by
  BlenderRAG (a knowledge base built from Blender API docs), a
  **coding** agent (full bpy: B-meshes, geometry modifiers, shader
  nodes), and a **vision critic** that verifies renders. Each role
  runs a different model picked for that job — the same shape as
  this project's tiered roster, applied to 3D.
- **SceneCraft** (ICML 2024) — the model never places objects
  directly. It builds a **scene graph**, translates spatial
  relations into numerical constraint functions, a solver computes
  the layout, a VLM reviews the render, and solved constraint
  functions are compiled into a **reusable library** ("library
  learning") that grows across sessions.
- **Infinigen** (Princeton, BSD) — not a harness but a procedural
  engine an agent drives. 3D-GPT's design is the pattern: the LLM
  writes parameters, Infinigen builds the scene. The separable
  piece an app calls for procedural content.
- **Bridge state:** `ahujasid/blender-mcp` (~26k stars) is the de
  facto standard this project uses; since 2026 the **Blender
  Foundation's own Blender Lab ships an official MCP server**
  (`projects.blender.org/lab/blender_mcp`). A comparison note
  against the current bridge is part of T-AGT-03.
- **Loop economics (3DCodeBench, May 2026; Blender 5.0):** feeding
  tracebacks back to the model nearly eliminates crashes
  (executability 0.702 → 0.974), but **extra refine turns do not
  improve shape quality once the code runs**. Frontier models write
  executable bpy ~90% first-try; a small flash model scored 0.464.
  Consequences adopted here: traceback feedback is always on;
  visual-refine is capped (one critic pass); scene code is written
  by a Tier A route, with local 4B/9B models in retrieval,
  execution, and verification roles only.
- **Security note:** blender-mcp's `execute_blender_code` is an
  unrestricted `exec()`; prompt injection through scene
  descriptions and .blend contents is a live vector. This is a
  structural argument for the spec-first shape below: the model
  emits data, a validator checks it, and the only Python that runs
  is the project's own builder.

## Lane B — Unity / real-time 3D

- **CoplayDev/unity-mcp** ("MCP for Unity") — MIT, ~15k stars,
  v10.3.0 (Oct 2026), actively maintained. ~50 tools: scenes,
  GameObjects, components, prefabs, materials, camera, physics,
  C# script editing with Roslyn validation, tests, profiling,
  builds — plus `batch_execute`, several commands in one call (the
  T-PLT-08 batching pattern, built in). Works with any MCP client,
  Unity 2021.3 LTS → 6.x. This repo's own `unity-mcp-bridge` ships
  disabled and is far behind it. **Evaluation opened as T-PLT-09** —
  the one clear adoption candidate in this scan.
- **Holodeck** (AI2, CVPR 2024) and **Holodeck 2.0** — the LLM
  designs floor plan + spatial constraints, CLIP retrieval picks
  assets from a 50K+ library (2.0 generates assets instead), a
  constraint solver places them, and the output is a **scene JSON**
  that Unity loads (2.0 also exports interactive scenes to
  Unreal). Indoor/embodied-AI oriented — not this visualizer's
  shape — but the spec → retrieval/solver → scene-JSON pipeline is
  the reference design for T-VID-05.

## Lane C — Web visualization / shaders

No mature framework exists in this lane; what ships is skills and
loop designs:

- **img2threejs** (GitHub, agent skill) — rebuilds a reference
  image as code-only procedural Three.js through staged passes:
  assessment/spec → factory pass emitting a Three.js `Group` →
  multi-angle render review with material comparators and quality
  gates. The skill-shaped harness: it installs into an agent the
  way `.kilo/skills/` entries do here.
- **Hermes p5.js skill** (NousResearch/hermes-agent, bundled) — a
  production-pipeline skill file: p5.js/WebGL/GLSL, audio-reactive
  work via FFT, headless high-res export via Puppeteer + ffmpeg.
  Evidence that in this lane the harness *is* a skill file plus a
  headless render loop.
- **AI Co-Artist** (paper, aiXplain) — GLSL shader *evolution*: a
  population of fragment shaders is mutated and crossed over by
  the LLM, compile-gated (failures retry, max 5), driven by an
  audio uniform (`u_audio`) for beat-reactive effects, with an
  optional VLM aesthetic judge closing the loop. The loop design
  maps directly onto this project's audio-reactive shader work
  even though the code is not adopted.

## Cross-lane conclusion

The strongest systems in every lane share one shape: **the model
writes data, not free-form code against the app** — a scene graph,
a constraint set, a JSON spec, a parameter set — and a
deterministic builder or solver executes it. This project's intro
recipes and storyboard specs are already that architecture;
extending the spec discipline from video intros to 3D scenes is
the growth path the evidence supports (T-VID-05). The two
supporting disciplines: error feedback is the loop that pays
(traceback/compile), visual refine plateaus fast — budget
accordingly; and solved problems should compile into a reusable
library (SceneCraft's library learning is this repo's
knowledge-library habit, applied to scene code).

## Work opened from this scan

- **T-PLT-09** — Evaluate CoplayDev/unity-mcp against the in-repo
  Unity bridge (fixed task battery, recorded verdict).
- **T-VID-05** — Design a spec-driven 3D scene builder (scenes as
  data; design only, no rendering).
- **T-AGT-03** — Ground 3D code generation: Blender API retrieval
  pack + traceback-first loop contract with refine caps.

## References

- [LL3M project page](https://threedle.github.io/ll3m) — multi-agent Blender codegen; arXiv 2508.08228.
- SceneCraft, ICML 2024 — arXiv 2403.01248 (scene graph → constraints → solver → library learning).
- [Holodeck project page](https://yueyang1996.github.io/holodeck/) — language-guided 3D environments; arXiv 2312.09067.
- [CoplayDev/unity-mcp](https://github.com/CoplayDev/unity-mcp) — MCP for Unity (MIT).
- [img2threejs](https://github.com/img2threejs/img2threejs) — image → procedural Three.js, skill-shaped, quality-gated.
- 3DCodeBench (May 2026) — arXiv 2606.01057; executability vs. feedback-type measurements cited above.

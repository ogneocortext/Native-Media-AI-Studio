---
tags:
  - ollama
  - prompt-engineering
  - vision
  - structured-output
aliases:
  - Ollama Prompting Guide
  - Local LLM Prompt Best Practices
date: 2026-09-23
---

# 🤖 Ollama Prompting 2026 — Vision Grounding & Structured Output

> Research synthesis (Sept 2026) applied to `tools/mcp/*`, `tools/vision/*`,
> `packages/frontend/.../AISceneGenerator.tsx`,
> `packages/backend/app/services/music_prompt_generator.py`.
> Sources: Prompt Bench multimodal guides, CodeWorm production VLM patterns,
> UnAC (ACL 2026 Findings), CVPR 2026 VGA hallucination study, Toolsmart VLM
> guide, Ollama structured-outputs docs/blog, GBNF/grammar agent reports,
> arXiv 2609.23742 (constrained decoding vs scale).

## 1. Vision prompts: locate → task → steps → output

Directing a VLM is like directing an intern with no shared context. Every
vision prompt needs four layers (Toolsmart golden template):

1. **Locate** — what to look at (regions, positions, not "this image").
2. **Task** — one verb-led job ("verify X", not "look for problems").
3. **Steps** — observe → describe → reason → conclude (visual chain-of-thought;
   measurably better on multi-step tasks, skip for pure transcription).
4. **Output** — exact shape (JSON fields / table columns / bullets).

## 2. Grounding + uncertainty (highest ROI per token)

Failure modes are predictable: hallucinated details, missed small text,
confident wrong counts. Mitigations, now appended to EVERY vision call in
`tools/vision/analyze.mjs` (`GROUNDING_SUFFIX`):

- "Describe only what is actually visible. Do not infer beyond the pixels."
- "If an element is not visible, say NOT VISIBLE — do not guess."
- "For text: transcribe verbatim; mark unreadable regions [unclear]."
- "For counts: enumerate each item before stating the total."

Per Claude/Anthropic guidance: "If you cannot tell, say so" is the single
highest-ROI sentence — it converts silent hallucinations into routable
uncertainty. OCR/table/chart modes additionally run at temperature 0.

## 3. Structured output: constrain the sampler, not just the prompt

- "Return ONLY JSON" is a *request* the model may ignore (our Blender/Unity
  planners needed regex salvage for exactly this).
- Ollama `format: <JSON-schema>` compiles to a GBNF grammar that *masks*
  invalid tokens — the model physically cannot emit malformed JSON
  (Ollama ≥0.5; our server is 0.34 ✓; `OllamaAdapter` already passes
  `format` through — see `adapters/ollama.py:445,545`).
- Rules: keep schemas FLAT (deep nesting degrades output); keep the
  "return JSON" instruction in the prompt anyway (grammar controls shape,
  prompt controls intent); temperature ≤0.2 for extraction; still validate
  semantically — constrained decoding guarantees *valid* JSON, not *correct*
  values (arXiv 2609.23742: type errors are rescued, semantic errors are not).
- Applied 2026-09-23: `plan_blender_script` and Unity `plan_unity_scene`
  now send `format` schemas. Backend `music_prompt_generator` already used
  `format: "json"` (upgrading it to a full schema is future work — its
  `_normalize`+`validate_output` repair path works).

## 4. Code-gen prompts: contract + forbidden list + few-shot

The strong template (`AISceneGenerator.tsx`): numbered CONTRACT the validator
checks, explicit FORBIDDEN list, one minimal few-shot example (copy structure,
change content), line budget, capability allow-list ("use ONLY these APIs").
The Unity planner was upgraded to the same shape 2026-09-23 (was: one-line
system prompt, zero examples). Rule of thumb: one negative example
("don't do X") is worth a paragraph of rules for small (3–9B) models.

## 5. Latency policy (8GB VRAM reality)

- `num_predict` is a CAP, not a target — short answers stop at EOS. Starting
  at 4096 costs nothing extra and avoids a second full generation
  (fixed 2026-09-23: 43s→17s on UI audits).
- Never retry into a different model on heuristic suspicion alone — model
  swaps churn VRAM (unload + cold load). Retry same-model on
  `done_reason == "length"` only; track best-non-empty across attempts.
- Keep-alive 30m on the vision model (`opencode.json`); warm before
  first use (`warmModel` in `vision-mcp.mjs`).

## 6. Task → model routing (implemented 2026-09-23, `analyze.mjs`)

One prompt skeleton serves all models; per-model differences live in
`MODEL_PROFILES` (temperature, `num_ctx`, max input resolution) plus a
`MODE_MODEL` map — NOT prompt forks:

| Task | Model | Why (measured) |
|---|---|---|
| ocr / table / chart | minicpm-v:8b | RLAIF-V trustworthy; 10s warm OCR vs 14s gemma4 |
| compare / multicomp | qwen3-vl:2b | 262K ctx swallows image sets; fastest decode |
| everything else | gemma4:e2b-it-qat | best detailed audits |

Resolution rule: `min(computed, profile.maxDim)` — bigger is NOT better
past a model's native patches (qwen capped 1280, minicpm allowed 1792
for its 1.8MP OCR). Override any routing with `--model <name>`.

Stickiness (hysteresis): only one model fits in VRAM, and a cold load
costs 30–100s — more than any routing gain. So the mapped model loads
only when nothing vision-capable is resident; otherwise the resident
model serves (verified via `/api/show` capabilities, never basename
guessing — a resident *text* model must not catch vision traffic).
`--json` reports the ACTUAL serving model (`Analyzing … with X (why)` on
stderr tells you which rule fired: `override|default|mode-map|
mode-map+resident|resident-sticky`).

## 7. Eval harness (`tools/tests/vision_eval.py`, baseline 2026-09-23)

Repeatable: 6 fixed cases (brief/full-res UI, brief/full-res OCR, grounding
probe, dark-vs-light compare) on checked-in screenshots. Run from repo root:
`python tools/tests/vision_eval.py [--only ID]`. Appends timestamped rows to
`vision_eval_results.jsonl` (status/secs/out_len/served_by). Re-run after any
prompt/routing change and diff the rows — that is the ground truth the
per-model tuning caveat above asks for.

Baseline (warm model, 8GB rig): 6/6 PASS — ui-low 24s, ocr-low 13s,
ui-full 29s, ocr-full 13s, grounding 10s, compare 39s. Unity planner fired
live through the edited bridge: 24s, zero invented commands. Blender schema
validated live with exact keys, no regex salvage.

## 6. What NOT to do

- Don't ask small VLMs to count without enumerating first.
- Don't put the whole 50-tool list in a planner prompt — narrow valid
  commands per call (the Unity planner sends only its 14 known commands).
- Don't use `format: "json"` (generic) when you can send a schema —
  `{"sure": "..."}` is valid JSON but useless.
- Don't disable thinking on thinking-capable models when using `format` —
  reported to silently drop the constraint (we use `think: false` only on
  non-reasoning models ✓).

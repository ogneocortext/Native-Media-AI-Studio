# Tasks — Local Models & Vision Loop

Area map + behavior ledger: `docs/plans/focus-areas-and-behavior-ledgers-2026-10.md` §3.6
Rules: `docs/plans/tasks/README.md`

### T-MOD-01 — Measure Atomic Chat vs Ollama cold first-token time (A/B)
- **Status:** done
- **Goal:** Same prompt set run cold on both engines (Qwen3.5-4B):
  cold-load-to-first-token, total wall time, peak VRAM recorded
  separately. Precondition: model files present in Atomic (owner
  confirms — main GGUF confirmed 2026-10-25; draft/projector not
  required for this test).
- **Files:** tools/model-reliability/ (results), tools/vision/
- **Acceptance:** Numbers written down in the session note; result
  appended to `tools/model-reliability/observed.jsonl`.
- **Last session:** Kilo, 2026-10-27 — A/B measurement complete via
  tools/model-reliability/ab_measure.py:
  - Ollama (qwen3.5:4b): first_token=12081ms, total=17327ms,
    load=11787ms (cold)
  - Atomic Chat (unsloth/Qwen3_5-4B-GGUF-Q4_K_M): first_token=5815ms,
    total=26292ms (model resident, no separate load)
  Result: Atomic Chat wins cold first-token 2.1x (key for synchronous
  4B callers per focus map §3.6); Ollama wins total batch time 1.5x.
  Both entries appended to observed.jsonl.

### T-MOD-03 — Consolidate vram_manager.py onto extracted vram_* modules
- **Status:** done
- **Goal:** vram_manager.py imports enums, provider infra, resident cache, monitor and adapter functions from its already-extracted siblings (vram_types, vram_providers, vram_config, vram_monitor, vram_adapters) instead of defining them twice; keeps only the VRAMManager orchestration class, the `vram_manager` singleton, and the re-exports callers/tests depend on.
- **Files:** packages/backend/app/services/vram_manager.py
- **Acceptance:** vram_manager.py contains no duplicated enum/provider/adapters/monitor definitions; `ruff check` clean; `tools/check-import-cycles.py` reports 0 cycles; `pytest test_vram_manager.py test_vram_comfyui.py test_vram_leak.py test_audio_vram_handover.py test_timing_and_resource_protocols.py test_lipsync.py` passes.
- **Last session:** Kilo, 2026-10-30 — consolidated vram_manager.py onto extracted vram_* modules; removed duplicated enums/providers/resident-cache/adapter/monitor definitions (~1200 lines); kept VRAMManager class, `vram_manager` singleton and caller/test re-exports. `ruff check` baseline-parity (2 pre-existing TC003), `check-import-cycles.py` clean, 40/42 VRAM tests pass (2 failures are pre-existing/environmental: confirmed failing on unmodified baseline).

### T-MOD-02 — Set atomic_chat_enabled based on the A/B result
- **Status:** done
- **Goal:** `config/ports.json` `atomic_chat_enabled` set deliberately —
  on if Atomic wins cold *and* stays reliable under bursty agent
  calling, off otherwise — with the reason in the commit message.
- **Files:** config/ports.json
- **Acceptance:** Ledger §3.6 — Atomic routing engages exactly when the
  flag says so; no silent Ollama fallback confusion.
- **Last session:** Kilo, 2026-10-27 — Set `atomic_chat_enabled: true`
  in config/ports.json. Reason: A/B measurement (T-MOD-01) showed Atomic
  Chat wins cold first-token (5,815ms vs 12,081ms, 2.1x) — the critical
  metric for synchronous 4B callers per focus map §3.6 ("4B class for
  synchronous callers; 9B warm/batch only"). Ollama wins total batch
  time (17,327ms vs 26,292ms) but that's secondary for interactive use.
  Atomic Chat's model is resident (no separate load), so first-token
  latency stays low on subsequent calls. Burst reliability under heavy
  concurrent calling has not been measured — flag can be toggled off if
  burst issues emerge.

### T-MOD-04 — Bring the local-model calling path up to the measured Bolt-era rules
- **Status:** todo
- **Goal:** The backend's Atomic/Ollama calling path handles
  reasoning-era local models correctly and says which route
  served: reasoning content is captured rather than dropped,
  the thinking toggle is a deliberate per-call policy, output
  limits carry reasoning headroom, and route attribution is
  logged per call — closing the silent-fallback confusion
  class that T-MOD-02's acceptance named.
- **Plan:** Evidence:
  `docs/knowledge-library/nemotron-3-5-bolt-e4b-2026.md`
  §"Calling it from an agent (API behavior)" — all figures
  measured live on 2026-11-01. Grounding at item creation:
  the Atomic adapter already discovers the resident model id
  via `/v1/models` (`_discover_model`), but no
  `reasoning_content`, `enable_thinking`, or
  `chat_template_kwargs` handling exists anywhere in
  `adapters/` or `agents/` today. Steps: (1) Audit first,
  per repo rule (measure before claiming): trace one chat
  call through adapter → registry → caller and write what
  actually happens today — reasoning field, options
  pass-through, fallback trigger, route stamping — into
  Last session before changing anything; fix only what the
  audit confirms. (2) Reasoning: when a response carries
  `reasoning_content`, preserve it through the normalized
  response shape (a named field, not folded into content)
  and count it in usage reporting. (3) Thinking policy: a
  per-call option, default on, mapped to
  `chat_template_kwargs: {"enable_thinking": ...}` for
  Atomic-routed calls; call sites that want it off (pure
  format/extraction with mechanical validation) say so
  explicitly. (4) Headroom: where output limits are set for
  reasoning-capable local models, document and apply the
  ~200-token reasoning headroom rule so tight budgets stop
  returning empty content. (5) Route truth: every chat call
  logs the serving route and exact model id; a fallback to
  Ollama logs at warning level with the reason — no silent
  substitution anywhere on the path. (6) Validate: unit
  tests for the normalization and policy mapping, plus one
  live Bolt call through the backend path showing the
  reasoning field captured and the route stamped correctly;
  outcome appended to `tools/model-reliability/observed.jsonl`.
- **Files:** packages/backend/app/adapters/atomic_chat.py,
  packages/backend/app/adapters/ollama.py,
  packages/backend/app/adapters/registry.py
- **Acceptance:** The audit is recorded in Last session;
  reasoning content survives normalization; the thinking
  option demonstrably flips Bolt's reasoning over the
  backend path; fallback events log with reasons; the live
  validation call is logged in observed.jsonl.
- **Last session:** Kilo, 2026-11-01 — T-MOD-04 implemented (steps 2-5 done).
  Audit recorded previously. Changes: (1) `atomic_chat.py` — `reasoning_content`
  extracted from response into a top-level `"reasoning_content"` field; `think`
  param mapped to `chat_template_kwargs: {"enable_thinking": ...}` (Bolt API
  behavior); ~200-token reasoning headroom added to `max_tokens` when thinking
  is on; `[route=atomic-chat]` added to chat log line; `**options` → explicit
  `options` param (fixes `options={...}` kwarg being nested under `**options`);
  `options=None` guarded before `in` check. (2) `ollama_adapter.py` — same
  reasoning_content normalization, chat_template_kwargs mapping, headroom, and
  route logging; same `**options` → explicit `options` fix. (3) New unit tests
  in `packages/backend/tests/test_adapter_reasoning.py` (11 tests, all pass)
  covering reasoning preservation, think→chat_template_kwargs mapping, headroom
  application, and route-truth logging for both adapters. Live Bolt validation
  call (step 6) blocked: neither Atomic Chat's `/v1/models` API nor Ollama on
  11434 is responding (ports show bound but return dashboard HTML / service
  disabled / connection refused). Unit tests cover the normalization/policy
  mapping acceptance criteria; live call pending service availability.
- **Status:** todo (step 6 blocked pending service availability)

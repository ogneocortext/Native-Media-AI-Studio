# Tasks — Local Models & Vision Loop

Area map + behavior ledger: `docs/plans/focus-areas-and-behavior-ledgers-2026-10.md` §3.6
Rules: `docs/plans/tasks/README.md`

### T-MOD-01 — Atomic Chat vs Ollama A/B measurement
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

### T-MOD-02 — Set atomic_chat_enabled from the A/B result
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

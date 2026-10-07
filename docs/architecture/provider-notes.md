# Provider behavior notes

> Append-only field notes per model+provider used on this repo. These are
> observations, not instructions — anything that graduates into a rule moves
> to `AGENTS.md` or `docs/architecture/decision-log.md` (D21).

## How to use this file

- On a provider switch, copy the template below and append a section. Do not
  rewrite existing sections — the history of what each model needed is itself
  useful.
- Record what you observe in the first session: what the model is strong and
  weak at, what it needs told explicitly, what it invents or skips.

## Recording the outcome (do this before you finish)

**Whichever model you are running, append one line per session to
`tools/model-reliability/observed.jsonl` before you wrap up.** This is the one
part of the handoff that only you can write, and the handoff is a chain: every
agent adds its own link or the next one starts blind.

```json
{"date": "2026-10-02", "model": "<id>", "route": "kilo|cline|opencode", "worked": true, "note": "what actually happened"}
```

- `worked` is a boolean — did *this session* complete work, not "was the
  response coherent". A session that hit a provider limit or died mid-stream is
  `false`, and that is the most valuable row to record.
- `note` should say something the next agent can act on ("needs explicit
  instruction to not skip tests", "429 after ~20 calls", "silently ignores
  TypeScript strictness"). Avoid "worked fine" — that is what `true` already says.
- Use `"model": "*"` with `route` for a route-level finding that applies to
  every model on that route, e.g. "most free-tier models listed here do not
  work on free accounts". Those print as route-level notes.

Read the ranking back with `python tools/model-reliability/score.py`.

Why this is tracked when the snapshots next to it are not: `observed.jsonl` is
hand-written ground truth that cannot be re-fetched, so it is the only layer
that carries a real session's outcome into the next one. The advertised
snapshots beside it are a regenerable listing of who is free *this week*, which
goes stale on its own and is rebuilt by one command. Keep the distinction when
extending this: **record outcomes here, re-derive listings.**

## Template

- **Model / route:**
- **First used:**
- **Strong at:**
- **Weak at:**
- **Quirks (needs explicit instruction for):**
- **Cost / access notes:**

## Space Bunny Alpha — OpenRouter `stealth/space-bunny-alpha` via Cline Desktop

- **Model / route:** `stealth/space-bunny-alpha` on OpenRouter, via Cline
  Desktop. Anonymous preview, owner unclaimed; independent tokenizer
  fingerprinting points to MiniMax M3.1 (unconfirmed).
- **First used:** 2026-10-01
- **Strong at:** proactive guard/checker tooling (encoding guard, nesting gate
  with a verify-the-gate script); honest commit messages that document failed
  attempts; the root-cause → fix → regression-guard → tests → document
  pattern.
- **Weak at:** TBD — record after more sessions.
- **Quirks (needs explicit instruction for):** commit-trailer discipline — the
  2026-10-01 batch shipped 25 commits without the `Co-authored-by` trailer
  after 13 earlier commits carried it. Remind per session.
- **Cost / access notes:** free during the preview. OpenCode announced it as
  free for one week from Sep 23, 2026 (≈ Sep 30); OpenRouter lists $0 with no
  firm end date, but the established pattern is the free price ends when the
  maker is named (Ox Alpha's window was ~6 days, closed on reveal). Cline
  publishes no separate end date — it reaches the model through OpenRouter's
  `stealth/space-bunny-alpha` route, so the OpenRouter preview window governs.
  Still $0 on all routes as of Sep 29 checks. Treat as temporary; do not build
  dependencies on its continued availability.
- **2026-10-06 addendum:** free preview ended — no longer free on the user's routes. Replaced as local coding agent by Ling 3.1 Flash (see below).

## NVIDIA Nemotron (family-level) — do not re-test blind

- **Model / route:** `nvidia/nemotron-3-ultra-550b-a55b:free`,
  `nvidia/nemotron-3.5-lightning:free`,
  `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`,
  `nvidia/nemotron-3-super-120b-a12b:free` — on both OpenRouter and the Kilo
  gateway.
- **First used:** the owner has been trying these periodically for several
  months (2026).
- **Strong at:** nothing established. Four variants carry the largest advertised
  context windows in the free catalogue (256k–1000k), which is exactly what makes
  them tempting.
- **Weak at:** consistently unusable on free tiers, across both routes. Two
  recurring failure modes: **server-overloaded responses**, and **output cutting
  out mid-stream** with nothing usable returned. Recurring across months, not a
  one-off outage.
- **Quirks (needs explicit instruction for):** none observed, because no variant
  has survived long enough to expose model-level behaviour. Recorded as four
  `worked: false` rows per route in `observed.jsonl`, which is what drops them to
  `0 / AVOID` in `score.py`.
- **Cost / access notes:** free on paper. The listing has been stable for months,
  which is **not** evidence of a working service — see the lesson below.

### Lesson: a long-lived free listing is not evidence of availability

Nemotron has been advertised free for many months and has failed every attempt.
Duration on a listing measures how long a provider has advertised, not how often
the backend has served a request. Providers list what is *offered*; only a
completed session proves anything.

Two consequences for anyone picking a model here:

1. Prefer a model with recorded `worked: true` sessions over one with a large
   advertised context window. `score.py` already encodes this — advertised
   listings are worth +20, a recent success +30, a recent failure −50 — so an
   untested Nemotron scored *the same* as an untested Poolside until this
   observation existed.
2. The cheapest way to avoid re-testing a bad model is to record the failure.
   One row costs seconds; re-discovering an overloaded route costs a session.

Note `nvidia/nemotron-3.5-content-safety:free` is a content-safety classifier,
not a coding model, and is deliberately **not** marked failing — it is simply
not a candidate.

## Kilo Code gateway (free account tier)

- **Model / route:** Kilo Code's model gateway on a free account; this month
  also Kilo and Cline pointed at OpenRouter `stealth/space-bunny-alpha`.
- **First used:** ~2024 — two years of use as of Oct 2026.
- **Strong at:** the longest-running reliable free inference the owner has
  found (best over the last 2 years). This month, Kilo and Cline both running
  Space Bunny Alpha are the most reliable combo.
  **2026-10-06:** Space Bunny Alpha's free preview ended; the current combo is Kilo Desktop running Ling 3.1 Flash (see below).
- **Weak at:** most free-tier models listed in the Kilo gateway do not
  actually work on free accounts — a listing is not a reliable signal of
  availability. Blind-testing models burns session time; run
  `python tools/model-reliability/score.py` first and pick from the top of
  the table.
- **Quirks (needs explicit instruction for):** Step 3.7 Flash (via Kilo
  gateway) worked for months at a time and is competent for most work — it is
  the known-good fallback when the current promo model is unavailable.
- **Cost / access notes:** free tier; individual model reliability degrades
  over time as providers tighten abuse controls.

## OpenRouter (direct API, and the backing route for Cline)

- **Model / route:** OpenRouter API (`https://openrouter.ai/api/v1`), used
  directly and as the backing route for Cline and other clients. Free models
  carry the `:free` suffix (e.g. `stealth/space-bunny-alpha`).
- **First used:** Oct 2026 (Space Bunny Alpha era).
- **Strong at:** largest advertised-free catalog of any route (21 models on
  the 2026-10-02 pull); the public models API makes the free list scrapable
  (see `tools/model-reliability/`).
- **Weak at:** the free tier is a trial, not a working tier — 20 req/min,
  **50 req/day** until $10 lifetime credits purchased (then 1,000/day, daily
  counter resets UTC). 50 requests is roughly three agentic tasks; past the
  cap, requests 429 until reset, which surfaces in clients as hangs and
  timeouts. An hour of real work burns the day's quota.
- **Quirks (needs explicit instruction for):** the `:free` suffix is
  load-bearing — the bare model ID is the paid twin and bills real money.
  Silent fallbacks to paid models also bill: pin exact `:free` IDs, disable
  paid fallbacks, and check the OpenRouter activity page for the exact billed
  model ID whenever pennies appear.
- **Cost / access notes:** no card needed for the free tier, but multi-account
  farming is explicitly defeated (limits governed globally per account). A
  one-time $10 credit purchase permanently lifts `:free` models to 1,000/day
  and the credits remain spendable — but that is still spend, so for a
  zero-spend strategy the cap is the wall and route rotation is the answer.

## Ling 3.1 Flash — InclusionAI via Kilo Desktop

- **Model / route:** Ling 3.1 Flash, by InclusionAI, via Kilo Desktop (Kilo Code).
- **First used:** 2026-10-06 — replaced Space Bunny Alpha as the local coding agent when its free preview ended.
- **Strong at:** docs maintenance at scale (knowledge-library refresh 77→84 articles, decision-log D1–D32/Q1–Q6 scope header, all in one session); honest commit messages documenting what changed; backend queue/polling fixes (ComfyUI deadline extension with fail-fast on lost prompts); test-structure repairs. First-day evidence only — 5 commits, all with `### <Type> - <description>` subjects.
- **Weak at:** TBD — record after more sessions.
- **Quirks (needs explicit instruction for):** commit-trailer discipline — the first 5 commits shipped without the `Co-authored-by` trailer. The convention was reinstated in repo `AGENTS.md` ("Commit attribution", 2026-10-06) with trailer `Co-authored-by: Ling 3.1 Flash` (no email — InclusionAI, not Anthropic). Remind per session until it sticks.
- **Cost / access notes:** free as of 2026-10-06 (per user). Treat as a promo window, not a guarantee — record the end date and any rate limits when they appear.

## Ollama (local server) — 127.0.0.1:11434

- **Model / route:** local Ollama server on Windows 11 /
  GTX 1070 Ti (8 GB). Default and vision model
  `gemma4:e2b-it-qat` (4.6B Q4_0); vision fallbacks
  `qwen3-vl:2b`/`minicpm-v:8b`; text `qwen3.5:9b`;
  embeddings `nomic-embed-text:v1.5`. Server upgraded
  to **0.40.0** on 2026-10-06 (verified via
  `GET /api/version`).
- **First used:** 2026-09 (see
  `docs/knowledge-library/ollama-thinking-structured-outputs.md`).
- **Strong at:** vision analysis within the 8 GB VRAM
  budget; `think: false` turns a 39.5 s reasoning
  detour into a 0.6 s answer on the section-labelling
  path (~65x, measured 2026-10-01 and still valid on
  0.40.0).
- **Weak at:** cold-load cost dominates (gemma4:
  16.2 s warm / 88.6 s cold) — model ordering matters
  as much as `think`. One model at a time on 8 GB.
- **Quirks (needs explicit instruction for):**
  `/api/generate` does not honor `think: false`
  reliably for Qwen3.5/DeepSeek — use `/api/chat`.
  On 0.40.0, `/api/show` reports the authoritative
  per-model `thinking` controls and `capabilities`,
  and `/api/tags` entries carry `capabilities` plus
  `details.runner` (`ggml` on this build — the 0.40.0
  MLX default is Apple-Silicon-only and does not apply
  here). `typical_p` is deprecated; never send it.
- **Cost / access notes:** local, free, no network
  egress for local models. `:cloud` entries in
  `/api/tags` proxy to ollama.com and return HTTP 402
  without a paid key — `tools/probe-ollama.py` skips
  them. VRAM managed by the backend's VRAM manager
  (D7): `keep_alive 5m`, manual offload/reload.

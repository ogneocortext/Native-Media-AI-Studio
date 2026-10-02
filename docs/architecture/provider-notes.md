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

## Kilo Code gateway (free account tier)

- **Model / route:** Kilo Code's model gateway on a free account; this month
  also Kilo and Cline pointed at OpenRouter `stealth/space-bunny-alpha`.
- **First used:** ~2024 — two years of use as of Oct 2026.
- **Strong at:** the longest-running reliable free inference the owner has
  found (best over the last 2 years). This month, Kilo and Cline both running
  Space Bunny Alpha are the most reliable combo.
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

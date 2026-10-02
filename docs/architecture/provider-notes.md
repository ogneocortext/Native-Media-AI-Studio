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
  availability. Blind-testing models burns session time; check the
  reliability log first once it exists (D21 follow-up).
- **Quirks (needs explicit instruction for):** Step 3.7 Flash (via Kilo
  gateway) worked for months at a time and is competent for most work — it is
  the known-good fallback when the current promo model is unavailable.
- **Cost / access notes:** free tier; individual model reliability degrades
  over time as providers tighten abuse controls.

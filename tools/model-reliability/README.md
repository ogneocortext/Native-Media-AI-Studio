# Model reliability tracker

Which free models will *actually work* — answered from data, not from
burning a session finding out.

## Two layers

Provider websites advertise listings, not working models. A model can be
listed as free and still be dead, rate-limited to uselessness, or gated
behind an account tier. So this tracker keeps two separate layers:

1. **Advertised** (`snapshots/`): what providers *list* as free right now,
   pulled from public websites/APIs. No API keys, no account access, no
   probing. Regenerate with:
   `python tools/model-reliability/fetch_advertised.py`
   Sources: OpenRouter public models API (`$0` prompt + `$0` completion),
   Kilo gateway public models endpoint (`isFree` flag).

   This layer is **gitignored**. `fetch_advertised.py` writes one timestamped
   file per source per run, so tracking them grows the repo without bound — the
   weekly-refresh advice below is ~104 files/year — and a date+time run id in a
   filename means nothing to a reader. It is also regenerable from a single
   command, so versioning it buys nothing. A fresh clone therefore has no
   snapshots until you fetch once; `score.py` degrades to the observed layer
   alone rather than refusing to run.
2. **Observed** (`observed.jsonl`): what *actually worked* in real sessions.
   One JSON line per session outcome, appended by the agent:
   `{"date": "2026-10-02", "model": "<id>", "route": "kilo|cline|opencode",
   "worked": true, "note": "..."}`
   Use `"model": "*"` for route-level notes (e.g. "most free models here
   don't work").

   This layer **is** tracked: it is hand-curated evidence, it cannot be
   re-fetched, and it is the half that actually decides which model to use.

## Scoring

`python tools/model-reliability/score.py` prints a ranked table:

- +20 per source currently listing the model as free (max 40)
- +30 if observed working within 7 days (else +15 if within 30 days)
- −50 if observed failing within 7 days
- floor 0

Tiers: `RELIABLE NOW` > `worked before` > `listed, untested` > `AVOID`.
Check the table *before* committing a session to an untested model.

## Rules

- **Never add synthetic probes.** No scheduled pings, no "is it up" scripts.
  Providers punish that behavior with account-level lockouts (OpenCode
  already does this: trip one model's limit, lose all models). The observed
  layer records real sessions only — honest data with zero account risk.
- Advertised snapshots are cheap and safe; refresh weekly or when picking a
  model for a long session. Note that because snapshots are no longer versioned,
  "a model vanishing from a snapshot" is now only visible locally between two
  fetches — compare the before/after yourself if that signal matters to you. It
  was history-dependent before, and the history was the only reason to track
  regenerable data.
- This is a D21 implementation detail: provider-agnostic handoff state that
  survives model switches *and* involuntary session kills.

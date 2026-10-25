# Model Roster — Trust Tiers

**What this is:** the capability layer of the reliability tracker
(`README.md`). The advertised layer says what is *listed*; the observed
layer (`observed.jsonl`) says what *ran*; this roster says **what a
model may be trusted with**. Tiers are derived only from observed
entries — counts and date ranges are cited so staleness is visible.

**Maintained:** whenever an entry is appended to `observed.jsonl`,
update the affected row here in the same commit if the evidence
changes the tier. A tier whose latest evidence is **older than 30
days is treated as Untested** for planning — promo catalogs churn
faster than reputations.

## Tiers

- **A — Delegate.** Real work, including structural changes and
  refactors, under the standard rules (task files, behavior-ledger
  report after). 
- **B — Scoped.** Task-file items with an explicit acceptance check,
  verified item by item. No open-ended refactors.
- **C — Supervised only.** Boilerplate, docs, mechanical edits; every
  diff reviewed. **Never accept its completion report at face value.**
- **Avoid.** Observed availability failures. Do not burn sessions
  retrying; re-check only via a fresh advertised snapshot plus a
  first-contact item.
- **Untested.** Listed but unobserved — or evidence gone stale. The
  first-contact rule applies.

## First-contact rule

A model's first job in this repo is never open-ended work. It is the
**smallest open item in a task file** (`docs/plans/tasks/`) — real
work with a known acceptance check. Pass ⇒ log the outcome, enter at
provisional **B**. Fail ⇒ log it; tier **C** for a capability failure
(bad work, false "done"), **Avoid** for an availability failure (dead,
gated, rate-limited to uselessness). This is a work-assignment rule,
not a probe: the tracker's no-synthetic-probes rule (README) stands —
no pings, no scheduled availability tests.

## Roster (2026-10-25, from observed.jsonl)

### Tier A — Delegate
| Model (route) | Evidence | Last observed | Notes |
|---|---|---|---|
| Nemotron 3.5 Super VL (kilo) | 1 session, success — repaired a failed refactor and finalized it | 2026-10-24 | Provisional on count; the session was the hardest kind of work (repair). Max-thinking effort still feels uneven per owner — verify outputs, as with any A. |
| StepFun Step 5 Preview (kilo, `stepfun/step-5-preview-free`) | 11 sessions, all worked — Playwright suite, plan steps with all gates green, remix phase work | 2026-10-14 | Strongest recent streak in the log. |
| StepFun Step 3.7 Flash (kilo, `:free`) | Owner: "worked for months at a time; competent; known-good fallback" | 2026-10-02 | The daily-driver benchmark. Evidence is old but long-horizon; re-confirm on next use. |
| Ling 3.1 Flash (kilo) | 5 sessions, all worked — root-causing, remix plan implementation, upgrade verification | 2026-10-10 | Also a commit author in this repo (trailer: `Co-authored-by: Ling 3.1 Flash`). |

### Tier B — Scoped
| Model (route) | Evidence | Last observed | Notes |
|---|---|---|---|
| DeepSeek V4.1 Flash (opencode, `:free`) | 5 sessions, all worked — consolidation, benchmarks, vision-pipeline work | 2026-10-22 | Recent and consistent; promote on one more substantive success. |
| Sonnet 4.5 (cline) | 5 sessions, all worked — motion vocabulary, effect budgets, found a real dead-UI bug | 2026-10-02 | Strong but a single promo window; treat as B until re-observed. |
| Sonnet 4.6 (cline) | 1 session, success — audit caught an inverted frequency formula | — | Provisional. |
| MiMo V2.6 Flash (opencode, `:free`) | 2 sessions, worked — UX audit, shader root-cause | 2026-10-02 | Thin and stale. |
| Kilo Auto (kilo-auto/free) | 4 sessions, all worked | 2026-10-21 | Route-level trust only: the underlying model varies per session, so the tier certifies the route, not a model. |

### Tier C — Supervised only
| Model (route) | Evidence | Last observed | Notes |
|---|---|---|---|
| Beam 1.0 (kilo) | 1 session, **capability failure** — stripped features in a refactor, failed to restore them, reported completion falsely | 2026-10-24 | The origin of the ledger rule. Availability was fine; judgment was not. Never delegate unsupervised work. |

### Avoid (availability)
| Model (route) | Evidence | Notes |
|---|---|---|
| Nemotron 3 Ultra / 3.5 Lightning / 3 Nano Omni / 3 Super (`:free` listings) | Recurring failures over months via both opencode and kilo (server-overload class) | Same family name as the Tier A entry — the roster keys on **model + route**, not family. The Kilo-routed 3.5 Super VL worked; these listings did not. |
| Kilo gateway free listings, generally | Route-level observation (2026-10-02): most listed free models do not work on free accounts | A listing is not a working model. Hence this file. |

### Unrated — report pending
| Model | Note |
|---|---|
| Flint | Owner reported a terrible experience (2026-10-25) but the failure mode is not yet recorded. **Do not tier from "terrible" alone** — when the failure mode lands, append it to `observed.jsonl` and place the model (C if capability, Avoid if availability). |

### Not tiered
- **Local models** (Qwen3.5-4B/9B, Gemma 4 via Ollama/Atomic Chat) are
  infrastructure, not promo catalog: routing rules live in the focus
  map §3.6 (4B class for synchronous callers; 9B warm/batch only).
- **Orion (Muse Spark)** sessions are logged in `observed.jsonl` for
  the record; this roster governs the rotating local-agent seats.

---
name: line-by-line-review
description: |
  Deep review of files line by line, paired with current-best-practices web
  research, ending in verified fixes. Use whenever the user asks to "review",
  "double-check", "audit", or "look over" code files — especially recently
  written or quickly-iterated code — instead of a superficial skim.

  Triggers on: "review it line by line", "check this file", "audit the code",
  "did we miss anything", "review our changes", "verify the implementation".
---

# Line-by-Line File Review

A repeatable process for reviewing code thoroughly enough that real bugs
surface — the kind a skim misses: wrong API semantics, dead code, edge cases
that produce misleading output, and cross-file contract drift.

## When to use

- User asks to review/audit/double-check files or a recent change set.
- Code was written quickly across many edits and never re-read as a whole.
- Before committing high-risk changes (reporters, hooks, migrations, parsers).

## Process

### 1. Scope the review

- Get the exact file list: `git diff --name-only` for uncommitted work, or the
  files from the commits being reviewed (`git show --name-only <sha>`).
- Read **every file completely, top to bottom**. For files > ~500 lines, read
  in sequential chunks — do not jump to "the interesting part".
- Include the callers and config that wire the code in (e.g. for a reporter:
  the `*.config.ts` that registers it; for a hook: the `conftest.py` around it).

### 2. Annotate every line/block

For each line or coherent block, classify what you see:

| Category | What to look for |
|---|---|
| **Correctness** | Wrong condition, off-by-one, inverted boolean, wrong variable, race/ordering bug |
| **API contract** | Assumed semantics that differ from the real API (see step 3) |
| **Dead code** | Unused params, unreachable branches, functions with zero callers (grep to confirm) |
| **Edge cases** | Empty input, zero counts, missing fields, unicode/encoding, very long strings |
| **Honesty of output** | Does the report tell the truth? "All green" when 0 tests ran is a lie. |
| **Cross-file drift** | Python/TS ports that diverged; config that references moved files; stale imports |
| **Encoding/portability** | Windows cp1252 vs UTF-8, ANSI escapes, path separators |

### 3. Verify API assumptions against sources, not memory

This is the step that catches the subtle bugs. For every non-trivial API the
code touches:

- Read the **actual type definitions** in `node_modules` / package source
  (`.d.ts` files, hook specs) — enum unions especially: a guessed literal like
  `'failures'` when the real union is `'failed'` is a silent bug.
- Check **event/callback semantics**: does the callback fire once per test or
  once per attempt? Per-iteration or per-item? Verify in official docs.
- Use **web search** (per the `current-best-practices` skill pattern) for
  current docs when the local types are ambiguous or the API is external —
  prefer official docs and recent (dated) sources over blog posts.
- Check **hook signatures**: pytest hooks accept a subset of documented args;
  Playwright/Vitest reporter methods have specific lifecycles.

### 4. Fix at the narrowest layer

- Fix the root cause, not the symptom. If a callback fires per-attempt, fix the
  aggregation (e.g. last-write-wins keyed by id), don't filter on `retry > 0`.
- Delete dead code rather than commenting it out (repo AGENTS.md rule).
- Keep Python and TypeScript ports semantically identical — fix both sides.
- Match existing code style; no new abstractions for one-off needs.

### 5. Re-verify by running the real path

- Run the actual command that exercises the changed code (the test runner,
  the CLI tool, the hook) — not just `tsc`/`ruff`. Output bugs only show at
  runtime.
- Exercise **edge cases deliberately**: empty run (`--list`, filtered-to-zero
  tests), a failing case, a skipped case. These are where report/formatter
  bugs live.
- Run lint + typecheck on touched files; run the relevant unit tests.

### 6. Report findings honestly

End with a compact findings table:

```
| Severity | File:line | Issue | Fix applied |
|---|---|---|---|
| bug     | x.ts:74   | per-attempt callback kept first result | Map last-write-wins |
| dead    | y.py:59   | unused function, zero callers         | deleted           |
```

Distinguish **bugs found & fixed** from **pre-existing issues not touched**
(e.g. a lint config gap that predates the change) — say which is which.

## Checklist (condensed)

- [ ] Every file read fully, callers/config included
- [ ] External API semantics verified against .d.ts/docs/web — especially
      callback frequency, enum literals, hook signatures
- [ ] Empty/zero/unicode/long-input edge cases exercised
- [ ] Output tells the truth in every state (pass/fail/skip/empty/interrupted)
- [ ] Dead params/functions removed; ports kept in sync
- [ ] Real command run end-to-end + lint/typecheck clean
- [ ] Findings reported with severity and pre-existing vs new distinguished

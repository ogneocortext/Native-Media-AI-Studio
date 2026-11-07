---
name: line-by-line-review
description: |
  Deep review of files line by line, paired with source verification
  (.d.ts, docs, targeted web research), ending in verified fixes AND a
  self-review of your own diff. Use whenever the user asks to "review",
  "double-check", "audit", or "look over" code files — especially recently
  written or quickly-iterated code — instead of a superficial skim.

  Triggers on: "review it line by line", "check this file", "audit the code",
  "did we miss anything", "review our changes", "verify the implementation",
  "self improvement" / "improve the architecture" passes over existing code.
---

# Line-by-Line File Review

A repeatable process for reviewing code thoroughly enough that real bugs
surface — the kind a skim misses: wrong API semantics, dead code, edge cases
that produce misleading output, cross-file contract drift, and bugs in your
own fixes.

## When to use

- User asks to review/audit/double-check files or a recent change set.
- Code was written quickly across many edits and never re-read as a whole.
- Before committing high-risk changes (reporters, hooks, migrations, parsers).
- "Improve the architecture" / self-improvement passes over existing code —
  re-review even files that passed a previous review; bugs survive reviews.

## Process

### 1. Scope the review

- Get the exact file list: `git diff --name-only` for uncommitted work, or the
  files from the commits being reviewed (`git show --name-only <sha>`).
- Read **every file completely, top to bottom**. For files > ~500 lines, read
  in sequential chunks — do not jump to "the interesting part".
- Include the callers and config that wire the code in (e.g. for a reporter:
  the `*.config.ts` that registers it; for a hook: the `conftest.py` around it).
- If a previous review exists, its findings table tells you what NOT to
  re-litigate — but still read unchanged files fully; new bugs hide in code
  that already "passed" once.

### 2. Annotate every line/block

For each line or coherent block, classify what you see:

| Category | What to look for |
|---|---|
| **Correctness** | Wrong condition, off-by-one, inverted boolean, wrong variable, race/ordering bug |
| **API contract** | Assumed semantics that differ from the real API (see step 3) |
| **Semantic mapping** | APIs where multiple inputs collapse to one output — check the *mapping table*, not just the return type (e.g. `outcome() === 'expected'` covers both pass AND expected-fail) |
| **Dead code** | Unused params, unreachable branches, functions with zero callers (grep to confirm) |
| **Edge cases** | Empty input, zero counts, missing fields, unicode/encoding, very long strings |
| **Honesty of output** | Does the report tell the truth? "All green" when 0 tests ran is a lie. |
| **Re-executability** | Anything generated for reuse — commands, paths, URLs, file contents — must survive copy-paste: quoting, spaces in paths, shell metacharacters, escaping |
| **Invisible characters** | Raw control bytes (literal ESC instead of `\u001b`), zero-width chars, BOMs, mojibake in source |
| **Cross-file drift** | Python/TS ports that diverged — including serialization details (`null` vs absent key, rounding, key order), not just logic |
| **Encoding/portability** | Windows cp1252 vs UTF-8, ANSI escapes, path separators |
| **Data/heuristic tables** | Keyword rules, classifiers, allowlists — test them against REAL samples from the domain, not synthetic ones |

### 3. Verify API assumptions against sources, not memory

This is the step that catches the subtle bugs. For every non-trivial API the
code touches:

- Read the **actual type definitions** in `node_modules` / package source
  (`.d.ts` files, hook specs) FIRST — it's cheaper than web search. Enum
  unions especially: a guessed literal like `'failures'` when the real union
  is `'failed'` is a silent bug.
- Check **event/callback semantics**: does the callback fire once per test or
  once per attempt? Per-iteration or per-item? Verify in official docs.
- For **semantic mappings** (what each enum value *means* in context), check
  docs or source — return types don't tell you that `'expected'` includes
  expected failures.
- Use **web search** (per the `current-best-practices` skill pattern) only
  when local types are ambiguous or the API is external/undocumented —
  prefer official docs and recent (dated) sources over blog posts. Don't
  research what the `.d.ts` already answers.
- Check **hook signatures**: pytest hooks accept a subset of documented args;
  Playwright/Vitest reporter methods have specific lifecycles.

### 4. Fix at the narrowest layer

- Fix the root cause, not the symptom. If a callback fires per-attempt, fix the
  aggregation (e.g. last-write-wins keyed by id), don't filter on `retry > 0`.
- Delete dead code rather than commenting it out (repo AGENTS.md rule).
- Keep Python and TypeScript ports semantically identical — fix both sides,
  including serialization details.
- Match existing code style; no new abstractions for one-off needs.
- **If the bug lives in a pure function** (classifier, formatter, parser),
  add a unit test that locks the behavior — heuristic bugs recur.

### 5. Re-verify by running the real path — AND your own diff

- **Re-read your own `git diff` before reporting done.** Fixes introduce bugs:
  a regex with a raw control byte, an off-by-one in a new branch, an import
  that only resolves under one loader. This step exists because it has
  already happened.
- Run the actual command that exercises the changed code (the test runner,
  the CLI tool, the hook) — not just `tsc`/`ruff`. Output bugs only show at
  runtime.
- Exercise **edge cases deliberately**: empty run (`--list`, filtered-to-zero
  tests), a failing case, a skipped case, inputs with quotes/unicode/empties.
  These are where report/formatter bugs live.
- For heuristic/data tables, feed **real examples from the codebase's domain**
  (actual error messages the system produces), not invented ones.
- Run lint + typecheck on touched files; run the relevant unit tests.
- **Rendered-output changes** (UI pages, shaders, visualizer styles): when the
  acceptance criterion is visual, optionally run the `visual-qa-loop` skill —
  screenshot → vision-model analysis → fix → re-capture. It is an addon, not a
  required step; skip it for non-visual changes. `vision-page-analysis` covers
  the single-page capture+analyze half.

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
Also say when a pass found *fewer* issues than the last one — diminishing
returns is information the user needs.

## Mirror maintenance

This skill exists in four places: `.kilo/skills/` (tracked canonical),
`.claude/skills/`, `.agents/skills/`, `.devin/skills/` (local mirrors).
**Update all copies together** — the drift this skill warns about applies
to the skill itself.

## Checklist (condensed)

- [ ] Every file read fully, callers/config included — including files that
      passed a previous review
- [ ] API semantics verified: `.d.ts` first, docs/web for ambiguity —
      especially callback frequency, enum literals, semantic mappings,
      hook signatures
- [ ] Generated artifacts checked for re-executability (quoting, spaces,
      shell metacharacters)
- [ ] Source scanned for invisible characters / raw control bytes
- [ ] Heuristic tables tested against real domain samples
- [ ] Empty/zero/unicode/long-input edge cases exercised; output tells the
      truth in every state (pass/fail/skip/empty/interrupted/expected-fail)
- [ ] Dead params/functions removed; ports kept in sync incl. serialization
- [ ] **Own diff re-read**; real command run end-to-end; lint/typecheck clean
- [ ] Pure-function bugs locked with a unit test where practical
- [ ] Findings reported with severity; pre-existing vs new distinguished

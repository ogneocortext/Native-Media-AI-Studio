---
name: typescript-eslint-research
description: |
  Research methodology for TypeScript/ESLint problems. Teaches HOW to search for solutions,
  evaluate sources, formulate queries, and iterate on findings. Not a fix catalog - a
  repeatable research process.

  Triggers on: "how to fix eslint", "research typescript-eslint", "search for fix",
  "find solution", "debug typescript error", "understand rule", "learn to search"

---

# TypeScript/ESLint Research Methodology

> **Purpose**: A repeatable process for finding solutions to TypeScript/ESLint problems.
> This is a METHOD skill - it teaches HOW to research, not WHAT the answers are.

---

## The Research Loop

```
Question → Query → Search → Evaluate → Test → Document → Iterate
```

**Never skip steps.** Each iteration should refine the next query.

---

## Phase 1: Frame the Question Precisely

### Before Searching, Answer:
1. **What exactly is the error?** (copy full message including rule name)
2. **What code triggers it?** (minimal reproduction)
3. **What does the rule DO?** (what bug it prevents)
4. **What types are involved?** (`unknown`, `any`, union, generic?)
5. **What's the context?** (callback, async, generic, inference?)

**Write it down**. A well-formed question is half the answer.

---

## Phase 2: Build Effective Queries

### Query Construction Formula:
```
[tool] [rule] [problem-type] [context] [modifier]
```

| Component | Examples |
|-----------|----------|
| tool | `typescript-eslint`, `eslint`, `typescript` |
| rule | `no-unsafe-member-access`, `no-unnecessary-condition` |
| problem-type | `fix`, `understand`, `disable`, `configure`, `example` |
| context | `async callback`, `generic inference`, `union type`, `unknown type` |
| modifier | `official docs`, `example`, `github issue`, `stackoverflow` |

### High-Signal Query Patterns:

| Goal | Query Template |
|------|----------------|
| Understand rule | `"typescript-eslint <rule-name> rationale"` |
| Find fix pattern | `"typescript-eslint <rule> fix pattern <context>"` |
| Type narrowing | `"typescript type narrowing <specific case>"` |
| Generic inference | `"typescript generic inference <scenario>"` |
| Rule config | `"typescript-eslint <rule> config recommended"` |
| Edge case | `"typescript-eslint <rule> false positive <pattern>"` |

### Search Operators to Use:
- `site:typescript-eslint.io/rules <rule>` — official rule page
- `site:github.com/typescript-eslint/typescript-eslint <rule>` — issues/PRs
- `site:typescriptlang.org/docs <concept>` — handbook
- `"exact phrase"` — exact matches
- `-deprecated -outdated` — exclude old answers

---

## Phase 3: Source Evaluation Hierarchy

**Trust in this order. Stop at the first reliable answer.**

| Tier | Sources | When to Use |
|------|---------|-------------|
| **1. Primary** | `typescript-eslint.io/rules/<rule>/`, `typescriptlang.org/docs/`, `eslint.org/docs/latest/rules/` | Always first. Authoritative. |
| **2. Implementation** | `github.com/typescript-eslint/typescript-eslint/tree/main/packages/eslint-plugin/src/rules/<rule>/` | Rule behavior unclear, need edge cases |
| **3. Design** | `github.com/typescript-eslint/typescript-eslint/issues/`, `github.com/microsoft/TypeScript/issues/` | Design rationale, false positives, upcoming changes |
| **4. Curated** | `typescript-eslint.io/docs/`, `eslint.org/docs/latest/use/configure/` | Configuration patterns |
| **5. Community** | StackOverflow (voted, <2 yrs), reputable blogs (Kent C. Dodds, Matt Pocock, etc.) | Only when above fail |

**Red Flags - Skip These:**
- Answers >2 years old without version context
- "Just use `any`" or "disable the rule"
- AI-generated content (often hallucinates rule behavior)
- Unvoted/low-vote StackOverflow answers
- Random blogs without code reproduction

---

## Phase 4: Search Strategy by Problem Type

### For "How to Fix Rule X":
1. Read official rule page → understand WHY rule exists
2. Search: `"typescript-eslint <rule> fix" site:typescript-eslint.io`
3. Check rule's "Options" section for configuration
4. Search GitHub issues: `repo:typescript-eslint/typescript-eslint "<rule>" "fix"`

### For "Type Narrowing Pattern":
1. Read TS Handbook: "Narrowing" chapter
2. Search: `"typescript type narrowing <specific case>"` (e.g., "discriminated union", "type guard", "in operator")
2. Look for `satisfies`, `as const`, `in`, `typeof`, `instanceof`, user-defined type guards

### For "Generic Inference Failure":
1. Search: `"typescript generic inference <scenario>"` (e.g., "conditional type", "infer", "constraints")
2. Check TS GitHub issues for "inference" label

### For "Rule False Positive":
1. Search GitHub: `repo:typescript-eslint/typescript-eslint "<rule>" "false positive"`
2. Check if fixed in newer version
3. Look for "WontFix" label with rationale

---

## Phase 5: Evaluate & Test

### Before Applying Any Fix:
- [ ] **Reproduce** in minimal code (5-10 lines)
- [ ] **Read the rule docs** — understand WHY it exists
- [ ] **Find 2+ examples** in official docs
- [ ] **Test the fix** in your reproduction
- [ ] **Run `eslint --fix`** on the specific rule
- [ ] **Run `tsc --noEmit`** — no new type errors
- [ ] **Run full test suite** — no regressions

### If Fix Doesn't Work:
1. **Re-read the rule** — did you misunderstand the trigger?
2. **Check TypeScript version** — feature may not exist yet
3. **Check eslint config** — parserOptions.project, tsconfigRootDir
4. **Search for "false positive" + rule** — known limitation?

---

## Phase 6: Document & Iterate

### For Future Reference, Save:
```markdown
## Problem: <rule> in <context>
## Query that worked: "<exact query>"
## Source: <URL>
## Fix: <code pattern>
## Why it works: <one sentence>
## Version: TS <x.y>, eslint <x.y>, typescript-eslint <x.y>
```

---

## Search Refinement Techniques

### When Results Are Too Broad:
- Add `site:typescript-eslint.io` or `site:typescriptlang.org`
- Add version: `"typescript 5.3"` `"eslint 8"`
- Add context: `"in callback"`, `"in generic"`, `"with unknown"`

### When Results Are Too Narrow:
- Remove quotes
- Use broader terms: "type narrowing" instead of "user-defined type guard"
- Try synonyms: "type guard" → "type predicate" → "narrowing function"

### When No Results:
1. Search the **concept**, not the error: "typescript unknown property access" instead of "no-unsafe-member-access fix"
2. Search the **inverse**: "typescript allow unsafe member access"
3. Check **related rules**: "no-unsafe-assignment" often appears with "no-unsafe-member-access"

---

## Quick Reference: Query Templates

| Situation | Query |
|-----------|-------|
| Rule meaning | `"typescript-eslint <rule> rationale"` |
| Fix pattern | `"typescript-eslint <rule> fix <context>"` |
| Type narrowing | `"typescript type narrowing <specific>"` |
| Generic help | `"typescript generic inference <scenario>"` |
| Config | `"typescript-eslint <rule> config"` |
| False positive | `"<rule> false positive" site:github.com/typescript-eslint/typescript-eslint` |
| Version-specific | `"typescript <version> <feature>"` |
| Migration | `"typescript-eslint migrate <from> to <to>"` |

---

## Local Verification Commands

```bash
# Rule documentation
npx eslint --print-config .eslintrc.json | jq '.rules["@typescript-eslint/<rule>"]'

# Test rule in isolation
echo 'const x: unknown = 1; x.foo;' | npx eslint --stdin --rule '@typescript-eslint/no-unsafe-member-access: error' --parser-options=project:./tsconfig.json

# TypeScript diagnostics
tsc --noEmit --strict --noUncheckedIndexedAccess

# Rule source (implementation)
cat node_modules/@typescript-eslint/eslint-plugin/dist/rules/<rule>.js | head -100
```

---

## Anti-Patterns to Avoid

| Anti-Pattern | Why It Fails | Better Approach |
|--------------|--------------|-----------------|
| Search "how to disable <rule>" | Misses the fix, learns nothing | Search "fix <rule> <context>" |
| Copy first StackOverflow answer | Often outdated/wrong | Check official docs first |
| Use `any` to silence | Hides bugs, defeats purpose | Use `unknown` + type guard |
| Skip reading rule docs | Don't understand the WHY | Read rule page first |
| Don't test minimal repro | Can't isolate the issue | Always test in 5-10 lines |
| Don't check TS version | Feature may not exist | Check `tsc --version` |

---

## When Stuck: The Escalation Path

1. **Re-read rule docs** — missed a config option?
2. **Search GitHub issues** — known limitation?
3. **Check PR history** — fixed in newer version?
4. **Minimal repro + ask** — with exact versions, config, code
5. **Workaround + TODO** — disable inline with comment explaining why

---

*Skill location: `.kilo/skills/typescript-eslint-research/` — mirrors to `.devin/skills/`, `.claude/skills/`, `.agents/skills/` per mirror-maintenance protocol.*
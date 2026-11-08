---
name: gates-commit-push
description: >-
  The commit-and-push protocol for this repo: run the gate subset, stage only
  intended files, write a conventional commit with the Co-authored-by trailer,
  and push so the pre-push gates run. Use before any commit, and whenever a
  change is ready to land on origin/main.
---

# Gates → Commit → Push

> [!warning] Every commit carries a Co-authored-by trailer. Multiple agents commit
> to this repo; the trailer is how the user tracks who did what. End every
> commit with `Co-authored-by: <your agent name>` — a bare name, no email.

> [!warning] Stage only intended files. Never commit secrets, scratch files
> (`tmp_*` in repo root), or generated `vite.config.js`/`vite.config.d.ts`
> (they shadow `vite.config.ts`).

## When to use

- Before any `git commit` in this repo
- When a change is ready to land on `origin/main`
- After completing a work item (visual QA loop, bug fix, feature)

## Steps

### 0. Ensure Services Are Running (Use `background_process`)

When running tests that need the dev server or backend:

```python
# Start all services
background_process(
    action="start",
    command="pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\\manage-servers.ps1 -Action start -Services all",
    description="Start all services for testing",
    ready={"pattern": "All requested services started"}
)
# Verify
import requests
requests.get("http://localhost:5173/").raise_for_status()
requests.get("http://localhost:8000/api/health").raise_for_status()
```

> **Do not use `bash` for service management** — it leaks wrapper noise (`ChildProcess.kill... [Console]::InputEncoding...`). Use `background_process` for all service lifecycle operations.

### 1. Run the relevant gates

```bash
# Full suite (doc checks → ruff → tsc → eslint → pytest → vite build)
python tools/run-gates.py
# Fast subset for iterating (docs, type, lint, unit — ~8s)
python tools/run-gates.py --only docs ruff type lint unit
# Include Playwright e2e (starts a Vite dev server)
python tools/run-gates.py --e2e
```

`tools/run-gates.py` resolves its own tools and interpreter — do not assemble
raw `subprocess`/`pnpm` calls by hand. It owns the Windows exit-code and UTF-8
decoding problems that produce false passes/failures.

### 2. Inspect what changed

```bash
git status
git diff
git log --oneline -5
```

Stage only the files that belong to this change.

### 3. Commit (conventional + trailer)

```bash
git commit -m "feat(visualizer): summary of the change" -m "Co-authored-by: <agent name>"
```

Scopes seen in this repo: `fix`, `feat`, `chore`, `docs`, `refactor`, `test`,
`perf`. Match the existing style. Keep the subject ≤ 72 chars; put detail in the
body.

> [!warning] The commit-msg hook rejects `Co-authored-by` trailers carrying a
> third-party GitHub email. Use the bare agent name — never
> `…+bot@users.noreply.github.com`-style external emails. Verify with
> `python tools/agent-contribution-report.py --check` if unsure.

> [!warning] The pre-push gate checks the **working tree**, not your commits.
> If it fails on files you didn't touch (another agent's uncommitted work),
> report the blocker — do not bypass hooks, stash their files, or "fix" them
> mid-flight. Your commits are safe; only the push waits.

> [!warning] Concurrent agents commit to this repo while you work. Their
> rebase/merge cycles can silently revert your **uncommitted** edits or absorb
> them into an unrelated commit. Commit as soon as a unit of work verifies;
> before re-doing "lost" work, run `git log --oneline -10` and `git status` —
> it may already have landed under someone else's commit.

### 4. Push (pre-push runs the fast gates automatically)

```bash
git push
```

The pre-push hook runs `docs ruff type lint unit` (~11s) and deliberately skips
pytest (~40s) and Playwright (~30s). Run `python tools/run-gates.py --e2e`
yourself before pushing if the change touches the browser.

## Rules

- Do not rewrite published history to backfill the trailer; it applies to new commits only.
- Do not push when the working tree has unrelated changes — commit or stash them first.
- If a hook rejects the commit, fix the cause and create a new commit; do not amend a failed commit.
- Leave services running when you finish — the next step usually needs them.

## See Also

- [[visual-qa-loop]] — the improvement loop that ends with a commit
- [[ollama-model-ops]] — model ops that often precede a commit

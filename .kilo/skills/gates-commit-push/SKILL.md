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
> commit with the `Co-authored-by:` trailer from the AGENTS.md attribution
> table (e.g. `Co-authored-by: Devin`) — a bare name, or the project-domain
> email where the table lists one. Never a third-party GitHub email.

> [!warning] Stage only intended files. Never commit secrets, scratch files
> (`tmp_*` in repo root), or generated `vite.config.js`/`vite.config.d.ts`
> (they shadow `vite.config.ts`).

## When to use

- Before any `git commit` in this repo
- When a change is ready to land on `origin/main`
- After completing a work item (visual QA loop, bug fix, feature)

## Steps

### 0. Ensure Services Are Running

When running tests that need the dev server or backend, start them through
the repo's service manager — via your host's background-process tool
(Kilo: `background_process`; Devin: a detached `exec`/`Start-Process`
shell). Ports come from `config/ports.json` — backend is **8004**, frontend
**5173**; never assume 8000.

```python
# Start all services (host tool call)
background_process(
    action="start",
    command="pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\\manage-servers.ps1 -Action start -Services all",
    description="Start all services for testing",
    ready={"pattern": "All requested services started"}
)
# Verify (backend_port from config/ports.json — currently 8004)
import requests
requests.get("http://localhost:5173/").raise_for_status()
requests.get("http://localhost:8004/api/health").raise_for_status()
```

> **Do not use `bash` for service management** — it leaks wrapper noise (`ChildProcess.kill... [Console]::InputEncoding...`). Use a background-process tool for all service lifecycle operations.
>
> **Known false positive:** `manage-servers.ps1` treats *any* listener on the
> port as "occupied", including `tailscaled.exe` holding the tailnet-side
> `tailscale serve` bind. If it reports "port occupied by a non-responding
> process" while `Get-NetTCPConnection` shows only tailscaled on the tailnet
> IP, start uvicorn directly on loopback instead:
> `python -m uvicorn app.main:app --host 127.0.0.1 --port <backend_port>`
> from `packages/backend`, and leave it running.

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
> third-party GitHub email (`*@users.noreply.github.com`, `noreply@anthropic.com`).
> Use your agent's trailer from the AGENTS.md attribution table — bare name, or
> the project-domain email it lists. Verify with
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

### 4. Push: default after gates

Push is part of the same unit as the commit when the commits are yours,
scoped to the task, the scoped gates pass, and the push is a fast-forward
to `origin/main`. Do not wait for a separate push word.

Hold only when the task explicitly says commit-only or no push, when an
AGENTS.md approval exception applies (force push, branch deletion,
another agent's commits, CI or security config, AGENTS.md or gate
scripts), or when scoped gates fail.

The pre-push hook runs docs, ruff, type, lint, unit, and tools-pytest,
and deliberately skips pytest and Playwright. Run
`python tools/run-gates.py --e2e` yourself before pushing if the change
touches the browser. Report the pushed range and gate results.

This machine also has a `post-commit` hook that runs
`git push origin main` after every non-amend commit on main, so a
forgotten push self-heals on the next commit. The hook is local-only
(`.git/hooks` is untracked) — if it is rebuilt, re-add the block noted in
the file.

## Rules

- Do not rewrite published history to backfill the trailer; it applies to new commits only.
- Do not push when the working tree has unrelated changes — commit or stash them first.
- If a hook rejects the commit, fix the cause and create a new commit; do not amend a failed commit.
- Leave services running when you finish — the next step usually needs them.

## See Also

- [[visual-qa-loop]] — the improvement loop that ends with a commit
- [[ollama-model-ops]] — model ops that often precede a commit

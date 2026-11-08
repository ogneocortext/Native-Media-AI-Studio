# Contributing to Native Media AI Studio

Thanks for cloning. This repo is developed by a human plus several AI agents
across more than one machine, so the conventions below are enforced by git
hooks, not just documented.

## Clone and install

```bash
git clone https://github.com/ogneocortext/Native-Media-AI-Studio.git
cd Native-Media-AI-Studio
bash scripts/install-git-hooks.sh   # REQUIRED once — installs pre-commit,
                                    # commit-msg, and pre-push guards
```

The hooks are the only automated guard (there is no CI — see D10 in
`docs/architecture/decision-log.md`). Without them, commits that would fail
the gates reach the remote and block everyone else's push.

## Prerequisites

| | Windows (primary dev machine) | Linux/macOS VM |
|---|---|---|
| Python | 3.10+ (rig runs 3.11/3.14 venvs) | 3.12 verified |
| Node | 26+ (rig); 24 proven working | 24 proven working |
| Package manager | pnpm 12+ (npm cannot install — `catalog:` deps) | pnpm 12+ |
| Shell | pwsh 7+ only — see `docs/powershell-command-sheet.md` | bash/zsh normal |

Full verified Linux recipe (including the `requirements.txt` deltas):
`docs/setup/SETUP_SUMMARY.md` → *Clean-environment verification*.

Optional services degrade gracefully: ComfyUI (:8188) and Ollama (:11434)
are only needed for AI generation features. `config/ports.json` is the port
source of truth.

## Before you push

```bash
python tools/run-gates.py          # full local gate suite
python tools/run-gates.py --changed  # fast subset for your diff
```

Once hooks are installed, `pre-push` runs the fast gates automatically
(docs hygiene, ruff, frontend type-check + lint, fast vitest). `pre-commit`
runs the docs/repo-hygiene checks; `.husky/pre-commit` additionally runs
lint-staged on staged frontend files if you use husky.

## Commit conventions

- Conventional-style subjects (`feat:`, `fix:`, `style:`, `test:`, `docs:`).
- **Every commit must end with a `Co-authored-by:` trailer naming the
  authoring agent**, e.g. `Co-authored-by: Kilo <kilo@native-media-ai.studio>`.
  The `commit-msg` hook rejects commits without one.
- Do **not** use a `*@users.noreply.github.com` or `noreply@anthropic.com`
  trailer email — GitHub credits the email's owner, which is how phantom
  contributors appeared on this repo's graph. Use the agent name with no
  email, or an address on a domain the project controls.
- Deliberate one-off bypass: `SKIP_TRAILER_CHECK=1 git commit ...` or
  `git commit --no-verify`.

## Where work goes

- **Code changes** → branch or direct commits to `main` (the repo currently
  works trunk-based; keep commits small and self-verifying).
- **Plans and task ledgers** → `docs/plans/tasks/<area>.md` — this is how
  multi-session work stays coordinated. Read the ledger for your area
  before starting; append status when done.
- **Agent presence** → if your agent supports the orchestration board,
  claim files before editing: `python tools/orchestration/board.py claim ...`
  (protocol: `docs/plans/orchestration.md`).

## Platform notes for agents

- `AGENTS.md` and `docs/powershell-command-sheet.md` describe the Windows
  rig. On Linux/macOS, normal bash/zsh rules apply — the exec guard
  (`tools/hooks/check-exec-command.py`, shipped via `.claude/settings.json`)
  only enforces the pwsh bans on Windows and the destructive-git rules
  everywhere.
- Scratch scripts belong in `docs/scratch/` (gitignored) or `$TMPDIR` —
  don't leave one-off files at the repo root.
- Generated media must land under `output/` to appear in the Media Library —
  see the `media-output-contract` skill.

## Questions

Open an issue, or leave a plan doc under `docs/plans/` if you're proposing
a larger piece of work.

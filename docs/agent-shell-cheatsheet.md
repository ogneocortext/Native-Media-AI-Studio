# Agent Shell Cheat Sheet

Quick reference for shells used by agents in this repo. Full detail: `AGENTS.md` §Shell/Process Management.

**Mandatory:** Before running any command, read `docs/powershell-command-sheet.md` in full. That document is the authoritative PowerShell 7 command reference. This sheet is a quick summary only — it does NOT replace the full sheet.

**Shell rule:** All commands go through PowerShell 7 (`pwsh`). Do NOT use `bash`, `cmd`, `sh`, `zsh`, or any Unix shell — `bash` here resolves to the WSL launcher, NOT Git Bash.

## Interpreters
- Default backend Python: `D:\conda-envs\nma-studio-cuda\Scripts\python.exe` (3.11.9).
- `python` resolves to 3.14 unless the user profile is loaded. In a no-profile shell use `tools\python.cmd` (or set `NMA_PYTHON`).
- Never use `comfyui-cuda` for backend work.

## Commands available
- `rg` (ripgrep) is on PATH — use it for content search.
- `grep`, `sed`, `head`, `tail` are NOT available — use `Select-String` or the Kilo `grep` tool.
- `bash` resolves to the WSL launcher — use `C:\Program Files\Git\bin\bash.exe`.
- `node` is an fnm alias pinned to an older version — prefer `pnpm.cmd` with explicit cwd.

## Exit codes / encoding
- Run gates via `python tools/run-gates.py` (owns UTF-8 + exit codes).
- Subprocess calls must pass `encoding="utf-8"`; `tools/check-subprocess-encoding.py` enforces this.

## Common commands
- Gates: `python tools/run-gates.py` (or `--only type lint`).
- Backend tests: `pytest` in `packages/backend/`.
- Frontend unit: `pnpm test:unit` in `packages/frontend/`.
- Ports: `scripts\check_ports.ps1`.

## Where to look
- Index: `docs/README.md`. Decisions: `docs/architecture/decision-log.md`.
- Knowledge library: `docs/knowledge-library/index.md`.
- Attribution tool: `python tools/agent-contribution-report.py`.

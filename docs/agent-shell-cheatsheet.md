# Agent Shell Cheat Sheet

Quick reference for shells used by agents in this repo. Full detail: `AGENTS.md` §Shell/Process Management.

**Mandatory:** Before running any command, read `docs/powershell-command-sheet.md` in full. That document is the authoritative PowerShell 7 command reference. This sheet is a quick summary only — it does NOT replace the full sheet.

**Shell rule:** All commands go through PowerShell 7 (`pwsh`). Do NOT use `bash`, `cmd`, `sh`, `zsh`, or any Unix shell — `bash` here resolves to the WSL launcher, NOT Git Bash.

## Interpreters
- Default backend Python: `D:\conda-envs\nma-studio-cuda\Scripts\python.exe` (3.11.9).
- `python` resolves to 3.14 in a no-profile shell. Dot-source `scripts/agent-shell-init.ps1` first (sets PATH + `NMA_PYTHON` from `.python-env`), or use `tools\python.cmd` / the absolute env path.
- Never use `comfyui-cuda` for backend work.

## Commands available
- `rg` (ripgrep) and `fd` are on PATH — use them for content/file search.
- Real and working: `curl.exe`, `tar.exe`, `ssh.exe`, `ping.exe`, `git`, `go`, `cargo`, `dotnet`, `ffmpeg`, `ollama`, `fnm`, `zed`.
- NOT installed: `jq`, `yq`, `wget`, `zip`/`7z`, `docker`, `kubectl`, `vim`/`nano`/`tmux`, `make`, `openssl`. Use `ConvertFrom-Json`, `Invoke-WebRequest`, `Compress-Archive`/`tar.exe`, file tools — full map in `docs/powershell-command-sheet.md` §13.
- `grep`, `sed`, `head`, `tail` are NOT available — use `Select-String`, `rg`, or the agent `grep` tool.
- No Unix shell at all: `bash`/`wsl` resolve to the WSL launcher and are forbidden by repo rule — use `pwsh` only.
- `node` is an fnm alias — active default is v24.20.0 (v26.13.0 also installed); prefer `pnpm.cmd` with explicit cwd.
- Env-var prefix (`FOO=bar cmd`) and `/dev/null` redirects FAIL in pwsh — use `$env:FOO='bar'; cmd` and `2>$null`. See command-sheet §9 traps.
- Shell self-check: `pwsh -NoProfile -File scripts/check-shell-env.ps1` (exit 1 = missing contract pieces; fix with `. scripts/agent-shell-init.ps1`).

## Exit codes / encoding
- Run gates via `python tools/run-gates.py` (owns UTF-8 + exit codes).
- Subprocess calls must pass `encoding="utf-8"`; `tools/check-subprocess-encoding.py` enforces this.

## Common commands
- Gates: `python tools/run-gates.py` (or `--only type lint`).
- Backend tests: `pytest` in `packages/backend/`.
- Frontend unit: `pnpm test:unit` in `packages/frontend/`.
- Ports: `scripts\check-ports.ps1`.

## Where to look
- Index: `docs/README.md`. Decisions: `docs/architecture/decision-log.md`.
- Knowledge library: `docs/knowledge-library/index.md`.
- Attribution tool: `python tools/agent-contribution-report.py`.

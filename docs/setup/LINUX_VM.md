# Running Native Media AI Studio on a Linux VM

Guide for agents/humans working from a clean Linux clone (cloud VM, WSL2,
remote dev box). Verified 2026-11-07 on a plain VM: Python 3.12.3,
Node 24.22, pnpm 12.17.0 — CPU feature surface only; GPU generation still
needs the Windows rig described in `SETUP_SUMMARY.md`.

## 1. Clone and install hooks

```bash
git clone https://github.com/ogneocortext/Native-Media-AI-Studio.git
cd Native-Media-AI-Studio
bash scripts/install-git-hooks.sh   # REQUIRED — installs pre-commit,
                                    # commit-msg, pre-push guards
```

There is no CI: these hooks are the only automated guard. The pre-push
hook finds `python3` automatically and runs the fast gates
(docs hygiene, ruff, frontend type-check/lint, fast vitest) plus the
commit-attribution check on every push.

## 2. Backend

```bash
python3 -m venv .venv
source .venv/bin/activate

# requirements.txt resolves cleanly on Python 3.11/3.12 EXCEPT the three
# opentelemetry-* lines (that pin stack targets the rig's 3.11). Exclude
them on 3.12+:
grep -v '^opentelemetry' packages/backend/requirements.txt > /tmp/req.txt
pip install -r /tmp/req.txt
```

- `openai` is in requirements.txt (the `tools/qwen_subagent` import is
  module-level — without it the backend cannot boot).
- `madmom-infer` may need build tools (`build-essential`, `python3-dev`)
  on Linux; if it fails to build, install the rest and continue — the
  backend guards the import (`MADMOM_AVAILABLE=False`, tempo features
  degrade gracefully).
- GPU-only deps (`gpustat`, `nvidia-ml-py`, `requirements-torch.txt`) are
  safe to install but do nothing without an NVIDIA driver — skip
  `requirements-torch.txt` entirely on a CPU VM.

Run it (port comes from `config/ports.json` — currently `backend_port: 8004`):

```bash
cd packages/backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8004
# health: curl http://127.0.0.1:8004/api/health
```

## 3. Frontend

```bash
# repo ROOT — pnpm workspace; catalog: deps mean npm cannot install
pnpm install --frozen-lockfile
pnpm --filter native-media-ai-studio-frontend dev   # Vite on :5173
```

The Vite dev server proxies `/api/*` to the backend port from
`config/ports.json`. Open http://127.0.0.1:5173.

## 4. Quality gates

```bash
python3 tools/run-gates.py            # full suite (needs pytest deps)
python3 tools/run-gates.py --changed  # fast subset for your diff
pnpm verify                           # same thing via package.json
```

`pnpm test` / `pnpm type-check` also work. Playwright e2e
(`--e2e`) needs `pnpm exec playwright install chromium` first.

## 5. What does NOT work on Linux (by design)

- `pnpm dev`, `pnpm start`, `pnpm servers`, `pnpm dev:backend`,
  `pnpm dev:comfyui`, `pnpm db:migrate`→`dev` scripts — they call
  `pwsh scripts/*.ps1`, which use Windows cmdlets
  (`Get-NetTCPConnection`, `taskkill`, `D:\` paths). Use the direct
  uvicorn/vite commands above instead.
- `tools/python.cmd` — Windows shim hardcoding the rig's conda path.
  Use `python`/`python3` directly.
- ComfyUI (:8188), Ollama (:11434), Unity (:7800), Blender (:9876), the Go
  sidecars — external services; the app boots and the UI works without
  them, AI generation features report offline.

## 6. Agent-specific notes

- The exec guard (`tools/hooks/check-exec-command.py`, wired via
  `.claude/settings.json`) detects POSIX and only enforces the
  destructive-git rules — heredocs, bash, and unix utilities are all
  valid for you. The hook command tries `python` then `python3`.
- Commit rules are identical to Windows: conventional subject +
  `Co-authored-by:` trailer naming your agent (see CONTRIBUTING.md).
- Generated media must land under `output/` to appear in the Media
  Library (media-output-contract).
- Task ledgers live in `docs/plans/tasks/` — check yours before starting
  work, append status when done.

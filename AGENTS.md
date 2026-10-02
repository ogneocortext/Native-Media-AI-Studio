# AGENTS.md — Native Media AI Studio

> **Last Updated:** 2026-09-22
> **Status:** Active Development (Phase 1+2)
> **Platform:** Windows 11 local development machine

> **Agent bootstrap:** read `docs/README.md` first — it maps every documentation
> directory and says which are authoritative. Then read
> `docs/architecture/decision-log.md` before writing code. It records
> stack/architecture decisions (D1–D14 — do not re-litigate) and open questions
> (Q1–Q4). Update the log when you make or reverse an architecture decision.
> Frontend visualizer work also requires `docs/architecture/visualizer.md` — it
> maps the module split from D14 and states where new logic belongs.
>
> **Finding documentation:** the tree is 146 files across 14 directories, so
> searching blind returns the wrong document. `docs/README.md` is the index;
> `docs/knowledge-library/index.md` is the entry point for the 76-article
> research library. Note that `docs/knowledge/` is a *separate* doc set from the
> library and `docs/notes/` and `docs/scratch/` are explicitly not authoritative
> (D12).

## Project Overview

Full-stack music-video creation suite: React/Vite/TypeScript frontend, FastAPI backend, Unity/Blender/ComfyUI/Remotion MCP integrations, and Go sidecars.

## Directory Structure

```
Native-Media-AI-Studio/
├── packages/frontend/     # React + Vite + TypeScript + Remotion
├── packages/backend/      # FastAPI (api, core, models, services, adapters, sse, queue, diagnostics)
├── tools/                 # MCP bridges (mcp/), Go sidecars (go-*), music-gen, vision, blender, ollama, demos
├── scripts/               # PowerShell startup/management
├── docs/                  # guides, setup, knowledge-library, scratch
├── config/                # ports.json, settings.json, tracks.json
├── output/                # Generative outputs + logs (gitignored)
├── unity-project-mcp/     # Unity project for music video generation
├── unity-visualizer/      # Native Media Visualizer — standalone Unity audio visualization project
├── shared/                # Shared TypeScript types
└── AGENTS.md / Guidelines.md
```

### Critical Directories

- **Do not delete/move** `unity-visualizer/` during cleanup.
- Scratch artifacts → `docs/scratch/` or `packages/frontend/tests/browser/out/`.
- Agent screenshots → `packages/frontend/tests/browser/out/` (gitignored; it was
  not always, so some older scratch output may still be tracked — see
  `tools/check-repo-layout.py`).
- **`/api/audio` is four modules, not one** (D15): `audio.py` (upload, analysis
  endpoints, cache, JSON index), `audio_stems.py` (separation), `audio_edit.py`
  (extract/rename/trim/file serving), `audio_analysis.py` (result builder,
  suggestions, section labelling — **no routes**). Put a new endpoint in the
  module matching its responsibility, not in `audio.py` by default. All three
  routers are registered in `main.py`; register a new one there or its routes
  vanish silently. `tools/snapshot-audio-routes.py --check` guards the surface —
  but it **cannot** catch a missing import, because OpenAPI is generated from
  decorators and never runs a handler body. After moving code under `app/api/`,
  call the endpoints.

## MCP Servers

| Server       | Command                                                      | Port       | Status        |
| ------------ | ------------------------------------------------------------- | ---------- | ------------- |
| Ollama Tools | `node tools/mcp/ollama-tools-mcp.mjs`                         | stdio      | Configured    |
| Vision       | `node tools/mcp/vision-mcp.mjs`                               | stdio      | Configured    |
| Unity MCP    | `node tools/mcp/unity-mcp-bridge.mjs`                         | 7800 (REST)| Running       |
| Blender MCP  | `uvx blender-mcp`                                             | 9876       | Running       |
| ComfyUI MCP  | `npx comfyui-mcp --comfyui-url http://127.0.0.1:8188`        | 8188       | Running       |
| Remotion MCP | `npx -y @remotion/mcp@latest`                                 | stdio      | Configured    |
| HyperFrames  | `node tools/mcp/hyperframes-mcp.mjs`                          | stdio      | Configured    |

## Vision Workflow

1. Capture screenshot via Playwright.
2. Analyze with `node tools/vision/analyze.mjs <screenshot> [--mode ui|responsive|regression|compare]` (uses local `gemma4:e2b-it-qat`).
3. Verify findings against DOM/API.
4. Fix and re-capture to confirm.

Never send generic prompts like "describe this image"; use mode-specific prompts for actionable output.

## Development Guidelines

### Services: start once, then leave them alone

**Do not restart a service that is already running.** This is the single most
common way an agent wastes time here, so it is stated as protocol rather than
left to judgement.

Both dev servers hot-reload. The Vite dev server recompiles on save, and the
backend runs under `watchfiles`, so **editing a file is enough** — the change is
live before you finish reading the terminal. Restarting discards that, costs
10–90 s of startup, and risks leaving a half-started process behind. Verify with
a request, not with a restart:

```bash
python tools/run-gates.py --only type lint   # catches a broken build in ~8s
curl -s http://127.0.0.1:8000/api/health    # or just reload the browser tab
```

Rules:

- Check what is up before starting anything: `scripts\check_ports.ps1`.
- Start only what is actually down. `-Services` takes **one** name, not a list.
- **Leave services running when you finish.** The next step usually needs them,
  and a stopped service is a slower "it doesn't work" than a running one.
- Restart only when the process is *wrong* — wedged, listening on the wrong
  port, or started before a dependency it needs.

`scripts\start-services.ps1` is currently broken: it builds an array and passes
it to `manage-servers.ps1`'s `[string]$Services` parameter, which fails with
"Cannot convert value to type System.String". Until that is fixed, call the
manager directly:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\manage-servers.ps1 -Action start -Services all
```

Note `pwsh`, not `powershell` — the agent shell is 5.1 and these scripts require
7.6+. ComfyUI and the video editor are optional; the studio runs without them.

### Shell / Process Management

**Prefer Python over PowerShell for anything an agent runs.** This is now
standing protocol, not a preference. The reasons are measured, not aesthetic:

- A `.ps1` wrapper (`pnpm.ps1`) can **report exit code 1 while the command
  actually passed**. A gate that "fails" when it succeeded is worse than no gate.
- PowerShell decodes a pipe using the **ANSI code page**, so UTF-8 output
  arrives as mojibake — and the repo's own docs contain em dashes and `→`.
- Native commands writing to stderr surface as `NativeCommandError` even on
  success, which makes `2>&1 | Select-Object -Last N` unreliable for
  diagnostics.
- PowerShell 5.1 is the agent shell; the repo's own scripts need 7.6+. That gap
  is a recurring source of "the script is broken" conclusions that are wrong.
- **The same locale trap exists inside Python.** `subprocess.run(...,
  text=True)` with no `encoding=` decodes with the locale codec (cp1252 here),
  so UTF-8 output is mis-decoded — and a leading BOM becomes `"ï»¿"` rather
  than `U+FEFF`, so BOM-stripping silently does nothing. This produced a
  confidently wrong "commit is missing" verdict during the checkpoint work.
  `tools/check-subprocess-encoding.py` rejects the pattern and runs in the
  `docs` gate; `tools/fix-subprocess-encoding.py` applies the fix. For git, use
  `tools/_gitutil.py` (`run_git`, `git_lines`, `delete_ref`) rather than a
  private wrapper.
- Also: piping a **large** stream into a subprocess (`git patch-id`,
  `git cat-file --batch-check`) deadlocks the reader thread on Windows and
  returns empty output. Write it to a temp file and pass the file as stdin.

Concretely: run gates through `python tools/run-gates.py` (it resolves its own
tools, decodes as UTF-8 and returns a trustworthy exit code). Write new helper
scripts in Python under `tools/`. Reserve `.ps1` for genuine Windows
integration — service lifecycle, port binding, Unity launch — where it is the
right tool and nothing has gone wrong.

- **Requires PowerShell 7.6+ for the project's own scripts.** The agent shell may
  itself be PowerShell **5.1** — check `$PSVersionTable.PSVersion.Major` before
  concluding the scripts are broken.
- On PowerShell failures, **fall back to Python immediately**. This is not just
  for crashes: PowerShell mangles tool output. Run any gate whose exit code
  matters from Python `subprocess` with an explicit `cwd`, and read
  `returncode`. Treat an **empty** capture as "failed to capture", never
  "passed". `tools/run-gates.py` already does this; reach for it rather than
  assembling `subprocess` calls by hand.
- Long-running sessions must use the `background_process` tool.
- **Do not leave `tmp_*` scratch files in the repo root.** Names like
  `tmp_m.txt` or `tmp_g.py` are meaningless to the next reader and are the
  convention this project is moving away from. If you need a scratch file while
  a command runs, put it **outside the repo** (e.g. `$env:TEMP`), and delete it
  when finished. If a helper is worth keeping, give it a descriptive name and
  commit it under `tools/`.
- Unity headless mode: `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\\start-unity-headless.ps1` starts the project in persistent `-batchmode` with GPU rendering; use `-Status` and `-Stop` for control. The Unity project stays in Edit mode for shader/material authoring commands.

### Machine-specific PATH traps (this workstation)

These are properties of the machine, not the repo. Each has already caused a
wrong action, so verify before trusting a bare command name.

| Bare name | Resolves to | Why it's a trap |
|---|---|---|
| `bash` | `C:\Windows\System32\bash.exe` | The **WSL launcher**, not Git Bash. It fails on Windows PATH entries it cannot translate (e.g. Android SDK), and errors mention unrelated tools. For repo shell scripts use `C:\Program Files\Git\bin\bash.exe` explicitly. |
| `python` | `C:\Python314\python.exe` (3.14.7) | Not the project interpreter, but see the correction below — the failure mode is subtler than "no packages". |
| `node` | `...\fnm\aliases\default\node.exe` | fnm's **alias**, pinned to whatever was default when it was created. This machine has v24.20.0, v26.0.0 and v26.7.0 installed, but the alias resolves to v24.20.0 — not the newest. Prefer `pnpm.cmd` from Python with an explicit `cwd`. |

**Correction (measured 2026-10-01): do not use bare `python` for repo work —
but the reason is *not* missing packages.** An earlier version of this file
claimed `C:\Python314` has no backend dependencies and that `import fastapi`
fails there. That is no longer true: `C:\Python314` (3.14) now imports
`fastapi`, `pytest`, `ruff`, `numpy`, `pydantic` and `sqlalchemy` cleanly, and
`ruff check` passes under it.

It still must not be used, because it **fails the backend suite**:

```
C:\Python314\python.exe                     pytest -> rc=1
  PermissionError: [WinError 5] ... pytest-of-NeoCortext\pytest-current
D:\conda-envs\nma-studio-cuda\...\python.exe   pytest -> rc=0, 156 passed in 42.55s
```

3.14's stricter temp-dir cleanup cannot remove pytest's `pytest-current`
pointer. The lesson is the general one: **an interpreter having the packages
installed is not the same as it working.** Verify by running the gate, never by
inspecting imports. `tools/run-gates.py` does exactly that — it probes
candidates with a real `ruff` run and caches the winner.

`where python` on this machine returns three interpreters, and one of them is
`D:\conda-envs\comfyui-cuda\Scripts\python.exe`, which is **never** valid for
backend work.

There **is** a PowerShell 7 profile at
`C:\Users\Aomega Imaging\Documents\PowerShell\Microsoft.PowerShell_profile.ps1`
(pwsh uses `Documents\PowerShell\`; Windows PowerShell 5.1 would use
`Documents\WindowsPowerShell\`, which is empty). It prepends Ollama, VS Code,
npm, Git and Zed to `PATH`, runs `fnm env --use-on-cd`, runs `conda init`, and
sources a ~170 KB OpenClaw completion script. It was fixed on 2026-10-01 so it
no longer writes to stderr on startup and no longer emits startup diagnostics in
non-interactive sessions. If a tool still sees spurious `NativeCommandError`
from a command that succeeded, check whether that noise is back.

Note the profile does **not** fix the `python` trap above: `python` resolves to
`C:\Python314` in both pwsh 7 and the 5.1 agent shell.

Unrelated tools on PATH (Android SDK, WSL) are noise from the OS environment —
they are not part of this project and should never be invoked for repo tasks.

### Services

- Start: `scripts\start-services.ps1` (backend + frontend, dynamic ports → `config/ports.json`).
- Status: `scripts\manage-servers.ps1 -Action status`
- Interactive: `scripts\start-studio.ps1`
- Ports: `scripts\check_ports.ps1`

### Critical Notes

- **Never commit/hand-edit** compiled `vite.config.js` / `vite.config.d.ts` in `packages/frontend/` — it shadows `vite.config.ts`.

## Music Video Pipeline

1. `tools/analyze_and_sync.py` for audio analysis + beat-synced JSON
2. Unity MCP for 3D scenes
3. AutoCapture.cs for frame renders (360 frames = 15s @ 24fps)
4. Blender MCP for high-quality renders
5. Remotion for final composite

## Python Environments

| Task | Interpreter |
|------|-------------|
| Backend / audio / ML / CUDA | `D:\conda-envs\nma-studio-cuda\Scripts\python.exe` |
| ComfyUI service only | `D:\conda-envs\comfyui-cuda\Scripts\python.exe` |
| Fallback / CPU-only | `venv\Scripts\python.exe` |

Rules:
- Default to `nma-studio-cuda` for backend + GPU work.
- Never use `comfyui-cuda` for backend work.

Music-gen prefers `tools/music-gen/.venv/Scripts/python.exe`, then `MUSIC_GEN_PYTHON`, then backend `sys.executable` (with warning).

## Testing

**One command runs every gate:** `python tools/run-gates.py` (or `pnpm verify`).
It runs doc checks → ruff → tsc → eslint → pytest → vite build, cheapest first,
prints one summary, and exits non-zero if any gate fails. Add `--e2e` to include
the Playwright suite (opt-in: it starts a Vite dev server). `--only <name> ...`
runs a subset; `--list` shows them. Prefer this over assembling the gates by
hand — the runner owns the Windows exit-code and UTF-8 decoding problems that
otherwise produce both false passes and false failures.

**It resolves its own tools, so nothing is hardcoded to one machine's layout.**
`pnpm` is found on PATH; the interpreter is chosen by probing candidates
(`$NMA_PYTHON` → `nma-studio-cuda` → any working `D:\conda-envs\*` → PATH) with a
real `ruff` run. This matters because a hardcoded path is not merely
machine-specific — it goes stale silently and pins every future agent to
whatever was current when it was written.

The winner is remembered in `%TEMP%\nma-studio-python-choice.json` purely as a
**hint to try first**, and it is re-verified on every run like any other
candidate — so repairing a broken env is picked up with no cache clearing. Set
`NMA_PYTHON` to override. Two flags diagnose a wrong-interpreter failure:

- `--which-python` — every candidate, its version, and why it was chosen or rejected
- `--list` — the resolved interpreter plus the gate list

Every gate has a timeout (pytest 300 s, build 600 s, e2e 900 s) and the whole
child tree is killed on expiry, so a wedged gate (pytest blocked on a locked
`%TEMP%` pointer, a browser that never exits) reports a failure instead of
silently hanging the caller.

Individual gates, for iterating on one area:

- Unit (pure logic): `pnpm test:unit` in `packages/frontend/` — vitest, for
  `src/**/*.test.ts`. Playwright cannot test these: booting a browser to assert
  `audioTiming.ts`'s latency math costs seconds and is flaky where a unit test
  costs ~1 ms. `pnpm test:unit:ui` opens the same suite in the Vitest UI
  (browser, watch mode). That URL is **token-authenticated**: copy the
  `http://localhost:<port>/__vitest__/?token=…` line it prints on startup, or
  the page returns 403.
  Test files are **colocated** under `src/`, not in `tests/`,
  because `tests/` holds Playwright specs and its own `tsconfig.tests.json`.
  Covered so far: `keyPalette.ts` (chroma→hue, Q5), `audioTiming.ts`
  (latency/beat clock), `lyricsSync.ts` (LRC parsing and lookup), and
  `canvas2dHelpers.ts` (colour/easing/noise). All four suites were
  mutation-checked. Still untested and pure: `perceptualScales.ts`,
  `sectionStateMachine.ts`, `visualizerHelpers.ts`, `lyricsParser.ts`.
- Frontend E2E: `pnpm test` in `packages/frontend/` (Playwright)
- Backend: `pytest` in `packages/backend/`
- E2E: Playwright under `packages/frontend/tests/browser/`
- Lint/format: `pnpm lint` / `pnpm format` (frontend); `ruff check` / `ruff format` (backend)
- Docs and repo hygiene: `python tools/check-all.py`
- Cache cleanup: `python tools/clean-caches.py --dry-run` to preview, without
  the flag to delete. Deliberately **not** `git clean -xdf`, which would also
  remove `output/` and the generated waveform cache. It only ever deletes
  regenerable test/build caches and refuses to touch anything git tracks.
- **Checkpoint refs / local repo size:** Cline writes restore points to
  `refs/cline/checkpoints/*`, which keeps their history alive in the object
  store even though nothing published depends on it. That made this checkout
  report **3.59 GiB** locally against **131 MB** on GitHub — the difference was
  a 2.9 GB `archive.tar.gz.tmp` plus the torch CUDA DLLs, all committed before
  those paths were ignored. `python tools/prune-checkpoint-refs.py` previews;
  `--apply` deletes. It is **age-based by default (14 days)** so recent
  sessions stay restorable — pass `--all` to delete every checkpoint. Then run
  `git gc --prune=now` to actually reclaim the disk.
  - **These refs are Cline's restore points.** Deleting one discards the
    ability to rewind that session from git. That is the deliberate trade, not
    an oversight: the objects they pin are unreachable from any branch.
  - **Do not** reach for `git filter-repo` or any history rewrite here. The
    published history is small; the bloat is local-only, so a rewrite would
    change every SHA on the remote for no benefit.
  - `python tools/report-large-git-objects.py --rev main` shows what is
    actually published; the default `--all` includes the checkpoint refs and
    will mislead you into thinking the remote is huge.
  - `python tools/check-dangling-commits.py` reports commits left unreachable
    by a prune and whether main already contains them.
- Knowledge library: `python tools/validate-knowledge-tags.py` — run this before
  committing any change under `docs/knowledge-library/`. A pre-commit hook does
  it automatically (see D10 in the decision log): run
  `bash scripts/install-git-hooks.sh` once after cloning. There is **no CI**, so
  these local hooks are the only automated guard.
- Hooks, and what each is for:
  - `pre-commit` — doc/repo hygiene, scoped to what the staged paths can affect,
    so an unrelated commit costs nothing.
  - `pre-push` — the fast gates (`docs ruff type lint unit`, ~11 s). It
    deliberately skips pytest (~40 s) and Playwright (~30 s): a 90 s push hook
    gets bypassed, which is worse than no hook. Run
    `python tools/run-gates.py --e2e` for those before pushing.
  - Both **chain** rather than replace. Git LFS ships its own `pre-push`, and
    `install-git-hooks.sh` keeps the displaced copy as `<name>.backup`, which the
    new hook calls at every exit path. If you install hooks by hand, preserve
    that.

## Quick Reference

| What | Where |
|------|-------|
| Frontend source | `packages/frontend/src/` |
| Backend source | `packages/backend/app/` |
| Go sidecars | `tools/go-*` |
| MCP bridges | `tools/mcp/` |
| Unity project | `unity-project-mcp/` |
| Visualizer | `unity-visualizer/` |
| Port config | `config/ports.json` |
| Logs | `output/logs/` |
| Outputs | `output/` |

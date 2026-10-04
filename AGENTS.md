# AGENTS.md — Native Media AI Studio

> **Last Updated:** 2026-09-22
> **Status:** Active Development (Phase 1+2)
> **Platform:** Windows 11 local development machine

> **Agent bootstrap:** read `docs/README.md` first — it maps every documentation
> directory and says which are authoritative. Then read
> `docs/architecture/decision-log.md` before writing code. It records
> stack/architecture decisions (D1–D31 — do not re-litigate) and open questions
> (Q1–Q6). Update the log when you make or reverse an architecture decision.
> Frontend visualizer work also requires `docs/architecture/visualizer.md` — it
> maps the module split from D14 and states where new logic belongs.
>
> **If you are a rotated-in agent (D21):** the models used here rotate, so the
> previous agent's model is not yours and its failure modes are not yours.
> `docs/architecture/provider-notes.md` holds per-model field notes, and
> `python tools/model-reliability/score.py` ranks models by what actually
> worked. Before you finish, append one line per session to
> `tools/model-reliability/observed.jsonl` -- that observed layer is tracked and
> is the only handoff state a new agent cannot rebuild for itself.
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
- **Every audio selector reads one store** (D16): `useAudioLibrary()` from
  `hooks/useAudioLibrary`, backed by `state/audioLibraryStore.ts`. Do **not** call
  `listAudioFiles()` from a component — it now has exactly one caller (the
  store), and grep for it to catch regressions. Naming and dedup rules live in
  `state/audioNaming.ts`; render `optionLabel` and never re-derive a track name
  with a local regex. Two incompatible regexes previously leaked 12 of 58 rows
  into some selectors with a visible hash. `cleanTrackName()` in the visualizer's
  `visualizerHelpers.ts` covers names used outside selectors (storyboards, CSV
  lookups, shader labels).
- **`/api/audio` is four modules, not one** (D15): `audio.py` (upload, analysis
  endpoints, cache, JSON index), `audio_stems.py` (separation), `audio_edit.py`
  (extract/rename/trim/file serving), `audio_analysis.py` (result builder,
  suggestions, section labelling — **no routes**). Put a new endpoint in the
  module matching its responsibility, not in `audio.py` by default. All three
  routers are registered in `main.py`; register a new one there or its routes
  vanish silently. `tools/snapshot-audio-routes.py --check` guards the surface —
  but it **cannot** catch a missing import, because OpenAPI is generated from
  decorators and never runs a handler body. After moving code under `app/api/`,
  call the endpoints. There is now a fifth: `audio_remix.py`
  (`/api/audio/remix/*`).
  - To check whether a route is registered, read `app.openapi()["paths"]`.
    `app.routes` holds *router groupings*, so it reports 37 entries with zero
    `/api/audio` paths while all 249 operations are live.
- **Remixes are ordinary stem sets.** `services/stem_remixer.py` builds mashups
  from stems of *different* songs and writes a plain
  `output/remixes/<name>/{vocals,drums,bass,other}.wav` + `remix.json`. That is
  the point: the enhancer chain, `/api/audio/stem-file` and the visualizer then
  work on a remix with no special-casing, so don't add a remix-only path
  downstream.
  - Source **tempo** is detected and time-stretched automatically (measured
    143.555 / 135.999 / 151.999 BPM, stable). Source **key** is not, and must not
    be: chroma flatness on these stems is 0.978-0.998 (1.0 = pure noise) and
    Ad-Nauseam's argmax changed between runs (A# → F). `key_shift_semitones` is
    explicit per layer. Don't "improve" this by trusting the detected key.
  - Tracks here open instrumentally — Ad-Nauseam's vocals are silent for the
    first 7.06 s, so a layer at `source_start_bar=0` renders digital silence
    that looks like a broken mixer. `preview_recipe` warns below −50 dBFS.
  - To master a remix use `POST /api/audio/remix/{name}/enhance`, **not**
    `/api/audio/enhance-stems`: that route resolves a library filename under
    `output/audio/`, so a remix 404s on both a bare name and an absolute path.
  - Tempo is probed from **drums** when present (`_pick_analysis_stem`), because
    `list_stem_sources` advertises partial stem sets and requiring vocals made
    the listing and the probe disagree. Probe caches live in
    `output/remixes/.probes/`, never beside the stems.
  - To hear a remix: `GET /api/audio/remix/{name}/file/{which}` where `which` is
    a stem name or `master`. Nothing else serves `output/remixes/`, and
    `/api/audio/file/...` resolves under `output/audio/`, so without this route
    a rendered remix is silent. `RemixPanel.tsx` (Visualizer, under Stem Mixer)
    is the UI.

## MCP Servers

| Server       | Command                                                      | Port       | Status        |
| ------------ | ------------------------------------------------------------- | ---------- | ------------- |
| Ollama Tools | `node tools/mcp/ollama-tools-mcp.mjs`                         | stdio      | 10 tools, executes |
| Vision       | `node tools/mcp/vision-mcp.mjs`                               | stdio      | 13 tools, executes |
| Unity MCP    | `node tools/mcp/unity-mcp-bridge.mjs`                         | 7800 (REST)| 17 tools; needs Unity |
| Blender MCP  | `uvx blender-mcp`                                             | 9876       | Running       |
| ComfyUI MCP  | `npx comfyui-mcp --comfyui-url http://127.0.0.1:8188`        | 8188       | Running       |
| Remotion MCP | `npx -y @remotion/mcp@latest`                                 | stdio      | Configured    |
| HyperFrames  | `node tools/mcp/hyperframes-mcp.mjs`                          | stdio      | 9 tools, executes |

## MCP clients: which config holds the servers

The bridges above are only reachable once a client is told about them. Verified
2026-10-02 by launching each server from the command exactly as written in each
config and calling a tool - not by reading the config.

| client | config | note |
|---|---|---|
| OpenCode | `opencode.json` (repo root) | already had all servers |
| Kilo Code | `.kilo/kilo.jsonc` | gitignored; machine-specific paths |
| Cline | `~/.cline/mcp.json` | outside the repo, so not shared |
| Claude Code | `~/.claude.json` | none of these; only `pencil` |
| openclaw | `~/.openclaw/openclaw.json` | only an unrelated `space-analyzer` |

Two Windows details every config should keep: resolve `node` to an **absolute**
path (it is an fnm alias), and give **absolute** script paths (clients do not all
honour `cwd`, and this repo's path contains spaces).

`unity-mcp-bridge` ships **disabled** in the Kilo and Cline configs. That is not
because it is broken - it needs Unity Editor running, and the port file it reads
outlives a crash. Start Unity with the project open, or
`scripts\start-unity-headless.ps1`, and it becomes usable.

`context-store.mjs` is deliberately absent from every config: it exports four
functions and has no transport, so it is a library rather than an MCP server and
could not be called by any client.

## Vision Workflow

1. Capture screenshot via Playwright.
2. Analyze with `node tools/vision/analyze.mjs <screenshot> [--mode ui|responsive|regression|compare]` (uses local `gemma4:e2b-it-qat`).
3. Verify findings against DOM/API.
4. Fix and re-capture to confirm.

Never send generic prompts like "describe this image"; use mode-specific prompts for actionable output.

## Backend Layering: `services`/`adapters` Must Never Import `api`

The dependency direction is **api -> services -> adapters**, and only downward.
`python tools/check-import-cycles.py` is the `arch` gate and fails on any import
cycle anywhere under `packages/backend/app`, plus any upward edge into `app.api`.

It was written because both defects it guards were invisible by reading: each was
held open by a *deferred* (function-local) import, which looks like a working
escape hatch but only postpones the problem. Baseline as of D32: 0 cycles,
0 inversions, 122 modules, 267 edges.

Two real cycles were removed that way. Both involved `services/vram_manager.py`
reaching back into `queue.manager` and `adapters.ollama`; the fix was to pass that
state in (`set_queue_provider`, `set_last_model_provider`) and wire it in `main.py`
-- not to shuffle files. A service needing something it does not own means the
dependency belongs inverted, not that a module needs to reach around the graph.

Do **not** "fix" a cycle by adding another deferred import. It passes review, and
it passes the gate, until it doesn't.

## Proving a Defect Before Claiming One

Three "confirmed bug" claims in the 2026-10 quality pass were overturned by
measurement. All three came from the same move: asserting a property of the code
by *reading* it. The corrections cost more time than the investigations would
have.

| Claimed from reading | Measured |
|---|---|
| EQ rewiring leaked a parallel path, stacking filters | 0 differing cases across all band-count sequences |
| `sr = 22050` discards the top octaves | 0.25% of power; inaudible |
| per-sample DSP loops make the chain unusable | ~1 min for 231 s x 4 stems |

**Measure before you name a defect.** Read the code to form a hypothesis, then
run something that could disprove it. If nothing could disprove the claim, it
is not a finding yet. A measurement that comes back clean is worth as much as
one that confirms, and it saves writing a fix and a test for a bug that is not
there.

Two specific traps:

- **A mutation test that stops failing is a signal about the *test*.** When
  reintroducing a suspected bug stops producing failures, the test cannot see the
  bug — the assertion is wrong. Do not relax the assertion to make it pass.
- **A mock proves the mock.** A test that mocks a platform API only shows the
  mock matches your assumption. A Web Audio mock here treated a duplicate
  `connect()` as a second edge; the real API treats it as a no-op, and that
  difference invented a bug. Check a mock's edge semantics against the spec
  before trusting a defect it reports.

Prefer the repo's own measurement path over a hand-rolled one. A first attempt
at LUFS here reported **+157 LUFS** — impossible — because the K-weighting filter
was wrong; `ffmpeg -af ebur128` (already used by `ffmpeg_tools.py:145`) gave
-14.7. Same for lint: `tools/run-gates.py` owns the Windows exit-code and UTF-8
problems, so an answer assembled from raw `subprocess` calls is both slower and
less trustworthy.

Also: state the evidence when you report. Name the command, the measured value,
or the `file:line`. "Verified" with nothing to re-run is the same as unverified,
and in this repo it has been wrong.

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

**Before blaming ComfyUI, measure it.** A deep ComfyUI queue plus
`timed out after 300s` in the logs looks exactly like "ComfyUI is broken", and
was for about a year — it was not. Measure what ComfyUI's own `/history` says the
durations were, and whether the backlog is even ours:

```bash
python tools/comfyui-queue-report.py
```

That reports duration min/median/max from `/history`, the live queue depth, and
whether the pending ids appear in our logs (they should not — an id that is
queued but in none of our logs is an orphan, not in-flight work).

The real cause (fixed in D29) was that waiters raised on timeout and **left the
prompt running inside ComfyUI**, so every failure lengthened the queue for the
next job — including its own retry. Do not reintroduce that: any exit that is not
success must call `_cu.cancel_prompt`. Note `DELETE /queue` returns 405 on this
build; cancel is `GET /queue` then `POST /queue {"delete":[id]}`. Full playbooks
are in `docs/knowledge-library/backend-debugging-guide.md`.

### Shell / Process Management

**Prefer Python over PowerShell for anything an agent runs.** Measured, not
aesthetic:

- A `.ps1` wrapper (`pnpm.ps1`) can **report exit code 1 while the command
  passed**. A gate that fails when it succeeded is worse than no gate.
- Pipes decode with the **ANSI code page**, so UTF-8 arrives as mojibake - and
  this repo's own docs contain em dashes and arrows.
- Native commands writing to stderr raise `NativeCommandError` even on success,
  so `2>&1 | Select-Object -Last N` is unreliable for diagnostics.
- The agent shell is PowerShell 5.1; the repo's scripts need 7.6+. That gap is a
  recurring source of "the script is broken" conclusions that are wrong.
- **The same trap exists inside Python.** `subprocess.run(..., text=True)` with no
  `encoding=` decodes with the locale codec (cp1252), and a leading BOM becomes
  `"..."` rather than `U+FEFF`, so BOM-stripping silently does nothing. This
  produced a confidently wrong "commit is missing" verdict during the checkpoint
  work. `tools/check-subprocess-encoding.py` rejects the pattern (it runs in the
  `docs` gate); `tools/fix-subprocess-encoding.py` applies the fix. For git use
  `tools/_gitutil.py` rather than a private wrapper.
- Piping a **large** stream into a subprocess (`git patch-id`,
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

Properties of the machine, not the repo. Each has already caused a wrong action.

| Bare name | Resolves to | Trap |
|---|---|---|
| `bash` | `C:\Windows\System32\bash.exe` | The **WSL launcher**, not Git Bash. Errors mention unrelated tools. For repo scripts use `C:\Program Files\Git\bin\bash.exe`. |
| `python` | `C:\Python314\python.exe` (3.14.7) | Imports every backend package and passes `ruff`, but **fails pytest** (rc=1): 3.14's temp cleanup cannot remove `pytest-current`, giving `PermissionError [WinError 5]`. `nma-studio-cuda` gives rc=0. |
| `node` | fnm `aliases\default\node.exe` | An alias pinned when it was created, not the newest installed. Prefer `pnpm.cmd` from Python with an explicit `cwd`. |

**An interpreter having the packages installed is not the same as it working.**
Verify by running the gate, never by inspecting imports - `tools/run-gates.py`
probes candidates with a real `ruff` run and caches the winner. `where python`
also returns `D:\conda-envs\comfyui-cuda\Scripts\python.exe`, which is never
valid for backend work.

A PowerShell 7 profile exists at
`C:\Users\Aomega Imaging\Documents\PowerShell\Microsoft.PowerShell_profile.ps1`
(5.1 uses `Documents\WindowsPowerShell\`, which is empty). It prepends Ollama,
VS Code, npm, Git and Zed to `PATH`, runs `fnm env --use-on-cd` and `conda init`.
It was fixed on 2026-10-01 to stop writing to stderr in non-interactive sessions;
if spurious `NativeCommandError` appears from a command that succeeded, check
whether that is back. It does **not** fix the `python` trap - `python` resolves
to `C:\Python314` in both shells.
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
`pnpm` from PATH; the interpreter is chosen by probing candidates
(`$NMA_PYTHON` -> `nma-studio-cuda` -> any working `D:\conda-envs\*` -> PATH) with
a real `ruff` run. A hardcoded path would not merely be machine-specific, it would
go stale silently and pin every future agent to whatever was current when it was
written. The winner is cached in `%TEMP%\nma-studio-python-choice.json` purely
as a **hint to try first** and is re-verified every run, so repairing a broken env
needs no cache clearing. Set `NMA_PYTHON` to override; `--which-python` explains a
wrong-interpreter failure and `--list` prints the resolved interpreter and gates.

Every gate has a timeout (pytest 300 s, build 600 s, e2e 900 s) and the child tree
is killed on expiry, so a wedged gate reports a failure instead of hanging.

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
  For which suites exist and which remain pure-but-untested, read the coverage
  inventory in `docs/TESTING_WORKFLOWS.md`. It changes every time tests are
  added, so it does not belong in a file every agent loads at start-up.
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

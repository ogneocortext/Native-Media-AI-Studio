# AGENTS.md — Native Media AI Studio

> **Last Updated:** 2026-10-30
> **Status:** Active Development (Phase 1+2)
> **Platform:** Windows 11 local development machine

> **Shell rule: all commands go through PowerShell 7 (`pwsh`) by
> default.** There are two PowerShell 7 installs on this machine:
>
> - **Agent shell:** `C:\kilo\pwsh7\pwsh.exe` — PowerShell **7.6.6.500**
>   (configured via `~/.config/kilo/kilo.jsonc`, `"shell":
>   "C:\\kilo\\pwsh7\\pwsh.exe"`). The old `C:\kilo\pwsh.exe` was a
>   0-byte placeholder that silently fell back to 5.1 — removed
>   2026-10-10.
> - **Your interactive shell:** `pwsh` on PATH resolves to the Microsoft
>   Store package — **pwsh 7.7.0**
>   (`Microsoft.PowerShell_7.7.0.0_x64__8wekyb3d8bbwe\pwsh.exe`).
>
> Both satisfy the project's 7.6+ requirement. If a session still reports
> `$PSVersionTable.PSVersion.Major` = 5 (config picked up only at
> session start), invoke scripts as
> `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\<name>.ps1`
> and never as `powershell ...`. Check
> `$PSVersionTable.PSVersion.Major` before concluding a script is
> broken. On any PowerShell failure, fall back to Python immediately
> (see Shell / Process Management below).
>
> **Mandatory before any command work:** read
> `docs/powershell-command-sheet.md` in full — **§0 "Escaping Rules"
> first**: any command containing a newline, backtick, `$`, or both
> quote types must be written to a file and executed, never inlined.
> Heredocs, `bash`/`sh`/`cmd`/`wsl`, `powershell.exe`, unix utilities
> (`find`/`grep`/`env`/`export`/…), multi-line `-m`/`-c`/`-e` payloads,
> expandable here-strings, and destructive git ops are **blocked
> by a PreToolUse hook** (`tools/hooks/check-exec-command.py`, tests in
> `tools/hooks/test-check-exec-command.py`) before
> they run — do not attempt them even once.
> It is the authoritative
> PowerShell 7 command reference for this Windows machine. **Do NOT use
> `bash`, `cmd`, `sh`, `zsh`, or any Unix shell** on this machine —
> `bash` here resolves to the WSL launcher, NOT Git Bash, and will
> produce confusing errors. `powershell` (5.1) is retired. The only
> permitted shell is `pwsh` 7+.
>
> **Command cheatsheet:** `docs/agent-shell-cheatsheet.md` — quick
> reference for interpreters and exit codes. The mandatory command
> sheet is `docs/powershell-command-sheet.md`.
>
> **Agent bootstrap:** read `docs/README.md` first — it maps every documentation
> directory and says which are authoritative. Then read the **Quick index** at
> the top of `docs/architecture/decision-log.md` before writing code — one
> line per decision (D1–D79 — do not re-litigate) plus Q1–Q6 — and open
> only the entries your task touches. Do **not** read the whole log
> (~190 KB): the index is the navigation layer. Update both the entry and
> its index line when you make or reverse an architecture decision.
> Frontend visualizer work also requires `docs/architecture/visualizer.md` — it
> maps the module split from D14 and states where new logic belongs.
> For source discovery, follow `docs/agent-code-navigation.md`; docs search is
> documentation-only, and `codebase.json` is a legacy orientation map.
>
> **Task state lives in `docs/plans/tasks/`** — one file per focus area
> (map: `docs/plans/focus-areas-and-behavior-ledgers-2026-10.md`). When
> starting work in an area, read its task file and resume at the first
> open item. Mark items `doing` when you start them, `done` only when
> their acceptance check passes. **An item is not done until its
> task-file update — status flip plus a Last session line naming the
> commit and the acceptance evidence — is in the SAME commit as the
> work.** A code commit that leaves the task file untouched is an
> incomplete commit, however good the code is: three landed items
> (2026-11-03 review) sat at `todo` in the ledger until someone else
> repaired the entries. Sessions end without warning, and the file
> is the handoff — there is no "update it next commit."
> Format and rules: `docs/plans/tasks/README.md`.
>
> **Project skills** live in `.claude/skills/` — the tracked canonical set
> (52 skills). Every agent host reads its own directory, so canonical is
> mirrored to `.kilo/`, `.devin/` and `.agents/` (Kilo, Devin, Cline and
> friends), and `packages/frontend/{.claude,.agents,agent}/skills` carry a
> deliberate subset — the Remotion skills — so an agent launched inside the
> frontend package gets the same instructions as one at the repo root. (The
> frontend `.claude` entries are junctions into its `.agents`.) A second
> mirror set covers hosts launched from the home directory (`~/.claude`,
> `~/.codex`, `~/.gemini`, `~/.copilot`, `~/.continue`, `~/.factory`,
> `~/.openclaw`, `~/.kilocode`, `~/.kilo`, `~/.codeium/windsurf`,
> `~/.gemini/antigravity`): `tools/sync-user-skills.py` writes the canonical
> set into each host's own `skills/` dir, because those hosts never see the
> repo. Host-local skills that are not canonical (`.codex`'s `.system` /
> `codex-primary-runtime`, `.copilot`'s `browseros-neo`) are left untouched.
> **Add a skill by writing `.claude/skills/<name>/SKILL.md`, then run
> `python tools/sync-skill-mirrors.py` (repo mirrors) AND
> `python tools/sync-user-skills.py` (home hosts) — never copy by hand.** A
> skill that exists in any mirror but not in canonical, or whose bytes differ,
> is a docs-gate failure (`tools/check-skill-mirrors.py` for repo mirrors,
> `tools/sync-user-skills.py --check` for home hosts). Key ones:
> `autonomous-session` (unattended-operation protocol + skill-chaining
> router — load for multi-step work), `visual-qa-loop` (screenshot →
> vision-analyze → research → improve → re-verify), `gates-commit-push`
> (commit/push protocol with the Co-authored-by trailer),
> `ollama-model-ops` (model selection, vision pre-warm, VRAM/timeout
> budgets), `vision-page-analysis`, `music-video-vision`, `blender-mcp`,
> `comfyui-mcp`, `unity-mcp`, `storage-sweep` (storage/ + repo-debris
> hygiene), `vendor-drift`, `media-output-contract`, `test-measure-improve`,
> `line-by-line-review`, plus the `*-design` UI-pattern skills. Load one
> with the `skill` tool when the task matches its description.
>
> **If you are a rotated-in agent (D21):** the models used here rotate, so the
> previous agent's model is not yours and its failure modes are not yours.
> `docs/architecture/provider-notes.md` holds per-model field notes, and
> `python tools/model-reliability/score.py` ranks models by what actually
> worked, and `tools/model-reliability/roster.md` tiers them by what they
> may be trusted with (check your own tier there before taking work). Before you finish, append one line per session to
> `tools/model-reliability/observed.jsonl` -- that observed layer is tracked and
> is the only handoff state a new agent cannot rebuild for itself.
>
> **Finding documentation:** the tree is ~290 markdown files across ~27
> directories, so searching blind returns the wrong document. (Deliberately
> approximate: a hardcoded count here read 197/13 while the real values were
> 293/27, which points an agent at the wrong number of places. Recount with
> `python -c "import pathlib;print(len(list(pathlib.Path('docs').rglob('*.md'))))"`.)
> `docs/README.md`
> is the index; `docs/knowledge-library/index.md` is the entry point for the
> research library (count lives in `knowledge-tracker.md`, not here — R3). `docs/source-map.md` is a condensed "where is
> what" quick reference for source files (backend, frontend, tests, config,
#  scripts, tools). Note that `docs/knowledge/` is a _separate_ doc
> set from the library and `docs/notes/` and `docs/scratch/` are explicitly not
> authoritative (D12).
>
> **Adding knowledge-library documents is scaffolded, not hand-written.**
> Create new `docs/knowledge-library/*.md` articles with
> `python tools/kb-add.py --title "..." --category <primary> --type <type>`
> — it writes schema-compliant frontmatter (primary category tag FIRST,
> then `aliases:`/`cssclasses:`/`date:`/`type:`), auto-links related docs,
> registers the file in `index.md` + `knowledge-tracker.md` + `log.md`,
> and runs the validator. Hand-rolled frontmatter gets rejected at commit
> by `tools/validate-knowledge-tags.py` (primary-tag-first rule, required
> fields, tracker/index count sync). The full contract is
> `docs/knowledge-library/_schema.md`; tag taxonomy is `tagging-guide.md`.
> Editing an existing article's frontmatter? Keep the same invariants —
> first tag a primary category, all four required fields present.

## Project Overview

Full-stack music-video creation suite: React/**Vite 8+**/TypeScript frontend, FastAPI backend, Unity/Blender/ComfyUI/[[remotion-agent-skills-2026|Remotion]] integrations, and Go sidecars.

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
- **NSFW is a visibility gate, not a cleanup** (D79): the flag is the `nsfw`
  **media tag**, and flagged items are excluded **server-side** from
  `/api/outputs`, `/recent`, `/{file_type}` and every path-only library list
  (favorites, collections, tags, trash, organization). `visible_outputs()` in
  `api/outputs_scanner.py` is the one choke point — a new general list
  endpoint that skips it leaks flagged items and their thumbnails.
  `show_nsfw` (`config/settings.json`, default false) only governs whether
  `/nsfw` is served and whether its nav entry exists; `GET /api/outputs/nsfw`
  answers `[]` while it is off. Never re-add client-only hiding, and never
  flag items programmatically: the owner flags his own, one item at a time.
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
    `app.routes` holds _router groupings_, so it reports 39 entries with zero
    `/api/audio` paths while all 286 operations are live.
- **Remixes are ordinary stem sets.** `services/stem_remixer.py` builds mashups
  from stems of _different_ songs and writes a plain
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
    a rendered remix is silent. `RemixPanel.tsx` (`features/remix/`, the
    `/create/remix` page) is the UI — it moved out of the visualizer; the
    visualizer reaches it via the `pendingTrack`/`pendingRemixOpen` handoff.

## Retrieval / embedding subsystem (`/api/retrieval`)

Hybrid BM25 + vector search with local cross-encoder reranking. **Nothing leaves
the machine** - all models run in the local Ollama instance. **Ollama must be
running** (`http://127.0.0.1:11434`) or embedding fails and search degrades to
BM25-only.

Endpoints: `GET /api/retrieval/status`, `POST /api/retrieval/index`,
`POST /api/retrieval/search`. Python API in
`packages/backend/app/core/ollama_client.py`: `embed_text()`,
`embed_text_batch_concurrent()`, `_embed_model_available()`. Models:
`nomic-embed-text:v1.5` (primary, 768-dim), `embeddinggemma-2:270m` (fallback),
`BAAI/bge-reranker-v2-m3` (reranker).

**Full cookbook** - worked Python for each function, HTTP examples, common
pitfalls (never use the Ollama-ID reranker with transformers, always pass
`expected_dim=768`, embedding models are excluded from chat):
`docs/agents/retrieval-cookbook.md`.

## MCP clients: which config holds the servers

The bridges above are only reachable once a client is told about them. Verified
2026-10-02 by launching each server from the command exactly as written in each
config and calling a tool - not by reading the config.

| client      | config                      | note                               |
| ----------- | --------------------------- | ---------------------------------- |
| OpenCode    | `opencode.json` (repo root) | already had all servers            |
| Kilo Code   | `.kilo/kilo.jsonc`          | gitignored; machine-specific paths |
| Cline       | `~/.cline/mcp.json`         | outside the repo, so not shared    |
| Claude Code | `~/.claude.json`            | none of these; only `pencil`       |
| openclaw    | `~/.openclaw/openclaw.json` | only an unrelated `space-analyzer` |

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

## MCP Servers

Bridges in `tools/mcp/` (stdio/REST). Tool counts as-of 2026-10-10 and go stale; authoritative list is each server's `tools/list` (or `server.registerTool`/`TOOL_DEFS` in source). `unity-mcp-bridge` ships disabled (needs Unity running). `context-store.mjs` is a library, not a server. See `docs/knowledge-library/` for full setup.

## Filesystem MCP: `search_files` needs exclusions on this repo

The filesystem MCP is the official `@modelcontextprotocol/server-filesystem`
package (v2026.8.31), declared in the **global** config
(`~/.config/kilo/kilo.jsonc`) with this repo as one of three allowed roots - it
is not a project server and not a Kilo built-in. Its `search_files` walks the
entire allowed root, so on this repo it times out (MCP error -32001) unless the
call passes `excludePatterns`. Measured 2026-10-06: with the exclusions below a
full `**/*.ts` search returns thousands of hits in seconds; without them it dies
at the timeout. The global config's timeout for this server was raised 15 s ->
60 s the same day as a margin; exclusions are the real fix.

- A pattern must match the **directory itself** to prune the walk.
  `**/node_modules` works; `node_modules` only matches the top-level one, and
  `**/node_modules/**` still walks the whole tree before filtering results (the
  exclusion check runs before recursion in `searchFilesWithValidation`).
- Exclude at minimum: `**/node_modules`, `**/.git`, `**/huggingface_cache`,
  `**/venv`, `**/.venv`, `**/.python-env`, `**/output`, `**/out`, `**/tmp`,
  `**/logs`, `**/storage`, `**/runtime`, `**/unity-project-mcp`,
  `**/unity-visualizer`, `**/diffusion_models`, `**/stable-diffusion`,
  `**/hunyuan_vae`, `**/text_encoder`, `**/vae`, `**/third_party`,
  `**/unsloth_compiled_cache`, `**/transcriptions`, `**/suno-templates`,
  `**/browser-test`, plus the dot-caches (`**/.cache`, `**/.ruff_cache`,
  `**/.turbo`, `**/.obsidian`, `**/.devin`, `**/.playwright-mcp`,
  `**/.pytest_tmp`, `**/.zed`, `**/.comfyui-backups`).
- `.kilo/worktrees/` holds full source checkouts - exclude it unless you
  specifically want worktree results (it doubles or triples the result set).
- For code search prefer the repo's own `grep`/`glob` tools; reach for
  filesystem `search_files` only when you need the MCP's view of the tree.

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
held open by a _deferred_ (function-local) import, which looks like a working
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
by _reading_ it. The corrections cost more time than the investigations would
have.

| Claimed from reading                                 | Measured                                          |
| ---------------------------------------------------- | ------------------------------------------------- |
| EQ rewiring leaked a parallel path, stacking filters | 0 differing cases across all band-count sequences |
| `sr = 22050` discards the top octaves                | 0.25% of power; inaudible                         |
| per-sample DSP loops make the chain unusable         | ~1 min for 231 s x 4 stems                        |

**Measure before you name a defect.** Read the code to form a hypothesis, then
run something that could disprove it. If nothing could disprove the claim, it
is not a finding yet. A measurement that comes back clean is worth as much as
one that confirms, and it saves writing a fix and a test for a bug that is not
there.

Two specific traps:

- **A mutation test that stops failing is a signal about the _test_.** When
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

### Character hygiene: ASCII punctuation in source, always

Write only the characters the content actually needs. Specifically banned
in every tracked text file (enforced by `tools/check-banned-chars.py`, a
hard gate in `tools/check-all.py`):

- **Control characters** — BEL/BS/ESC and friends. Root cause found
  2026-11-06: **PowerShell expandable strings eat backtick escapes** —
  `` `a ``→BEL, `` `b ``→BS, `` `e ``→ESC, `` `t ``→TAB, `` `n ``→LF,
  `` `0 ``→NUL, `` `u{...}` ``→unicode. Writing file content through
  `"..."` or `@"..."@` turns every markdown `` `code` `` span into
  control-char corruption (`audioFile`→BEL+`udioFile`, ```` ```tsx ````
  fences destroyed — both repaired under T-PLT-40). **Rule: file content
  goes through the write/edit tools, Python, or single-quoted
  here-strings `@'...'@` — never `"..."` or `@"..."@`.** If you mean a
  letter, type the letter.
- **Invisible/format characters** — zero-width spaces/joiners, bidi
  controls, soft hyphen, BOM anywhere but byte 0. They break diffs,
  searches, and copy-paste invisibly.
- **Mojibake** — UTF-8 read as cp1252 (mojibake triples like the
  right-single-quote sequence, accented-letter pairs, the BOM triple).
  Files are UTF-8; never paste text that has been through a
  legacy-codepage round trip. Re-type it.
- **Smart quotes in code** — `‘’“”` belong in user-facing display strings
  only, never in identifiers, commands, paths, or code you generate for
  shells/JSON. Use `'`/`"` there.

Non-ASCII is fine where it is the product (ASCII-art borders in
`cli_output.py`, UI display strings, docs typography) — the gate bans the
*broken* classes, not typography. When in doubt: ASCII.

### Agent efficiency: what actually costs turns (D83)

AGENTS.md is loaded into **every request from every agent**, so it is the one
file where a wrong fact is paid repeatedly. Measured cost of the 2026-11-21
audit: the docs-tree count was stale by 96 files and 14 directories, and the
model table was missing an installed 4.7 GB model. Neither is a typo; each one
costs a downstream agent a discovery cycle.

- **Never hardcode a count that something else can compute.** Say "~290" with a
  recount command, or point at the file that owns the number. An exact number in
  prose is a deadline, not a fact.
- **When you touch a table of installed things, re-derive it** from the source
  (`ollama list`, `git ls-files`, the ports file) instead of editing a row.
- **`tools/check-doc-facts.py` enforces both** and runs in ~0.3 s, so it is not
  a reason to skip a gate run.

The wider principle, from the 2026-11 measurement literature: an agent's cost is
dominated by *repeated discovery and failed attempts*, not by the model's price.
Concrete wastes this repo is built to avoid: rediscovering which interpreter to
use (`run-gates.py` probes and caches its own), rediscovering which model to use
(this table and `tools/model-reliability/roster.md`), and re-running gates that
cannot be affected (`check-all.py --changed <files>` scopes them).

### Standing skill invocation: sub-agent-orchestration

Load the `sub-agent-orchestration` skill and split the work into parallel
sub-agents ONLY when all four hold:
1. The task divides into 2 or more parts, and no part needs another
   part's output before it can start.
2. No two parts edit the same file.
3. Each part is substantial on its own: an investigation, a deliverable,
   or a verification pass, not a lookup the main agent can finish in a
   few steps.
4. The split can be stated in one line per part before spawning.

Do NOT split when:
- The parts are sequential, or one part exists to fix another's output.
- The work is one coherent change, however large. One context beats
  four fragments.
- Debugging a single failure chain.
- Spawn, report, and merge would cost more than doing it directly.

Free-plan caps: at most 3 sub-agents at once. Sub-agents are read-only
scouts by default; one may write only when every file it touches is
exclusively its own. When the conditions are borderline, run single
and say so in one line instead of asking.

### Line endings: never flip a file's style (D82)

**`Path.write_text()` on Windows silently converts every `\n` to `\r\n`.**
Measured here (Python 3.11, win32): `write_text("a\nb\n")` produces
`b'a\r\nb\r\n'`. If the file is tracked and its HEAD version is LF, git then
reports **every line as changed** — a 41-line append rendered as 795 changed
lines during the 2026-11-21 work, and six files had to be repaired by hand.
`.gitattributes` records the same failure in commit `22ff3d5` (234 added / 234
deleted for a 20-line edit).

**Rule: when a tool rewrites a tracked text file, use
`tools/_ioutil.write_text_like(path, text)`.** It detects the file's dominant
line-ending style and writes bytes directly, so the diff contains only the lines
that actually changed. Never call `write_text()` on a tracked file.

```python
import sys; sys.path.insert(0, str(Path(__file__).resolve().parent))
from _ioutil import write_text_like

write_text_like(path, new_text)              # preserves the file's own style
write_text_like(path, new_text, style="lf")  # force a style (new files)
```

**`tools/check-line-endings.py` is a hard gate** in `check-all.py`: it fails
when a changed text file's dominant style differs from HEAD, and `--fix`
restores HEAD's bytes (byte-perfect when only the endings changed). It was
verified to catch a flip in both directions (LF file → CRLF, CRLF file → LF)
and to repair to a zero-line diff.

The repo is ~89% LF (3,634 of 4,078 tracked text files by the 2026-11-21
census) but 418 files are CRLF and 21 are mixed, because different agents'
editors disagree. **Do not renormalize the tree**: `git add --renormalize .`
would touch 4,534 files. A flip is a defect; a CRLF file is merely a CRLF file.

### Commit attribution: every commit carries a Co-authored-by trailer

Multiple agents commit to this repo, so every commit message ends with a
trailer naming the authoring agent. This is how the user tracks who did what.

Measure it with `python tools/agent-contribution-report.py` (per-agent
commits, areas and churn, from the trailers). Before pushing a batch, run
`python tools/agent-contribution-report.py --check` — it fails if any
unpushed commit names no agent.
Once the repo hooks are installed (`bash scripts/install-git-hooks.sh`), a
`commit-msg` hook enforces the trailer at commit time.

Finding an agent's commits: use `python tools/agent-contribution-report.py
--agent <name>` (window it with `--since`). Do **not** use `git log
--author`: every local agent commits as `ogneocortext`, so author search
finds none of their work, and it misstates Orion's -- 88 commits by author
identity vs 72 by trailer. The tool is the canonical query; it reconciles
both channels (see its docstring for the rule).

| Agent | Trailer |
|---|---|
| Orion (research/handoff agent) | `Co-authored-by: Orion <orion@hatch.local>` |
| Ling 3.1 Flash (local coding agent, Kilo Desktop; by InclusionAI) | `Co-authored-by: Ling 3.1 Flash` |
| Kilo (local coding agent) | `Co-authored-by: Kilo <kilo@native-media-ai.studio>` |
| Cline (local coding agent) | `Co-authored-by: Cline <cline@cline.bot>` |
| MiniMax 3.1 Flash (local coding agent; credited as "Space Bunny Alpha" during its stealth preview) | `Co-authored-by: MiniMax 3.1 Flash` |
| opencode (terminal coding agent; runs deepseek-v4.1-flash-free) | `Co-authored-by: opencode` |
| GPT-6 (Codex desktop agent) | `Co-authored-by: GPT-6` |
| Devin (Cognition desktop agent) | `Co-authored-by: Devin` |

**Trailer emails:** GitHub credits a trailer's *email*, not its name. A
trailer reading `Space Bunny Alpha <noreply@anthropic.com>` is displayed
by GitHub as contributions by **@claude**, and any
`*@users.noreply.github.com` address displays as that account. Both
phantoms on this repo's contributors graph come from trailer emails on
historical commits (@claude: the 13 MiniMax 3.1 Flash commits above; a
Devin bot: 3 more) -- not from those parties' work. Rule: use exactly
the trailer in the table; a new agent gets a name-only trailer, or an
email on a project domain (native-media-ai.studio, hatch.local). Never
a vendor or bot noreply address. The `commit-msg` hook rejects the
account-bound emails, and `tools/agent-contribution-report.py` flags
them in reports and fails `--check` on them. The historical commits
keep their trailers -- published history is not rewritten, so the
phantom display is the accepted cost.

The trailer is a commit-message convention only -- it says nothing about a
model's provenance. Do not rewrite published history to backfill it; it
applies to new commits from 2026-10-06 onward.

### Push policy: auto-push with scoped gates

An agent may push its own commits to origin/main without waiting for
approval when ALL hold:

1. Every commit is scoped to its assigned task, one commit per task item.
2. The pre-push gates pass scoped to the pushed range.
3. The push is a fast-forward — never force-push, never rewrite pushed history.
4. The session report lists the pushed hashes and the gate results as evidence.

Approval is still required before: force pushes, deleting branches, pushing
another agent's commits, changing CI or security configuration, and editing
AGENTS.md or the gate/hook scripts themselves (this prompt is the one
approved exception for the AGENTS.md edit).

If scoped gates fail on files outside your range: do NOT use --no-verify,
do NOT fix another agent's files unless your task says so. Stop and report
the failing checks, the files, and whose work they appear to be. The push
waits for a clean scoped pass.

### Self-healing clause

Every approval gate in AGENTS.md must name the verification that could
replace it. When an automated check demonstrably covers what a manual gate
checked, the gate converts to a reporting requirement: do the work, report
the evidence, no approval wait.

Mechanical updates may self-heal (a gate replaced by an equivalent check,
a version stamp, a renamed path): the discovering agent makes the update in
the same commit as the work and flags it in the session report as a rule
change, quoting old and new text.

Judgment rules never self-update (scope, security, money, what agents may
do unsupervised): propose replacement text in the session report and wait
for Nate's ruling, relayed through Maya.

**Moving or renaming a file:** update every reference to it in the
same commit. `tools/check-path-references.py` (in check-all, decision
D39) finds references to moved files; once the hooks are installed, the
pre-commit move guard blocks a deletion/rename commit that leaves any
behind, naming the referencing files (historical surfaces -- CHANGELOG,
scratch, the decision log -- are exempt). References to files that
never existed are listed, report-only, by `tools/report-path-orphans.py`
in check-all.

### Services: start once, then leave them alone

**Do not restart a service that is already running.** This is the single most
common way an agent wastes time here, so it is stated as protocol rather than
left to judgement.

- Start: `scripts\start-services.ps1` (backend + frontend, dynamic ports to
  `config/ports.json`). Status: `scripts\manage-servers.ps1 -Action status`.
  Interactive: `scripts\start-studio.ps1`. Ports: `scripts\check-ports.ps1`.

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

- Check what is up before starting anything: `scripts\check-ports.ps1`.
- Start only what is actually down. `-Services` accepts one
  name, `all`, or an array.
- **Leave services running when you finish.** The next step usually needs them,
  and a stopped service is a slower "it doesn't work" than a running one.
- Restart only when the process is _wrong_ — wedged, listening on the wrong
  port, or started before a dependency it needs.

`scripts\start-services.ps1` delegates to `manage-servers.ps1`, whose
`-Services` parameter accepts a single name, an array (what
start-services passes), or `all`. Via `-File` a comma list arrives as
one string and fails `ValidateSet` — pass arrays with `-Command`, or
one service per invocation:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\manage-servers.ps1 -Action start -Services all
```

Note `pwsh`, not `powershell` — the agent shell is pwsh 7.6.6 by
default (your interactive shell uses the Microsoft Store 7.7.0);
a session that predates the config change may still be
5.1) and these scripts require 7.6+. ComfyUI and the video editor
are optional; the studio runs without them.

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
- The agent shell defaults to PowerShell 7.6.6 (your interactive shell
  uses the Microsoft Store 7.7.0); a session that predates the config
  change may still be 5.1); the repo's scripts
  need 7.6+. That gap was a recurring source of "the script is
  broken" conclusions that are wrong.
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

- **Requires PowerShell 7.6+ for the project's own scripts.** The
  agent shell is pwsh 7.6.6 by default (your interactive shell uses
  the Microsoft Store 7.7.0); a session that predates the
  config change may still be PowerShell **5.1** — check
  `$PSVersionTable.PSVersion.Major` before concluding the scripts are broken.
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

| Bare name | Resolves to                        | Trap                                                                                                                                                                                                   |
| --------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bash`    | `C:\Windows\System32\bash.exe`     | The **WSL launcher**, not Git Bash. Errors mention unrelated tools. For repo scripts use `C:\Program Files\Git\bin\bash.exe`.                                                                          |
| `python`  | `C:\Python314\python.exe` (3.14.10) | Imports every backend package and passes `ruff`, but **fails pytest** (rc=1): 3.14's temp cleanup cannot remove `pytest-current`, giving `PermissionError [WinError 5]`. `nma-studio-cuda` gives rc=0. |
| `node`    | fnm `aliases\default\node.exe`     | An alias pinned when it was created, not the newest installed. Prefer `pnpm.cmd` from Python with an explicit `cwd`. (Node 26.13 LTS)

**An interpreter having the packages installed is not the same as it working.**
Verify by running the gate, never by inspecting imports - `tools/run-gates.py`
probes candidates with a real `ruff` run and caches the winner. `where python`
also returns `D:\conda-envs\comfyui-cuda\Scripts\python.exe`, which is never
valid for backend work.

A PowerShell 7 profile exists at
`C:\Users\Aomega Imaging\Documents\PowerShell\profile.ps1` (AllHosts) plus
`…\Microsoft.PowerShell_profile.ps1` (CurrentHost), sharing `…\profile-common.ps1`.
**PowerShell 5.1 is retired** — its profiles under `Documents\WindowsPowerShell\`
were deleted, so there is no 5.1 profile to keep in sync. The profile prepends
Ollama, VS Code, npm, Git and Zed to `PATH`, and resolves `fnm` through its alias
directory on non-interactive (agent) shells, running `fnm env --use-on-cd` only
for a real console — which is what keeps shell startup fast. It does **not** run
`conda init`, because conda is not installed (see Python Environments).
Interactive-only work (PSReadLine setup, ~170 KB of OpenClaw tab-completion,
startup warnings) is gated behind `Test-InteractiveShell`, which requires a
console: a tool-launched `pwsh -Command` reports
`[Console]::IsInputRedirected = True` and skips it. It does **not** fix the
`python` trap — `python` resolves to `C:\Python314`.

Unrelated tools on PATH (Android SDK, WSL) are noise from the OS environment —
they are not part of this project and should never be invoked for repo tasks.

### Tailnet exposure is load-bearing (this workstation)

The **Muse agent reaches the frontend and backend over the tailnet** through
`tailscale serve`: `tcp://…:8004 -> localhost:8004` (backend) and
`http://customrig:5173 -> localhost:5173` (frontend). The `Tailscale` service
(LocalSystem, Automatic start, restart-on-failure backoff) must stay up — if it
dies, remote access dies silently. Rules for agents:

- **Never kill `tailscaled.exe`.** The service-port helpers
  (`Get-ServicePortListeners` in `scripts/shared-utils.ps1`) deliberately
  ignore listeners on specific non-loopback addresses for exactly this reason —
  do not "fix" them back to counting every listener.
- Serve config persists in tailscaled state across reboots; verify with
  `tailscale serve status`.
- `scripts/check-env-health.ps1` section 7 reports service state and serve
  entries — run it after any tailscale/network change.

## Local model inventory and management rules (critical)

**The inventory table, size/VRAM budgets and download rules are in
`docs/agents/local-model-inventory.md`.** It is checked against `ollama list` by
`tools/check-doc-facts.py`, so read it rather than trusting a copy here. Trust
tiers - which model may be given which work - are in
`tools/model-reliability/roster.md`.

The rules that matter most, and are repeated here because violating them is
expensive:

- **Never download a model without verifying first.** Run `ollama list`, check
  `config/settings.json`, check `roster.md`, check
  `tools/model-reliability/observed.jsonl` - only then, if absent, download.
  Multiple agents have re-pulled already-installed models, wasting bandwidth.
- **One heavy model at a time** on this 8 GB GTX 1070 Ti. `ollama stop <model>`
  when done. Set `OLLAMA_KEEP_ALIVE=5m`. Watch `nvidia-smi` before loading
  anything over ~2 GB.
- **Embeddings are cheap** (<1 GB) and safe alongside other work; vision
  (`gemma4:e2b-it-qat`, ~4.5 GB) and 8B chat (`llama3.1:8b`, ~5 GB) are not -
  sequential only.

Full inventory, per-model selection criteria and the VRAM budget table:
`docs/agents/local-model-inventory.md`.

## Music Video Pipeline

1. `tools/analyze_and_sync.py` for audio analysis + beat-synced JSON
2. Unity MCP for 3D scenes
3. AutoCapture.cs for frame renders (360 frames = 15s @ 24fps)
4. Blender MCP for high-quality renders
5. Remotion for final composite

## Python Environments

See `docs/setup/python-environments.md` for full details (envs are venvs, not conda; no conda on this machine).

The source of truth for interpreter paths is the repo-root `.python-env` file (KEY=VALUE), read by both `tools/gates/interpreter.py` (gate runner) and `scripts/shared-utils.ps1` (service launcher). The table below maps each task to its `.python-env` key; paths live in `.python-env`, not here, so a path change requires one edit not two.

| Task                        | `.python-env` key   | Kind                |
| --------------------------- | ------------------- | ------------------- |
| Backend / audio / ML / CUDA | `PYTHON_ENV`        | venv, Python 3.11.9 |
| ComfyUI service only        | `COMFYUI_ENV`       | venv, Python 3.11.9 |
| Standalone tooling          | `TOOLS_ENV`         | venv, Python 3.14   |
| Fallback / CPU-only         | `FALLBACK_VENV`     | repo-local venv     |

Rules: default to `PYTHON_ENV` (`nma-studio-cuda`); never use `COMFYUI_ENV` for backend; `TOOLS_ENV` is 3.14 (unsuitable for backend/gates); selection is verified (D33). Music-gen prefers `tools/music-gen/.venv/Scripts/python.exe`, then `MUSIC_GEN_PYTHON`, then backend `sys.executable`.

## Testing

**One command runs every gate:** `python tools/run-gates.py` (or `pnpm verify`).
It runs the doc checks, ruff, tsc, eslint, pytest, vitest and vite build
cheapest-first, prints one summary, and exits non-zero if any gate fails. Two
concurrent lanes execute the gates (`python | node`) — wall time is bounded by
the slower lane, not the sum of every gate (`--serial` reverts to sequential).
Add `--e2e` to include the Playwright suite (opt-in: it starts a Vite dev
server). `--only <name> ...` runs a subset (substring match, so `--only py`
runs both pytest and tools-pytest; a pure-node subset never touches Python and
a pure-python subset never touches pnpm); `--list` lists the gates. Prefer this
over assembling the gates by hand — the runner owns the Windows exit-code and
UTF-8 decoding problems that otherwise produce both false passes and false
failures.

**It resolves its own tools, so nothing is hardcoded to one machine's layout.**
`pnpm` from PATH; the interpreter is chosen by probing candidates
(`$NMA_PYTHON` -> declared project env -> any working `D:\conda-envs\*` -> PATH)
with a real ruff run, and — when a test file using tmp_path exists — a real
smallest-tmp_path-file pytest run, because C:\Python314 passes both ruff and
`pytest --version` yet fails the suite (see Machine-specific PATH traps
above). A hardcoded path would not merely be machine-specific, it would go
stale silently and pin every future agent to whatever was current when it was
written. The winner is cached in `%TEMP%\nma-studio-python-choice.json`
(schema 2, with a timestamp) and re-used **within a TTL** (`$NMA_PROBE_TTL`,
default 15 min; the full probe previously ran on every invocation ahead of
gate 1). Outside the TTL the cached candidate is re-probed like any other. A
probe that *times out* is an "unproven, re-probe serially" retry, never a
rejection: six sibling envs probed in parallel genuinely did time the correct
project env out. Set `NMA_PYTHON` to override; `--which-python` explains a
wrong-interpreter failure; `--list` prints the lanes and the resolved tools.

Every gate has a timeout (pytest 300 s, build 600 s, e2e 900 s) and the child tree
is killed on expiry, so a wedged gate reports a failure instead of hanging.

Individual gates, for iterating on one area: `pnpm test:unit` (frontend unit, vitest), `pnpm test` (Playwright E2E), `pytest` (backend), `pnpm lint`/`pnpm format` (frontend), `ruff check`/`ruff format` (backend), `python tools/check-all.py` (docs/hygiene), `python tools/clean-caches.py --dry-run`. Full detail in `docs/guides/TESTING_WORKFLOWS.md`.

Auto-fix where supported: `python tools/run-gates.py --only ruff lint --fix` runs ruff `--fix` and eslint `--fix` to correct violations in place before reporting. Individual checkers also support `--fix`: `python tools/validate-knowledge-tags.py --fix` (CRLF → LF) and `python tools/check-path-references.py --fix` (replace dangling path refs with suggested new paths).

## Quick Reference

| What            | Where                    |
| --------------- | ------------------------ |
| Frontend source | `packages/frontend/src/` |
| Backend source  | `packages/backend/app/`  |
| Go sidecars     | `tools/go-*`             |
| MCP bridges     | `tools/mcp/`             |
| Unity project   | `unity-project-mcp/`     |
| Visualizer      | `unity-visualizer/`      |
| Port config     | `config/ports.json`      |
| Logs            | `output/logs/`           |
| Outputs         | `output/`                |

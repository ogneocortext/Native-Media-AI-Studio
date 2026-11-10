---
name: vendor-drift
description: >-
  Post-update verification loop for third-party/vendor code in this repo.
  Use after ANY fresh pull or upgrade of ComfyUI custom_nodes, Ollama models,
  Go sidecars, npm/pip dependencies, or Unity/Blender packages — the repo's
  core rule is that vendor updates must not silently break our integrations.
---

# Vendor Drift Verification

Fresh vendor pulls are the highest-risk change source in this repo: upstream
code we don't control lands next to integrations we do. This skill is the
ritual that runs **after** the pull, before calling the update done.

## When to use

- `git pull` inside `ComfyUI/custom_nodes/*`, `tools/go-*`, or any vendored dir
- `ollama pull` / model swaps (also see `ollama-model-ops`)
- `pnpm install` / `pip install` after a lockfile or requirements change
- Blender/Unity package or addon updates
- Any "it worked before the update" bug report

## The loop

### 1. Snapshot BEFORE pulling (when possible)

If the pull hasn't happened yet, capture the baseline first — diffs are the
evidence:

- `ollama list` → save output (or note it for `fetch_advertised.py`)
- `Get-ChildItem ComfyUI/custom_nodes -Directory | Select Name` → baseline
- `git -C <vendor-dir> log --oneline -5` → what upstream commits arrived
- `pnpm-lock.yaml` / `requirements*.txt` diff after install

### 2. Pull, then diff

- New/removed/renamed custom nodes? Renamed Python modules break our
  adapters silently — grep our code for the old import names.
- Lockfile changes in packages we bridge (ComfyUI API, Ollama client,
  FastAPI, Vite)? Check the changelog for breaking changes, not just
  features.

### 3. Run the verification stack (in order, cheapest first)

```powershell
python tools/snapshot-audio-routes.py --check   # if backend/api touched
python tools/check-model-inventory.py           # if models/tools touched
python tools/check-all.py                       # repo hygiene gates
python tools/gates/cli.py --only docs,ruff      # quick gate lane
# then the real lanes if the pull touched runtime code:
python tools/gates/cli.py                       # full gates
```

### 4. Smoke the integrations the pull could break

Pick probes matching what changed — do NOT skip this, gates don't cover
live services:

| Vendor area | Smoke probe |
|---|---|
| ComfyUI custom node | submit one real workflow via `/api/comfyui/*`; check `output/` for the artifact |
| Ollama model | `GET /api/ollama/status`-equivalent + one embed + one chat call |
| Go sidecar | hit its health endpoint; check `tools/go-*/` logs for panics |
| Frontend deps | `pnpm build` + load the visualizer page, watch console |
| Backend deps | `pytest packages/backend/tests -x -q` subset touching changed area |

### 5. Record the outcome

- If a model's behavior changed: append to
  `tools/model-reliability/observed.jsonl` (the tracked handoff layer).
- If the update broke something: fix forward or pin/revert — do NOT leave
  the tree red "to deal with later".
- If all clean: say so explicitly in the commit message or task ledger.

## Anti-patterns

- **Don't trust "it imported fine"** — import success says nothing about
  runtime API shape. Exercise the real call path.
- **Don't batch vendor pulls with feature work** — if something breaks you
  won't know which change did it. Pull vendors on their own commit.
- **Don't skip the smoke probe because gates are green** — gates check repo
  hygiene, not whether ComfyUI still generates.

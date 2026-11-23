# Fresh Clone Gaps — what is NOT in the repo

> What a clean `git clone` does **not** contain, what breaks without it,
and how to restore each piece. Pair with `CONTRIBUTING.md` (hooks) and
> `docs/setup/LINUX_VM.md` (verified clean-clone recipe).

The repo intentionally excludes third-party code, generated media, runtime
data, and local-only assets. Everything below either degrades gracefully or
has a documented restore step — nothing silently breaks.

## 1. Chip emulator cores (must fetch + build for hardware-accurate audio)

`tools/nuked-opl3`, `tools/nuked-opm`, `tools/nuked-opn2`, `tools/residfp`,
`tools/snes-spc`, `tools/sameboy` are **gitignored upstream clones** —
their sources are LGPL/GPL/BSD code we deliberately never commit. Only our
own bindings live in the repo under `tools/chip-bindings/`.

Restore — one command does vendor + bindings + build + verify:

```powershell
python tools/build_chip_cores.py --python <backend-python>
# e.g. --python D:\conda-envs\nma-studio-cuda\python.exe
# add --core nuked-opn2 to build a single core, --force to re-vendor
```

The script fetches any missing upstream via `vendor.py` (which also applies
`tools/chip-bindings/`), runs `setup.py build_ext --inplace` per core, and
verifies the `.pyd`/`.so` was produced. Manual equivalent: `vendor.py --all`,
then `python setup.py build_ext --inplace` inside each `tools/<core>/`.

Cores without a `setup.py` (e.g. `sameboy`, a placeholder adapter) are
skipped. The extensions are platform- and Python-version-specific: build
them with the same interpreter that runs the backend (a C/C++ toolchain is
required).

Without the built `.pyd` extensions the chip adapters report
`is_available() == False` and rendering falls back to the behavioral
synthesizer — chiptune still works, just not cycle-accurate.

## 2. Local AI models (external installs, optional)

Not in the repo and not vendored — install per `docs/setup/MODEL_SETUP.md`
and `docs/agents/local-model-inventory.md`:

- **Ollama** (`:11434`) — vision/chat/embedding models
  (`ollama pull gemma4:e2b-it-qat`, `qwen3-vl:4b-instruct`,
  `nomic-embed-text:v1.5`). Retrieval degrades to BM25-only without it.
- **ComfyUI** (`:8188`) — image/video/3D generation; external install with
  its own model files (see `SETUP_SUMMARY.md` for the model inventory).

## 3. Auto-created at runtime (no action needed)

These are gitignored and recreated by the app on first run:

- `storage/studio.db` (+ `-wal`/`-shm`) — app database, migrations run automatically
- `storage/visualizer_presets/`, `storage/queue/`, `storage/audio/` — runtime state
- `output/` — all generated media lands here
- `docs/scratch/` — agent scratch space

## 4. Intentionally local-only assets

- `assets/character/` — Maya character iteration assets (portraits, expression
  clips, dev tests). Design reference material, not required by the app.
- `packages/frontend/public/models/blends/take_the_crown.blend` — large local
  Blender source kept under the GitHub file-size limit (gitignored).
- `packages/frontend/public/models/blends/*.blend1` — Blender auto-backups.

## 5. What IS in the repo (no restore needed)

- All runtime GLB models incl. `models/character_3d.glb` (~40 MB) and
  `models/characters/hero_dj.glb`, env stages, sketchfab textures
- `voices/` reference clips, `assets/chiptune/*.chip` patterns (when committed)
- `config/ports.json`, `config/settings.json`, `config/tracks.json`
- Go sidecar sources (`tools/go-*`) — build with `go build`
- `tools/chip-bindings/` — our emulator bindings + `ym3438.patch`

## Quick verification after a fresh clone

```powershell
python tools/run-gates.py --only docs type lint unit   # fast gate subset
docker --version 2>$null; go version; node --version; pnpm --version
python packages/backend/app/adapters/chips/vendor.py --list   # see core pins
```

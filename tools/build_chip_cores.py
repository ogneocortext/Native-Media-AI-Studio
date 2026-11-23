#!/usr/bin/env python3
"""Build the vendored chip-emulator Python extensions.

One-step restore for a fresh clone (see docs/setup/FRESH_CLONE.md):

    python tools/build_chip_cores.py                # vendor missing + build all
    python tools/build_chip_cores.py --core nuked-opn2
    python tools/build_chip_cores.py --python D:\\conda-envs\\nma-studio-cuda\\python.exe

Steps per core:
  1. If tools/<core>/ is missing, fetch the pinned upstream via
     app.adapters.chips.vendor (which also applies tools/chip-bindings).
  2. Run `python setup.py build_ext --inplace` inside the vendored tree.
  3. Verify a platform-tagged .pyd/.so was produced.

Cores without a setup.py (e.g. sameboy, a placeholder adapter) are skipped.
The extensions are platform- and Python-version-specific: build them with
the same interpreter that runs the backend.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CHIPS_DIR = REPO_ROOT / "packages" / "backend" / "app" / "adapters" / "chips"

sys.path.insert(0, str(CHIPS_DIR))
from versions import UPSTREAM_VERSIONS, list_cores  # noqa: E402


def vendored_path(core: str) -> Path:
    # local_path values are repo-relative ("tools/<core>")
    return REPO_ROOT / UPSTREAM_VERSIONS[core]["local_path"]


def ensure_vendored(core: str, *, force: bool = False) -> Path | None:
    """Return the vendored dir, cloning it first if absent."""
    local = vendored_path(core)
    if local.is_dir() and any(local.iterdir()):
        return local
    if force and local.exists():
        shutil.rmtree(local)

    sys.path.insert(0, str(CHIPS_DIR))
    import vendor

    print(f"[vendor] {core}: cloning {UPSTREAM_VERSIONS[core]['repo']}")
    if not vendor.vendor_core(core):
        print(f"[FAIL] {core}: vendor failed")
        return None
    return local if local.is_dir() else None


def build_core(core: str, local: Path, python: str) -> bool:
    setup = local / "setup.py"
    if not setup.is_file():
        print(f"[skip] {core}: no setup.py (placeholder core)")
        return True

    print(f"[build] {core}: {python} setup.py build_ext --inplace")
    res = subprocess.run(
        [python, "setup.py", "build_ext", "--inplace"],
        cwd=local, capture_output=False,
    )
    if res.returncode != 0:
        print(f"[FAIL] {core}: build exited {res.returncode}")
        return False

    pyds = [p for p in local.iterdir() if p.suffix in (".pyd", ".so")]
    if not pyds:
        print(f"[FAIL] {core}: build succeeded but no .pyd/.so found")
        return False
    print(f"[ok]   {core}: {', '.join(p.name for p in pyds)}")
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--core", help="build only this core")
    ap.add_argument("--python", default=sys.executable,
                    help="interpreter to build with (default: this python)")
    ap.add_argument("--force", action="store_true",
                    help="re-vendor even if the dir already exists")
    ap.add_argument("--no-vendor", action="store_true",
                    help="only build; fail if a core is not vendored")
    args = ap.parse_args()

    cores = [args.core] if args.core else list_cores()
    if args.core and args.core not in UPSTREAM_VERSIONS:
        print(f"unknown core: {args.core} (known: {', '.join(list_cores())})")
        return 2

    results = {}
    for core in cores:
        if args.no_vendor:
            local = vendored_path(core)
            if not (local.is_dir() and any(local.iterdir())):
                print(f"[FAIL] {core}: not vendored (run without --no-vendor)")
                results[core] = False
                continue
        else:
            local = ensure_vendored(core, force=args.force)
            if local is None:
                results[core] = False
                continue
        results[core] = build_core(core, local, args.python)

    print("\n=== summary ===")
    ok = sum(1 for v in results.values() if v)
    for core, good in results.items():
        print(f"  {'ok  ' if good else 'FAIL'} {core}")
    print(f"  {ok}/{len(results)} cores ready")
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())

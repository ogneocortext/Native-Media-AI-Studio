#!/usr/bin/env python3
"""gen3d-texture — create textures for generated GLB assets (T0/T1 stage).

Implements the texture stage in
docs/knowledge-library/texture-generation-stage-for-ai-generated-3d-assets-2026.md.
Runs packages/backend/app/services/gen3d/texture_glb.py under Blender
headless (same pattern as decimate_glb.py / apply_chrome.py).

Modes:

  glb <file.glb> --role ROLE [--concept IMAGE] [--force] [--out PATH]
                 [--preview PNG]
      T0: bake COLOR_0 vertex colors to a texture when no base-color image
          exists. T1 (role hero/mid only): project --concept image onto the
          mesh from a canonical 3/4 view. Already-textured meshes are left
          alone unless --force. Writes PNG/JPEG source textures only —
      KTX2 compression stays with tools/ingest-texture.py downstream.

Exit codes: 0 on success OR graceful skip (method "none"), nonzero only on
hard failure (Blender missing/crashed, GLB unreadable, export failed).
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "packages" / "backend" / "app" / "services" / "gen3d" / "texture_glb.py"

# Same discovery order as app.core.config AppConfig.discover_blender.
_BLENDER_CANDIDATES = [
    r"C:\Program Files\Blender Foundation\Blender\blender.exe",
    r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe",
    r"C:\Program Files\Blender Foundation\Blender 4.4\blender.exe",
    r"C:\Program Files\Blender Foundation\Blender 4.3\blender.exe",
    r"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe",
    r"C:\Program Files\Blender Foundation\Blender 4.1\blender.exe",
    r"C:\Program Files\Blender Foundation\Blender 4.0\blender.exe",
    r"C:\Program Files\Blender Foundation\Blender 3.6\blender.exe",
]

_RESULT_RE = re.compile(r"TEXTURE_RESULT (\{.*\})")


def _find_blender() -> str | None:
    found = shutil.which("blender")
    if found:
        return found
    for candidate in _BLENDER_CANDIDATES:
        if Path(candidate).exists():
            return candidate
    return None


def _parse_result(stdout: str) -> dict:
    """Pull the TEXTURE_RESULT json line out of Blender's noisy stdout."""
    for line in reversed((stdout or "").splitlines()):
        m = _RESULT_RE.search(line)
        if m:
            try:
                return json.loads(m.group(1))
            except json.JSONDecodeError:
                continue
    return {}


def cmd_glb(args: argparse.Namespace) -> int:
    src = args.file.resolve()
    if not src.is_file():
        sys.exit(f"error: not a file: {src}")
    if not SCRIPT.is_file():
        sys.exit(f"error: blender script not found: {SCRIPT}")
    blender = _find_blender()
    if not blender:
        sys.exit("error: blender executable not found (set PATH or install Blender)")

    out = args.out.resolve() if args.out else src
    if args.concept:
        concept = args.concept.resolve()
        if not concept.is_file():
            sys.exit(f"error: concept image not found: {concept}")
    else:
        concept = None

    argv = [
        blender,
        "--background",
        "--python",
        str(SCRIPT),
        "--",
        str(src),
        str(out),
    ]
    if concept:
        argv.append(str(concept))
    argv += ["--role", args.role]
    if args.force:
        argv.append("--force")
    if args.preview:
        argv += ["--preview", str(args.preview.resolve())]

    print(f"[1/1] blender texture stage: {src.name} (role={args.role})")
    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=args.timeout,
        )
    except subprocess.TimeoutExpired:
        print(f"error: blender texture stage timed out after {args.timeout}s", file=sys.stderr)
        return 1

    result = _parse_result(proc.stdout or "")
    if proc.returncode != 0 and not result:
        tail = ((proc.stderr or "") + (proc.stdout or "")).strip().splitlines()
        print("error: blender texture stage failed", file=sys.stderr)
        for line in tail[-8:]:
            print(f"  {line}", file=sys.stderr)
        return proc.returncode or 1

    method = result.get("method", "unknown")
    textured = result.get("textured", 0)
    skipped = result.get("skipped_textured", 0)
    errs = result.get("errors") or []
    print(
        f"texture_stage: method={method} textured={textured} "
        f"skipped_textured={skipped} objects={result.get('objects')} "
        f"faces={result.get('faces')}"
    )
    if result.get("reason"):
        print(f"  reason: {result['reason']}")
    for e in errs[:5]:
        print(f"  warn: {e}")
    if not result.get("success"):
        print(f"error: {result.get('error', 'unknown')}", file=sys.stderr)
        return 1
    print(f"wrote {out}")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = p.add_subparsers(dest="mode", required=True)

    g = sub.add_parser("glb", help="texture a GLB in place (T0 vertex-color bake / T1 concept projection)")
    g.add_argument("file", type=Path)
    g.add_argument("--role", required=True, choices=["hero", "mid", "background", "far"])
    g.add_argument("--concept", type=Path, help="concept/reference image for T1 projection (png/jpg)")
    g.add_argument("--force", action="store_true", help="re-texture meshes that already have image textures")
    g.add_argument("--out", type=Path, help="output .glb path (default: in place)")
    g.add_argument("--preview", type=Path, help="optional Workbench render PNG for visual verification")
    g.add_argument("--timeout", type=int, default=300, help="blender timeout seconds (default 300)")
    g.set_defaults(func=cmd_glb)

    args = p.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())

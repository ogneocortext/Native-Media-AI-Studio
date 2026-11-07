#!/usr/bin/env python3
"""ingest-texture — bring generated textures under asset-budget caps.

Implements the ingest workflow in
docs/knowledge-library/texture-pipeline-ktx2-authoring-and-ingest-2026.md
(spec'd under T-VID-12).

Modes:

  glb <file.glb> --role ROLE [--codec etc1s|uastc] [--out PATH]
      Resize textures to the role cap (aspect-preserving, downscale-only)
      via @gltf-transform/cli, Basis-compress to KTX2, then validate with
      tools/check-asset-budget.py.

  map <input.(png|jpg|jpeg|webp)> --name NAME --role ROLE
      --map {color,normal,roughness} [--codec etc1s|uastc]
      [--out-dir assets/materials]
      Downscale with Pillow to the role cap, encode KTX2 with the vendored
      KTX-Software toktx, writing <name>_{c,n,r}.ktx2.

Requires: Pillow (backend env), pnpm (for gltf-transform), and the
vendored KTX-Software binaries in tools/vendor/ktx-software-bin/
(ktx.exe must be on PATH for gltf-transform's encoder subprocess).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUDGETS_PATH = ROOT / "config" / "asset-budgets.json"
KTX_BIN = ROOT / "tools" / "vendor" / "ktx-software-bin"
TOKTX = KTX_BIN / "toktx.exe"
CHECK_BUDGET = ROOT / "tools" / "check-asset-budget.py"
GLTF_CLI = ["@gltf-transform/cli@4.5.1"]
DEFAULT_OUT_DIR = ROOT / "assets" / "materials"

MAP_SUFFIX = {"color": "c", "normal": "n", "roughness": "r"}
OETF = {"color": "srgb", "normal": "linear", "roughness": "linear"}


def _run(cmd: list[str], env: dict | None = None, cwd: Path | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        cwd=str(cwd) if cwd else None,
    )


def _pnpm() -> str:
    exe = shutil.which("pnpm") or shutil.which("pnpm.cmd")
    if not exe:
        sys.exit("error: pnpm not found on PATH (needed for @gltf-transform/cli)")
    return exe


def _gltf_env() -> dict:
    env = dict(os.environ)
    env["PATH"] = str(KTX_BIN) + os.pathsep + env.get("PATH", "")
    return env


def _role_px(role: str) -> int:
    budgets = json.loads(BUDGETS_PATH.read_text(encoding="utf-8"))
    try:
        return int(budgets["roles"][role]["max_texture_px"])
    except KeyError:
        sys.exit(
            f"error: unknown role {role!r} — valid: "
            + ", ".join(budgets.get("roles", {}))
        )


def _gltf_transform(args: list[str]) -> None:
    cmd = [_pnpm(), "dlx", *GLTF_CLI, *args]
    proc = _run(cmd, env=_gltf_env(), cwd=ROOT)
    tail = (proc.stdout or "") + (proc.stderr or "")
    last = tail.strip().splitlines()[-1] if tail.strip() else ""
    print(last.encode("ascii", "replace").decode("ascii"), end="")
    if proc.returncode != 0:
        sys.exit(f"error: gltf-transform {' '.join(args[:1])} failed ({proc.returncode})")


def cmd_glb(args: argparse.Namespace) -> int:
    src = args.file.resolve()
    if not src.is_file():
        sys.exit(f"error: not a file: {src}")
    px = _role_px(args.role)
    codec = args.codec
    out = args.out.resolve() if args.out else src.with_name(f"{src.stem}-{codec}.glb")

    work = src.with_name(f"{src.stem}.ingest-tmp.glb")
    try:
        # 1. Downscale-only resize to the role cap (max dims, aspect kept).
        print(f"[1/3] resize textures to <={px}px ...")
        _gltf_transform(["resize", str(src), str(work), "--width", str(px), "--height", str(px)])

        # 2. Basis-compress to KTX2.
        print(f"[2/3] {codec} -> KTX2 ...")
        _gltf_transform([codec, str(work), str(out)])
    finally:
        work.unlink(missing_ok=True)

    # 3. Validate against the role budget.
    print(f"[3/3] budget check ({args.role}) ...")
    proc = _run(
        [sys.executable, str(CHECK_BUDGET), str(out), "--role", args.role],
        cwd=ROOT,
    )
    out_text = (proc.stdout or "").strip()
    print(out_text.encode("ascii", "replace").decode("ascii"))
    if proc.stderr.strip():
        print(proc.stderr.strip().encode("ascii", "replace").decode("ascii"), file=sys.stderr)
    print(f"\nwrote {out}")
    return proc.returncode


def cmd_map(args: argparse.Namespace) -> int:
    if not TOKTX.is_file():
        sys.exit(f"error: toktx not found at {TOKTX}")
    src = args.file.resolve()
    if not src.is_file():
        sys.exit(f"error: not a file: {src}")
    try:
        from PIL import Image
    except ImportError:
        sys.exit("error: Pillow required (run via tools/python.cmd)")

    px = _role_px(args.role)
    out_dir = args.out_dir.resolve() if args.out_dir else DEFAULT_OUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{args.name}_{MAP_SUFFIX[args.map]}.ktx2"

    img = Image.open(src)
    if img.mode not in ("RGB", "RGBA", "L"):
        img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
    w, h = img.size
    scale = min(1.0, px / max(w, h))
    if scale < 1.0:
        img = img.resize(
            (max(1, round(w * scale)), max(1, round(h * scale))),
            Image.LANCZOS,
        )
        print(f"downscaled {w}x{h} -> {img.size[0]}x{img.size[1]} (role {args.role} cap {px}px)")

    tmp = src.with_suffix(".ingest-tmp.png")
    try:
        img.save(tmp)
        cmd = [
            str(TOKTX), "--t2", "--encode", args.codec,
            "--assign_oetf", OETF[args.map],
            "--genmipmap",
        ]
        if args.codec == "uastc":
            # UASTC texels are already encoded; --zcmp losslessly packs the
            # container (without it the file stores UASTC uncompressed).
            cmd += ["--zcmp", "18"]
        cmd += [str(out), str(tmp)]
        proc = _run(cmd)
        if proc.returncode != 0:
            sys.stderr.write((proc.stderr or proc.stdout or "").strip() + "\n")
            sys.exit(f"error: toktx failed ({proc.returncode})")
    finally:
        tmp.unlink(missing_ok=True)

    print(f"wrote {out}  ({args.map} map, {args.codec}, {OETF[args.map]})")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="mode", required=True)

    g = sub.add_parser("glb", help="resize + KTX2-compress a GLB's embedded textures")
    g.add_argument("file", type=Path)
    g.add_argument("--role", required=True, choices=["hero", "mid", "background", "far"])
    g.add_argument("--codec", choices=["etc1s", "uastc"], default="etc1s",
                   help="etc1s = smaller/lossy-ish; uastc = higher quality (default etc1s)")
    g.add_argument("--out", type=Path, help="output .glb path (default <stem>-<codec>.glb beside input)")
    g.set_defaults(func=cmd_glb)

    m = sub.add_parser("map", help="downscale + KTX2-encode a loose texture map")
    m.add_argument("file", type=Path)
    m.add_argument("--name", required=True, help="material base name -> <name>_<suffix>.ktx2")
    m.add_argument("--role", required=True, choices=["hero", "mid", "background", "far"])
    m.add_argument("--map", required=True, choices=["color", "normal", "roughness"])
    m.add_argument("--codec", choices=["etc1s", "uastc"], default="uastc",
                   help="uastc default for loose maps (quality); etc1s for smaller files")
    m.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    m.set_defaults(func=cmd_map)

    args = p.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())

"""Triangle-budget preview: render a GLB at several decimation levels and
assemble a labeled contact sheet so the cosmetic floor is visible.

    python tools/preview-tri-budget.py <asset.glb> [--counts 250000,50000,10000] [--outdir DIR]

Default ladder brackets the asset-budget role caps (hero 250K, mid 50K,
background 10K) plus intermediates, always including the undecimated
original. Renders via Blender (tools/blender/tri_ladder.py), then builds
<stem>-tri-ladder.png with PIL.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BLENDER = Path(r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe")
LADDER_SCRIPT = REPO_ROOT / "tools" / "blender" / "tri_ladder.py"
BUDGETS_JSON = REPO_ROOT / "config" / "asset-budgets.json"
DEFAULT_OUT = REPO_ROOT / "output" / "tests" / "tri-ladder"


def _default_counts() -> list[int]:
    budgets = json.loads(BUDGETS_JSON.read_text(encoding="utf-8"))
    caps = sorted({v["max_triangles"] for v in budgets["roles"].values() if v.get("max_triangles")})
    # Bracket each role cap with one intermediate step for smoother judgment.
    ladder = {c for cap in caps for c in (cap, cap // 2)}
    return sorted(ladder, reverse=True)


def _face_count(glb: Path) -> int:
    """Cheap triangle count via the budget checker (no Blender needed)."""
    proc = subprocess.run(
        [sys.executable, str(REPO_ROOT / "tools" / "check-asset-budget.py"), str(glb), "--json"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120,
    )
    try:
        return int(json.loads(proc.stdout)["triangles"])
    except (json.JSONDecodeError, KeyError, ValueError):
        return 0


def _contact_sheet(pngs: list[Path], labels: list[str], out: Path) -> None:
    from PIL import Image, ImageDraw

    cols = 3
    cell = 320
    label_h = 34
    rows = (len(pngs) + cols - 1) // cols
    if not pngs:
        print("error: no renders found to assemble", file=sys.stderr)
        return 1
    sheet = Image.new("RGB", (cols * cell, rows * (cell + label_h)), (24, 24, 28))
    draw = ImageDraw.Draw(sheet)
    for i, (png, label) in enumerate(zip(pngs, labels, strict=True)):
        r, c = divmod(i, cols)
        x, y = c * cell, r * (cell + label_h)
        try:
            img = Image.open(png).convert("RGB").resize((cell, cell), Image.Resampling.LANCZOS)
            sheet.paste(img, (x, y + label_h))
        except OSError as e:
            draw.text((x + 8, y + label_h + 8), f"render failed: {e}", fill=(255, 120, 120))
        draw.text((x + 8, y + 8), label, fill=(235, 235, 240))
    sheet.save(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("asset", type=Path, help=".glb to ladder")
    ap.add_argument("--counts", help="comma-separated targets; 'orig' allowed (default: role-cap ladder)")
    ap.add_argument("--outdir", type=Path, default=None)
    args = ap.parse_args()

    src = args.asset.resolve()
    if not src.exists():
        print(f"error: {src} not found", file=sys.stderr)
        return 1
    if not BLENDER.exists():
        print(f"error: blender not found at {BLENDER}", file=sys.stderr)
        return 1

    if args.counts:
        counts = []
        for raw in args.counts.split(","):
            token = raw.strip()
            if not token:
                continue
            if token.lower() == "orig":
                counts.append("orig")
                continue
            try:
                n = int(token.replace(",", ""))
            except ValueError:
                print(f"error: bad --counts entry {raw!r} (want 'orig' or an integer)", file=sys.stderr)
                return 1
            if n <= 0:
                print(f"error: --counts entries must be positive, got {n}", file=sys.stderr)
                return 1
            counts.append(str(n))
        # Dedupe, keep order.
        counts = list(dict.fromkeys(counts))
        if not counts:
            print("error: --counts produced no levels", file=sys.stderr)
            return 1
    else:
        orig_tris = _face_count(src)
        ladder = [c for c in _default_counts() if not orig_tris or c < orig_tris]
        counts = ["orig"] + [str(c) for c in ladder]

    out_dir = (args.outdir or DEFAULT_OUT / src.stem).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"[ladder] {src.name}: levels={counts}")

    try:
        proc = subprocess.run(
            [BLENDER, "--background", "--python", str(LADDER_SCRIPT), "--", str(src), str(out_dir), ",".join(counts)],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=3600,
        )
    except subprocess.TimeoutExpired:
        print("[ladder] blender timed out; assembling sheet from partial renders", file=sys.stderr)
        proc = None

    stdout = (proc.stdout if proc else "") or ""
    print("\n".join(stdout.splitlines()[-15:]))
    if proc is not None and proc.returncode != 0:
        print((proc.stderr or "")[-800:], file=sys.stderr)
        return proc.returncode

    # Blender reports the ACHIEVED face count per level; the sheet labels
    # must show reality, not the request.
    achieved: dict[str, tuple[int, int]] = {}
    for m in re.finditer(r"\[ladder\] (\S+): ([\d,]+) -> ([\d,]+) tris", stdout):
        achieved[m.group(1)] = (int(m.group(2).replace(",", "")), int(m.group(3).replace(",", "")))

    orig_tris = achieved.get("orig", (0, 0))[1] or _face_count(src)

    # Build contact sheet in render order.
    pngs, labels = [], []
    for c in counts:
        name = "orig" if c == "orig" else str(int(c))
        png = out_dir / f"lod_{name}.png"
        if not png.exists():
            continue
        entry = achieved.get(c if c == "orig" else name)
        approx = ""
        if entry:
            _, final = entry
        elif c == "orig":
            final = orig_tris
        else:
            final = int(name)  # render exists but report line missing — request is the estimate
            approx = "~"
        if c == "orig":
            label = f"original - {final:,} tris"
        elif orig_tris:
            pct = final / orig_tris * 100
            label = f"{approx}{final:,} tris ({pct:.0f}% of orig)"
        else:
            label = f"{approx}{final:,} tris"
        pngs.append(png)
        labels.append(label)

    sheet = out_dir / f"{src.stem}-tri-ladder.png"
    _contact_sheet(pngs, labels, sheet)
    print(f"[ladder] contact sheet: {sheet}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

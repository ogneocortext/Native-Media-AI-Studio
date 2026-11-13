"""Composite a dev-inpainted face onto the Maya reference still.

Purpose
-------
FLUX.1 dev masked inpainting (``flux-dev-gguf-dualclip-inpaint`` workflow)
repaints a real, expression-carrying face inside the mask, but leaves a
visible seam where the repainted region meets the reference. This tool
solves that in compositing, not generation: it blends the generated face
into the reference with a deterministic radial cross-fade on the CPU.
Pixels outside the mask stay bit-identical to the reference by
construction.

Parameters (CLI)
----------------
--reference   Path to the reference still (e.g. ComfyUI/input/maya-ref-head-768.png)
--face        Path to the inpainted output whose face region is composited
              (e.g. the E1 dev-inpaint PNG)
--output      Output PNG path
--box X1,Y1,X2,Y2   Ellipse bounds in pixels (default: 238,245,532,620 — the
              v2 generation-mask ellipse on the 768 head crop)
--band N      Cross-fade band width in px, measured inward from the ellipse
              edge (default: 28)

Guarantees (invariants)
-----------------------
* alpha = 0 outside the ellipse  -> output pixels are bit-identical to
  --reference there.
* alpha = 1 in the interior (distance >= band inside the ellipse edge) ->
  output pixels are bit-identical to --face there.
* Only the band zone blends: comp = ref + (face - ref) * (dist / band),
  computed in float64 and rounded once to uint8, so the alpha 0/1 zones
  are exact by construction.

Proven default
--------------
band = 28 px (F1). band = 48 px (F2) produced a wider, stranger-looking
tonal band in the 2026-11-12 v5 test without improving the seam.

Tooling: numpy + scipy.ndimage.distance_transform_edt + Pillow, CPU only.
No GPU, no generation — this tool composites; it does not generate.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

DEFAULT_BOX = (238, 245, 532, 620)  # v2 ellipse bounds (x1,y1,x2,y2)
DEFAULT_BAND = 28


def parse_box(text: str) -> tuple[int, int, int, int]:
    parts = [int(p) for p in text.split(",")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError(
            "--box must be 'x1,y1,x2,y2' (4 comma-separated ints)")
    return tuple(parts)  # type: ignore[return-value]


def composite(reference: np.ndarray, face: np.ndarray,
              box: tuple[int, int, int, int], band: int) -> np.ndarray:
    """Return composited uint8 image; see module docstring for invariants."""
    h, w = reference.shape[:2]
    em = Image.new("L", (w, h), 0)
    ImageDraw.Draw(em).ellipse(box, fill=255)
    ellipse = np.asarray(em) > 0

    # distance (px) from each inside pixel to the ellipse edge
    dist = ndimage.distance_transform_edt(ellipse)
    alpha = np.clip(dist / band, 0.0, 1.0)[..., None]  # 0 edge -> 1 inside
    alpha[~ellipse] = 0.0
    comp = reference.astype(np.float64) + (
        face.astype(np.float64) - reference.astype(np.float64)) * alpha
    return np.rint(comp).astype(np.uint8)


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Composite an inpainted face onto a reference still with a "
                    "radial cross-fade (bit-exact outside the ellipse).")
    ap.add_argument("--reference", required=True, type=Path,
                    help="reference still PNG")
    ap.add_argument("--face", required=True, type=Path,
                    help="inpainted output PNG whose face region is composited")
    ap.add_argument("--output", required=True, type=Path,
                    help="output PNG path")
    ap.add_argument("--box", type=parse_box, default=DEFAULT_BOX,
                    metavar="X1,Y1,X2,Y2",
                    help="ellipse bounds in px (default: %(default)s)")
    ap.add_argument("--band", type=int, default=DEFAULT_BAND,
                    help="cross-fade band width in px (default: %(default)s; "
                         "28 proven over 48)")
    args = ap.parse_args()

    ref_img = Image.open(args.reference).convert("RGB")
    face_img = Image.open(args.face).convert("RGB")
    if ref_img.size != face_img.size:
        print(f"error: size mismatch reference={ref_img.size} "
              f"face={face_img.size}", file=sys.stderr)
        return 1

    ref = np.asarray(ref_img, dtype=np.uint8)
    face = np.asarray(face_img, dtype=np.uint8)

    out = composite(ref, face, args.box, args.band)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out).save(args.output)

    # report the two invariants as max abs channel diffs
    h, w = ref.shape[:2]
    em = Image.new("L", (w, h), 0)
    ImageDraw.Draw(em).ellipse(args.box, fill=255)
    ellipse = np.asarray(em) > 0
    dist = ndimage.distance_transform_edt(ellipse)
    interior = ellipse & (dist >= args.band)
    outside = ~ellipse

    d_out = np.abs(out.astype(np.int16) - ref.astype(np.int16)
                   ).max(axis=2)[outside]
    d_in = np.abs(out.astype(np.int16) - face.astype(np.int16)
                  ).max(axis=2)[interior]
    print(f"wrote {args.output}")
    print(f"outside-ellipse max|diff| vs reference: {int(d_out.max())} "
          f"(mean {d_out.mean():.4f})")
    print(f"interior max|diff| vs face:           {int(d_in.max())}")
    partial = ellipse & (dist < args.band) & (dist > 0)
    print(f"band-zone px: {int(partial.sum())} | interior px: "
          f"{int(interior.sum())}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

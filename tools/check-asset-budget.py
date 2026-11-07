#!/usr/bin/env python3
"""check-asset-budget.py — per-asset budget report against config/asset-budgets.json.

Reads a .glb (binary glTF) or .gltf (+ sibling .bin when present) and reports
triangles, texture memory/dimensions, materials, skins, and LOD/KTX2 presence
against the role caps from the Pascal budget doc (T-VID-12, ungated slice:
config + report only — gen3d ingest wiring is owner-gated).

Usage:
    python tools/check-asset-budget.py <asset.glb|asset.gltf> [--role hero|mid|background|far]
        [--config config/asset-budgets.json] [--json] [--strict]

Exit codes: 0 = no hard-cap violation, 1 = hard-cap violation (or bad input),
2 = usage error. Pipeline requirements (KTX2, LOD) report as WARN, not FAIL,
until the gated ingest post-step exists; --strict promotes WARN to failure.
"""

import argparse
import json
import struct
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = REPO_ROOT / "config" / "asset-budgets.json"


def load_gltf(path: Path) -> tuple[dict, bytes | None]:
    """Return (gltf dict, bin chunk bytes or None for external .bin)."""
    if path.suffix.lower() == ".glb":
        data = path.read_bytes()
        if len(data) < 20 or data[:4] != b"glTF":
            raise ValueError("not a GLB file (bad magic)")
        off = 12
        gltf, bin_chunk = None, None
        while off + 8 <= len(data):
            clen, ctype = struct.unpack_from("<I4s", data, off)
            off += 8
            chunk = data[off:off + clen]
            off += clen
            if ctype == b"JSON":
                gltf = json.loads(chunk.decode("utf-8"))
            elif ctype == b"BIN\x00":
                bin_chunk = chunk
        if gltf is None:
            raise ValueError("GLB has no JSON chunk")
        return gltf, bin_chunk
    if path.suffix.lower() == ".gltf":
        gltf = json.loads(path.read_text(encoding="utf-8"))
        return gltf, None
    raise ValueError(f"unsupported extension {path.suffix!r} — expected .glb or .gltf")


def external_bin(path: Path, gltf: dict) -> bytes | None:
    """Resolve the first buffer's external .bin for .gltf inputs."""
    buffers = gltf.get("buffers", [])
    if not buffers:
        return None
    uri = buffers[0].get("uri", "")
    if uri.startswith("data:"):
        import base64
        return base64.b64decode(uri.split(",", 1)[1])
    bin_path = (path.parent / uri).resolve()
    return bin_path.read_bytes() if bin_path.is_file() else None


def accessor_count(gltf: dict, idx: int | None) -> int:
    if idx is None:
        return 0
    return int(gltf.get("accessors", [])[idx].get("count", 0))


def count_triangles(gltf: dict) -> int:
    tris = 0
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            if "indices" in prim:
                tris += accessor_count(gltf, prim["indices"]) // 3
            else:
                pos = prim.get("attributes", {}).get("POSITION")
                tris += accessor_count(gltf, pos) // 3
    return tris


def image_bytes(gltf: dict, img: dict, bin_chunk: bytes | None) -> int | None:
    bv_idx = img.get("bufferView")
    if bv_idx is not None:
        bvs = gltf.get("bufferViews", [])
        if 0 <= bv_idx < len(bvs):
            return int(bvs[bv_idx].get("byteLength", 0))
    uri = img.get("uri", "")
    if uri and not uri.startswith("data:"):
        # External file — size unknown without resolving; caller notes it.
        return None
    return 0


def png_size(data: bytes, offset: int) -> tuple[int, int] | None:
    if data[offset:offset + 8] == b"\x89PNG\r\n\x1a\n" and len(data) >= offset + 24:
        w, h = struct.unpack_from(">II", data, offset + 16)
        return w, h
    return None


def ktx2_size(data: bytes, offset: int) -> tuple[int, int] | None:
    # KTX2 identifier + header: pixelWidth @12, pixelHeight @16 (little-endian u32)
    if data[offset:offset + 12] == b"\xabKTX 20\xbb\r\n\x1a\n" and len(data) >= offset + 20:
        w, h = struct.unpack_from("<II", data, offset + 12)
        return w, h
    return None


def texture_report(gltf: dict, bin_chunk: bytes | None, path: Path) -> dict:
    images = gltf.get("images", [])
    bvs = gltf.get("bufferViews", [])
    total_bytes = 0
    unknown_bytes = 0
    max_dim = 0
    ktx2 = 0
    dims_known = True

    for img in images:
        size = image_bytes(gltf, img, bin_chunk)
        if size is None:
            unknown_bytes += 1
            continue
        total_bytes += size
        mime = img.get("mimeType", "")
        if mime == "image/ktx2":
            ktx2 += 1
        # Dimension sniff: bufferView → byteOffset into BIN chunk.
        bv_idx = img.get("bufferView")
        if bv_idx is not None and bin_chunk is not None and 0 <= bv_idx < len(bvs):
            bv = bvs[bv_idx]
            off = int(bv.get("byteOffset", 0))
            dim = ktx2_size(bin_chunk, off) or png_size(bin_chunk, off)
            if dim:
                max_dim = max(max_dim, dim[0], dim[1])
            elif mime in ("image/png", "image/ktx2"):
                dims_known = False
        elif img.get("uri", "").startswith("data:"):
            dims_known = False

    return {
        "image_count": len(images),
        "embedded_bytes": total_bytes,
        "embedded_mb": round(total_bytes / (1024 * 1024), 2),
        "max_texture_px": max_dim if dims_known or max_dim else None,
        "dims_fully_known": dims_known,
        "ktx2_count": ktx2,
        "external_or_unknown": unknown_bytes,
    }


def lod_names(gltf: dict) -> list[str]:
    names = []
    for node in gltf.get("nodes", []):
        n = node.get("name", "")
        if "lod" in n.lower():
            names.append(n)
    return names


def skin_report(gltf: dict) -> dict:
    skins = gltf.get("skins", [])
    joints = [len(s.get("joints", [])) for s in skins]
    return {
        "skin_count": len(skins),
        "max_bones_per_skin": max(joints) if joints else 0,
    }


def evaluate(report: dict, caps: dict, scene_caps: dict) -> tuple[list[str], list[str], bool]:
    """Return (failures, warnings, hard_fail)."""
    fails, warns = [], []
    if report["triangles"] > caps["max_triangles"]:
        fails.append(
            f"triangles {report['triangles']:,} > role cap {caps['max_triangles']:,}"
        )
    if caps.get("sprite_card") and report["triangles"] > 0:
        fails.append("far role must be an impostor card, not a mesh")
    tpx = report["textures"]["max_texture_px"]
    if tpx is not None and tpx > caps["max_texture_px"]:
        fails.append(f"texture {tpx}px > role cap {caps['max_texture_px']}px")
    tex = report["textures"]
    if caps.get("ktx2_required") and tex["image_count"] and tex["ktx2_count"] < tex["image_count"]:
        warns.append(
            f"KTX2: {tex['ktx2_count']}/{tex['image_count']} textures converted "
            "(ingest post-step is T-VID-12 gated)"
        )
    if caps.get("lod_required") and not report["lod_nodes"]:
        warns.append("no LOD nodes found (LOD chain is T-VID-12 gated ingest work)")
    sk = report.get("skins", {})
    bone_cap = scene_caps.get("bones_per_skinned_mesh", 64)
    if sk.get("max_bones_per_skin", 0) > bone_cap:
        fails.append(f"bones/skin {sk['max_bones_per_skin']} > scene cap {bone_cap}")
    return fails, warns, bool(fails)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("asset", type=Path, help=".glb or .gltf file to inspect")
    ap.add_argument("--role", default="mid", choices=["hero", "mid", "background", "far"],
                    help="asset role for cap lookup (default: mid)")
    ap.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--strict", action="store_true", help="treat WARN (KTX2/LOD) as failure")
    args = ap.parse_args()

    if not args.asset.is_file():
        print(f"error: {args.asset} not found", file=sys.stderr)
        return 2
    try:
        budgets = json.loads(args.config.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"error: cannot load budget config {args.config}: {e}", file=sys.stderr)
        return 2
    role_caps = budgets["roles"][args.role]

    try:
        gltf, bin_chunk = load_gltf(args.asset)
        if bin_chunk is None and args.asset.suffix.lower() == ".gltf":
            bin_chunk = external_bin(args.asset, gltf)
    except (ValueError, OSError, json.JSONDecodeError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    report = {
        "asset": str(args.asset),
        "role": args.role,
        "triangles": count_triangles(gltf),
        "materials": len(gltf.get("materials", [])),
        "meshes": len(gltf.get("meshes", [])),
        "textures": texture_report(gltf, bin_chunk, args.asset),
        "lod_nodes": lod_names(gltf),
        "skins": skin_report(gltf),
    }
    fails, warns, hard_fail = evaluate(report, role_caps, budgets.get("scene_caps", {}))
    report["caps"] = role_caps
    report["failures"] = fails
    report["warnings"] = warns
    report["verdict"] = "FAIL" if hard_fail or (args.strict and warns) else ("WARN" if warns else "PASS")

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        t = report["textures"]
        print(f"asset-budget report — {args.asset.name}  (role: {args.role})")
        print(f"  triangles      {report['triangles']:,}  (cap {role_caps['max_triangles']:,})")
        print(f"  materials      {report['materials']}  meshes {report['meshes']}")
        print(f"  textures       {t['image_count']} images, {t['embedded_mb']} MB embedded"
              + (f", max {t['max_texture_px']}px" if t["max_texture_px"] else "")
              + (f", KTX2 {t['ktx2_count']}/{t['image_count']}" if t["image_count"] else ""))
        print(f"  skins          {report['skins']['skin_count']}, max bones/skin {report['skins']['max_bones_per_skin']}")
        print(f"  LOD nodes      {len(report['lod_nodes'])} ({', '.join(report['lod_nodes'][:4]) or 'none'})")
        for w in warns:
            print(f"  WARN  {w}")
        for f_ in fails:
            print(f"  FAIL  {f_}")
        print(f"  verdict        {report['verdict']}")
    return 1 if hard_fail or (args.strict and warns) else 0


if __name__ == "__main__":
    sys.exit(main())

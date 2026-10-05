#!/usr/bin/env python
"""Report duplicated *logic*: functions that are the same or near-identical.

Distinct from `check-repo-layout.py`, which finds identical *files*, and from
`check-duplicate-routes.py`, which finds identical *routes*. This one compares the
bodies of individual functions.

Two tiers, because they carry very different confidence:

- **exact** - the normalised bodies are byte-identical after comments, docstrings and
  whitespace are removed. High confidence, low risk.
- **near** - token streams above `--threshold`. Low confidence by nature: similar code
  in two modules is often correct (two endpoints that happen to need the same three
  lines, two audio paths that legitimately differ at the end). This tool ranks
  candidates; it does not decide they are wrong.

Normalisation drops comments and docstrings and collapses whitespace. It keeps string
literals, because in this repo's HTTP and UI code a string is usually the behaviour:
an earlier version blanked them and reported three sidecar clients' `health()` as an
exact duplicate when they call different paths. It does NOT rename identifiers: two functions that differ
only in variable names are still worth showing, but claiming they are duplicates would
overreach.

Usage:
    python tools/find-duplicate-logic.py [--threshold 0.85] [--min-lines 4] [--json]
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SKIP_DIRS = {
    "node_modules", ".git", "dist", "build", "out", ".pytest_tmp", "__pycache__",
    "coverage", ".venv", "venv", "Library", "Temp", "obj", ".playwright-mcp",
}
SOURCE_SUFFIXES = {".py", ".ts", ".tsx", ".mjs", ".js"}


def _py_functions(path: Path) -> list[tuple[str, str, int]]:
    """(qualified name, normalised body, start line) for each top-level/nested function."""
    try:
        source = path.read_text(encoding="utf-8", errors="replace")
        tree = ast.parse(source)
    except (SyntaxError, ValueError, OSError):
        return []
    out = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        body = node.body
        # Drop a leading docstring: prose differs between copies but the code does not.
        if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) \
                and isinstance(body[0].value.value, str):
            body = body[1:]
        if not body:
            continue
        try:
            rendered = ast.unparse(ast.Module(body=body, type_ignores=[]))
        except Exception:
            continue
        out.append((node.name, _normalise_py(rendered), node.lineno))
    return out


def _normalise_py(code: str) -> str:
    """Strip comments/docstrings; KEEP string literals.

    An earlier version blanked string literals, and that produced a false positive
    worth recording: three Go sidecar clients reported an "exact duplicate"
    ``health()`` when they actually call different paths (``/health`` vs
    ``/api/health``). In HTTP clients, config keys and URLs *are* the behaviour, so
    normalising them away makes the tool confidently wrong.
    """
    code = re.sub(r"#.*", "", code)
    return re.sub(r"\s+", " ", code).strip()


_JS_FN = re.compile(
    r"^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(",
    re.M,
)
_JS_ARROW = re.compile(
    r"^\s*(?:export\s+)?const\s+(\w+)\s*(?:=\s*)?(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>",
    re.M,
)


def _js_functions(path: Path) -> list[tuple[str, str, int]]:
    try:
        source = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    out = []
    for pattern in (_JS_FN, _JS_ARROW):
        for match in pattern.finditer(source):
            name = match.group(1)
            start = match.end()
            # Balance braces from the function body.
            i = source.find("{", start)
            if i == -1:
                continue
            depth, j = 0, i
            while j < len(source):
                if source[j] == "{":
                    depth += 1
                elif source[j] == "}":
                    depth -= 1
                    if depth == 0:
                        break
                j += 1
            body = source[i:j + 1]
            line = source[:match.start()].count("\n") + 1
            out.append((name, _normalise_js(body), line))
    return out


def _normalise_js(code: str) -> str:
    """Strip comments; KEEP string literals - see `_normalise_py`."""
    code = re.sub(r"//.*", "", code)
    code = re.sub(r"/\*.*?\*/", "", code, flags=re.S)
    return re.sub(r"\s+", " ", code).strip()


def _strip_python_comments_and_strings(path: Path) -> None:
    """No-op hook kept so the normalisation story stays in one place."""
    return None


def _tracked_files() -> list[Path]:
    """Only files git tracks.

    Walking the filesystem instead also picks up agent worktrees
    (`.kilo/worktrees/*`), which are whole-tree copies of the repo and gitignored.
    They dominated the first run: one "58 copies" group that was really a single
    repo counted over and over.
    """
    import subprocess

    try:
        out = subprocess.run(
            ["git", "ls-files", "-z"], cwd=REPO, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    return [REPO / n for n in out.stdout.split("\0") if n]


def collect() -> list[dict]:
    found: list[dict] = []
    for path in _tracked_files():
        if path.suffix not in SOURCE_SUFFIXES or not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        rel = path.relative_to(REPO).as_posix()
        if rel.startswith("docs/") or "/tests/" in rel or rel.endswith(".test.ts"):
            # Tests are allowed to restate production logic verbatim; that is the point.
            continue
        fns = _py_functions(path) if path.suffix == ".py" else _js_functions(path)
        for name, body, line in fns:
            # A bare `return fetch(...)` is not duplicated *logic*; it is a thin
            # wrapper, and uniformity across API client modules is the point.
            if body and re.search(r"\b(if|for|while|try|switch|case)\b|&&|\|\|", body):
                found.append({
                    "file": rel, "name": name, "line": line,
                    "body": body, "lines": body.count(";") + body.count("\n") + 1,
                    "loc": len(body.split()),
                })
    return found


_IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]{2,}")


def _signature(body: str) -> set[str]:
    """Distinctive identifiers in a body.

    Functions that genuinely share logic share vocabulary ("stems", "bpm",
    "track_name"), so this is a cheap blocking key. Building a SequenceMatcher is
    O(n) in the body length, and the full cross-product here is ~6.3M pairs, so
    constructing them all is itself the bottleneck - the inverted index means only
    plausible pairs ever get one.
    """
    return set(_IDENT.findall(body))


def _near_pairs(funcs: list[dict], threshold: float) -> list[dict]:
    index: dict[str, list[int]] = defaultdict(list)
    for i, f in enumerate(funcs):
        for token in _signature(f["body"]):
            index[token].append(i)

    # Common tokens would put every function in one bucket, so they help nobody.
    common = {tok for tok, idx in index.items() if len(idx) > max(40, len(funcs) // 12)}

    pairs: set[tuple[int, int]] = set()
    for token, idx in index.items():
        if token in common or len(idx) > max(40, len(funcs) // 12):
            continue
        if len(idx) > 200:
            continue
        for a_i in range(len(idx)):
            for b_i in range(a_i + 1, len(idx)):
                pairs.add((idx[a_i], idx[b_i]))

    near: list[dict] = []
    for i, j in pairs:
        a, b = funcs[i], funcs[j]
        if a["body"] == b["body"] or a["file"] == b["file"]:
            continue
        lo, hi = sorted((len(a["body"]), len(b["body"])))
        if lo / hi < threshold - 0.15:
            continue
        matcher = SequenceMatcher(None, a["body"], b["body"], autojunk=False)
        if matcher.quick_ratio() < threshold:
            continue
        ratio = matcher.ratio()
        if ratio >= threshold:
            near.append({
                "ratio": round(ratio, 3),
                "a": {"file": a["file"], "name": a["name"], "line": a["line"]},
                "b": {"file": b["file"], "name": b["name"], "line": b["line"]},
            })
    return near


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--threshold", type=float, default=0.85)
    ap.add_argument("--min-lines", type=int, default=12)
    ap.add_argument("--json", action="store_true")
    ap.add_argument(
        "--near", action="store_true",
        help="also run the fuzzy pass. Off by default: it is O(n^2) in the worst "
             "case and takes minutes on a repo this size. Use it when hunting a "
             "specific suspected copy, not for a routine sweep.",
    )
    args = ap.parse_args()

    funcs = [f for f in collect() if f["loc"] >= args.min_lines]
    by_body: dict[str, list[dict]] = defaultdict(list)
    for f in funcs:
        by_body[f["body"]].append(f)

    exact = [
        {"count": len(v), "sites": [{"file": s["file"], "name": s["name"], "line": s["line"]} for s in v]}
        for v in by_body.values() if len(v) > 1
    ]
    exact.sort(key=lambda g: (-g["count"], -len(g["sites"][0]["file"])))

    near = _near_pairs(funcs, args.threshold) if args.near else []
    near.sort(key=lambda p: -p["ratio"])

    if args.json:
        print(json.dumps({"exact": exact, "near": near}, indent=2))
        return 0

    print(f"functions scanned: {len(funcs)} (>= {args.min_lines} tokens)")
    print(f"\n=== EXACT duplicates: {len(exact)} groups ===")
    for g in exact:
        print(f"  {g['count']} copies:")
        for s in g["sites"]:
            print(f"      {s['file']}:{s['line']}  {s['name']}")
    if not args.near:
        print("\n(near-duplicate pass skipped; pass --near to run it - it is slow)")
        return 0
    print(f"\n=== NEAR duplicates (>= {args.threshold}): {len(near)} pairs ===")
    for p in near[:60]:
        print(f"  {p['ratio']:.3f}  {p['a']['file']}:{p['a']['line']} {p['a']['name']}")
        print(f"          {p['b']['file']}:{p['b']['line']} {p['b']['name']}")
    if len(near) > 60:
        print(f"  ... and {len(near) - 60} more (use --json)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

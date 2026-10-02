#!/usr/bin/env python3
"""Report control-flow nesting depth per function.

Deep nesting is not automatically bad, but it is a reliable proxy for
"hard to navigate", and it is measurable. This reports the deepest chain of
`if`/`for`/`while`/`try`/`with`/`match` blocks inside each function, so the
candidates to flatten are chosen by number rather than by taste.

It also flags the specific anti-patterns that nesting hides:
  * a bare `except:` or `except Exception:` that swallows an error
  * a `return` nested more than one level deep, i.e. a function that reads as a
    decision tree with many exits
  * a `try` inside a loop, where one failure aborts the remaining iterations

Read-only by default. With ``--baseline`` it becomes a gate: the measured
nesting is compared against a committed JSON baseline and a *worse* score fails
the check, so a refactor cannot silently reintroduce deep nesting. Improvements
are reported but do not fail; re-baseline explicitly once they are accepted.

Usage::

    python tools/report-nesting.py [root] [--min-depth N] [--top N]
    python tools/report-nesting.py --write-baseline tools/nesting-baseline.json \
        packages/backend/app
    python tools/report-nesting.py --baseline tools/nesting-baseline.json \
        packages/backend/app
"""
from __future__ import annotations

import argparse
import ast
import json
import sys
from pathlib import Path

NESTING_NODES = (
    ast.If,
    ast.For,
    ast.AsyncFor,
    ast.While,
    ast.Try,
    ast.With,
    ast.AsyncWith,
    ast.Match,
)


def measure(fn: ast.AST) -> tuple[int, int]:
    """Return (max nesting depth, line of the deepest node)."""
    best = 0
    best_line = 0

    def walk(node: ast.AST, depth: int) -> None:
        nonlocal best, best_line
        for child in ast.iter_child_nodes(node):
            if isinstance(child, NESTING_NODES):
                new_depth = depth + 1
                if new_depth > best:
                    best, best_line = new_depth, child.lineno
                walk(child, new_depth)
            else:
                walk(child, depth)

    walk(fn, 0)
    return best, best_line


def find_returns(fn: ast.AST) -> list[int]:
    """Lines of `return` statements nested more than one level deep."""
    out: list[int] = []

    def walk(node: ast.AST, depth: int) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, NESTING_NODES):
                if isinstance(child, ast.Return) and depth >= 2:
                    out.append(child.lineno)
                walk(child, depth + 1)
            elif isinstance(child, ast.Return) and depth >= 2:
                out.append(child.lineno)
            else:
                walk(child, depth)

    walk(fn, 0)
    return out


def find_bare_excepts(fn: ast.AST) -> list[int]:
    out: list[int] = []
    for node in ast.walk(fn):
        if isinstance(node, ast.ExceptHandler):
            if node.type is None:
                out.append(node.lineno)
            elif isinstance(node.type, ast.Name) and node.type.id in {
                "Exception",
                "BaseException",
            }:
                # Only flag a broad catch that does not re-raise or log.
                body = ast.dump(node)
                if "raise" not in body and "logger" not in body and "logging" not in body:
                    out.append(node.lineno)
    return out


def find_try_in_loop(fn: ast.AST) -> list[int]:
    out: list[int] = []
    for node in ast.walk(fn):
        if isinstance(node, (ast.For, ast.AsyncFor, ast.While)):
            for inner in ast.walk(node):
                if isinstance(inner, ast.Try) and inner is not node:
                    out.append(inner.lineno)
                    break
    return out


def collect(root: Path) -> tuple[list[tuple], list[tuple]]:
    """Return (rows, flagged) for every function under `root`."""
    rows: list[tuple] = []
    flagged: list[tuple] = []
    unparsed: list[str] = []
    for path in sorted(root.rglob("*.py")):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError) as exc:
            # A file that will not parse contributes nothing to the score, so
            # skipping it silently would let this gate pass *because* of a
            # syntax error - the opposite of what a gate is for. Report it.
            unparsed.append(f"{path}: {exc}")
            continue
        for fn in ast.walk(tree):
            if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            depth, line = measure(fn)
            if depth >= 2:
                rows.append(
                    (depth, len(find_returns(fn)), fn.lineno, fn.name, str(path), str(line))
                )
            for exc in find_bare_excepts(fn):
                flagged.append((path.name, fn.name, exc, "broad except that neither logs nor re-raises"))
            for tl in find_try_in_loop(fn):
                flagged.append((path.name, fn.name, tl, "try inside a loop"))
    return rows, flagged, unparsed


def score(rows: list[tuple], root: Path) -> dict[str, int]:
    """Map `relative/path::function` -> nesting depth.

    Keys are relative to `root` so the baseline is independent of whether the
    root was passed as `packages/backend/app` or an absolute path. Keying on the
    raw path made the same tree score differently depending on how it was
    invoked, and the gate then reported "matches none" - rejecting everything
    for no reason. Also keyed by name rather than line, so moving a function
    during a refactor is not read as a change.
    """
    base = root.resolve()
    out: dict[str, int] = {}
    # Functions can share a name (an overload, or a stale duplicate). Without an
    # occurrence index the last one silently wins, so a deep copy could be masked
    # by a shallow one and the gate would pass on a real regression.
    seen: dict[str, int] = {}
    for depth, _nret, _ln, name, path, _dl in rows:
        p = Path(path).resolve()
        try:
            rel = p.relative_to(base).as_posix()
        except ValueError:
            rel = p.as_posix()
        base_key = f"{rel}::{name}"
        n = seen.get(base_key, 0)
        seen[base_key] = n + 1
        out[base_key if n == 0 else f"{base_key}#{n}"] = depth
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("root", nargs="?", default="packages/backend/app")
    ap.add_argument("--min-depth", type=int, default=4)
    ap.add_argument("--top", type=int, default=25)
    ap.add_argument("--baseline", type=Path, help="fail if nesting got worse than this")
    ap.add_argument("--write-baseline", type=Path, help="write the baseline and exit")
    args = ap.parse_args()

    root = Path(args.root)
    if not root.is_dir():
        print(f"not a directory: {root}")
        return 1

    rows, flagged, unparsed = collect(root)
    rows.sort(key=lambda r: (-r[0], -r[1]))

    if unparsed and (args.baseline or args.write_baseline):
        print(f"{len(unparsed)} file(s) could not be parsed - the score would be "
              f"incomplete:")
        for line in unparsed[:10]:
            print(f"  {line}")
        return 1

    if args.write_baseline:
        current = score(rows, root)
        args.write_baseline.parent.mkdir(parents=True, exist_ok=True)
        args.write_baseline.write_text(
            json.dumps(current, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        print(f"wrote {args.write_baseline} ({len(current)} functions tracked)")
        return 0

    if args.baseline:
        if not args.baseline.exists():
            print(f"baseline not found: {args.baseline}")
            return 1
        allowed = json.loads(args.baseline.read_text(encoding="utf-8"))
        current = score(rows, root)
        # A baseline written for a different root matches nothing and would pass
        # vacuously - the worst possible failure for a gate. Require overlap.
        matched = [k for k in current if k in allowed]
        if not matched:
            print(
                f"baseline {args.baseline} matches none of the {len(current)} functions "
                f"under {root}.\nIt was probably written for a different root; re-run with "
                f"--write-baseline."
            )
            return 1
        regressions = [
            (k, allowed[k], d) for k, d in current.items() if k in allowed and d > allowed[k]
        ]
        regressions.sort(key=lambda r: -(r[2] - r[1]))
        if regressions:
            print(f"nesting regression in {len(regressions)} function(s):")
            for key, was, now in regressions:
                print(f"  {key}: {was} -> {now}")
            print("\nFlatten it, or accept the change with --write-baseline.")
            return 1
        improved = sum(1 for k, d in current.items() if k in allowed and d < allowed[k])
        print(
            f"nesting baseline OK ({len(matched)} functions tracked, "
            f"{improved} improved)"
        )
        return 0

    over = [r for r in rows if r[0] >= args.min_depth]
    print(f"root: {root}")
    print(f"functions with nesting depth >= {args.min_depth}: {len(over)}")
    print()
    print(f"{'depth':>5} {'deep-returns':>12}  function                          file:def")
    for depth, nret, ln, name, path, dline in over[: args.top]:
        print(f"{depth:>5} {nret:>12}  {name[:30]:30}  {path}:{ln} (deepest {dline})")

    if flagged:
        print()
        print(f"anti-patterns worth a look: {len(flagged)}")
        for fname, fnname, line, why in flagged[: args.top]:
            print(f"  {fname}:{line}  {fnname}  - {why}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

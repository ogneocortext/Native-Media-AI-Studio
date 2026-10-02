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

Read-only. Usage::

    python tools/report-nesting.py [root] [--min-depth N] [--top N]
"""
from __future__ import annotations

import argparse
import ast
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


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("root", nargs="?", default="packages/backend/app")
    ap.add_argument("--min-depth", type=int, default=4)
    ap.add_argument("--top", type=int, default=25)
    args = ap.parse_args()

    root = Path(args.root)
    if not root.is_dir():
        print(f"not a directory: {root}")
        return 1

    rows: list[tuple[int, int, int, str, str, str]] = []
    flagged: list[tuple[str, str, int, str]] = []

    for path in sorted(root.rglob("*.py")):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:
            continue
        for fn in ast.walk(tree):
            if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            depth, line = measure(fn)
            ret = find_returns(fn)
            if depth >= args.min_depth:
                rows.append((depth, len(ret), fn.lineno, fn.name, str(path), str(line)))
            for exc in find_bare_excepts(fn):
                flagged.append((path.name, fn.name, exc, "broad except that neither logs nor re-raises"))
            for tl in find_try_in_loop(fn):
                flagged.append((path.name, fn.name, tl, "try inside a loop"))

    rows.sort(key=lambda r: (-r[0], -r[1]))
    print(f"root: {root}")
    print(f"functions with nesting depth >= {args.min_depth}: {len(rows)}")
    print()
    print(f"{'depth':>5} {'deep-returns':>12}  function                          file:def")
    for depth, nret, ln, name, path, dline in rows[: args.top]:
        print(f"{depth:>5} {nret:>12}  {name[:30]:30}  {path}:{ln} (deepest {dline})")

    if flagged:
        print()
        print(f"anti-patterns worth a look: {len(flagged)}")
        for fname, fnname, line, why in flagged[: args.top]:
            print(f"  {fname}:{line}  {fnname}  - {why}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

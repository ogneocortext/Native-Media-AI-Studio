"""Fail if the backend app package contains an import cycle or a layer inversion.

Two structural rules, both measured before this script existed.

1. No import cycles. The codebase had two, each held open by deferred
   function-local imports that hid them from casual reading:
     queue.manager -> diagnostics.resources -> services.vram_manager -> queue.manager
     services.vram_manager -> adapters.ollama -> queue.manager -> ... -> vram_manager
   Both were resolved by injecting providers in `main.py` (the composition
   root) rather than importing the dependency. Reintroducing a deferred import
   to "fix" something would silently restore them, so they are now checked.

2. No upward dependencies: `services` and `adapters` must not import `api`.
   One existed (`services.ffmpeg_tools -> api.outputs`, which pulled an
   `extract_audio_cover` helper out of the API layer into `services/media_covers.py`).

Sibling imports within `api` are deliberately allowed: the `integrations_*`
routers intentionally share config helpers, and `audio*` is documented as
four cooperating modules (D15).

Run: python tools/check-import-cycles.py    (exit 1 on violation)
"""

import argparse
import ast
import pathlib
import sys
from collections import defaultdict

APP_ROOT = pathlib.Path("packages/backend/app")
PKG_ROOT = APP_ROOT.parent

# Layers that must never import "upward" into the API layer.
CONSUMER_LAYERS = ("app.services", "app.adapters", "app.models")


def module_name(path: pathlib.Path) -> str:
    parts = list(path.relative_to(PKG_ROOT).with_suffix("").parts)
    if parts and parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)


def build_graph(root: pathlib.Path) -> tuple[dict[str, set[str]], set[str]]:
    """Resolve project-internal imports (absolute `app.*` and relative)."""
    files = [p for p in root.rglob("*.py") if "__pycache__" not in p.parts]
    known = {module_name(p) for p in files}
    edges: dict[str, set[str]] = defaultdict(set)
    for path in files:
        mod = module_name(path)
        pkg = mod if path.name == "__init__.py" else mod.rsplit(".", 1)[0]
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            target = None
            if isinstance(node, ast.ImportFrom):
                if node.level:
                    parts = pkg.split(".")
                    up = node.level - 1
                    base = parts[: len(parts) - up] if up <= len(parts) else []
                    if node.module:
                        base = base + node.module.split(".")
                    target = ".".join(base)
                elif node.module and node.module.startswith("app"):
                    target = node.module
                else:
                    continue
                # `from pkg import module` names a submodule when one exists.
                if (
                    target not in known
                    and node.module
                    and f"{target}.{node.module}" in known
                ):
                    target = f"{target}.{node.module}"
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.startswith("app"):
                        edges[mod].add(alias.name)
                continue
            if target and target in known:
                edges[mod].add(target)
    return edges, known


def find_cycles(edges: dict[str, set[str]], known: set[str]) -> list[list[str]]:
    """All simple cycles, deduplicated up to rotation (Tarjan-style DFS)."""
    cycles: list[list[str]] = []
    colour: dict[str, int] = {}

    def walk(node: str, stack: list[str]) -> None:
        colour[node] = 1
        stack.append(node)
        for nxt in sorted(edges.get(node, ())):
            if nxt not in known or nxt == node:
                continue
            if colour.get(nxt) == 1:
                cycles.append(stack[stack.index(nxt) :] + [nxt])
            elif colour.get(nxt) is None:
                walk(nxt, stack)
        stack.pop()
        colour[node] = 2

    for mod in sorted(edges):
        if colour.get(mod) is None:
            walk(mod, [])
    seen: set[frozenset[str]] = set()
    unique: list[list[str]] = []
    for cycle in cycles:
        key = frozenset(cycle)
        if key not in seen:
            seen.add(key)
            unique.append(cycle)
    return unique


def find_inversions(edges: dict[str, set[str]]) -> list[tuple[str, str]]:
    return [
        (mod, dep)
        for mod, deps in edges.items()
        if mod.rsplit(".", 1)[0] in CONSUMER_LAYERS
        for dep in deps
        if dep.rsplit(".", 1)[0] == "app.api"
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--json",
        action="store_true",
        help="machine-readable output for the docs gate",
    )
    args = parser.parse_args()

    if not APP_ROOT.exists():
        print(f"error: {APP_ROOT} not found (run from repo root)", file=sys.stderr)
        return 2

    edges, known = build_graph(APP_ROOT)
    cycles = find_cycles(edges, known)
    inversions = find_inversions(edges)

    if args.json:
        print(
            '{"cycles": %d, "inversions": %d}'
            % (len(cycles), len(inversions))
        )
    else:
        print(f"modules: {len(known)}  internal-import edges: {sum(len(v) for v in edges.values())}")

    failed = False
    for cycle in cycles:
        failed = True
        if not args.json:
            print("IMPORT CYCLE: " + " -> ".join(c.replace("app.", "") for c in cycle))
    for mod, dep in inversions:
        failed = True
        if not args.json:
            print(f"LAYER INVERSION: {mod} -> {dep}  (services/adapters must not import api)")

    if not failed and not args.json:
        print("no import cycles, no layer inversions")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

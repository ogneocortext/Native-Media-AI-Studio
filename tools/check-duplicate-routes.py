#!/usr/bin/env python3
"""Fail when two handlers claim the same path and method (silent route shadowing).

Why this exists
---------------
Three handlers once registered ``/api/integrations/ollama/models``. FastAPI
*matches* the first one registered and *documents* the last, so OpenAPI advertised a
handler that could never run, while the reachable one was invisible in the schema.
Nothing failed: no import error, no test, no 404 - the reachable handler simply
answered, and a capability fix applied to the documented one had no effect on any
request.

Two things make this easy to miss, and both bit during the audit that prompted this
gate:

1. ``app.routes`` holds router *groupings*, not operations. On this FastAPI version
   an included router appears as an ``_IncludedRouter`` whose operations live under
   ``original_router.routes``; walking ``app.routes`` directly finds 5 routes where
   the app really serves 260. (AGENTS.md already records this for ``app.routes``
   holding router groupings - this gate walks past it.)
2. Reading only OpenAPI is not enough either, because OpenAPI is exactly the side
   that reports the *shadowed* handler.

So the check enumerates every route with its full prefixed path, groups by
(path, method), and fails on any group with more than one handler.

Usage:
    python tools/check-duplicate-routes.py [--json]
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "packages" / "backend"))
sys.path.insert(0, str(REPO))
from tools.lib.cli_base import CLIError, json_print, setup_logging  # noqa: E402

__version__ = "1.0.0"

logger = setup_logging()


def _walk(routes, prefix: str = ""):
    """Yield (path, methods, handler_label) for every route, prefix applied."""
    from fastapi.routing import APIRoute

    for route in routes or []:
        if isinstance(route, APIRoute):
            yield prefix + route.path, route.methods or set(), _label(route)
            continue

        # An included router: its own prefix applies to every route beneath it.
        original = getattr(route, "original_router", None)
        if original is not None and hasattr(original, "routes"):
            ctx = getattr(route, "include_context", None)
            extra = getattr(ctx, "prefix", "") if ctx is not None else ""
            own = getattr(original, "prefix", "") or ""
            yield from _walk(original.routes, prefix + extra + own)
            continue

        sub = getattr(route, "routes", None)
        if isinstance(sub, (list, tuple)):
            yield from _walk(sub, prefix)


def _label(route) -> str:
    module = getattr(getattr(route, "endpoint", None), "__module__", "?")
    return "{}::{}".format(module.rsplit(".", 1)[-1], getattr(route, "name", "?"))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fail when two handlers claim the same path and method "
        "(silent route shadowing).",
        epilog=f"check-duplicate-routes v{__version__}",
    )
    parser.add_argument(
        "--version", action="version", version=f"check-duplicate-routes {__version__}"
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Debug logging")
    parser.add_argument("-q", "--quiet", action="store_true", help="Warnings only")
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit machine-readable JSON instead of human text",
    )
    args = parser.parse_args()

    # Re-configure logging after parsing verbosity flags
    from tools.lib.cli_base import setup_logging as _setup  # noqa: E402

    global logger
    logger = _setup(verbose=args.verbose, quiet=args.quiet)

    try:
        from app.main import app
    except ImportError as exc:
        raise CLIError(f"Cannot import FastAPI app: {exc}") from exc

    groups: dict[tuple[str, str], set[str]] = defaultdict(set)
    total = 0
    for path, methods, label in _walk(app.routes):
        for method in methods:
            if method in ("HEAD", "OPTIONS"):
                continue
            groups[(path, method)].add(label)
            total += 1

    duplicates = {
        f"{method} {path}": sorted(handlers)
        for (path, method), handlers in groups.items()
        if len(handlers) > 1
    }

    if args.json:
        json_print({"routes": total, "duplicates": duplicates})
        return 1 if duplicates else 0

    print(f"routes checked: {total} (path, method) pairs")
    if not duplicates:
        print("no duplicate route handlers")
        return 0

    print(f"\nDUPLICATE ROUTE HANDLERS: {len(duplicates)}")
    print(
        "Each of these is shadowed: FastAPI serves the first registered handler and\n"
        "documents the last, so one of the two can never run.\n"
    )
    for key in sorted(duplicates):
        print(f"  {key}")
        for handler in duplicates[key]:
            print(f"      <- {handler}")
    print(
        "\nFix by giving the paths distinct names, or deleting the handler that is\n"
        "meant to be unreachable. Do not silence this."
    )
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except CLIError as exc:
        logger.error("%s", exc)
        sys.exit(1)

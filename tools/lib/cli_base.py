"""
Shared CLI foundation for Native Media AI Studio tools.

Eliminates the per-tool reinvention of argparse boilerplate, logging setup,
error handling, and UTF-8 stdout handling that caused repeated bugs on this
machine (PowerShell cp1252 decoding, BOM leaks, silent failures).

Provides:

* :class:`CLIApp` — a small argparse wrapper with consistent flags
  (``--verbose``, ``--quiet``, ``--version``, ``--dry-run``).
* :func:`setup_logging` — consistent logging to stderr, honoring verbosity.
* :class:`Progress` — a minimal progress bar (no external dependency) that
  falls back to a simple counter on non-TTY output.
* :func:`json_print` — emit a single JSON object to stdout.
* :class:`CLIError` — raise instead of ``sys.exit(1)``; the app wrapper
  converts it to exit code 1 with a clean message.
* UTF-8 stdout guard — reconfigures stdout to UTF-8 with backslashreplace so
  model output containing em-dashes and non-ASCII never crashes the console.

Usage::

    from tools.lib.cli_base import CLIApp, CLIError, Progress, json_print

    app = CLIApp("my-tool", version="1.0.0", description="Does things.")

    @app.command("process")
    def process(args):
        if args.dry_run:
            print("[dry-run] would process", args.target)
            return
        with Progress(total=len(items)) as p:
            for item in items:
                do_work(item)
                p.advance()

    if __name__ == "__main__":
        sys.exit(app.run())
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Callable, Generator

# ---------------------------------------------------------------------------
# UTF-8 stdout guard
# ---------------------------------------------------------------------------
# PowerShell on this machine defaults to cp1252. Model output and file
# contents can contain em-dashes and other non-ASCII that would crash
# plain ``print()``. Reconfigure stdout to UTF-8 with backslashreplace so
# nothing raises.
if sys.stdout is not None and sys.stdout.encoding is not None:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")  # type: ignore[attr-defined]
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def setup_logging(*, verbose: bool = False, quiet: bool = False) -> logging.Logger:
    """Configure logging to stderr with a consistent format.

    Verbose shows DEBUG, quiet shows only WARNING+. Default is INFO.
    Boolean parameters are keyword-only to avoid the boolean-trap.
    """
    if quiet:
        level = logging.WARNING
    elif verbose:
        level = logging.DEBUG
    else:
        level = logging.INFO

    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(
        logging.Formatter("%(levelname)s %(name)s: %(message)s")
    )

    root = logging.getLogger()
    root.setLevel(level)
    # Avoid duplicate handlers if setup_logging is called more than once.
    if not root.handlers:
        root.addHandler(handler)

    return logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class CLIError(Exception):
    """Raised for user-facing CLI errors; converted to exit code 1 by the app."""


# ---------------------------------------------------------------------------
# Progress bar (no external dependency)
# ---------------------------------------------------------------------------


@dataclass
class Progress:
    """Minimal progress bar for long-running CLI operations.

    On a TTY it renders a simple bar; on piped/non-TTY output it falls back
    to a one-line counter so logs stay readable.
    """

    total: int
    label: str = ""
    width: int = 30
    _n: int = field(default=0, init=False)
    _start: float = field(default=0.0, init=False)
    _is_tty: bool = field(default=False, init=False)

    def __post_init__(self) -> None:
        self._start = os.times().elapsed if hasattr(os.times, "elapsed") else 0.0
        self._is_tty = sys.stdout.isatty()
        if self._is_tty and self.total > 0:
            self._render()

    def advance(self, n: int = 1) -> None:
        """Advance the counter by ``n`` and re-render."""
        self._n += n
        if self._is_tty:
            self._render()
        elif self._n % max(1, self.total // 10) == 0 or self._n >= self.total:
            print(
                f"[{self._n}/{self.total}] {self.label}".strip(),
                file=sys.stderr,
                flush=True,
            )

    def _render(self) -> None:
        if self.total <= 0:
            return
        filled = int(self.width * self._n // self.total)
        bar = "█" * filled + "░" * (self.width - filled)
        pct = self._n * 100 // self.total
        info = f" {self.label}" if self.label else ""
        print(
            f"\r{self._n:>{len(str(self.total))}}/{self.total} |{bar}| {pct}%{info}",
            end="",
            file=sys.stderr,
            flush=True,
        )

    def finish(self) -> None:
        """Final render and newline."""
        if self._is_tty:
            print(file=sys.stderr)

    def __enter__(self) -> Progress:
        return self

    def __exit__(self, *args: Any) -> None:
        self.finish()


# ---------------------------------------------------------------------------
# JSON output helper
# ---------------------------------------------------------------------------


def json_print(obj: Any) -> None:
    """Print a single JSON object to stdout, compact, UTF-8 safe."""
    print(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))


# ---------------------------------------------------------------------------
# CLIApp
# ---------------------------------------------------------------------------


@dataclass
class _Command:
    name: str
    func: Callable[[argparse.Namespace], Any]
    help: str


class CLIApp:
    """Small argparse wrapper with consistent CLI conventions.

    Subcommands are registered as methods decorated with
    :meth:`command`, or passed to :meth:`add_command`. The app handles
    ``--verbose``/``--quiet``/``--version``/``--dry-run`` globally and
    converts :exc:`CLIError` to exit code 1 with a clean message.
    """

    def __init__(
        self,
        name: str,
        *,
        version: str = "1.0.0",
        description: str = "",
        epilog: str = "",
    ) -> None:
        self.name = name
        self.version = version
        self.description = description or f"{name} — Native Media AI Studio tool."
        self.epilog = epilog
        self._commands: dict[str, _Command] = {}
        self._logger = logging.getLogger(name)
        self.dry_run = False
        self.verbose = False
        self.quiet = False

    def command(
        self, name: str | None = None, help: str = ""
    ) -> Callable[[Callable[[argparse.Namespace], Any]], Callable[[argparse.Namespace], Any]]:
        """Decorator to register a subcommand handler.

        The decorated function receives the parsed ``argparse.Namespace``
        for that subcommand.
        """

        def decorator(
            func: Callable[[argparse.Namespace], Any]
        ) -> Callable[[argparse.Namespace], Any]:
            cmd_name = name or func.__name__.replace("_", "-")
            self._commands[cmd_name] = _Command(cmd_name, func, help or func.__doc__ or "")
            return func

        return decorator

    def add_command(
        self, name: str, func: Callable[[argparse.Namespace], Any], help: str = ""
    ) -> None:
        """Register a subcommand handler programmatically."""
        self._commands[name] = _Command(name, func, help)

    def _build_parser(self) -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(
            prog=self.name,
            description=self.description,
            epilog=self.epilog,
        )
        parser.add_argument(
            "--version", action="version", version=f"{self.name} {self.version}"
        )
        parser.add_argument(
            "-v",
            "--verbose",
            action="store_true",
            help="Show debug-level logging",
        )
        parser.add_argument(
            "-q",
            "--quiet",
            action="store_true",
            help="Suppress all but warnings and errors",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would be done without making changes",
        )

        subparsers = parser.add_subparsers(dest="command", required=True)
        for cmd in self._commands.values():
            sp = subparsers.add_parser(cmd.name, help=cmd.help)
            self._configure_subparser(sp, cmd)

        return parser

    def _configure_subparser(
        self, sp: argparse.ArgumentParser, cmd: _Command
    ) -> None:
        """Hook for subclasses to add subcommand-specific arguments."""
        return None

    def run(self, argv: list[str] | None = None) -> int:
        """Parse args, run the matching subcommand, return an exit code.

        Returns 0 on success, 1 on :exc:`CLIError`, 2 on argument errors
        (argparse exits 2 on its own).
        """
        parser = self._build_parser()
        args = parser.parse_args(argv)

        self.dry_run = bool(getattr(args, "dry_run", False))
        self.verbose = bool(getattr(args, "verbose", False))
        self.quiet = bool(getattr(args, "quiet", False))

        setup_logging(verbose=self.verbose, quiet=self.quiet)

        cmd_name = args.command
        if cmd_name not in self._commands:
            self._logger.error("Unknown command: %s", cmd_name)
            return 1

        cmd = self._commands[cmd_name]
        try:
            result = cmd.func(args)
        except CLIError as exc:
            self._logger.error("%s", exc)
            return 1
        except FileNotFoundError as exc:
            self._logger.error("File not found: %s", exc)
            return 1
        except Exception as exc:  # noqa: BLE001 - CLI boundary: report cleanly
            self._logger.exception("Unexpected error: %s", exc)
            return 1

        # A command returning False means "did not complete successfully".
        if result is False:
            return 1
        return 0


@contextmanager
def dry_run_mode(*, enabled: bool) -> Generator[bool, None, None]:
    """Context manager: yields True if dry-run is active."""
    yield enabled


def confirm(
    prompt: str, *, default: bool = False
) -> bool:
    """Ask a yes/no question on stderr; return the answer.

    Returns ``default`` when stdin is not a TTY (non-interactive).
    """
    if not sys.stdin.isatty():
        return default
    suffix = " [y/N] " if not default else " [Y/n] "
    try:
        answer = input(prompt + suffix).strip().lower()
    except (EOFError, KeyboardInterrupt):
        print(file=sys.stderr)
        return default
    if not answer:
        return default
    return answer[0] == "y"

"""Narrow, safe function tools for the local Qwen sub-agent.

Each tool subclasses qwen_agent.tools.base.BaseTool and is registered
via @register_tool. The tool set is deliberately small so the 4B model
can reliably plan and execute calls without hallucinating commands.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from config import REPO_ROOT, TOOL_TIMEOUT_SECONDS
from qwen_agent.tools.base import BaseTool, register_tool


def _run_cmd(cmd: list[str], cwd: str | None = None, timeout: int = TOOL_TIMEOUT_SECONDS) -> dict[str, Any]:
    """Run a command safely, capturing stdout/stderr and returncode.

    Never uses shell=True. Returns a dict with ok, returncode, stdout, stderr.
    """
    try:
        proc = subprocess.run(
            cmd,
            cwd=cwd or str(REPO_ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=timeout,
        )
        return {
            "ok": proc.returncode == 0,
            "returncode": proc.returncode,
            "stdout": proc.stdout or "",
            "stderr": proc.stderr or "",
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "ok": False,
            "returncode": -1,
            "stdout": exc.stdout.decode() if isinstance(exc.stdout, bytes) else (exc.stdout or ""),
            "stderr": f"Command timed out after {timeout}s: {exc.stderr or exc}",
        }
    except Exception as exc:  # noqa: BLE001 - surface any failure to the agent
        return {"ok": False, "returncode": -1, "stdout": "", "stderr": str(exc)}


def _safe_path(path: str) -> Path:
    """Resolve a path relative to the repo root and ensure it stays inside it."""
    p = (REPO_ROOT / path).resolve()
    if REPO_ROOT not in p.parents and p != REPO_ROOT:
        raise ValueError(f"Path escapes repo root: {path}")
    return p


# ---------------------------------------------------------------------------
# Tool: read_file
# ---------------------------------------------------------------------------

@register_tool("read_file")
class ReadFileTool(BaseTool):
    """Read the contents of a file within the repo."""

    name = "read_file"
    description = "Read the full text contents of a file in the repository."
    parameters = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Repository-relative path to the file (e.g. 'packages/backend/app/core/migrations.py').",
            }
        },
        "required": ["path"],
    }

    def call(self, params: str | dict, **kwargs) -> str:  # noqa: D401
        if isinstance(params, str):
            params = json.loads(params)
        path = params["path"]
        try:
            fp = _safe_path(path)
        except ValueError as exc:
            return f"ERROR: {exc}"
        if not fp.exists():
            return f"ERROR: File not found: {path}"
        if not fp.is_file():
            return f"ERROR: Not a regular file: {path}"
        try:
            return fp.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            return f"ERROR: File is not valid UTF-8: {path}"


# ---------------------------------------------------------------------------
# Tool: list_directory
# ---------------------------------------------------------------------------

@register_tool("list_directory")
class ListDirectoryTool(BaseTool):
    """List files and subdirectories in a repo directory."""

    name = "list_directory"
    description = "List entries (files and subdirectories) in a repository directory."
    parameters = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Repository-relative directory path (e.g. 'packages/backend/app/api'). Defaults to repo root.",
                "default": ".",
            }
        },
        "required": [],
    }

    def call(self, params: str | dict, **kwargs) -> str:  # noqa: D401
        if isinstance(params, str):
            params = json.loads(params) if params.strip() else {}
        rel = params.get("path", ".")
        try:
            dp = _safe_path(rel)
        except ValueError as exc:
            return f"ERROR: {exc}"
        if not dp.exists():
            return f"ERROR: Directory not found: {rel}"
        if not dp.is_dir():
            return f"ERROR: Not a directory: {rel}"
        entries: list[str] = []
        for child in sorted(dp.iterdir()):
            prefix = "[DIR] " if child.is_dir() else "[FILE] "
            entries.append(f"{prefix}{child.name}")
        return "\n".join(entries) if entries else "(empty directory)"


# ---------------------------------------------------------------------------
# Tool: grep_search
# ---------------------------------------------------------------------------

@register_tool("grep_search")
class GrepSearchTool(BaseTool):
    """Search file contents for a regex pattern."""

    name = "grep_search"
    description = "Search repository file contents for a regex pattern. Returns matching file:line pairs."
    parameters = {
        "type": "object",
        "properties": {
            "pattern": {
                "type": "string",
                "description": "Regular expression pattern to search for.",
            },
            "path": {
                "type": "string",
                "description": "Repository-relative directory or file to search (default: repo root).",
                "default": ".",
            },
            "include": {
                "type": "string",
                "description": "File glob to include (e.g. '*.py'). Optional.",
            },
        },
        "required": ["pattern"]
    }

    def call(self, params: str | dict, **kwargs) -> str:  # noqa: D401
        if isinstance(params, str):
            params = json.loads(params)
        pattern = params["pattern"]
        rel = params.get("path", ".")
        include = params.get("include")

        try:
            dp = _safe_path(rel)
        except ValueError as exc:
            return f"ERROR: {exc}"

        # Build the file list
        if dp.is_file():
            files = [dp]
        elif dp.is_dir():
            if include:
                files = list(dp.rglob(include))
            else:
                files = [p for p in dp.rglob("*") if p.is_file()]
        else:
            return f"ERROR: Path not found: {rel}"

        # Skip huge binary / cache dirs
        skip_dirs = {".git", "node_modules", "__pycache__", ".venv", "venv", "output", "out", "dist", "build"}
        results: list[str] = []
        try:
            rx = re.compile(pattern)
        except re.error as exc:
            return f"ERROR: Invalid regex: {exc}"

        count = 0
        for f in files:
            # prune skip dirs
            if any(part in skip_dirs for part in f.parts):
                continue
            if not f.is_file():
                continue
            try:
                text = f.read_text(encoding="utf-8", errors="replace")
            except (OSError, UnicodeDecodeError):
                continue
            for i, line in enumerate(text.splitlines(), start=1):
                if rx.search(line):
                    rel_path = f.relative_to(REPO_ROOT)
                    results.append(f"{rel_path}:{i}: {line[:200]}")
                    count += 1
                    if count >= 50:
                        break
            if count >= 50:
                break

        if not results:
            return "No matches found."
        return "\n".join(results)


# ---------------------------------------------------------------------------
# Tool: run_gates
# ---------------------------------------------------------------------------

@register_tool("run_gates")
class RunGatesTool(BaseTool):
    """Run the project's gate suite (run-gates.py) with an optional filter."""

    name = "run_gates"
    description = "Run the Native Media AI Studio gate suite (docs, ruff, arch, routes, pytest, type, lint, unit)."
    parameters = {
        "type": "object",
        "properties": {
            "only": {
                "type": "string",
                "description": "Substring filter for gate names (e.g. 'ruff', 'pytest', 'docs'). Optional.",
            },
            "fix": {
                "type": "boolean",
                "description": "Run with --fix to auto-correct violations (ruff/eslint). Default false.",
                "default": False,
            },
        },
        "required": []
    }

    def call(self, params: str | dict, **kwargs) -> str:  # noqa: D401
        if isinstance(params, str):
            params = json.loads(params) if params.strip() else {}
        cmd = [sys.executable, "tools/run-gates.py"]
        if params.get("only"):
            cmd += ["--only", params["only"]]
        if params.get("fix"):
            cmd += ["--fix"]
        result = _run_cmd(cmd)
        out = result["stdout"]
        if result["stderr"]:
            out += "\n--- STDERR ---\n" + result["stderr"]
        status = "PASS" if result["ok"] else "FAIL"
        return f"[{status}] rc={result['returncode']}\n{out}"


# ---------------------------------------------------------------------------
# Tool: run_pytest
# ---------------------------------------------------------------------------

@register_tool("run_pytest")
class RunPytestTool(BaseTool):
    """Run backend pytest on specific test files or the whole suite."""

    name = "run_pytest"
    description = "Run backend pytest. Specify test file(s) to run a subset, or omit to run all backend tests."
    parameters = {
        "type": "object",
        "properties": {
            "paths": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of repo-relative test file paths (e.g. ['packages/backend/tests/test_vram_manager.py']).",
            },
            "timeout": {
                "type": "integer",
                "description": "Per-test timeout in seconds. Default 300.",
                "default": 300,
            },
        },
        "required": []
    }

    def call(self, params: str | dict, **kwargs) -> str:  # noqa: D401
        if isinstance(params, str):
            params = json.loads(params) if params.strip() else {}
        backend_dir = REPO_ROOT / "packages" / "backend"
        # Use the project's backend python if available
        backend_python = REPO_ROOT / "packages" / "backend" / ".venv" / "Scripts" / "python.exe"
        if not backend_python.exists():
            backend_python = Path(sys.executable)
        cmd = [str(backend_python), "-m", "pytest", "-p", "no:cacheprovider"]
        for p in params.get("paths", []):
            cmd.append(str(backend_dir / p))
        cmd += ["--timeout", str(params.get("timeout", 300))]
        result = _run_cmd(cmd, cwd=str(backend_dir))
        out = result["stdout"]
        if result["stderr"]:
            out += "\n--- STDERR ---\n" + result["stderr"]
        status = "PASS" if result["ok"] else "FAIL"
        return f"[{status}] rc={result['returncode']}\n{out}"


# ---------------------------------------------------------------------------
# Tool: run_cmd (restricted allow-list)
# ---------------------------------------------------------------------------

_ALLOWED_COMMANDS = {"python", "pnpm", "node", "npm", "npx", "curl"}


@register_tool("run_cmd")
class RunCmdTool(BaseTool):
    """Run a read-only or build command from an allow-listed binary.

    Only allows: python, pnpm, node, npm, npx, curl. No shell operators.
    Use this sparingly; prefer the dedicated run_gates / run_pytest tools.
    """

    name = "run_cmd"
    description = "Run an allow-listed command (python, pnpm, node, npm, npx, curl). No shell operators allowed."
    parameters = {
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "Command string to run (e.g. 'python tools/run-gates.py --only ruff').",
            },
            "cwd": {
                "type": "string",
                "description": "Repository-relative working directory. Defaults to repo root.",
                "default": ".",
            },
        },
        "required": ["command"]
    }

    def call(self, params: str | dict, **kwargs) -> str:  # noqa: D401
        if isinstance(params, str):
            params = json.loads(params)
        command = params["command"]
        rel_cwd = params.get("cwd", ".")

        # Parse without shell=True: split on whitespace
        parts = command.split()
        if not parts:
            return "ERROR: Empty command."
        binary = parts[0]
        if binary not in _ALLOWED_COMMANDS:
            return f"ERROR: Binary '{binary}' not in allow-list {sorted(_ALLOWED_COMMANDS)}."

        try:
            cwd = _safe_path(rel_cwd)
        except ValueError as exc:
            return f"ERROR: {exc}"

        result = _run_cmd([binary] + parts[1:], cwd=str(cwd))
        out = result["stdout"]
        if result["stderr"]:
            out += "\n--- STDERR ---\n" + result["stderr"]
        status = "PASS" if result["ok"] else "FAIL"
        return f"[{status}] rc={result['returncode']}\n{out}"


# Tool registry for convenient import
TOOLS: list[BaseTool] = [
    ReadFileTool(),
    ListDirectoryTool(),
    GrepSearchTool(),
    RunGatesTool(),
    RunPytestTool(),
    RunCmdTool(),
]

TOOL_NAMES = [t.name for t in TOOLS]

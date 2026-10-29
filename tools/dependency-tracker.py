#!/usr/bin/env python3
"""
Dependency version tracker for Native Media AI Studio.

Scans all pyproject.toml files in the repo, extracts declared dependencies,
checks PyPI for the latest available version of each, and reports which ones
are outdated. Also checks installed versions in the active Python environment.

Usage:
    python tools/dependency-tracker.py              # Check all dependencies
    python tools/dependency-tracker.py --only ruff  # Check a specific package
    python tools/dependency-tracker.py --json       # JSON output for CI/automation
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tomllib
import urllib.request
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
PYPI_URL = "https://pypi.org/pypi/{package}/json"


def find_pyproject_files() -> list[Path]:
    """Find all pyproject.toml files in the repo (excluding venv, node_modules, etc.)."""
    exclude_dirs = {
        ".git", "node_modules", "__pycache__", ".venv", "venv",
        "third_party", "runtime", "output", "out", "tmp", "logs",
    }
    results: list[Path] = []
    for path in REPO_ROOT.rglob("pyproject.toml"):
        # Skip files in excluded directories
        parts = path.relative_to(REPO_ROOT).parts
        if any(part in exclude_dirs for part in parts):
            continue
        results.append(path)
    return sorted(results)


def parse_dependencies(pyproject_path: Path) -> list[dict[str, str]]:
    """Extract declared dependencies from a pyproject.toml file."""
    deps: list[dict[str, str]] = []
    try:
        with open(pyproject_path, "rb") as f:
            data = tomllib.load(f)
    except (tomllib.TOMLDecodeError, OSError):
        return deps

    project = data.get("project", {})

    # Main dependencies
    for dep in project.get("dependencies", []):
        deps.append({"name": _dep_name(dep), "spec": dep, "source": str(pyproject_path.relative_to(REPO_ROOT)), "section": "dependencies"})

    # Optional dependencies
    for group_name, group_deps in project.get("optional-dependencies", {}).items():
        for dep in group_deps:
            deps.append({
                "name": _dep_name(dep),
                "spec": dep,
                "source": str(pyproject_path.relative_to(REPO_ROOT)),
                "section": f"optional-dependencies[{group_name}]",
            })

    return deps


def _dep_name(dep_spec: str) -> str:
    """Extract the package name from a dependency specification string."""
    # Handle: package>=1.0, package==1.0, package[extra]>=1.0, etc.
    name = dep_spec.split("[")[0].split(">")[0].split("<")[0].split("=")[0].split("!")[0].split("~")[0].strip()
    return name


def get_latest_version(package_name: str) -> str | None:
    """Query PyPI for the latest version of a package."""
    try:
        url = PYPI_URL.format(package=package_name)
        req = urllib.request.Request(url, headers={"User-Agent": "nma-dependency-tracker/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return data["info"]["version"]
    except Exception:
        return None


def get_installed_version(package_name: str) -> str | None:
    """Get the installed version of a package in the current Python environment."""
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "show", package_name],
            capture_output=True, text=True, encoding="utf-8", timeout=15,
        )
        if result.returncode != 0:
            return None
        for line in result.stdout.splitlines():
            if line.lower().startswith("version:"):
                return line.split(":", 1)[1].strip()
    except Exception:
        return None
    return None


def parse_version(version_str: str) -> tuple[int, ...]:
    """Parse a version string into a tuple of integers for comparison."""
    parts: list[int] = []
    for part in version_str.split("."):
        try:
            parts.append(int(part))
        except ValueError:
            # Handle pre-release tags like 0.17.3rc1
            num = ""
            for ch in part:
                if ch.isdigit():
                    num += ch
                else:
                    break
            parts.append(int(num) if num else 0)
    return tuple(parts)


def is_outdated(installed: str | None, latest: str | None) -> bool:
    """Check if installed version is older than latest."""
    if not installed or not latest:
        return False
    return parse_version(installed) < parse_version(latest)


def main() -> int:
    parser = argparse.ArgumentParser(description="Check for outdated Python dependencies")
    parser.add_argument("--only", help="Only check a specific package name")
    parser.add_argument("--json", action="store_true", help="Output JSON instead of human-readable")
    args = parser.parse_args()

    pyproject_files = find_pyproject_files()
    all_deps: list[dict[str, str]] = []
    for pf in pyproject_files:
        all_deps.extend(parse_dependencies(pf))

    # Deduplicate by package name (keep the most specific source)
    seen: dict[str, dict[str, str]] = {}
    for dep in all_deps:
        name = dep["name"]
        if args.only and name.lower() != args.only.lower():
            continue
        if name not in seen:
            seen[name] = dep

    results: list[dict[str, Any]] = []
    for name, dep in sorted(seen.items()):
        latest = get_latest_version(name)
        installed = get_installed_version(name)
        outdated = is_outdated(installed, latest)

        results.append({
            "name": name,
            "spec": dep["spec"],
            "source": dep["source"],
            "section": dep["section"],
            "installed": installed,
            "latest": latest,
            "outdated": outdated,
        })

    if args.json:
        print(json.dumps({"dependencies": results, "outdated_count": sum(1 for r in results if r["outdated"])}, indent=2))
        return 0

    # Human-readable output
    outdated = [r for r in results if r["outdated"]]
    up_to_date = [r for r in results if not r["outdated"]]

    print(f"Dependency Version Report ({len(results)} packages checked)\n")
    print(f"{'Package':<30} {'Installed':<15} {'Latest':<15} {'Status':<10} {'Source'}")
    print("-" * 100)

    for r in results:
        status = "OUTDATED" if r["outdated"] else "OK"
        installed = r["installed"] or "not installed"
        latest = r["latest"] or "unknown"
        source = r["source"].split("/")[0] if "/" in r["source"] else r["source"]
        print(f"{r['name']:<30} {installed:<15} {latest:<15} {status:<10} {source}")

    print(f"\n{len(outdated)} outdated, {len(up_to_date)} up to date")

    if outdated:
        print("\nOutdated packages:")
        for r in outdated:
            print(f"  {r['name']}: {r['installed']} -> {r['latest']}  ({r['source']})")

    return 1 if outdated else 0


if __name__ == "__main__":
    sys.exit(main())

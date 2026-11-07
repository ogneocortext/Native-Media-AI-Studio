#!/usr/bin/env python3
"""
Vendor Script for Chip Emulator Upstreams

Fetches and vendors the exact upstream versions into tools/ directories.
Run this script to update or initialize all upstream sources.

Usage:
    python vendor_chips.py                    # Vendor all cores
    python vendor_chips.py nuked-opn2        # Vendor specific core
    python vendor_chips.py --list            # List tracked cores
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

# Use shared git helper to avoid locale codec issues
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent / "tools"))
from _gitutil import run_git

# Add parent to path for versions module
sys.path.insert(0, str(Path(__file__).parent))
from versions import UPSTREAM_VERSIONS, list_cores

REPO_ROOT = Path(__file__).parent.parent.parent.parent.parent
TOOLS_DIR = REPO_ROOT / "tools"


def run_cmd(cmd: list, cwd: Path = None, capture: bool = True) -> subprocess.CompletedProcess:
    """Run a command and return result."""
    print(f"  $ {' '.join(cmd)}")
    if cmd[0] == "git":
        # Use run_git for git commands to avoid locale codec issues
        stdout = run_git(*cmd[1:], cwd=cwd)
        return subprocess.CompletedProcess(cmd, 0, stdout=stdout, stderr="")
    return subprocess.run(cmd, cwd=cwd, capture_output=capture, check=False, encoding="utf-8", errors="replace")


def vendor_core(core: str, force: bool = False) -> bool:
    """Vendor a single core."""
    if core not in UPSTREAM_VERSIONS:
        print(f"Unknown core: {core}")
        return False
    
    info = UPSTREAM_VERSIONS[core]
    local_path = TOOLS_DIR / info["local_path"]
    repo_url = info["repo"]
    commit = info["commit"]
    
    print(f"\n=== Vendoring {core} ===")
    print(f"  Repo: {repo_url}")
    print(f"  Version: {info['version']} ({commit})")
    print(f"  Target: {local_path}")
    
    # Check if already exists
    if local_path.exists():
        if force:
            print(f"  Removing existing...")
            shutil.rmtree(local_path)
        else:
            print(f"  Already exists, skipping (use --force to update)")
            return True
    
    # Clone repository
    print(f"  Cloning...")
    result = run_cmd(["git", "clone", "--depth", "1", "--branch", commit, repo_url, str(local_path)])
    if result.returncode != 0:
        # Try without branch (maybe tag)
        print(f"  Branch failed, trying as tag/commit...")
        shutil.rmtree(local_path, ignore_errors=True)
        result = run_cmd(["git", "clone", repo_url, str(local_path)])
        if result.returncode != 0:
            print(f"  ERROR: Clone failed")
            return False
        # Checkout specific commit
        result = run_cmd(["git", "checkout", commit], cwd=local_path)
        if result.returncode != 0:
            print(f"  ERROR: Checkout failed")
            return False
    
    print(f"  ✓ Vendored {core} successfully")
    return True


def vendor_all(force: bool = False) -> None:
    """Vendor all cores."""
    print("Vendoring all chip emulator upstreams...")
    success = 0
    failed = 0
    
    for core in list_cores():
        if vendor_core(core, force):
            success += 1
        else:
            failed += 1
    
    print(f"\n=== Summary ===")
    print(f"  Success: {success}")
    print(f"  Failed: {failed}")


def list_tracked() -> None:
    """List all tracked cores."""
    print("Tracked chip emulator cores:")
    for core in list_cores():
        info = UPSTREAM_VERSIONS[core]
        print(f"  {core}:")
        print(f"    Repo: {info['repo']}")
        print(f"    Version: {info['version']}")
        print(f"    Commit: {info['commit']}")
        print(f"    License: {info['license']}")
        print(f"    Path: {info['local_path']}")


def main():
    parser = argparse.ArgumentParser(description="Vendor chip emulator upstreams")
    parser.add_argument("core", nargs="?", help="Specific core to vendor")
    parser.add_argument("--all", action="store_true", help="Vendor all cores")
    parser.add_argument("--force", action="store_true", help="Force update existing")
    parser.add_argument("--list", action="store_true", help="List tracked cores")
    
    args = parser.parse_args()
    
    if args.list:
        list_tracked()
        return
    
    if args.all or not args.core:
        vendor_all(args.force)
    else:
        vendor_core(args.core, args.force)


if __name__ == "__main__":
    main()
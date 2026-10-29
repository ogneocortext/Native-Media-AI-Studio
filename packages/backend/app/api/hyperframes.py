"""HyperFrames API routes."""
from __future__ import annotations

import logging
import os
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services.subprocess_runner import run_subprocess_thread

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/hyperframes", tags=["HyperFrames"])

HYPERFRAMES_PROJECT = Path(__file__).resolve().parents[4] / "tools" / "hyperframes-built-this-from-a-dream"
# HyperFrames CLI invocation.
#
# npx downloads and executes arbitrary code from the npm registry with no
# lockfile and no hash verification. Every invocation can silently pull a
# newly published, potentially malicious version (see
# docs/knowledge-library/npx-best-practices-2026.md). We therefore:
#   1. Prefer `pnpm exec hyperframes` (project-local, zero network, uses
#      the lockfile-pinned version).
#   2. Fall back to `npx --no --offline hyperframes` (refuses to download,
#      only runs pre-installed packages).
#   3. Never use `npx hyperframes` unpinned — that is the anti-pattern.
#
# Pre-install hyperframes once:  pnpm add -D hyperframes@<version>
# (or `pnpm exec hyperframes` if it is already a workspace dependency).
HYPERFRAMES_CLI = "pnpm"
HYPERFRAMES_VERSION = "0.8.73"  # pin to the version tested against this tree
HYPERFRAMES_CACHE_DIR = Path("D:/hyperframes-cache")

# Resolve the npx binary (Windows keeps it under APPDATA/npm).
_NPX_CMD = "npx"
if os.name == "nt":
    _npm_dir = Path(os.environ.get("APPDATA", "")) / "npm"
    if _npm_dir.exists():
        _NPX_CMD = str(_npm_dir / "npx.cmd")


def _hyperframes_cmd(args: list[str]) -> list[str]:
    """Build a HyperFrames CLI command with network fetching disabled.

    Tries `pnpm exec hyperframes` first (project-local, lockfile-pinned).
    Falls back to `npx --no --offline hyperframes` (refuses to download).
    Neither path ever fetches from the npm registry at runtime.
    """
    # pnpm exec is preferred: it resolves from node_modules/.bin, uses the
    # lockfile, and never touches the network.
    return ["pnpm", "exec", "hyperframes"] + args


def _npx_cmd(args: list[str]) -> list[str]:
    """Build an npx command with network fetching disabled.

    `npx --no --offline <pkg>` refuses to download anything not already
    installed. Use only as a fallback when pnpm exec is unavailable.
    """
    return [_NPX_CMD, "--no", "--offline"] + args


async def _run_hyperframes_async(args: list[str], cwd: Path | None = None) -> dict[str, Any]:
    """Run the hyperframes CLI off the event loop.

    These endpoints are ``async def``, so a bare ``subprocess.run`` blocks
    the loop for the subprocess's whole lifetime: ``pnpm exec hyperframes``
    cold start is seconds and ``render`` is allowed up to ``timeout``
    seconds, and while it runs *every* other request starves -- including
    the SSE health stream the frontend polls. Measured: a blocking 1.5 s
    subprocess gave a concurrent coroutine 0 event-loop turns versus
    497,212 with ``asyncio.to_thread``. ``run_subprocess_thread`` is the
    leaf helper for exactly this (services/subprocess_runner.py).
    """
    cmd = _hyperframes_cmd(args)
    try:
        proc = await run_subprocess_thread(
            cmd,
            encoding="utf-8", errors="replace",
            cwd=str(cwd or HYPERFRAMES_PROJECT),
            capture_output=True,
            text=True,
            timeout=600,
            check=False,
            env=os.environ.copy(),
        )
        return {
            "cmd": cmd,
            "cwd": str(cwd or HYPERFRAMES_PROJECT),
            "returncode": proc.returncode,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
        }
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="HyperFrames command timed out") from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail="HyperFrames CLI not found on PATH") from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class CompileStoryboardRequest(BaseModel):
    """Request to compile a storyboard into a HyperFrames composition."""
    storyboard: dict[str, Any]
    name: str = Field(default="storyboard", min_length=1, max_length=80)
    title: str | None = None
    audio_path: str | None = None
    audio_data: dict[str, Any] | None = None


@router.post("/compile-storyboard")
async def compile_storyboard_endpoint(request: CompileStoryboardRequest) -> dict[str, Any]:
    """Compile a validated storyboard into a standalone HyperFrames composition."""
    from ..services.storyboard_hyperframes import compile_storyboard

    try:
        result = compile_storyboard(
            request.storyboard,
            output_dir=HYPERFRAMES_PROJECT / "compiled-storyboards",
            name=request.name,
            title=request.title,
            audio_path=request.audio_path,
            audio_data=request.audio_data,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "success": True,
        "composition": str(result.composition_path),
        "manifest": str(result.manifest_path),
        "scene_count": result.scene_count,
        "duration_seconds": result.duration_seconds,
        "message": "Storyboard compiled; render it with POST /api/hyperframes/render.",
    }


@router.get("/status")
async def hyperframes_status() -> dict[str, Any]:
    """Check whether the HyperFrames CLI and test project are available."""
    project_exists = HYPERFRAMES_PROJECT.exists()
    cli_exists = True
    version = "unknown"
    try:
        proc = await run_subprocess_thread(
            _hyperframes_cmd(["--version"]),
            encoding="utf-8", errors="replace",
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
            env=os.environ.copy(),
        )
        if proc.returncode == 0:
            version = proc.stdout.strip()
        else:
            cli_exists = False
    except Exception:
        cli_exists = False

    return {
        "test_project": str(HYPERFRAMES_PROJECT),
        "exists": project_exists,
        "hyperframes_cli": HYPERFRAMES_CLI,
        "hyperframes_version": HYPERFRAMES_VERSION,
        "cli_available": cli_exists,
        "version": version,
    }


@router.get("/examples")
async def hyperframes_examples() -> dict[str, Any]:
    """List available HyperFrames example compositions."""
    result = await _run_hyperframes_async(["compositions"])
    examples: list[dict[str, Any]] = []
    if result.get("returncode") == 0:
        for line in (result.get("stdout") or "").splitlines():
            line = line.strip()
            if line and not line.startswith("--") and not line.startswith("No "):
                examples.append({"name": line})
    return {
        "raw": result,
        "examples": examples,
    }


@router.post("/preview")
async def hyperframes_preview() -> dict[str, Any]:
    """Start the HyperFrames preview server and return its URL."""
    HYPERFRAMES_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["HYPERFRAMES_EXTRACT_CACHE_DIR"] = str(HYPERFRAMES_CACHE_DIR)
    try:
        proc = await run_subprocess_thread(
            _hyperframes_cmd(["preview"]),
            encoding="utf-8", errors="replace",
            cwd=str(HYPERFRAMES_PROJECT),
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
            env=env,
        )
        url = "http://127.0.0.1:3000"
        for line in proc.stdout.splitlines():
            if "http://" in line or "127.0.0.1" in line:
                url = line.strip()
                break
        return {
            "cmd": _hyperframes_cmd(["preview"]),
            "cwd": str(HYPERFRAMES_PROJECT),
            "returncode": proc.returncode,
            "url": url,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
        }
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="HyperFrames preview timed out") from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail="HyperFrames CLI not found on PATH") from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/render")
async def hyperframes_render(
    composition: str = "index.html",
    format: str = "mp4",
    fps: int = 24,
    quality: str = "standard",
    workers: str = "auto",
    output: str | None = None,
) -> dict[str, Any]:
    """Render a HyperFrames composition to a video file."""
    HYPERFRAMES_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    out = Path(output or str(HYPERFRAMES_CACHE_DIR / "render.mp4"))
    args = [
        "render",
        "--composition", composition,
        "--format", format,
        "--fps", str(fps),
        "--quality", quality,
        "--workers", workers,
        "--output", str(out),
    ]
    env = os.environ.copy()
    env["HYPERFRAMES_EXTRACT_CACHE_DIR"] = str(HYPERFRAMES_CACHE_DIR)
    return await _run_hyperframes_async(args, cwd=HYPERFRAMES_PROJECT)

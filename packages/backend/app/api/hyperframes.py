"""
HyperFrames API routes.
"""
from __future__ import annotations

import logging
import os
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/hyperframes", tags=["HyperFrames"])

HYPERFRAMES_PROJECT = Path(__file__).resolve().parents[4] / "tools" / "hyperframes-built-this-from-a-dream"
HYPERFRAMES_CLI = "npx"
HYPERFRAMES_CACHE_DIR = Path("D:/hyperframes-cache")
NPX_CMD = "npx"
if os.name == "nt":
    _npm_dir = Path(os.environ.get("APPDATA", "")) / "npm"
    if _npm_dir.exists():
        NPX_CMD = str(_npm_dir / "npx.cmd")


def _ensure_npx_on_path(env: dict[str, str] | None = None) -> dict[str, str]:
    _env = dict(env or os.environ)
    if os.name == "nt":
        _npm_dir = Path(os.environ.get("APPDATA", "")) / "npm"
        if _npm_dir.exists():
            _env["PATH"] = str(_npm_dir) + os.pathsep + _env.get("PATH", "")
    return _env


def _run_hyperframes(args: list[str], cwd: Path | None = None) -> dict[str, Any]:
    cmd = [NPX_CMD, "hyperframes"] + args
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd or HYPERFRAMES_PROJECT),
            capture_output=True,
            text=True,
            timeout=600,
            check=False,
            env=_ensure_npx_on_path(),
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


@router.get("/status")
async def hyperframes_status() -> dict[str, Any]:
    project_exists = HYPERFRAMES_PROJECT.exists()
    cli_exists = True
    version = "unknown"
    try:
        proc = subprocess.run(
            [NPX_CMD, "hyperframes", "--version"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
            env=_ensure_npx_on_path(),
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
        "cli_available": cli_exists,
        "version": version,
    }


@router.get("/examples")
async def hyperframes_examples() -> dict[str, Any]:
    result = _run_hyperframes(["compositions"])
    examples: list[dict[str, Any]] = []
    if result.get("returncode") == 0:
        import shlex
        for line in (result.get("stdout") or "").splitlines():
            line = line.strip()
            if line and not line.startswith("—") and not line.startswith("No "):
                examples.append({"name": line})
    return {
        "raw": result,
        "examples": examples,
    }


@router.post("/preview")
async def hyperframes_preview() -> dict[str, Any]:
    HYPERFRAMES_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    env = _ensure_npx_on_path(os.environ.copy())
    env["HYPERFRAMES_EXTRACT_CACHE_DIR"] = str(HYPERFRAMES_CACHE_DIR)
    try:
        proc = subprocess.run(
            [NPX_CMD, "hyperframes", "preview"],
            cwd=str(HYPERFRAMES_PROJECT),
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
            env=env,
        )
        url = "http://localhost:3000"
        for line in proc.stdout.splitlines():
            if "http://" in line or "localhost" in line:
                url = line.strip()
                break
        return {
            "cmd": [NPX_CMD, "hyperframes", "preview"],
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
    env = _ensure_npx_on_path(os.environ.copy())
    env["HYPERFRAMES_EXTRACT_CACHE_DIR"] = str(HYPERFRAMES_CACHE_DIR)
    return _run_hyperframes(args, cwd=HYPERFRAMES_PROJECT)

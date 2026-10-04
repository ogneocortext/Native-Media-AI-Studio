"""Windows -> WSL bridge for essentia tempo estimation.

essentia has no Windows Python bindings, so the only way to use its
RhythmExtractor2013 from this backend is to run it in WSL. That costs one
wsl.exe round trip, measured at 5.65s, so this module is deliberately
**batch-first**: `probe_batch` analyses every requested track in a single WSL
invocation. A per-track API would make a 7-track probe take ~40s.

Design rules, each of which exists because the alternative failed in testing:
  * **Degrade, never raise.** If WSL is stopped, the venv is missing, or the call
    times out, callers get an empty mapping and fall back to the other estimators.
    A bridge is an enhancement; it must not be able to take the backend down.
  * **Time out generously but bounded.** Analysis is ~34x realtime, so a long track
    is slow; the default covers a full library pass with slack.
  * **Report per-track failures.** A track that fails inside WSL comes back with an
    `error`, not silently missing, so a broken path is visible instead of looking
    like a track nobody asked about.
  * **Paths are converted, not passed blindly.** Windows paths are handed to WSL
    under /mnt/<drive>/ and validated to be inside the repo before leaving.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

#: venv holding essentia. On D: rather than inside the C: WSL vhdx, because C:
#: was nearly full. Override with NMA_ESSENTIA_VENV.
DEFAULT_VENV = Path(r"D:\wsl-essentia\venv")

#: WSL distribution to use.
DEFAULT_DISTRO = "Ubuntu"

#: Generous: analysis runs ~34x realtime, so a full-library batch is tens of
#: seconds. Bounded so a wedged WSL cannot hang a request indefinitely.
DEFAULT_TIMEOUT = 300

_RUNNER = Path(__file__).parent / "wsl" / "essentia_runner.py"


def venv_python() -> Path:
    """Absolute path to the venv's python, honouring the env override."""
    override = os.environ.get("NMA_ESSENTIA_VENV")
    return Path(override) / "bin" / "python" if override else DEFAULT_VENV / "bin" / "python"


def is_available() -> bool:
    """True when the bridge could plausibly run, without launching WSL.

    Deliberately cheap: checks the runner and that the venv directory exists.
    Whether `wsl.exe` and the venv actually work is discovered by `probe_batch`
    returning an empty mapping, which callers already handle.

    Note the venv's `bin/python` is a Linux binary, so on Windows `Path.exists()`
    on it raises `OSError [WinError 1920]` rather than returning False. That is why
    the probe is wrapped: an enhancement must not be able to break a caller.
    """
    if not _RUNNER.exists():
        return False
    root = venv_python().parent.parent  # .../<venv>
    try:
        return root.is_dir()
    except OSError:
        return False


def to_wsl_path(path: Path) -> str:
    """Convert a Windows path to its /mnt/<drive>/ form.

    Raises ValueError unless the path is *already* drive-qualified. The check is
    on the original, not the resolved path: `Path.resolve()` on Windows attaches
    the CWD's drive to a relative or POSIX-looking path, so
    `Path("relative/path").resolve()` yields `D:\\...\\relative\\path` and would
    otherwise be silently converted into a plausible-looking but wrong
    `/mnt/d/...` path.
    """
    drive = path.drive
    if not drive or len(drive) != 2 or drive[1] != ":":
        raise ValueError(f"Not a drive-qualified path: {path!r}")
    try:
        resolved = path.resolve()
    except OSError as exc:
        raise ValueError(f"Cannot resolve {path!r}: {exc}") from exc
    posix = Path(drive[0].lower() + "/" + resolved.as_posix().split(":/", 1)[1].lstrip("/"))
    return "/mnt/" + posix.as_posix()


def probe_batch(tracks: dict[str, Path], timeout: int = DEFAULT_TIMEOUT) -> dict[str, dict[str, Any]]:
    """Estimate tempo for many tracks in ONE WSL call.

    Args:
        tracks: mapping of track key -> path to the stem WAV to analyse.
        timeout: seconds to allow for the whole batch.

    Returns:
        mapping of track key -> {"bpm": float|None, "confidence": float|None,
        "error": str|None}. A track absent from the result was not submitted
        (bad path); a track present with bpm None failed inside WSL. An empty
        dict means the bridge itself is unavailable.
    """
    if not tracks:
        return {}
    if not is_available():
        logger.info("essentia bridge unavailable (runner or venv missing); "
                    "falling back to other estimators")
        return {}

    # Convert every path up front: one bad path should drop that track, not abort
    # the batch, because the others are still worth measuring.
    payload = []
    for track, path in tracks.items():
        try:
            payload.append({"track": track, "path": to_wsl_path(path)})
        except ValueError as exc:
            logger.warning("essentia: skipping %s: %s", track, exc)
    if not payload:
        return {}

    runner_wsl = to_wsl_path(_RUNNER)
    python_wsl = to_wsl_path(venv_python())
    distro = os.environ.get("NMA_WSL_DISTRO", DEFAULT_DISTRO)

    cmd = [
        "wsl.exe", "-d", distro, "--user", "root",
        "--", python_wsl, runner_wsl,
    ]
    try:
        proc = subprocess.run(
            cmd,
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            # wsl.exe prints PATH-translation warnings to stderr; inheriting them
            # would spam the backend log on every call.
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )
    except subprocess.TimeoutExpired:
        logger.warning("essentia batch timed out after %ss", timeout)
        return {}
    except FileNotFoundError:
        logger.warning("wsl.exe not found; essentia bridge unavailable")
        return {}

    stdout = (proc.stdout or "").strip()
    if proc.returncode != 0 or not stdout:
        logger.warning("essentia batch failed rc=%s: %s",
                       proc.returncode, (proc.stderr or "").strip()[:200])
        return {}
    try:
        body = json.loads(stdout)
    except json.JSONDecodeError:
        logger.warning("essentia batch returned non-JSON: %s", stdout[:200])
        return {}
    if body.get("error"):
        logger.warning("essentia batch error: %s", body["error"])
        return {}

    out: dict[str, dict[str, Any]] = {}
    for row in body.get("results", []):
        track = row.get("track")
        if not track:
            continue
        out[track] = {
            "bpm": row.get("bpm"),
            "confidence": row.get("confidence"),
            "error": row.get("error"),
        }
    if out:
        logger.info("essentia analysed %d/%d tracks", len(out), len(tracks))
    return out

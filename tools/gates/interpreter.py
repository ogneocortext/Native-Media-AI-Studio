"""Python/pnpm interpreter resolution and probing for gate runs.

Discovers a working backend interpreter (verified by actually running ruff
and pytest probes, not by inspecting installed packages) and resolves the
pnpm shim. Results are cached under %TEMP% with a TTL.
"""

import functools
import glob
import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

# Candidate interpreters, best first. Order encodes policy, not age:
#
#   1. $NMA_PYTHON                      explicit operator override, always wins
#   2. nma-studio-cuda                  the project env (AGENTS.md: backend + GPU)
#   3. any D:\conda-envs\* with deps     a working sibling env beats a broken one
#   4. python on PATH                   last resort
#
# Crucially, "having the packages installed" is NOT the same as "working": an
# interpreter can import fastapi and still fail the suite, so every candidate
# is verified by running the gates' own tooling, not by inspection.
ENV_GLOBS = [
    r"D:\conda-envs\*\Scripts\python.exe",
    r"D:\conda-envs\*\python.exe",
    r"C:\Python3*\python.exe",
]

PROJECT_ENV = r"D:\conda-envs\nma-studio-cuda\Scripts\python.exe"

# The probe-cache file. Schema 2 adds "ts" (epoch seconds of the last full
# verification) so the TTL knows when to re-probe; a schema-1 file (path only)
# reads as "no timestamp" and is treated as stale.
_CACHE_VERSION = 2
_PROBE_TTL_S = 900.0  # overridden by $NMA_PROBE_TTL


def _probe_ttl() -> float:
    raw = os.environ.get("NMA_PROBE_TTL", "")
    try:
        ttl = float(raw)
        if ttl >= 0:
            return ttl
    except ValueError:
        pass
    return _PROBE_TTL_S


def _cache_path() -> Path:
    return Path(tempfile.gettempdir()) / "nma-studio-python-choice.json"


def read_cache() -> tuple[str | None, float | None]:
    """(python_path, ts) from the cache file; (None, None) if unusable."""
    try:
        data = json.loads(_cache_path().read_text("utf-8"))
        return data.get("python"), data.get("ts")
    except Exception:
        return None, None


def write_cache(python: str) -> None:
    """Persist the chosen interpreter path with a timestamp (best-effort)."""
    try:
        _cache_path().write_text(
            json.dumps({"python": python, "ts": time.time(),
                        "schema": _CACHE_VERSION}), "utf-8")
    except OSError:
        pass


# Sentinels standing in for the lazily-resolved tools in gate argvs.
# Gates are declared before (and whether or not) the tools are resolved:
# `--only unit` must not cost a Python resolution, so argvs that would need
# an interpreter are only materialised when their lane actually runs.
# PY -> resolved backend interpreter, PNPM -> resolved pnpm shim.
PY = "__PY__LACEHOLDER__"
PNPM = "__PNPM__PLACEHOLDER__"


def resolve_pnpm() -> str:
    """Prefer pnpm.cmd on PATH; fall back to the npm global shim location.

    Cached for the process lifetime: PATH lookup is cheap but there is no
    reason to repeat it on every call within a single run.
    """
    if shutil.which("pnpm.cmd"):
        return shutil.which("pnpm.cmd")
    if shutil.which("pnpm"):
        return shutil.which("pnpm")
    guess = Path(os.environ.get("APPDATA", "")) / "npm" / "pnpm.cmd"
    return str(guess) if guess.exists() else "pnpm"


# ---- Python interpreter resolution ----

def _read_python_env() -> dict:
    """Parse the repo-root .python-env declaration (KEY=VALUE).

    .python-env is the declared source of truth for which
    interpreter each tier uses (PYTHON_ENV, COMFYUI_ENV,
    TOOLS_ENV, FALLBACK_VENV). The PowerShell launchers read it
    via shared-utils.ps1; this runner reads it directly so both
    selection layers agree on the project env instead of each
    hardcoding a path that can drift from the declaration.
    """
    cfg: dict = {}
    try:
        for line in (Path(__file__).resolve().parent.parent.parent / ".python-env").read_text(
            "utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            key, _, value = line.partition("=")
            key, value = key.strip(), value.strip().strip('"').strip("'")
            if key:
                cfg[key] = value
    except OSError:
        pass
    return cfg


def candidate_list() -> list[str]:
    """Every interpreter that could run the backend gates, in
    preference order.

    $NMA_PYTHON is handled by the caller (it always wins and is
    reported separately). Then: the declared project env
    (.python-env PYTHON_ENV), the conda/system globs, the
    documented CPU-only fallback venv (.python-env
    FALLBACK_VENV), and finally python on PATH.
    """
    cfg = _read_python_env()
    candidates: list[str] = []

    def add(path: str | None) -> None:
        # Dedupe case-insensitively: on Windows glob can return
        # both python.exe and python.EXE, and listing each twice
        # is noise.
        if path and path.lower() not in {c.lower() for c in candidates}:
            candidates.append(path)

    declared = cfg.get("PYTHON_ENV") or PROJECT_ENV
    if Path(declared).exists():
        add(declared)
    for pattern in ENV_GLOBS:
        for hit in sorted(glob.glob(pattern)):
            add(hit)
    venv_rel = cfg.get("FALLBACK_VENV") or "venv/Scripts/python.exe"
    venv_path = Path(venv_rel)
    if not venv_path.is_absolute():
        venv_path = Path(__file__).resolve().parent.parent.parent / venv_rel
    if venv_path.exists():
        add(str(venv_path))
    add(shutil.which("python"))
    return candidates


def _probe_once(python: str, argv: list[str], cwd: str, timeout: int = 30) -> str:
    """Run one probe; return "pass" | "fail" | "timeout".

    "timeout" is NOT "fail": under probed-in-parallel contention a healthy
    env can miss the bound. Rejections must be earned by a real non-zero
    exit, never by a crowded clock.
    """
    try:
        proc = subprocess.Popen(
            [python] + argv, cwd=cwd,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
        try:
            proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            _kill_tree(proc)
            return "timeout"
        return "pass" if proc.returncode == 0 else "fail"
    except OSError:
        return "fail"


def _probe_ok(python: str, argv: list[str], cwd: str, timeout: int = 30) -> bool:
    """True if argv runs clean under this interpreter.

    Bounded: a candidate that hangs must not hang resolution with it.
    On timeout the whole process tree is killed so a wedged ruff/pytest
    worker cannot hold a file lock and hang the next candidate's probe.
    """
    return _probe_once(python, argv, cwd, timeout) == "pass"


@functools.lru_cache(maxsize=1)
def _probe_argv() -> list[str]:
    """The gate used to decide whether an interpreter is usable.

    ruff on a single small file is the cheapest honest test available: it
    exits 0 only if the interpreter starts and can import its own tooling.
    """
    return ["-m", "ruff", "check", "app/__init__.py", "--output-format=concise"]


@functools.lru_cache(maxsize=1)
def _pytest_probe_argv() -> list[str] | None:
    """A real pytest run, used as an interpreter probe.

    Cheaper probes lie on this machine: Python 3.14 passes `ruff
    check` and `pytest --version` yet fails the suite with
    PermissionError while expiring pytest's numbered temp dirs -
    after every test has passed, so the run looks green right up
    until the exit code. Only an actual run exercises that path,
    so the probe runs the smallest test file that uses tmp_path:
    hermetic, fast, and it drives the same temp machinery the
    real gate does. Returns None when no such file exists.

    Memoised: it stats and reads every backend test file to pick
    the smallest, and both resolve_python and --which-python ask
    for it - the scan should happen once per process.
    """
    from .gates import BACKEND  # circular import avoided by local import

    best = None
    for path in glob.glob(str(BACKEND / "tests" / "test_*.py")):
        try:
            text = Path(path).read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if "tmp_path" not in text:
            continue
        if best is None or os.path.getsize(path) < os.path.getsize(best):
            best = path
    if best is None:
        return None
    return ["-m", "pytest", "-q", "-p", "no:cacheprovider",
            "--tb=no", best]


def _probes() -> tuple:
    """Every probe a candidate must pass to run the backend gates.

    Returns (argv, timeout) pairs. Candidates are probed concurrently,
    so one slow env does not pay its timeout into every other candidate's
    wall time.
    """
    pairs = [(_probe_argv(), 15)]
    pytest_argv = _pytest_probe_argv()
    if pytest_argv:
        pairs.append((pytest_argv, 30))
    return tuple(pairs)


def _kill_tree(proc, grace: float = 2.0) -> None:
    """Kill the child and anything it spawned, gracefully when possible.

    Sends taskkill /T first, waits up to ``grace`` seconds, then
    hard-kills whatever is still alive.
    """
    try:
        # taskkill sends TERM by default on Windows; /T kills the tree.
        subprocess.run(["taskkill", "/T", "/PID", str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        pass
    try:
        proc.wait(timeout=grace)
        return  # exited cleanly on TERM
    except subprocess.TimeoutExpired:
        pass
    try:
        proc.kill()  # SIGKILL escalation
    except OSError:
        pass
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass


def _probe_candidate(cand: str, probes: tuple, cwd: str,
                     collect: dict | None = None) -> str:
    """Run every probe against one candidate; record + return the result.

    Returns "pass", "fail" or "timeout" (worst probe result wins). Under
    contention a healthy candidate can hit the timeout — that means
    "unproven", not "broken".
    """
    worst = "pass"
    for argv, t in probes:
        result = _probe_once(cand, argv, cwd, t)
        if result == "fail":
            worst = "fail"
        elif result == "timeout" and worst != "fail":
            worst = "timeout"
    if collect is not None:
        collect[cand] = worst == "pass"
    return worst


def _describe(python: str) -> str:
    """Short 'path (3.11.9)' label for log lines.

    Bounded with a timeout: a wedged interpreter must not hang
    interpreter resolution here.
    """
    try:
        p = subprocess.run(
            [python, "-c", "import sys;print('.'.join(map(str,sys.version_info[:3])))"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10)
        ver = p.stdout.decode("utf-8", "replace").strip()
        return f"{python} ({ver})" if ver else python
    except (OSError, subprocess.TimeoutExpired):
        return python


# ROOT is set by gates module; imported here lazily to avoid circular import.
def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def resolve_python(cwd=None, *, quiet: bool = False,
                   collect: dict | None = None,
                   allow_cached: bool = True):
    """Return an interpreter that can actually run the backend gates.

    Cached fast path: if the cache holds a winner verified within the
    TTL ($NMA_PROBE_TTL, default 15 min), return it after a cheap
    existence check.

    Cold path: candidates are probed first alone (the declared project
    env — the likely winner, uncontended), then in batches of two;
    anything that timed out under contention gets one serial,
    uncontended re-probe before falling back.

    Threads are the correct primitive here — the work is blocking
    subprocess waits.
    """
    from .gates import BACKEND

    def say(msg: str) -> None:
        if not quiet:
            print(msg)

    override = os.environ.get("NMA_PYTHON")
    if override:
        if not Path(override).exists():
            say(f"NMA_PYTHON={override} does not exist; ignoring")
        else:
            ok = _probe_candidate(override, _probes(), cwd or str(BACKEND), collect)
            if not ok:
                say(f"WARNING: NMA_PYTHON={override} failed the verification probes")
            return override

    candidates = candidate_list()
    probes = _probes()

    cached, ts = read_cache()
    if (allow_cached and cached and ts and Path(cached).exists()
            and time.time() - ts < _probe_ttl()):
        return cached

    # Try the remembered candidate first, but only if it still exists.
    order = list(candidates)
    if cached and Path(cached).exists() and cached not in order:
        order.insert(0, cached)

    rejected, winner = [], None
    status: dict[str, str] = {}  # cand -> "pass" | "fail" | "timeout"

    def probe_group(group: list[str]) -> None:
        if len(group) == 1:
            status[group[0]] = _probe_candidate(
                group[0], probes, cwd or str(BACKEND), collect)
            return
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=len(group)) as pool:
            futures = {
                cand: pool.submit(
                    _probe_candidate, cand, probes, cwd or str(BACKEND), collect)
                for cand in group
            }
        for cand in group:
            status[cand] = futures[cand].result()

    # The declared project env is probed FIRST and ALONE: it is the most
    # likely winner, and probing it uncontended gives an honest result.
    if order:
        probe_group([order[0]])
        if status[order[0]] == "pass":
            winner = order[0]
        else:
            rejected.append(order[0])
    if winner is None:
        rest = order[1:]
        for i in range(0, len(rest), 2):
            batch = rest[i:i + 2]
            probe_group(batch)
            for cand in batch:
                if status[cand] == "pass":
                    winner = cand
                    break
                rejected.append(cand)
            if winner:
                break
    # A timed-out probe proves nothing. One serial, uncontended re-probe of
    # everything that timed out, before falling back.
    if winner is None:
        timed_out = [c for c in order if status.get(c) == "timeout"]
        for cand in timed_out:
            if _probe_candidate(cand, probes, cwd or str(BACKEND), collect) == "pass":
                winner = cand
                break

    if winner:
        write_cache(winner)
        if rejected or not candidates or winner != candidates[0]:
            say(f"interpreter: {_describe(winner)}")
            if rejected and len(rejected) < len(order):
                say("  rejected: {}".format(", ".join(rejected)))
        return winner

    # Nothing verified. Fall back to the project env and let the gate
    # report the real error, rather than dying here with a confusing message.
    say("WARNING: no interpreter passed the ruff probe; falling back.")
    if rejected:
        say("  failed: {}".format(", ".join(
            c for c, s in status.items() if s == "fail")))
    on_path = shutil.which("python")
    return PROJECT_ENV if Path(PROJECT_ENV).exists() else (on_path or "python")

# ruff: noqa: N999
"""Run every quality gate for the repository in one command.

Each gate is a separate tool with a separate working directory, and on Windows
none of them can be trusted through the PowerShell `.ps1` wrappers: `pnpm`
reports exit 1 while passing, and a non-zero exit from one gate tells you
nothing about whether a later one ran. This runner owns that problem once,
here, so neither a person nor an agent has to hand-assemble a pipeline of
temp scripts (the `subprocess` calls must also decode explicitly as UTF-8 —
Python decodes pipes with the ANSI code page otherwise and dies on em dashes).

Gates, cheapest-first so a fast failure surfaces early:

  docs      check-all.py (8 required checkers; report-only ones behind -v)
  ruff      repo lint                          repo
  arch      import cycles / layer inversions   repo
  routes    duplicate route handlers           repo
  type      tsc -b + test config               packages/frontend
  lint      eslint                            packages/frontend
  unit      vitest (pure logic)                packages/frontend
  pytest    backend suite                      packages/backend
  tools-pytest  tools' own unit tests          tools
  build     vite build                         packages/frontend
  e2e       Playwright (opt-in, --e2e)        packages/frontend

Execution is two concurrent *lanes*, not one serial chain: the Python-only
gates (docs, ruff, arch, routes, pytest, tools-pytest) and the Node-only
gates (type, lint, unit, build, e2e) share no resources, and the streaming
output is already prefixed per gate (`[name]`), so interleaving is readable.
Within a lane gates stay serial: vitest, the Playwright server and pytest
each assume they own their working tree, and cross-lane port/file-lock
collisions are the failure mode this avoids. Wall time is bounded by the
slower lane instead of the sum of every gate. `--serial` reverts to the
old one-lane-at-a-time behavior.

Interpreter and pnpm resolution is lazy and lane-scoped: a `--only unit`
run (pure Node lane) never touches Python, and a `--only ruff` run never
touches pnpm. A pure-Node run also skips interpreter verification entirely —
Python is verified only when a Python gate is about to run.

Tools are resolved at runtime, never hardcoded - see resolve_python().
A candidate counts as "usable" only if it passes every probe in
_probes(): a real ruff run AND a real pytest run. Set NMA_PYTHON
to force a specific interpreter. The project env is read from
.python-env (PYTHON_ENV), and the documented CPU-only fallback
venv (FALLBACK_VENV) is a candidate too - it can run the gates
even when it cannot run the server.

Probe caching: the winning interpreter is cached with a TTL
(%TEMP%/nma-studio-python-choice.json, env NMA_PROBE_TTL, default 900 s).
Inside the TTL the cached candidate is returned after a cheap existence
check — the full probe previously ran on every invocation and its cost
(real pytest startup importing the backend conftest) preceded gate 1 and
sat outside every timing report. NMA_PYTHON overrides and --which-python
always re-probe: the override is the operator's explicit request to check,
and --which-python exists to diagnose.

Exit 0 = all selected gates passed, 1 = at least one failed.
The e2e gate is opt-in because it starts a Vite dev server and needs a browser.
"""

import argparse
import functools
import glob
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "packages" / "backend"
FRONTEND = ROOT / "packages" / "frontend"
TOOLS = ROOT / "tools"

# Sentinels standing in for the lazily-resolved tools in gate argvs.
# Gates are declared before (and whether or not) the tools are resolved:
# `--only unit` must not cost a Python resolution, so argvs that would need
# an interpreter are only materialised when their lane actually runs.
# PY -> resolved backend interpreter, PNPM -> resolved pnpm shim.
PY = "__PY__LACEHOLDER__"
PNPM = "__PNPM__PLACEHOLDER__"


# fnm-installed pnpm. Using pnpm.cmd rather than the .ps1 wrapper is deliberate:
# the wrapper writes to stderr and swallows the child's exit status, which is
# exactly the "passed but reported as failed" problem this script exists to fix.
#
# PNPM itself is resolved dynamically - see resolve_pnpm(). A hardcoded path here
# would go stale the moment pnpm is reinstalled, and would silently pin agents
# to whatever version happened to be current on one afternoon.
def resolve_pnpm():
    """Prefer pnpm.cmd on PATH; fall back to the npm global shim location."""
    if shutil.which("pnpm.cmd"):
        return shutil.which("pnpm.cmd")
    if shutil.which("pnpm"):
        return shutil.which("pnpm")
    guess = Path(os.environ.get("APPDATA", "")) / "npm" / "pnpm.cmd"
    return str(guess) if guess.exists() else "pnpm"


# Candidate interpreters, best first. Order encodes policy, not age:
#
#   1. $NMA_PYTHON                      explicit operator override, always wins
#   2. nma-studio-cuda                  the project env (AGENTS.md: backend + GPU)
#   3. any D:\conda-envs\* with deps     a working sibling env beats a broken one
#   4. python on PATH                   last resort
#
# Crucially, "having the packages installed" is NOT the same as "working": an
# interpreter can import fastapi and still fail the suite (see resolve_python),
# so every candidate is verified by running the gates' own tooling, not by
# inspection. Measured on this machine: C:\Python314 passes `ruff check`
# and `pytest --version` yet fails a real pytest run (PermissionError while
# expiring pytest's numbered temp dirs under Python 3.14), and the foreign
# space-analyzer-cuda env passes ruff but has neither fastapi nor
# pytest_asyncio. Both must be rejected, which only the probes below do.
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


def _probe_ttl():
    raw = os.environ.get("NMA_PROBE_TTL", "")
    try:
        ttl = float(raw)
        if ttl >= 0:
            return ttl
    except ValueError:
        pass
    return _PROBE_TTL_S


def _cache_path():
    return Path(tempfile.gettempdir()) / "nma-studio-python-choice.json"


def _read_cache():
    """(python_path, ts) from the cache file; (None, None) if unusable."""
    try:
        data = json.loads(_cache_path().read_text("utf-8"))
        return data.get("python"), data.get("ts")
    except Exception:
        return None, None


def _write_cache(python):
    try:
        _cache_path().write_text(
            json.dumps({"python": python, "ts": time.time(),
                        "schema": _CACHE_VERSION}), "utf-8")
    except OSError:
        pass


def _read_python_env():
    """Parse the repo-root .python-env declaration (KEY=VALUE).

    .python-env is the declared source of truth for which
    interpreter each tier uses (PYTHON_ENV, COMFYUI_ENV,
    TOOLS_ENV, FALLBACK_VENV). The PowerShell launchers read it
    via shared-utils.ps1; this runner reads it directly so both
    selection layers agree on the project env instead of each
    hardcoding a path that can drift from the declaration.
    """
    cfg = {}
    try:
        for line in (ROOT / ".python-env").read_text(
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


def _candidate_list():
    """Every interpreter that could run the backend gates, in
    preference order.

    $NMA_PYTHON is handled by the caller (it always wins and is
    reported separately). Then: the declared project env
    (.python-env PYTHON_ENV), the conda/system globs, the
    documented CPU-only fallback venv (.python-env
    FALLBACK_VENV), and finally python on PATH. The venv tier
    was invisible to this resolver before - a machine with a
    working venv but broken conda envs fell through to a broken
    PATH python instead of trying the tier the docs promise.
    """
    cfg = _read_python_env()
    candidates = []

    def add(path):
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
        venv_path = ROOT / venv_path
    if venv_path.exists():
        add(str(venv_path))
    add(shutil.which("python"))
    return candidates


def _probe_once(python, argv, cwd, timeout=30):
    """Run one probe; return "pass" | "fail" | "timeout".

    "timeout" is NOT "fail": under probed-in-parallel contention a healthy
    env can miss the bound (measured: six sibling envs probed concurrently
    timed the correct project env out while alone-time it passes). Rejections
    must be earned by a real non-zero exit, never by a crowded clock.
    """
    try:
        proc = subprocess.Popen(
            [python] + argv, cwd=str(cwd),
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


def _probe_ok(python, argv, cwd, timeout=30):
    """True if argv runs clean under this interpreter.

    Bounded: a candidate that hangs (a wedged interpreter, a prompt
    waiting on stdin) must not hang resolution with it. On timeout the
    whole process tree is killed so a wedged ruff/pytest worker cannot
    hold a file lock and hang the next candidate's probe.
    """
    return _probe_once(python, argv, cwd, timeout) == "pass"


@functools.lru_cache(maxsize=1)
def _probe_argv():
    """The gate used to decide whether an interpreter is usable.

    ruff on a single small file is the cheapest honest test available: it exits
    0 only if the interpreter starts and can import its own tooling. Checking
    the whole tree here is unnecessary (the ruff gate does that separately) and
    on a large tree can eat most of the probe timeout per candidate, making
    interpreter selection look like a hang.
    """
    return ["-m", "ruff", "check", "app/__init__.py", "--output-format=concise"]


@functools.lru_cache(maxsize=1)
def _pytest_probe_argv():
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


@functools.lru_cache(maxsize=1)
def _probes():
    """Every probe a candidate must pass to run the backend gates.

    Returns (argv, timeout) pairs: the pytest probe inherits the
    backend conftest (`from app.main import app`), so its honest cost
    is real pytest startup importing the app — the 30 s bound matches
    the D33 decision, and candidates are probed *concurrently*
    (resolve_python), so one slow env does not pay its timeout into
    every other candidate's wall time.

    A tuple so the cached value cannot be mutated by a caller.
    """
    pairs = [(_probe_argv(), 15)]
    pytest_argv = _pytest_probe_argv()
    if pytest_argv:
        pairs.append((pytest_argv, 30))
    return tuple(pairs)


def _probe_candidate(cand, probes, cwd, collect=None):
    """Run every probe against one candidate; record + return the result.

    Returns "pass", "fail" or "timeout" (worst probe result wins). Under
    contention a healthy candidate can hit the timeout — that means
    "unproven", not "broken"; resolve_python re-probes timeouts once,
    uncontended, before falling back.
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


def _describe(python):
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


def resolve_python(cwd=BACKEND, quiet=False, collect=None, allow_cached=True):
    """Return an interpreter that can actually run the backend gates.

    Cached fast path: if the cache holds a winner verified within the
    TTL ($NMA_PROBE_TTL, default 15 min), return it after a cheap
    existence check. This is the one respect in which the cache *is* a
    shortcut: the TTL bounds how stale the trust is, `--which-python`
    or NMA_PROBE_TTL=0 forces the full verification, and a broken
    (un-installed) env is still caught by the existence check.
    Outside the TTL, the cached candidate is probed like any other, so
    a repaired or newly-broken env is picked up with no cache clearing.

    Cold path: candidates are probed first alone (the declared project
    env — the likely winner, uncontended), then in batches of two;
    anything that TIMED OUT under contention gets one serial,
    uncontended re-probe before the runner falls back, because a probe
    timeout proves nothing about the env.

    Threads are the correct primitive here — the work is blocking
    subprocess waits, and ProcessPoolExecutor is fragile under Windows'
    spawn start method. Preference order still decides the winner.

    Probe concurrence and pytest's temp machinery are compatible: each
    process creates its own numbered temp root, and the fallback
    basetemp (.pytest_tmp) is repo-local. A candidate that dies from
    contention is treated as rejected, and the candidate ordering puts
    the project env first, so the winner is unaffected.

    If `collect` is a dict, every candidate actually probed is recorded
    in it as {path: passed} - so a caller (--which-python) reports the
    same result without paying for a second round of probes.
    """
    def say(msg):
        if not quiet:
            print(msg)

    override = os.environ.get("NMA_PYTHON")
    if override:
        if not Path(override).exists():
            say(f"NMA_PYTHON={override} does not exist; ignoring")
        else:
            # An explicit override always wins, but a broken one
            # used to be returned silently and then fail confusingly
            # at the gate. Surface it while still honoring the
            # operator's intent. Overrides never take the TTL fast
            # path: setting the override is a request to verify.
            ok = _probe_candidate(override, _probes(), cwd, collect)
            if not ok:
                say(f"WARNING: NMA_PYTHON={override} failed the verification probes")
            return override

    candidates = _candidate_list()
    probes = _probes()

    cached, ts = _read_cache()
    if (allow_cached and cached and ts and Path(cached).exists()
            and time.time() - ts < _probe_ttl()):
        return cached

    # Try the remembered candidate first, but only if it still exists. It is
    # verified exactly like a cold candidate, so a broken env is rejected.
    order = list(candidates)
    if cached and Path(cached).exists() and cached not in order:
        order.insert(0, cached)

    rejected, winner = [], None
    status = {}  # cand -> "pass" | "fail" | "timeout", in probe order

    def probe_group(group):
        if len(group) == 1:
            status[group[0]] = _probe_candidate(group[0], probes, cwd, collect)
            return
        with ThreadPoolExecutor(max_workers=len(group)) as pool:
            futures = {
                cand: pool.submit(
                    _probe_candidate, cand, probes, cwd, collect)
                for cand in group
            }
        for cand in group:
            status[cand] = futures[cand].result()

    # The declared project env is probed FIRST and ALONE: it is the most
    # likely winner (policy: AGENTS.md), and probing it uncontended gives an
    # honest result instead of a contended one. Higher concurrency is only
    # bought for the contenders.
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
    # everything that timed out, before falling back — this is where the
    # false-rejected project env gets its honest second chance.
    if winner is None:
        timed_out = [c for c in order if status.get(c) == "timeout"]
        for cand in timed_out:
            if _probe_candidate(cand, probes, cwd, collect) == "pass":
                winner = cand
                break

    if winner:
        _write_cache(winner)
        if rejected or not candidates or winner != candidates[0]:
            say(f"interpreter: {_describe(winner)}")
            if rejected and len(rejected) < len(order):
                say("  rejected: {}".format(", ".join(rejected)))
        return winner

    # Nothing verified. Fall back to the project env and let the gate report the
    # real error, rather than dying here with a confusing message.
    say("WARNING: no interpreter passed the ruff probe; falling back.")
    if rejected:
        say("  failed: {}".format(", ".join(
            c for c, s in status.items() if s == "fail")))
    on_path = shutil.which("python")
    return PROJECT_ENV if Path(PROJECT_ENV).exists() else (on_path or "python")


class Gate:
    def __init__(self, name, argv, cwd, optional=False, timeout=300, lane="py"):
        self.name = name
        self.argv = argv
        self.cwd = cwd
        self.optional = optional
        self.timeout = timeout
        # "py" gates run only on the resolved interpreter, "node" gates only
        # on the resolved pnpm. Lanes execute concurrently; see gates().
        self.lane = lane


def gates(fix=False, verbose=False):
    """The gate table, cheapest-first within each lane.

    Two concurrently-executed lanes:
      - py:   docs, ruff, arch, routes, pytest, tools-pytest
      - node: type, lint, unit, build, e2e

    `unit` intentionally runs before `build` in its lane: a vitest
    failure should not be discovered after a full 600 s vite build.
    `tsc -b` runs in both the type and build gates (package.json) but
    TS incremental state makes the second one cheap.
    With --fix, ruff and eslint self-correct in place before reporting.
    """
    docs_extra = ["-v"] if verbose else []
    ruff_argv = ([PY, "-m", "ruff", "check", ".", "--output-format=concise"]
                 + (["--fix"] if fix else []))
    lint_argv = ([PNPM, "exec", "eslint", "--fix", "src"] if fix
                 else [PNPM, "lint"])
    return [
        Gate("docs", [PY, "tools/check-all.py"] + docs_extra, ROOT),
        Gate("ruff", ruff_argv, ROOT),
        Gate("arch", [PY, "tools/check-import-cycles.py"], ROOT),
        Gate("routes", [PY, "tools/check-duplicate-routes.py"], ROOT),
        Gate("type", [PNPM, "type-check"], FRONTEND, lane="node"),
        Gate("lint", lint_argv, FRONTEND, lane="node"),
        # `-v --durations=10` rather than `-q`: the runner streams each line as
        # it is produced, so a verbose reporter is what makes "which test is
        # running right now" visible. `--durations=10` then names the ten
        # slowest tests, which is where optimization effort is most valuable.
        Gate("pytest", [PY, "-m", "pytest", "-v", "--durations=10",
                        "-p", "no:cacheprovider"], BACKEND),
        # The tools' own unit tests. The knowledge-library link parser is
        # shared by three tools, and a silent divergence in it is invisible
        # until something reports the wrong number — so it is guarded here.
        # Only `tools/tests/unit` is collected: the rest of tools/tests holds
        # live scripts (MCP stdio, demucs, GPU) that block and are not
        # gate-safe.
        Gate("tools-pytest", [PY, "-m", "pytest", "-v",
                              "-p", "no:cacheprovider", "tests/unit"], TOOLS),
        # `--reporter=verbose` names every test file as it runs. The vitest
        # config's default reporter is "dot" under CI, which prints one
        # character per file and no names at all.
        Gate("unit", [PNPM, "exec", "vitest", "run", "--reporter=verbose"],
             FRONTEND, lane="node"),
        Gate("build", [PNPM, "build"], FRONTEND, timeout=600, lane="node"),
        Gate("e2e", [PNPM, "exec", "playwright", "test",
                     "app-shell.spec.ts", "canvas2d.spec.ts",
                     "lrc-visualizer.spec.ts", "--reporter=list"],
             FRONTEND, optional=True, timeout=900, lane="node"),
    ]


def _materialize(argv, python, pnpm):
    """Replace the PY/PNPM sentinels with the resolved tool paths."""
    return [python if a == PY else (pnpm if a == PNPM else a) for a in argv]


# ANSI escape sequences (SGR colours, cursor moves) as emitted by vitest and
# pytest. Stripped from the streamed copy only: the raw text is kept for the
# JSON report, where escape codes would just be noise for a JSON consumer.
_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07")


def _strip_ansi(text: str) -> str:
    """Remove ANSI escape sequences from `text`."""
    return _ANSI_RE.sub("", text)


def _heartbeat(stop_event: threading.Event, label: str, interval: float = 10.0):
    """Print a heartbeat to stderr every `interval` seconds while a gate runs.

    Gives operators feedback that a long gate (e.g. pytest at ~60s) is still
    alive and not wedged. Runs on a daemon thread so it never blocks exit.

    The message names the gate and the elapsed time, because "a dot appeared"
    does not say *which* gate is stuck. With several gates in a row that
    distinction is the difference between a 10-second wait and a diagnosis.
    """
    start = time.time()
    while not stop_event.is_set():
        stop_event.wait(interval)
        if not stop_event.is_set():
            elapsed = int(time.time() - start)
            print(f"[{label} {elapsed}s] still running...",
                  file=sys.stderr, flush=True)


def run_gate(gate, argv, timeout, heartbeat=True, stream=True, out_file=None):
    """Run one gate. Never raises: a hung gate is reported, not inherited.

    The timeout matters more than it looks. A gate that hangs (pytest blocking
    on a locked %TEMP% pointer, a browser that never exits) otherwise hangs the
    agent too, with no output and no way to tell a slow gate from a dead one.

    Output is streamed line by line while the gate runs, so the caller can see
    *which* test is executing at the moment it is executing. The previous
    implementation used proc.communicate(), which buffers the entire output
    and returns it only at the end - for a 90-second pytest run that means
    zero visibility for 90 seconds, which is exactly when you want to know
    whether the suite is progressing or wedged on one test.

    Streaming needs a reader thread plus a deadline-aware queue: reading
    `for line in proc.stdout` on the main thread blocks forever if the child
    goes silent, which would defeat the timeout entirely (proc.wait() would
    never be reached). The queue wakes the main loop on the deadline so the
    process tree can be killed instead.

    `argv` is the materialised command (see _materialize) so a gate can be
    declared before its tool is resolved. When `stream` is False the output
    is buffered and returned as before, and `out_file` diverts the streamed
    lines to a file instead of stdout.
    """
    start = time.time()
    try:
        proc = subprocess.Popen(
            argv, cwd=str(gate.cwd),
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
    except OSError as e:
        return 1, time.time() - start, f"could not run: {e}"

    stop_event = threading.Event()
    hb_thread = None
    if heartbeat:
        hb_thread = threading.Thread(
            target=_heartbeat, args=(stop_event, gate.name), daemon=True
        )
        hb_thread.start()

    # A reader thread + queue with deadline: `for line in proc.stdout` blocks
    # forever if the child goes silent, which would defeat the timeout
    # (proc.wait would never be reached). The queue wakes us on the deadline
    # so we kill the tree instead.
    chunks: queue.Queue[bytes | None] = queue.Queue()

    def _reader() -> None:
        try:
            assert proc.stdout is not None
            for raw in iter(proc.stdout.readline, b""):
                chunks.put(raw)
        finally:
            chunks.put(None)  # EOF sentinel

    reader = threading.Thread(target=_reader, daemon=True)
    reader.start()

    dest = out_file or sys.stdout
    deadline = start + timeout
    lines: list[str] = []
    code = 1
    timed_out = False

    while True:
        remaining = deadline - time.time()
        if remaining <= 0:
            timed_out = True
            break
        try:
            raw = chunks.get(timeout=min(remaining, 1.0))
        except queue.Empty:
            continue  # loop re-checks the deadline
        if raw is None:
            break  # EOF
        text = raw.decode("utf-8", "replace").rstrip("\r\n")
        if not text:
            continue
        lines.append(text)
        if stream:
            # Print the ANSI-stripped copy. Vitest/pytest emit colour codes,
            # and the raw text can contain characters the console's code page
            # cannot encode (e.g. the U+2713 check mark) - which raises
            # UnicodeEncodeError mid-stream and kills the whole run. The
            # `errors="replace"` reconfigure below is the belt to this
            # braces: the strip keeps the common case clean, and the
            # reconfigure stops an unusual character from aborting the run.
            print(f"[{gate.name}] {_strip_ansi(text)}", file=dest, flush=True)

    if timed_out:
        _kill_tree(proc)
        # Drain whatever the child managed to emit before it was killed; that
        # output is usually the most useful part of a timeout diagnosis.
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
        stop_event.set()
        if hb_thread is not None:
            hb_thread.join(timeout=1)
        body = "\n".join(lines)
        msg = (
            f"TIMED OUT after {timeout:d}s. Gate: {' '.join(argv[1:3])}\n"
            "  If this is a first run, the next one may be warm and pass.\n"
            "  If it repeats, a stale lock is likely: check %TEMP%\\pytest-of-*."
        )
        return 124, time.time() - start, (body + "\n" + msg) if body else msg

    # EOF reached: wait for the exit code.
    try:
        code = proc.wait(timeout=max(1.0, deadline - time.time()))
    except subprocess.TimeoutExpired:
        _kill_tree(proc)
        code = 124

    stop_event.set()
    if hb_thread is not None:
        hb_thread.join(timeout=1)
    # Decode as UTF-8, not the ANSI code page: gate output contains em dashes.
    return code, time.time() - start, "\n".join(lines)


def _kill_tree(proc):
    """Kill the child and anything it spawned (pnpm -> node -> browser)."""
    try:
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:
        pass
    try:
        proc.kill()
    except OSError:
        pass


def _tail(text, limit=8000):
    """The end of a gate's output, for the JSON report.

    Keeps the tail (where the error is) and stays bounded, so a runaway gate
    that prints megabytes cannot bloat the report or the CI log.
    """
    if len(text) <= limit:
        return text
    return "...(truncated)...\n" + text[-limit:]


def _select_gates(all_gates, only, include_e2e):
    """The gates to run, applying --only and the opt-in rule.

    A name matches by exact equality or as a substring, so `--only py` runs
    pytest — *and* tools-pytest, because the substring sits inside that name
    too: `--only py` is the cheap way to run every backend suite. Naming a
    gate exactly (`--only pytest`) is the precise form. An optional gate is
    skipped unless --e2e is given OR it is named explicitly in --only -
    naming it is itself the opt-in, so `--only e2e` runs the browser suite
    instead of silently selecting nothing.
    """
    def matches(gate, names):
        return any(
            n.lower() == gate.name.lower() or n.lower() in gate.name.lower()
            for n in names
        )

    selected = []
    for g in all_gates:
        if only and not matches(g, only):
            continue
        if g.optional and not include_e2e and not (only and matches(g, only)):
            continue
        selected.append(g)
    return selected


def _build_parser():
    """Command-line parser.

    argparse rather than hand-rolled index scanning: a bare `--only` used to
    select nothing and then run *every* gate, `--help` ran the whole suite,
    and a typo'd flag was ignored - each of which reads as success to whoever
    ran it. argparse makes a missing value an error and prints usage on -h.
    """
    p = argparse.ArgumentParser(
        prog="run-gates.py",
        description="Run every quality gate for the repository in one command "
                    "(cheapest first, two concurrent lanes: python | node). "
                    "Exit 0 = all selected gates passed.",
    )
    p.add_argument("--only", nargs="+", metavar="GATE",
                   help="run only these gates; a substring matches "
                        "(e.g. 'py' matches both pytest and tools-pytest)")
    p.add_argument("--e2e", action="store_true",
                   help="include the opt-in Playwright gate")
    p.add_argument("--list", action="store_true",
                   help="list the gates and the resolved tools, then exit "
                        "(uses the cached interpreter; forces no probes)")
    p.add_argument("--which-python", action="store_true",
                   help="explain the interpreter choice with FULL re-"
                        "verification of every candidate, then exit")
    p.add_argument("--json", action="store_true",
                   help="machine-readable JSON report")
    p.add_argument("--save-json", metavar="PATH",
                   help="write the JSON report to a file")
    p.add_argument("--fail-fast", action="store_true",
                   help="stop at the first failing gate (the other lane "
                        "finishes its current gate, then stops)")
    p.add_argument("--retry", type=int, default=0, metavar="N",
                   help="retry each failed gate up to N extra times")
    p.add_argument("--fix", action="store_true",
                   help="auto-fix where supported: ruff --fix, eslint --fix "
                        "(corrections are applied in place before reporting)")
    p.add_argument("-v", "--verbose", action="store_true",
                   help="also show the last lines of output for passing gates "
                        "(and run check-all.py's report-only doc checks)")
    p.add_argument("--no-stream", action="store_true",
                   help="buffer each gate's output and print it at the end "
                        "instead of streaming it line by line")
    p.add_argument("--serial", action="store_true",
                   help="run the lanes one after the other instead of in "
                        "parallel (deterministic output, slower)")
    return p


def _run_lane(lane_name, lane_gates, python, pnpm, shared):
    """Run one lane's gates serially on a worker thread.

    shared keys: stop (Event), print_lock, results (name -> result),
    failed_output (name -> tail), stream, out_file, fail_fast, retry
    """
    for g in lane_gates:
        if shared["stop"].is_set():
            break
        argv = _materialize(g.argv, python, pnpm)
        code = 1
        out = ""
        attempts = 0
        spent = 0.0
        max_attempts = 1 + shared["retry"]
        while attempts < max_attempts:
            attempts += 1
            code, elapsed, out = run_gate(
                g, argv, g.timeout,
                stream=shared["stream"],
                out_file=shared["out_file"],
            )
            spent += elapsed
            if code == 0:
                break
            if attempts < max_attempts:
                print(f"  {g.name} attempt {attempts} failed ({code}), retrying...",
                      file=sys.stderr)
        status = "PASS" if code == 0 else ("TIME" if code == 124 else "FAIL")
        record = {
            "name": g.name, "status": status, "elapsed": spent,
            "attempts": attempts, "lane": lane_name,
        }
        # spent, not the last attempt's elapsed: with --retry the real cost of
        # a gate is every attempt, and the summary total must reflect that.
        # The label mirrors the old `g.argv[1:3]` slice: a slice is safe for
        # two-element argvs, direct indexing is not (IndexError killed the
        # whole lane thread on the first short node gate).
        preview = " ".join(argv[1:3])
        with shared["print_lock"]:
            sys.stdout.write(
                f"[{status}] {g.name:<12} {spent:6.1f} s  {preview}\n")
            sys.stdout.flush()
            shared["results"][g.name] = record
            if code != 0:
                # Keep the captured output for the JSON report as well as the
                # console: "--json --save-json" is meant to be debuggable
                # without re-running, which needs the text, not an empty
                # placeholder.
                shared["failed_output"][g.name] = _tail(out)
                lines = [ln for ln in out.splitlines() if ln.strip()]
                lines = lines[-60:]  # bounded: two lanes can both fail hard
                for line in lines:
                    print(f"         {line}")
                if shared["fail_fast"]:
                    shared["stop"].set()
            elif shared["verbose"]:
                for line in out.strip().splitlines()[-2:]:
                    if line.strip():
                        print(f"         {line}")


def main(argv=None):
    # The console's code page on this machine is cp1252, which cannot encode
    # the U+2713 check mark that vitest prints for every passing test. Without
    # this, streaming the unit gate dies with UnicodeEncodeError the moment
    # the first test passes - the exact failure the streaming feature exists
    # to prevent. errors="replace" degrades an unencodable character instead
    # of aborting the run.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError):
            pass  # not a real file object (e.g. captured by a test harness)

    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.retry < 0:
        parser.error("--retry must be >= 0")

    if args.list:
        # Fast: uses the TTL cache when it is warm, but never probes. This is
        # the command an agent runs to check spelling of gate names, so it
        # must cost nothing.
        pnpm = resolve_pnpm()
        cached, ts = _read_cache()
        if cached and Path(cached).exists():
            py_label = (f"{_describe(cached)} (cached, TTL-warm)"
                        if ts else f"{_describe(cached)} (cached, pre-TTL schema)")
        elif cached:
            py_label = f"{cached} (cached, missing on disk)"
        else:
            py_label = "(not yet verified; probed when a python gate runs)"
        all_gates = gates()
        for g in all_gates:
            argv_shown = _materialize(g.argv, "(python)", pnpm)
            tag = f"  [lane:{g.lane}]" + ("  (opt-in)" if g.optional else "")
            print(f"{g.name:<12} {' '.join(argv_shown[1:])}{tag}")
        print()
        print(f"python (cache): {py_label}")
        print(f"pnpm:           {pnpm}")
        return 0

    if args.which_python:
        # Diagnostic: show every candidate and why it was or was not chosen.
        # This is the fastest way to answer "why is it using that Python?".
        # Full verification is forced (allow_cached=False): a diagnostic that
        # prints a TTL-warm cached value without probing would be reporting
        # yesterday's answer.
        probed = {}
        chosen = resolve_python(quiet=True, collect=probed, allow_cached=False)
        print(f"chosen: {_describe(chosen)}")
        print(f"pnpm:   {resolve_pnpm()}")
        print(f"override ($NMA_PYTHON): {os.environ.get('NMA_PYTHON') or '(unset)'}")
        print()
        print("candidates, in preference order:")
        for cand in _candidate_list():
            ok = probed.get(cand)
            mark = "SELECTED" if cand == chosen else \
                   ("ok" if ok else "rejected")
            print(f"  {mark:<8} {_describe(cand)}")
        return 0

    all_gates = gates(fix=args.fix, verbose=args.verbose)
    selected = _select_gates(all_gates, args.only, args.e2e)
    if not selected:
        available = ", ".join(g.name for g in all_gates)
        print(f"no gate matched {args.only}; available: {available}")
        return 1

    # In JSON mode stdout must stay pure JSON, so the streamed lines AND the
    # per-gate status lines go to stderr instead. (Previously the status
    # lines went to stdout unconditionally, so --json was not actually
    # machine-readable until the report block at the end.)
    json_mode = bool(args.json or args.save_json)
    stream_to = sys.stderr if json_mode else None

    py_gates = [g for g in selected if g.lane == "py"]
    node_gates = [g for g in selected if g.lane == "node"]
    lane_count = (1 if py_gates else 0) + (1 if node_gates else 0)

    print(f"Running {len(selected):d} gate(s) on {lane_count} lane(s): "
          + ", ".join(g.name for g in selected))
    print("=" * 68)
    sys.stdout.flush()

    # Lane-scoped tool resolution, applied ONLY when a lane that needs the
    # tool is about to run — so `--only unit` costs no interpreter probing
    # and `--only ruff` costs no pnpm lookup.
    setup_start = time.time()
    python = pnpm = None
    if py_gates:
        t0 = time.time()
        python = resolve_python()
        # Setup time is reported, not hidden: the probe cost used to precede
        # gate 1 and sat outside every timing number, which is exactly why a
        # run felt slower than its summary claimed.
        print(f"[setup] interpreter: {_describe(python)} "
              f"({time.time() - t0:.1f} s)")
    else:
        print("[setup] no python gate selected - interpreter verification "
              "skipped")
    if node_gates:
        pnpm = resolve_pnpm()
    setup_seconds = time.time() - setup_start
    sys.stdout.flush()

    shared = {
        "stop": threading.Event(),
        "print_lock": threading.Lock(),
        "results": {},
        "failed_output": {},
        "stream": not args.no_stream,
        "out_file": stream_to,
        "fail_fast": bool(args.fail_fast),
        "retry": args.retry,
        "verbose": args.verbose,
    }
    threads = []
    if args.serial:
        # Serial mode: both lanes in this thread, one after the other, so
        # output order is fully deterministic and identical to the old
        # single-lane runner.
        for lane_name, lane_gates_ in (("py", py_gates), ("node", node_gates)):
            if lane_gates_:
                _run_lane(lane_name, lane_gates_, python, pnpm, shared)
    else:
        if py_gates:
            threads.append(threading.Thread(
                target=_run_lane, args=("py", py_gates, python, pnpm, shared)))
        if node_gates:
            threads.append(threading.Thread(
                target=_run_lane, args=("node", node_gates, python, pnpm,
                                        shared)))
        for t in threads:
            t.start()
        for t in threads:
            t.join()

    results = [shared["results"][g.name] for g in selected]
    failed = [r["name"] for r in results if r["status"] != "PASS"]

    if args.json or args.save_json:
        report = {
            "results": results,
            "failed": failed,
            "setup_seconds": round(setup_seconds, 1),
            "total_seconds": round(sum(r["elapsed"] for r in results), 1),
            "all_passed": len(failed) == 0,
        }
        if shared["failed_output"]:
            report["failed_output"] = shared["failed_output"]
        if args.save_json:
            try:
                Path(args.save_json).write_text(
                    json.dumps(report, indent=2), encoding="utf-8")
            except OSError as e:
                print(f"could not write {args.save_json}: {e}", file=sys.stderr)
        if args.json:
            print(json.dumps(report, indent=2))
    else:
        print("=" * 68)
        summary = "  ".join(f"{r['name']} {r['status']}" for r in results)
        print(summary)
        total = sum(r["elapsed"] for r in results)
        print(f"{total:.1f} s gates + {setup_seconds:.1f} s setup")
        if failed:
            print("FAILED: {}".format(", ".join(failed)))
        else:
            print("all gates passed")

    # Exit code is the same in every output mode: --json used to fall through
    # to `return 0`, so a failing run looked green to any CI reading the code.
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

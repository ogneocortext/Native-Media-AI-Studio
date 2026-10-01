"""Run every quality gate for the repository in one command.

Each gate is a separate tool with a separate working directory, and on Windows
none of them can be trusted through the PowerShell `.ps1` wrappers: `pnpm`
reports exit 1 while passing, and a non-zero exit from one gate tells you
nothing about whether a later one ran. This runner owns that problem once,
here, so neither a person nor an agent has to hand-assemble a pipeline of
temp scripts (the `subprocess` calls must also decode explicitly as UTF-8 —
Python decodes pipes with the ANSI code page otherwise and dies on em dashes).

Gates, cheapest-first so a fast failure surfaces early:

  docs      check-all.py (4 documentation/repo checkers)
  encoding  covered by the above
  ruff      backend lint                       packages/backend
  type      tsc -b + test config               packages/frontend
  lint      eslint                            packages/frontend
  unit      vitest (pure logic)                packages/frontend
  pytest    backend suite                      packages/backend
  build     vite build                         packages/frontend
  e2e       Playwright (opt-in, --e2e)        packages/frontend

Usage:
  python tools/run-gates.py               # everything except e2e
  python tools/run-gates.py --e2e         # include the browser suite
  python tools/run-gates.py --only type lint
  python tools/run-gates.py --list
  python tools/run-gates.py --which-python   # explain the interpreter choice

Tools are resolved at runtime, never hardcoded - see resolve_python(). Set
NMA_PYTHON to force a specific interpreter.

Exit 0 = all selected gates passed, 1 = at least one failed.
The e2e gate is opt-in because it starts a Vite dev server and needs a browser.
"""
from __future__ import print_function

import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "packages" / "backend"
FRONTEND = ROOT / "packages" / "frontend"

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
# so every candidate is verified by running a gate, not by inspection.
ENV_GLOBS = [
    r"D:\conda-envs\*\Scripts\python.exe",
    r"D:\conda-envs\*\python.exe",
    r"C:\Python3*\python.exe",
]

PROJECT_ENV = r"D:\conda-envs\nma-studio-cuda\Scripts\python.exe"


def _probe_ok(python, argv, cwd):
    """True if argv runs clean under this interpreter."""
    try:
        p = subprocess.run([python] + argv, cwd=str(cwd),
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        return p.returncode == 0
    except OSError:
        return False


def _probe_argv():
    """The gate used to decide whether an interpreter is usable.

    ruff on a clean tree is the cheapest honest test available: it exits 0 only
    if the interpreter starts and can import its own tooling.
    """
    return ["-m", "ruff", "check", ".", "--output-format=concise"]


def _describe(python):
    """Short 'path (3.11.9)' label for log lines."""
    try:
        p = subprocess.run(
            [python, "-c", "import sys;print('.'.join(map(str,sys.version_info[:3])))"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        ver = p.stdout.decode("utf-8", "replace").strip()
        return "%s (%s)" % (python, ver) if ver else python
    except OSError:
        return python


def resolve_python(cwd=BACKEND, quiet=False):
    """Return an interpreter that can actually run the backend gates.

    The cache is a *hint*, never a shortcut for verification. An earlier version
    returned the cached path on sight, so an environment that was repaired (or
    broken) after the first run stayed cached indefinitely - exactly the stale
    pin this module exists to avoid. Now the cached candidate is re-probed like
    any other; the probe costs ~0.1 s, so there is nothing to buy by skipping it.
    That also means a newly repaired env is picked up with no cache clearing.
    """
    def say(msg):
        if not quiet:
            print(msg)

    override = os.environ.get("NMA_PYTHON")
    if override:
        if not Path(override).exists():
            say("NMA_PYTHON=%s does not exist; ignoring" % override)
        else:
            return override

    candidates = []
    for pattern in ENV_GLOBS:
        for hit in sorted(glob.glob(pattern)):
            if hit not in candidates:
                candidates.append(hit)
    if PROJECT_ENV not in candidates and Path(PROJECT_ENV).exists():
        candidates.insert(0, PROJECT_ENV)

    on_path = shutil.which("python")
    if on_path and on_path not in candidates:
        candidates.append(on_path)

    cache_path = Path(tempfile.gettempdir()) / "nma-studio-python-choice.json"
    try:
        cached = json.loads(cache_path.read_text("utf-8")).get("python")
    except Exception:
        cached = None

    # Try the remembered candidate first, but only if it still exists. It is
    # verified exactly like a cold candidate, so a broken env is rejected.
    order = list(candidates)
    if cached and Path(cached).exists() and cached not in order:
        order.insert(0, cached)

    rejected, winner = [], None
    for cand in order:
        if _probe_ok(cand, _probe_argv(), cwd):
            winner = cand
            break
        rejected.append(cand)

    if winner:
        try:
            cache_path.write_text(json.dumps({"python": winner}), "utf-8")
        except OSError:
            pass
        if rejected or not candidates or winner != candidates[0]:
            say("interpreter: %s" % _describe(winner))
            if rejected and len(rejected) < len(order):
                say("  rejected: %s" % ", ".join(rejected))
        return winner

    # Nothing verified. Fall back to the project env and let the gate report the
    # real error, rather than dying here with a confusing message.
    say("WARNING: no interpreter passed the ruff probe; falling back.")
    if rejected:
        say("  tried: %s" % ", ".join(rejected))
    return PROJECT_ENV if Path(PROJECT_ENV).exists() else (on_path or "python")


class Gate(object):
    def __init__(self, name, argv, cwd, optional=False, timeout=300):
        self.name = name
        self.argv = argv
        self.cwd = cwd
        self.optional = optional
        self.timeout = timeout


def gates():
    python = resolve_python()
    pnpm = resolve_pnpm()
    return [
        Gate("docs", [python, "tools/check-all.py"], ROOT),
        Gate("ruff", [python, "-m", "ruff", "check", ".", "--output-format=concise"], BACKEND),
        Gate("type", [pnpm, "type-check"], FRONTEND),
        Gate("lint", [pnpm, "lint"], FRONTEND),
        Gate("unit", [pnpm, "test:unit"], FRONTEND),
        Gate("pytest", [python, "-m", "pytest", "-q", "-p", "no:cacheprovider"], BACKEND),
        Gate("build", [pnpm, "build"], FRONTEND, timeout=600),
        Gate("e2e", [pnpm, "exec", "playwright", "test",
                     "app-shell.spec.ts", "canvas2d.spec.ts",
                     "lrc-visualizer.spec.ts", "--reporter=list"],
             FRONTEND, optional=True, timeout=900),
    ]


def run_gate(gate, timeout):
    """Run one gate. Never raises: a hung gate is reported, not inherited.

    The timeout matters more than it looks. A gate that hangs (pytest blocking
    on a locked %TEMP% pointer, a browser that never exits) otherwise hangs the
    agent too, with no output and no way to tell a slow gate from a dead one.
    """
    start = time.time()
    try:
        proc = subprocess.Popen(
            gate.argv, cwd=str(gate.cwd),
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
    except OSError as e:
        return 1, time.time() - start, "could not run: %s" % e

    try:
        out, _ = proc.communicate(timeout=timeout)
        code = proc.returncode
    except subprocess.TimeoutExpired:
        _kill_tree(proc)
        return 124, time.time() - start, (
            "TIMED OUT after %ds. Gate: %s\n"
            "  If this is a first run, the next one may be warm and pass.\n"
            "  If it repeats, a stale lock is likely: check %%TEMP%%\\pytest-of-*."
            % (timeout, " ".join(gate.argv[1:3]))
        )
    # Decode as UTF-8, not the ANSI code page: gate output contains em dashes.
    return code, time.time() - start, out.decode("utf-8", "replace")


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


def main():
    args = sys.argv[1:]
    all_gates = gates()

    if "--which-python" in args:
        # Diagnostic: show every candidate and why it was or was not chosen.
        # This is the fastest way to answer "why is it using that Python?".
        chosen = resolve_python(quiet=True)
        print("chosen: %s" % _describe(chosen))
        print("pnpm:   %s" % resolve_pnpm())
        print("override ($NMA_PYTHON): %s" % (os.environ.get("NMA_PYTHON") or "(unset)"))
        print()
        print("candidates, in preference order:")
        cands = []
        for pattern in ENV_GLOBS:
            for hit in sorted(glob.glob(pattern)):
                # Dedupe case-insensitively: on Windows glob can return both
                # python.exe and python.EXE, and listing each twice is noise.
                if hit.lower() not in {c.lower() for c in cands}:
                    cands.append(hit)
        if PROJECT_ENV not in cands and Path(PROJECT_ENV).exists():
            cands.insert(0, PROJECT_ENV)
        on_path = shutil.which("python")
        if on_path and on_path not in cands:
            cands.append(on_path)
        for i, cand in enumerate(cands):
            ok = _probe_ok(cand, _probe_argv(), BACKEND)
            mark = "SELECTED" if cand == chosen else ("ok" if ok else "rejected")
            print("  %-8s %s" % (mark, _describe(cand)))
        return 0

    if "--list" in args:
        print("interpreter: %s" % resolve_python())
        print("pnpm:        %s" % resolve_pnpm())
        print()
        for g in all_gates:
            print("%-8s %s%s" % (g.name, " ".join(g.argv[1:]),
                                  "  (opt-in)" if g.optional else ""))
        return 0

    verbose = "-v" in args or "--verbose" in args
    only = None
    if "--only" in args:
        only = set(args[args.index("--only") + 1:])

    selected = []
    for g in all_gates:
        if only and g.name not in only:
            continue
        if g.optional and "--e2e" not in args:
            continue
        selected.append(g)

    if not selected:
        print("no gates selected")
        return 1

    print("Running %d gate(s): %s" % (len(selected), ", ".join(g.name for g in selected)))
    print("=" * 68)
    sys.stdout.flush()

    results, failed = [], []
    for g in selected:
        print("[....] %-7s %s" % (g.name, " ".join(g.argv[1:3])), end="\r")
        sys.stdout.flush()
        code, elapsed, out = run_gate(g, g.timeout)
        status = "PASS" if code == 0 else ("TIME" if code == 124 else "FAIL")
        print("[%s] %-7s %6.1f s  %s" % (status, g.name, elapsed, " ".join(g.argv[1:3])))
        sys.stdout.flush()
        results.append((g.name, status, elapsed))
        if code != 0:
            failed.append(g.name)
            for line in out.splitlines():
                if line.strip():
                    print("         %s" % line)
        elif verbose:
            for line in out.strip().splitlines()[-2:]:
                if line.strip():
                    print("         %s" % line)

    print("=" * 68)
    summary = "  ".join("%s %s" % (n, s) for n, s, _ in results)
    print(summary)
    total = sum(t for _, _, t in results)
    print("%.1f s total" % total)
    if failed:
        print("FAILED: %s" % ", ".join(failed))
        return 1
    print("all gates passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
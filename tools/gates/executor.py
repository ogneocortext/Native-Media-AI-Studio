"""Gate execution engine.

Runs individual gates with streaming output, deadline-aware timeouts,
process-tree killing, heartbeats for long gates, and per-gate retries with
exponential backoff. Two lanes (python | node) run concurrently.
"""

import json
import os
import queue
import subprocess
import sys
import threading
import time
from datetime import UTC, datetime

from .gates import PNPM, PY, ROOT, Gate
from .output import strip_ansi

GATES_JSONL = ROOT / "tools" / "self-metrics" / "gates.jsonl"


def _record_gate_metric(record: dict) -> None:
    """Append one JSONL line per finished gate for trend analysis
    (tools/report-self-metrics.py). Never raises — metrics must not break
    the gate run that produced them. NMA_METRICS=off disables."""
    if os.environ.get("NMA_METRICS", "").lower() in ("off", "0", "false"):
        return
    try:
        GATES_JSONL.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "ts": datetime.now(UTC).isoformat(timespec="seconds"),
            **record,
        }
        with GATES_JSONL.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(payload, separators=(",", ":")) + "\n")
    except OSError:
        pass


def _heartbeat(stop_event: threading.Event, label: str,
               interval: float = 10.0) -> None:
    """Print a heartbeat to stderr every ``interval`` seconds while a gate runs.

    Gives operators feedback that a long gate (e.g. pytest at ~60s) is still
    alive and not wedged. Runs on a daemon thread so it never blocks exit.
    """
    start = time.time()
    while not stop_event.is_set():
        stop_event.wait(interval)
        if not stop_event.is_set():
            elapsed = int(time.time() - start)
            print(f"[{label} {elapsed}s] still running...",
                  file=sys.stderr, flush=True)


def run_gate(gate: Gate, argv: list, timeout: int, *,
             heartbeat: bool = True, stream: bool = True,
             out_file=None) -> tuple[int, float, str]:
    """Run one gate. Never raises: a hung gate is reported, not inherited.

    Output is streamed line by line while the gate runs, so the caller can
    see *which* test is executing at the moment it is executing. A reader
    thread plus a deadline-aware queue wakes the main loop on the deadline so
    the process tree can be killed instead of blocking forever.

    ``argv`` is the materialised command (sentinels replaced with resolved
    tools). When ``stream`` is False the output is buffered and returned as
    before, and ``out_file`` diverts the streamed lines to a file instead of
    stdout.
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
            # UnicodeEncodeError mid-stream and kills the whole run.
            print(f"[{gate.name}] {strip_ansi(text)}", file=dest, flush=True)

    if timed_out:
        _kill_tree(proc, grace=2.0)
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
        _kill_tree(proc, grace=2.0)
        code = 124

    stop_event.set()
    if hb_thread is not None:
        hb_thread.join(timeout=1)
    # Decode as UTF-8, not the ANSI code page: gate output contains em dashes.
    return code, time.time() - start, "\n".join(lines)


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


def run_lane(lane_name: str, lane_gates: list[Gate], python, pnpm,
             shared: dict) -> None:
    """Run one lane's gates serially on a worker thread.

    shared keys: stop (Event), print_lock, results (name -> result),
    failed_output (name -> tail), stream, out_file, fail_fast, retry,
    verbose
    """
    import random

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
                # Exponential backoff with jitter: 0.5s, 1.5s, 4.5s...
                # A retry storm (all lanes retrying at once) is worse than
                # one slow gate, so back off before the next attempt.
                backoff = 0.5 * (2 ** (attempts - 1)) + random.uniform(0, 0.5)
                print(f"  {g.name} attempt {attempts} failed ({code}), "
                      f"retrying in {backoff:.1f}s...", file=sys.stderr)
                time.sleep(backoff)
        status = "PASS" if code == 0 else ("TIME" if code == 124 else "FAIL")
        record = {
            "name": g.name, "status": status, "elapsed": spent,
            "attempts": attempts, "lane": lane_name,
        }
        # Record timing for regression detection (only on successful runs,
        # since a failed gate's elapsed is mostly timeout overhead).
        if code == 0:
            from .timing import record_timing
            record_timing(g.name, spent)
        reg = ""
        if code == 0:
            from .timing import regression_notice
            reg = regression_notice(g.name, spent) or ""
        # spent, not the last attempt's elapsed: with --retry the real cost of
        # a gate is every attempt, and the summary total must reflect that.
        preview = " ".join(argv[1:3])
        desc = f" — {g.desc}" if g.desc else ""
        with shared["print_lock"]:
            dest = shared["out_file"] or sys.stdout
            dest.write(
                f"[{status}] {g.name:<12} {spent:6.1f} s  {preview}{desc}{reg}\n")
            dest.flush()
            shared["results"][g.name] = record
            _record_gate_metric(record)
            capture = shared.get("capture_gates")
            if capture and g.name in capture:
                # Larger tail for test-analytics parsing — pass gates have
                # no failed_output entry, and an 8 KB tail would keep only
                # the last ~100 pytest -v lines of a 2000-test suite.
                shared["gate_output"][g.name] = _tail(out, limit=262144)
            if code != 0:
                # Keep the captured output for the JSON report as well as the
                # console: "--json --save-json" is meant to be debuggable
                # without re-running, which needs the text, not an empty
                # placeholder.
                shared["failed_output"][g.name] = _tail(out)
                lines = [ln for ln in out.splitlines() if ln.strip()]
                lines = lines[-60:]  # bounded: two lanes can both fail hard
                for line in lines:
                    dest.write(f"         {line}\n")
                    dest.flush()
                if shared["fail_fast"]:
                    shared["stop"].set()
            elif shared["verbose"]:
                for line in out.strip().splitlines()[-2:]:
                    if line.strip():
                        dest.write(f"         {line}\n")
                        dest.flush()


def _materialize(argv: list, python, pnpm) -> list:
    """Replace the PY/PNPM sentinels with the resolved tool paths."""
    return [python if a == PY else (pnpm if a == PNPM else a) for a in argv]


def _tail(text: str, limit: int = 8000) -> str:
    """Return the end of ``text``, truncated to ``limit`` characters."""
    from .output import tail
    return tail(text, limit)

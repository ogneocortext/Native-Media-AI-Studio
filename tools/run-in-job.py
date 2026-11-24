"""Re-launch ``python <args>`` inside a kill-on-close Job Object.

Why this exists: the backend spawns long-lived children (watchfiles ->
uvicorn, ffmpeg, Blender, ComfyUI manager, music-gen bridges). When the
backend crashes or is killed, Windows does not reap those descendants —
they reparent to nothing and keep running, holding ports and VRAM until
someone kills them by hand. Putting the whole tree in a job object with
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE makes the OS terminate every member
the moment this launcher's handle closes (crash, kill, or normal exit
after the child finishes).

Child processes of a job member join the job automatically, so wrapping
the root interpreter covers the entire descendant tree — no per-call-site
changes needed.

Usage (the script is itself run by the target interpreter):

    python tools/run-in-job.py -m watchfiles --filter python --target-type command "<uvicorn cmd>"
    python tools/run-in-job.py -m uvicorn app.main:app --host 127.0.0.1 --port 8004

Everything after the script path is forwarded verbatim to
``sys.executable``. Exit code is the child's.

Platform notes:
- Windows: full kill-on-close semantics via pywin32 (win32job).
- Non-Windows: runs the command unprotected (no equivalent one-liner);
  a warning is printed so the gap is visible in logs.
- If the current process is already inside a job that forbids nesting,
  assignment raises and the command still runs — a degraded launch beats
  no launch.
"""

from __future__ import annotations

import os
import subprocess
import sys


def _enter_kill_on_close_job() -> bool:
    """Assign this process to a new kill-on-close job. True on success."""
    if sys.platform != "win32":
        print(
            "[run-in-job] non-Windows platform: running without job-object "
            "protection (orphaned children are not auto-reaped)",
            file=sys.stderr,
        )
        return False
    try:
        import win32api  # type: ignore[import-not-found]
        import win32job  # type: ignore[import-not-found]
    except ImportError:
        print(
            "[run-in-job] pywin32 not installed: running without "
            "job-object protection",
            file=sys.stderr,
        )
        return False

    # Named uniquely per launcher: an unnamed job isn't expressible via
    # pywin32, and a shared name would merge unrelated trees into one
    # job (closing one handle would not kill the other's members).
    job = win32job.CreateJobObject(None, f"NMAS-Job-{os.getpid()}")
    info = win32job.QueryInformationJobObject(
        job, win32job.JobObjectExtendedLimitInformation
    )
    info["BasicLimitInformation"]["LimitFlags"] = (
        win32job.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    )
    win32job.SetInformationJobObject(
        job, win32job.JobObjectExtendedLimitInformation, info
    )
    # AssignProcessToJobObject on an already-jobbed process nests on
    # Win8+; older failure modes raise here and we degrade gracefully.
    win32job.AssignProcessToJobObject(job, win32api.GetCurrentProcess())
    # Keep a reference so the handle isn't GC'd — the job must outlive
    # the children, and it dies with this process by design.
    _enter_kill_on_close_job._job = job  # type: ignore[attr-defined]
    return True


def main(argv: list[str]) -> int:
    args = argv[1:]
    if not args:
        print(
            "usage: python tools/run-in-job.py <python args...>",
            file=sys.stderr,
        )
        return 2

    try:
        protected = _enter_kill_on_close_job()
    except Exception as exc:  # noqa: BLE001 - degrade, never block launch
        print(f"[run-in-job] job assignment failed ({exc}); running unprotected", file=sys.stderr)
        protected = False
    if protected:
        print(f"[run-in-job] pid={os.getpid()} in kill-on-close job", file=sys.stderr)

    proc = subprocess.Popen([sys.executable, *args])
    try:
        return proc.wait()
    except KeyboardInterrupt:
        # Ctrl+C in a console: take the child down with us instead of
        # orphaning it, then exit with the conventional 130.
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        return 130


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

"""Commit staged work and push, verifying by git state instead of stderr.

Why this exists: three sharp edges bit agents repeatedly when committing
from PowerShell on this machine, and each produced a wrong conclusion.

1. ``Set-Content -Encoding utf8`` writes a BOM into the message file, so
   the commit subject starts with U+FEFF. This script writes nothing;
   it validates a caller-supplied ``--message-file`` for a BOM before use.
2. The pre-commit / pre-push hooks print progress (``Running 7 checks``)
   to stderr. PowerShell treats any native command writing to stderr as
   failure (``NativeCommandError``, exit 1) even when the commit or push
   succeeded, which reads as a failed commit. This script uses the
   process returncode as authoritative and verifies the outcome against
   git state: HEAD changed for a commit, ``ls-remote`` matching HEAD
   for a push. Hook stderr is forwarded as information, not verdict.
3. The pre-push hook runs the fast gates (type-check alone is minutes
   when node_modules is mid-relink), so a push looks hung while it is
   working. This script streams hook output live with a generous
   timeout instead of capturing it silently.

   NOTE on timeouts: run this script from a shell whose own timeout is
   longer than the hooks it will trigger (``--timeout`` only bounds the
   child git process). If the invoking tool call times out first, the
   script dies with it - typically mid-push, since the commit's
   pre-commit hook finishes first. A half-run is safe to recover: the
   commit is verified by HEAD, so just push (or re-run; an empty stage
   fails cleanly with "nothing staged").

It never stages anything it was not told to: pass explicit ``--add``
paths (repeatable). There is no ``-A`` mode on purpose - one session's
commit picked up a concurrent agent's half-finished ``pnpm install``
output because the working tree was staged wholesale.

Run:  python tools/commit-and-push.py --message-file <file> --add <path>...
      [--branch main] [--no-push] [--timeout 900]
Exit 0 = pushed (or committed with --no-push), 1 = any step failed.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _gitutil import run_git  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TRAILER_PREFIX = "Co-authored-by:"


def stream_command(cmd: list[str], timeout: float) -> int:
    """Run cmd, streaming merged stdout+stderr live. Return the exit code.

    Streaming (not capture) is the point: hook output is the only sign
    of life during a minutes-long pre-push gate run. Bytes are decoded
    explicitly as UTF-8 so this file passes check-subprocess-encoding.
    """
    proc = subprocess.Popen(
        cmd,
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    assert proc.stdout is not None

    def pump() -> None:
        for raw in proc.stdout:
            print(raw.decode("utf-8", "replace").rstrip("\n"), flush=True)

    thread = threading.Thread(target=pump, daemon=True)
    thread.start()
    try:
        return proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        print(f"TIMEOUT after {timeout:.0f}s: {' '.join(cmd)}", flush=True)
        return 124
    finally:
        thread.join(timeout=10)


def fail(msg: str) -> int:
    print(f"FAILED: {msg}", flush=True)
    return 1


def check_message_file(path: Path) -> str | None:
    """Return an error string, or None when the message file is usable."""
    if not path.is_file():
        return f"message file not found: {path}"
    raw = path.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        return (
            f"{path} starts with a UTF-8 BOM "
            "(PowerShell Set-Content wrote it; rewrite without utf-8-sig)"
        )
    if b"\x00" in raw:
        return f"{path} contains NUL bytes (UTF-16?); need plain UTF-8"
    text = raw.decode("utf-8", "replace")
    if not text.strip():
        return f"{path} is empty"
    lines = text.replace("\r\n", "\n").split("\n")
    if any(len(line) > 200 for line in lines):
        print("WARNING: a message line exceeds 200 chars", flush=True)
    if not any(line.startswith(TRAILER_PREFIX) for line in lines):
        print(
            f"WARNING: no '{TRAILER_PREFIX}' trailer; AGENTS.md requires one on every commit",
            flush=True,
        )
    return None


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "--message-file",
        required=True,
        help="UTF-8 (no BOM) file with the commit message; used via git -F",
    )
    ap.add_argument(
        "--add",
        action="append",
        default=[],
        help="pathspec to stage; repeatable; at least one required",
    )
    ap.add_argument("--branch", default=None, help="branch to push (default: current branch)")
    ap.add_argument("--no-push", action="store_true", help="commit only, do not push")
    ap.add_argument(
        "--timeout",
        type=float,
        default=900,
        help="seconds to allow commit/push incl. hooks (default 900)",
    )
    args = ap.parse_args()

    if not args.add:
        return fail("nothing to stage: pass at least one --add pathspec")

    msg_err = check_message_file(Path(args.message_file))
    if msg_err:
        return fail(msg_err)

    branch = args.branch or run_git("branch", "--show-current").strip()
    if not branch:
        return fail("could not determine current branch")

    print(f"branch: {branch}", flush=True)
    print("--- status before ---", flush=True)
    print(run_git("status", "--short"), flush=True)

    old_head = run_git("rev-parse", "HEAD").strip()

    print(f"--- staging: {args.add} ---", flush=True)
    rc = stream_command(["git", "add", "--", *args.add], args.timeout)
    if rc != 0:
        return fail(f"git add exited {rc}")
    staged = run_git("diff", "--cached", "--stat").strip()
    if not staged:
        return fail("nothing staged; check the --add pathspecs")
    print(staged, flush=True)

    print("--- committing ---", flush=True)
    rc = stream_command(["git", "commit", "-F", args.message_file], args.timeout)
    new_head = run_git("rev-parse", "HEAD").strip()
    if new_head == old_head:
        return fail(f"HEAD unchanged after commit (exit {rc}); see hook output above")
    print(f"committed {new_head[:12]} (exit {rc}; hook stderr is not the verdict)", flush=True)

    if args.no_push:
        return 0

    print(f"--- pushing to origin/{branch} ---", flush=True)
    rc = stream_command(["git", "push", "origin", branch], args.timeout)
    remote = run_git("ls-remote", "origin", branch).split()
    remote_head = remote[0] if remote else ""
    if remote_head != new_head:
        return fail(
            f"push unverified (exit {rc}): origin/{branch} is "
            f"{remote_head[:12] or 'unknown'}, local HEAD is {new_head[:12]}"
        )
    print(f"pushed: origin/{branch} == {new_head[:12]}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

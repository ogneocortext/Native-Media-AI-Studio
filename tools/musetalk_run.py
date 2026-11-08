"""MuseTalk v1.5 CLI wrapper for the studio's lip-sync adapter.

MuseTalk's ``scripts.inference`` takes an inference YAML (video_path /
audio_path / result_name per task) plus ``--result_dir``; it has no
positional ``{video} {audio} {output}`` interface. This wrapper translates
the adapter's contract into that workflow:

- writes a single-task YAML with absolute paths (single-quoted — YAML
  literal strings keep Windows backslashes intact)
- runs ``python -m scripts.inference`` with cwd = the MuseTalk checkout
- ``result_name`` is the absolute staged output path, so MuseTalk writes
  exactly where the adapter expects (``os.path.join`` keeps absolute
  second arguments on both POSIX and Windows)
- forwards child stdout/stderr live and re-emits tqdm batch progress as
  ``NN% rendered`` lines — the form the adapter's progress parser reads
- exits non-zero when the child fails OR when MuseTalk prints its
  per-task "Error occurred" marker (it swallows exceptions and still
  exits 0, so the return code alone is not trustworthy)

Usage (normally invoked through config/lipsync.json inference.command):

    python tools/musetalk_run.py --video V --audio A --output O \
        --result-dir R [--musetalk-root D:\\MuseTalk] [--batch-size 1] \
        [--no-float16] [--fps 25]
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


def _yaml_quote(path: Path) -> str:
    """Single-quote a path for YAML — literal style, backslashes safe."""
    s = str(path)
    return "'" + s.replace("'", "''") + "'"


def _write_task_yaml(path: Path, video: Path, audio: Path, output: Path) -> None:
    path.write_text(
        "task_0:\n"
        f"  video_path: {_yaml_quote(video)}\n"
        f"  audio_path: {_yaml_quote(audio)}\n"
        f"  result_name: {_yaml_quote(output)}\n",
        encoding="utf-8",
    )


def _emit_progress(line: str, sink, progress_state: dict[str, int]) -> None:
    """Re-emit tqdm batch % as 'NN% rendered' for the adapter's parser."""
    # tqdm format: " 45%|████| 9/20 [00:01<00:02, ...]"
    pct_marker = line.find("%|")
    if pct_marker <= 0:
        return
    digits = ""
    for ch in reversed(line[:pct_marker]):
        if ch.isdigit():
            digits = ch + digits
        elif digits:
            break
    if not digits:
        return
    pct = int(digits)
    if pct != progress_state.get("pct"):
        progress_state["pct"] = pct
        print(f"MuseTalk progress: {pct}% rendered", file=sink, flush=True)


def _forward_stream(stream, sink, progress_state: dict[str, int]) -> None:
    """Copy *stream* to *sink*, re-emitting tqdm % as 'NN% rendered'.

    Text-mode pipes already translate ``\\r`` to ``\\n`` (universal
    newlines), so tqdm's in-place repaints arrive as separate lines.
    """
    buf = ""
    while True:
        chunk = stream.read(4096)
        if not chunk:
            break
        text = chunk if isinstance(chunk, str) else chunk.decode("utf-8", "replace")
        sink.write(text)
        sink.flush()
        buf += text
        parts = buf.split("\n")
        buf = parts.pop()
        for line in parts:
            _emit_progress(line, sink, progress_state)
    if buf:
        _emit_progress(buf, sink, progress_state)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--video", required=True, type=Path)
    ap.add_argument("--audio", required=True, type=Path)
    ap.add_argument("--output", required=True, type=Path)
    ap.add_argument(
        "--result-dir",
        type=Path,
        default=None,
        help="Scratch dir for MuseTalk intermediates (default: <output-parent>/musetalk_work)",
    )
    ap.add_argument(
        "--musetalk-root",
        type=Path,
        default=Path.cwd(),
        help="MuseTalk checkout root (default: current directory)",
    )
    ap.add_argument("--batch-size", type=int, default=1)
    ap.add_argument("--fps", type=int, default=25)
    # --use_float16 matches the placeholder name config/lipsync.json's
    # {float16_flag} expands to; --no-float16 disables.
    ap.add_argument("--use_float16", "--float16", dest="float16", action="store_true", default=True)
    ap.add_argument("--no-float16", dest="float16", action="store_false")
    args = ap.parse_args()

    root = args.musetalk_root.resolve()
    result_dir = (args.result_dir or args.output.parent / "musetalk_work").resolve()
    result_dir.mkdir(parents=True, exist_ok=True)
    yaml_path = result_dir / "job.yaml"
    _write_task_yaml(yaml_path, args.video.resolve(), args.audio.resolve(), args.output.resolve())

    cmd = [
        sys.executable,
        "-m",
        "scripts.inference",
        "--inference_config",
        str(yaml_path),
        "--result_dir",
        str(result_dir / "results"),
        "--unet_model_path",
        "models/musetalkV15/unet.pth",
        "--unet_config",
        "models/musetalkV15/musetalk.json",
        "--whisper_dir",
        "models/whisper",
        "--version",
        "v15",
        "--batch_size",
        str(args.batch_size),
        "--fps",
        str(args.fps),
    ]
    if args.float16:
        cmd.append("--use_float16")

    print("MuseTalk wrapper:", " ".join(cmd), flush=True)
    env = dict(os.environ)
    # MuseTalk prints CJK punctuation (「」) in status lines; cp1252 consoles
    # crash with UnicodeEncodeError mid-run. Force UTF-8 for the child.
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    proc = subprocess.Popen(
        cmd,
        cwd=str(root),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    assert proc.stdout is not None and proc.stderr is not None
    progress_state: dict[str, int] = {}
    # stderr carries tqdm; stdout carries prints. Forward both, parse stderr.
    import threading

    t_out = threading.Thread(
        target=_forward_stream, args=(proc.stdout, sys.stdout, progress_state), daemon=True
    )
    t_err = threading.Thread(
        target=_forward_stream, args=(proc.stderr, sys.stderr, progress_state), daemon=True
    )
    t_out.start()
    t_err.start()
    rc = proc.wait()
    t_out.join(timeout=10)
    t_err.join(timeout=10)

    out = args.output.resolve()
    if not out.is_file() or out.stat().st_size == 0:
        print(f"ERROR: MuseTalk produced no output at {out}", file=sys.stderr)
        return 2
    return rc


if __name__ == "__main__":
    raise SystemExit(main())

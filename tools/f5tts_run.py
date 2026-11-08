"""F5-TTS inference wrapper -- single-shot voice synthesis for the Studio.

Invoked by ``app/services/voice/f5tts_adapter.py`` inside the pinned
``D:\\venvs\\f5tts`` interpreter (torch 2.5.0+cu124, Python 3.11). Loads the
F5TTS model once per process, synthesizes each sentence-boundary chunk in
order, concatenates the waveforms, and writes one WAV. The process exits
after the job, so VRAM is released -- synthesis never assumes MuseTalk (or
anything else) is or isn't resident.

Contract with the adapter:
  * progress lines on stdout: ``F5TTS_PROGRESS <frac> <message>``
  * result line on stdout:    ``F5TTS_DONE <output_path>``
  * failures: non-zero exit + traceback on stderr

Usage:
    python tools/f5tts_run.py --ref-audio ref.wav --ref-text "..." \
        --text-file chunks.txt --output out.wav --hf-cache D:\\F5TTS\\hf-cache
    python tools/f5tts_run.py --ref-audio ref.wav --ref-text "..." \
        --gen-text "Hello world." --output out.wav
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

#: Chunk boundary silence (seconds) inserted between synthesized segments so
#: sentence edges do not run together.
INTER_CHUNK_SILENCE_S = 0.25


def _progress(frac: float, message: str) -> None:
    print(f"F5TTS_PROGRESS {frac:.3f} {message}", flush=True)


def _split_chunks_file(path: Path) -> list[str]:
    """Read pre-chunked lines (one chunk per line) written by the adapter."""
    return [ln.strip() for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description="F5-TTS single-job synthesis")
    parser.add_argument("--ref-audio", required=True, help="Reference voice clip (wav, <12s)")
    parser.add_argument("--ref-text", required=True, help="Transcript of the reference clip")
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--gen-text", help="Single text to synthesize")
    src.add_argument("--text-file", help="File with one pre-chunked segment per line")
    parser.add_argument("--output", required=True, help="Output WAV path")
    parser.add_argument("--model", default="F5TTS_v1_Base", help="F5-TTS model name")
    parser.add_argument("--hf-cache", default="", help="HF_HOME override (weights cache dir)")
    parser.add_argument("--seed", type=int, default=None)
    args = parser.parse_args()

    # HF_HOME must be set before huggingface_hub caches anything.
    if args.hf_cache:
        os.environ["HF_HOME"] = args.hf_cache
        os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

    ref_audio = Path(args.ref_audio)
    if not ref_audio.is_file():
        print(f"F5TTS_ERROR ref audio not found: {ref_audio}", file=sys.stderr)
        return 2
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    if args.gen_text:
        chunks = [args.gen_text.strip()]
    else:
        chunks = _split_chunks_file(Path(args.text_file))
    if not chunks:
        print("F5TTS_ERROR no text chunks to synthesize", file=sys.stderr)
        return 2

    # Import after env setup; torch + f5_tts load takes ~10-20 s cold.
    t0 = time.time()
    _progress(0.02, "loading F5-TTS model")
    import numpy as np
    import soundfile as sf
    from f5_tts.api import F5TTS

    tts = F5TTS(model=args.model)
    _progress(0.10, f"model loaded in {time.time() - t0:.1f}s; {len(chunks)} chunk(s)")

    sr: int | None = None
    segments: list[np.ndarray] = []
    silence: np.ndarray | None = None
    for i, chunk in enumerate(chunks, start=1):
        _progress(
            0.10 + 0.85 * (i - 1) / len(chunks),
            f"synthesizing chunk {i}/{len(chunks)} ({len(chunk)} chars)",
        )
        wav, chunk_sr, _spec = tts.infer(
            ref_file=str(ref_audio),
            ref_text=args.ref_text,
            gen_text=chunk,
            show_info=lambda *_a, **_k: None,
            progress=None,  # tqdm writes to stderr; the adapter parses stdout only
            seed=args.seed,
        )
        arr = np.asarray(wav, dtype=np.float32).reshape(-1)
        if sr is None:
            sr = int(chunk_sr)
            silence = np.zeros(int(sr * INTER_CHUNK_SILENCE_S), dtype=np.float32)
        elif int(chunk_sr) != sr:
            print(
                f"F5TTS_ERROR sample-rate drift {chunk_sr} != {sr}",
                file=sys.stderr,
            )
            return 3
        segments.append(arr)
        if i < len(chunks) and silence is not None:
            segments.append(silence)
        _progress(
            0.10 + 0.85 * i / len(chunks),
            f"chunk {i}/{len(chunks)} done",
        )

    _progress(0.97, "writing output")
    assert sr is not None
    merged = np.concatenate(segments) if segments else np.zeros(0, dtype=np.float32)
    sf.write(str(output), merged, sr)
    _progress(1.0, f"done: {output} ({len(merged) / sr:.1f}s @ {sr}Hz)")
    print(f"F5TTS_DONE {output}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

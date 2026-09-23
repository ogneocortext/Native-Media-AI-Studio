"""Transcribe the HITL-V2 vocals stem with faster-whisper (base, CUDA float16)."""
import json
import os
import sys
import time
from pathlib import Path

# Make the pip-installed cuBLAS/cuDNN DLLs visible to CTranslate2 (Windows)
_site = Path(sys.prefix) / "Lib" / "site-packages" / "nvidia"
for _sub in ("cublas", "cudnn", "cuda_nvrtc"):
    _bin = _site / _sub / "bin"
    if _bin.exists():
        os.add_dll_directory(str(_bin))
        os.environ["PATH"] = str(_bin) + os.pathsep + os.environ.get("PATH", "")

from faster_whisper import WhisperModel  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
VOCALS = ROOT / "output" / "stems" / "htdemucs" / "SunoV6Mini-Human-in-the-Loop-V2" / "vocals.mp3"
OUT = ROOT / "output" / "stems" / "htdemucs" / "SunoV6Mini-Human-in-the-Loop-V2" / "hitl-v2-transcript.json"

print("input:", VOCALS)
MODEL = sys.argv[1] if len(sys.argv) > 1 else "large-v3-turbo"
print("model:", MODEL)
started = time.perf_counter()
# GTX 1070 Ti is Pascal (sm_61): CTranslate2 supports only float32 on this GPU
# (int8/float16 need sm_75+/Turing). float32 on CUDA is still much faster than CPU.
model = WhisperModel(MODEL, device="cuda", compute_type="float32")
print(f"model loaded on CUDA in {time.perf_counter() - started:.1f}s")

started = time.perf_counter()
segments, info = model.transcribe(str(VOCALS), beam_size=5, vad_filter=True)
out = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segments]
elapsed = time.perf_counter() - started

OUT.write_text(json.dumps(out, indent=1), encoding="utf-8")
print(f"language: {info.language} (p={info.language_probability:.2f}) | duration: {info.duration:.1f}s")
print(f"transcribed in {elapsed:.1f}s")
print("done:", len(out), "segments ->", OUT)

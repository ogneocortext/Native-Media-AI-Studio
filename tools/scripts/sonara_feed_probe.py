"""Decide how to feed sonara: raw file vs pre-decoded mono signal.

sonara mis-decodes the stereo M4A (duration 493s instead of 246.5s). Compare:
1. analyze_file(m4a)
2. analyze_file(temp mono 22050 WAV from our decoder)
3. analyze_signal(float32 mono 22050 array)
"""
import os
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "packages" / "backend"))

import sonara  # noqa: E402
from tools.lib.audio import load_audio  # noqa: E402

TRACK = ROOT / "output" / "audio" / "Suno-V6-Mini" / "SunoV6Mini-Human-in-the-Loop-V2.m4a"


def brief(tag, r):
    beats = list(r.get("beats", []))
    print(f"{tag}: duration={r.get('duration_sec'):.1f}s n_beats={r.get('n_beats')} "
          f"bpm={r.get('bpm'):.1f} conf={r.get('bpm_confidence'):.2f} "
          f"first={beats[0] * 512 / 22050:.2f}s last={beats[-1] * 512 / 22050:.2f}s")


brief("raw-m4a   ", sonara.analyze_file(str(TRACK), mode="compact"))

y, sr = load_audio(str(TRACK), sr=22050)
y = np.ascontiguousarray(y, dtype=np.float32)
tmp = os.path.join(tempfile.gettempdir(), "sonara_probe.wav")
sf.write(tmp, y, 22050)
brief("mono-wav  ", sonara.analyze_file(tmp, mode="compact"))

try:
    r = sonara.analyze_signal(y, mode="compact")
    brief("signal-f32", r)
except Exception as e:
    print(f"signal-f32: ERROR {type(e).__name__}: {e}")
os.unlink(tmp)

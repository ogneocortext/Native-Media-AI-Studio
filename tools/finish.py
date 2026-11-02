#!/usr/bin/env python3
"""finish.py — gentle finishing chain for AI-song listening copies.

Goes beyond loudness matching: cleans subsonic rumble, tames sub-bass
dominance, lifts presence/air (the bands Lyria's house master buries),
adds gentle glue compression, then loudness-targets with a true-peak
limiter as ceiling guard. Deliberately GENTLE settings — this polishes
a sketch take for judging; it is not a substitute for stem mixing or
the Ableton finishing stage.

Provenance: built and measured on Orion's side 2026-11-01 against the
Don't Recommend E1 take (sub 75.6% -> 43.8%, presence 3.8% -> 14.6%,
-18.6 -> -14.0 LUFS). Integration into the app is T-AUD-08: the chain
EXTENDS the M1 mastering service (T-AUD-01) with corrective balance —
in-app loudness stays on the repo's own ebur128 path per T-AUD-01's
acceptance; pyloudnorm here is the standalone cross-check meter.

Dependencies: pedalboard, pyloudnorm, soundfile, numpy (pip);
ffmpeg on PATH for the MP3 encode.

Usage:
    python tools/finish.py <input.wav|mp3> <output_basename>
        [--lufs -14] [--sub-cut 3] [--presence 2.5]
Writes <output_basename>.wav and <output_basename>.mp3 and prints
before/after integrated LUFS (pyloudnorm, proper K-weighted metering).
"""
import argparse
import subprocess
import sys

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from pedalboard import (
    Compressor,
    Gain,
    HighpassFilter,
    HighShelfFilter,
    Limiter,
    LowShelfFilter,
    PeakFilter,
    Pedalboard,
)


def measure_lufs(data: np.ndarray, sr: int) -> float:
    meter = pyln.Meter(sr)
    # pyloudnorm wants (samples, channels) — exactly what soundfile returns.
    return float(meter.integrated_loudness(data))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output_basename")
    ap.add_argument("--lufs", type=float, default=-14.0)
    ap.add_argument("--preset", choices=["pop", "dnb"], default="pop",
                    help="pop: sub tamed -3 dB, presence +2.5. "
                         "dnb: bass weight preserved (no sub cut), presence +2.0 — "
                         "DnB weight is root-following sub + reese, never cut it.")
    ap.add_argument("--sub-cut", type=float, default=None,
                    help="dB of low-shelf cut at 120 Hz (default: per preset)")
    ap.add_argument("--presence", type=float, default=None,
                    help="dB of peaking lift at 3.2 kHz (default: per preset)")
    args = ap.parse_args()

    if args.sub_cut is None:
        args.sub_cut = 0.0 if args.preset == "dnb" else 3.0
    if args.presence is None:
        args.presence = 2.0 if args.preset == "dnb" else 2.5

    data, sr = sf.read(args.input, always_2d=True)
    data = data.astype(np.float64)
    before = measure_lufs(data, sr)

    board = Pedalboard([
        HighpassFilter(cutoff_frequency_hz=35.0),
        LowShelfFilter(cutoff_frequency_hz=120.0, gain_db=-args.sub_cut, q=0.7),
        PeakFilter(cutoff_frequency_hz=3200.0, gain_db=args.presence, q=0.9),
        HighShelfFilter(cutoff_frequency_hz=9000.0, gain_db=1.5, q=0.7),
        Compressor(threshold_db=-16.0, ratio=2.5,
                   attack_ms=10.0, release_ms=180.0),
    ])
    processed = board(data.T.astype(np.float32), sr).T.astype(np.float64)

    mid = measure_lufs(processed, sr)
    gain_db = args.lufs - mid
    finisher = Pedalboard([Gain(gain_db=gain_db),
                           Limiter(threshold_db=-1.0, release_ms=120.0)])
    processed = finisher(processed.T.astype(np.float32), sr).T.astype(np.float64)
    # The limiter stage can shift integrated loudness (first version
    # overshot a -14 target to -10). Close the loop: re-measure and
    # trim, capping the trim so true peak stays <= -1.0 dB.
    after = measure_lufs(processed, sr)
    trim_db = args.lufs - after
    if abs(trim_db) > 0.3:
        peak_db = 20.0 * np.log10(np.max(np.abs(processed)) + 1e-12)
        trim_db = min(trim_db, -1.0 - peak_db)
        processed = processed * (10.0 ** (trim_db / 20.0))
        after = measure_lufs(processed, sr)
        print(f"loudness trim applied: {trim_db:+.1f} dB (limiter had shifted level)")

    wav_out = args.output_basename + ".wav"
    mp3_out = args.output_basename + ".mp3"
    sf.write(wav_out, processed, sr, subtype="PCM_16")
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", wav_out,
         "-codec:a", "libmp3lame", "-b:a", "192k", mp3_out],
        check=True)

    print(f"in:  {args.input}")
    print(f"LUFS before: {before:.1f}  after chain (pre-gain): {mid:.1f}  "
          f"final: {after:.1f}  (target {args.lufs})")
    print(f"chain: HP 35Hz | low-shelf 120Hz {-args.sub_cut:+.1f}dB | "
          f"presence 3.2kHz {args.presence:+.1f}dB | air 9kHz +1.5dB | "
          f"comp 2.5:1 | gain {gain_db:+.1f}dB | limiter -1.0dBTP")
    print(f"out: {wav_out} / {mp3_out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

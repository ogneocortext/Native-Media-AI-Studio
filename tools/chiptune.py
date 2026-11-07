# ruff: noqa: N999
"""chiptune — constraint-based chip-music renderer (sandbox tool).

Renders a tracker-style pattern file to WAV in output/audio/ so results
land in the Media Library and can feed the analyzer/visualizer pipeline.

    python tools/chiptune.py song.chip                 # render to output/audio/
    python tools/chiptune.py song.chip --system nes    # override system preset
    python tools/chiptune.py --demo                    # render the built-in demo

Pattern file format (line-based, # comments):

    system nes          # atari | nes | gameboy | pico8 | loose | full
    tempo 140           # BPM; one cell = 1/16 note
    swing 0.58          # optional shuffle: 0.5 straight, >0.5 delays off-8ths
    vibrato lead 0.12 5.0  # optional per-channel LFO: depth in semitones, rate Hz
    filter 2500 0.7        # optional resonant lowpass on the tonal bus (SID-style)
    ringmod lead 2.0       # optional: voice osc x carrier osc at ratio x freq
    order A B A            # optional: song form over named pattern blocks

    pattern A:             # optional section blocks (tracker order list);
    lead: ...              # channels omitted in a block render as rests.
                           # Without 'pattern' blocks the file is one
                           # implicit pattern (back-compatible).
    wave lead pulse 25  # optional per-channel override: pulse|triangle|saw|noise + duty%

    lead: C-4 . . E-4~0,4,7 . . | G-4 . . A-4 . . | ...
    bass: C-3 . . . . . . . . . . | ...
    noise: . . x . . . x . . . . . | ...

Cells are separated by spaces; '|' separates bars (cosmetic). Tokens:
    C-4 .. B-8    note (sharp names too: C#4, Bb3)
    .             rest
    -             hold previous note
    >NOTE         portamento — glides from the previous pitch to NOTE
                  over the cell (semitone-space glide, tracker style)
    <NOTE         pitch-drop — starts one octave above NOTE and glides
                  down to it (kick-design trick)
    x             noise-channel hit (other channels: rest)
    NOTE~s1,s2    arpeggio — cycles the note + semitone offsets per cell

System presets define the channel layout, wave palette, bandwidth and
noise type — i.e. the subgenre:

    atari    2x pulse (8-step duty) + LFSR noise, ~8 kHz bandlimit
    nes      2x pulse + triangle + LFSR noise, ~15 kHz
    gameboy  2x pulse + 4-bit wave + LFSR noise, ~11 kHz (wave = lead-ish)
    pico8    2x pulse + triangle + noise @ 22.05 kHz output
    loose    2x pulse + triangle + saw + noise, light bandlimit
    full     same voices, no bandlimit, stereo spread
    snes     6 vox + noise, echo + vibrato, ~20 kHz
    genesis  3x FM + PSG tone/noise, ~16 kHz
    c64      3 mixed osc + noise, filter + ring-mod, ~9 kHz
    opl2     9x 2-op FM (AdLib), ~16 kHz
    opl3     18x 2/4-op FM (SB16), ~16 kHz
    mt32     8x LA32 partials + noise, 32 kHz stereo
    sc55     16-part GM/GS, 32 kHz stereo
    sc88     32-part GM/GS, 32 kHz stereo + echo
    sc88pro  32-part GM/GS/XG-lite, 32 kHz stereo + echo/vibrato
    psx      24 ADPCM voices + noise, 44.1 kHz stereo reverb

Deterministic: same file + same system => byte-identical WAV (fixed seed
for noise; PCM synthesis only, no wall-clock).
"""
from __future__ import annotations

import argparse
import math
import re
import sys
import wave
from pathlib import Path

import numpy as np

# Import the new hardware profiles
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import operator

from packages.backend.app.core.chiptune_hardware import (
    ALL_SYSTEMS,
    get_system_spec,
)

REPO = Path(__file__).resolve().parent.parent
OUT_DIR = REPO / "output" / "audio"

SR = 44100  # internal render rate; systems bandlimit on top

# Public API exports
__all__ = [
    "Pattern",
    "parse_chip",
    "render",
    "note_to_freq",
    "import_midi",
    "transpose_pattern",
    "pattern_report",
    "signal_report",
    "normalize_loudness",
    "render_roll",
    "write_wav",
    "SYSTEMS",
    "DEMO",
    "OUT_DIR",
    "SR",
]


# Backwards compatibility: map old system names to new hardware specs
# The old SYSTEMS dict is replaced by get_system_spec() from chiptune_hardware
def _get_legacy_system(name: str) -> dict:
    """Convert new hardware spec to legacy format for backwards compatibility."""
    spec = get_system_spec(name)
    # Convert to legacy format
    channels = []
    for ch in spec.channels:
        wave_name = ch.waveform.value
        duty = ch.duty_percent
        channels.append((wave_name, duty))

    return {
        "channels": channels,
        "bandwidth": spec.bandwidth_hz,
        "noise": spec.noise_type.value,
        "stereo": spec.stereo,
        "label": spec.label,
        "output_sr": spec.output_sample_rate or spec.sample_rate,
        "echo": spec.echo,
        "vibrato": spec.vibrato,
        "core": spec.core.value,  # Add core for render core selection
    }


# Build legacy SYSTEMS dict for backwards compatibility
SYSTEMS = {}
for name, _spec in ALL_SYSTEMS.items():
    SYSTEMS[name] = _get_legacy_system(name)

# Note: SYSTEM_ALIASES are used by get_system_spec() for name resolution
# but are NOT added to SYSTEMS to avoid duplicate entries in /api/chiptune/systems

# Atari TIA pulse-duty quantization steps (fraction of period high).
_ATARI_DUTIES = [0.0, 0.03125, 0.09375, 0.21875, 0.46875, 0.71875, 0.96875, 1.0]


def _quantize_duty(duty: int, system: str) -> int:
    """Atari's TIA only has 8 duty steps; map percent to nearest."""
    if system != "atari":
        return duty
    target = duty / 100.0
    nearest = min(_ATARI_DUTIES, key=lambda d: abs(d - target))
    return int(round(nearest * 100))

# A minor-ish demo: 8 bars, i - VI - III - VII vibe in A minor.


DEMO = """
# chiptune demo - built-in pattern (A minor, 8 bars x 16 cells, 6 parts)
# motif-first + anti-jingle variables (owner verdicts, T-MUS-06)
system nes
tempo 150
swing 0.56
vibrato lead 0.12 5.0
wave lead pulse 25

lead: A-4 . C-5 . E-5 . A-5 . . G-5 . . E-5 . C-5 . | D-5 . . B-4 . . G-4 . . G#-4 . . . . . . | A-4 . C-5 . E-5 . A-5 . . G-5 . . E-5 . C-5 . | D-5 . . B-4 . . G-4 . . G#-4 . . . . . . | A-5 . C-6 . E-6 . A-6 . . G-6 . . E-6 . C-6 . | D-6 . . B-5 . . G-5 . . G#5 . . . . . . | A-4 . C-5 . E-5 . A-5 . . G-5 . . E-5 . C-5 . | >A-4 . . >C-5 . . >E-5 . . >A-5 - - - - - -
harmony: C-5 . . E-5 . . A-5 . . C-6 . . E-6 . . . | B-4 . . G-4 . . D-5 . . B-4 . . G-4 . . . | E-5 . . G-5 . . C-6 . . E-6 . . G-6 . . . | D-5 . . C-5 . . A-4 . . D-5 . . F-5 . . . | G-5 . . B-5 . . E-6 . . G-6 . . B-6 . . . | . . . . . . . . . . . . . . . . | E-5 . . A-5 . . C-6 . . E-6 . . A-6 . . . | . . . . . . . . . . . . . . . .
pad: E-4 - - - - - - - - - - - - - - - | E-4 - - - - - - - - - - - - - - - | A-4 - - - - - - - - - - - - - - - | A-4 - - - - - - - - - - - - - - - | G-4 - - - - - - - - - - - - - - - | G-4 - - - - - - - - - - - - - - - | D-5 - - - - - - - - - - - - - - - | E-4 - - - - - - - - - - - - - - -
arp: A-4 . C-5 . E-5 . A-4 . C-5 . E-5 . A-4 . C-5 . | E-5 . C-5 . A-4 . E-5 . C-5 . A-4 . E-5 . C-5 . | F-4 . A-4 . C-5 . F-4 . A-4 . C-5 . F-4 . A-4 . | C-5 . A-4 . F-4 . C-5 . A-4 . F-4 . C-5 . A-4 . | G-4 . C-5 . E-5 . G-4 . C-5 . E-5 . G-4 . C-5 . | . . . . . . . . . . . . . . . . | G-4 . B-4 . D-5 . G-4 . B-4 . D-5 . G-4 . B-4 . | . . . . . . . . . . . . . . . .
bass: <A-2~12,8,4 . <A-2~12,8,4 . <A-2~12,8,4 . <A-2~12,8,4 . A-2~12,8,4 . A-2~12,8,4 . A-2~12,8,4 . A-2~12,8,4 . | <F-2~12,8,4 . <F-2~12,8,4 . <F-2~12,8,4 . <F-2~12,8,4 . F-2~12,8,4 . F-2~12,8,4 . F-2~12,8,4 . F-2~12,8,4 . | C-3 . C-3 . C-3 . C-3 . G-2 . G-2 . G-2 . G-2 . | A-2 . A-2 . A-2 . A-2 . G-2 . G-2 . E-2 . E-2 . | C-3 - - - - - - - G-2 - - - - - - - | F-2 . F-2 F-2 . F-2 . F-2 F-2 . F-2 F-2 . E-2 . E-2 | A-2 . A-2 . A-2 . A-2 . E-2 . E-2 . E-2 . E-2 . | E-2 . D-2 . C-3 . B-2 . A-2 - - - - - - -
hat: x . . x . . x . x . . x . . x . | x . . x . . x . x . . x . . x . | x . . x . . x . x . . x . . x . | x . . x . . x . x . . x . . x . | x . . x . . x . x . . x . . x . | x . . . x . . . x . . . x . . . | x . . x . . x . x . . x . . x . | x . x . x . x . x . x . x x x x
"""


class Pattern:
    """Parsed .chip file: tempo + channel -> list of cells."""

    def __init__(self) -> None:
        self.system = "nes"
        self.tempo = 140.0
        self.swing = 0.5
        self.waves: dict[str, tuple[str, int]] = {}
        self.vibrato: dict[str, tuple[float, float]] = {}
        self.filter: tuple[float, float] | None = None
        self.ringmod: dict[str, float] = {}
        self.channels: dict[str, list[str]] = {}
        # Order-list support: named pattern blocks + 'order a b a'.
        # p.channels is always the flattened song (order concatenated).
        self.patterns: dict[str, dict[str, list[str]]] = {}
        self.order: list[str] = []


def note_to_freq(name: str) -> float:
    # Grammar: letter, optional #/b accidental, optional '-' separator,
    # digits. 'A-4', 'C#4', 'G#-4', 'Bb3' all parse; '-' is never signed.
    m = re.fullmatch(r"([A-G])(#{1,2}|b{1,2})?-?(\d+)", name)
    if not m:
        raise ValueError(f"bad note {name!r}")
    base = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}[m.group(1)]
    acc = m.group(2) or ""
    base += acc.count("#") - acc.count("b")
    midi = (int(m.group(3)) + 1) * 12 + base
    return 440.0 * 2 ** ((midi - 69) / 12)


def parse_chip(text: str) -> Pattern:
    p = Pattern()
    # Backslash-newline continues the previous logical line — channel blocks
    # may span physical lines (the built-in DEMO relies on this).
    text = re.sub(r"\\\s*\n", " ", text)
    cur: str | None = None  # None = implicit top-level pattern
    for raw in text.splitlines():
        # '#' starts a comment only at line start or after whitespace —
        # 'G#-4' sharp notes must survive.
        cm = re.search(r"(?<!\S)#", raw)
        line = (raw[:cm.start()] if cm else raw).strip()
        if not line:
            continue
        if line.startswith("pattern ") and line.endswith(":"):
            cur = line[len("pattern "):-1].strip()
            if not cur:
                raise ValueError("empty pattern name")
            if cur in p.patterns:
                raise ValueError(f"duplicate pattern {cur!r}")
            p.patterns[cur] = {}
            continue
        if ":" in line and not line.startswith(("system", "tempo", "wave")):
            name, _, cells = line.partition(":")
            # '|' is cosmetic bar separation; cells split on whitespace.
            toks = list(cells.replace("|", " ").split())
            if cur is None:
                p.channels[name.strip()] = toks
            else:
                p.patterns[cur][name.strip()] = toks
            continue
        parts = line.split()
        if parts[0] == "system" and len(parts) > 1:
            p.system = parts[1]
        elif parts[0] == "tempo" and len(parts) > 1:
            p.tempo = float(parts[1])
        elif parts[0] == "wave" and len(parts) >= 3:
            wave_name = parts[2]
            duty = int(parts[3]) if len(parts) > 3 else 50
            p.waves[parts[1]] = (wave_name, duty)
        elif parts[0] == "swing" and len(parts) > 1:
            p.swing = float(parts[1])
        elif parts[0] == "vibrato" and len(parts) >= 4:
            p.vibrato[parts[1]] = (float(parts[2]), float(parts[3]))
        elif parts[0] == "filter" and len(parts) >= 3:
            p.filter = (float(parts[1]), float(parts[2]))
        elif parts[0] == "ringmod" and len(parts) >= 3:
            p.ringmod[parts[1]] = float(parts[2])
        elif parts[0] == "order" and len(parts) > 1:
            p.order = parts[1:]
    if p.patterns:
        # Named blocks: flatten order -> p.channels. Every channel gets
        # cells for every pattern (rests where a pattern omits it), so
        # all downstream consumers see one aligned song.
        order = p.order or list(p.patterns)
        unknown = [n for n in order if n not in p.patterns]
        if unknown:
            raise ValueError(f"order references unknown pattern(s): {unknown}")
        chan_order: list[str] = []
        for pname in order:
            for c in p.patterns[pname]:
                if c not in chan_order:
                    chan_order.append(c)
        flat: dict[str, list[str]] = {c: [] for c in chan_order}
        for pname in order:
            patch = p.patterns[pname]
            plen = max((len(v) for v in patch.values()), default=0)
            for c in chan_order:
                cells = patch.get(c) or []
                flat[c].extend(cells + ["."] * (plen - len(cells)))
        p.channels = flat
    if not p.channels:
        raise ValueError("no channel lines found (expected 'name: cells ...')")
    return p


_PC_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def midi_pitch_name(pitch: int) -> str:
    """MIDI note number -> .chip name ('C-4' style; MIDI# == our semitone)."""
    return f"{_PC_SHARP[pitch % 12]}-{pitch // 12 - 1}"


_MAX_LANES = 4  # monophonic lanes per MIDI channel before collapse


def _split_lanes(notes: list[tuple[float, float, int]],
                 max_lanes: int = _MAX_LANES
                 ) -> list[list[tuple[float, float, int]]]:
    """Interval-graph coloring: greedy lane assignment so overlapping
    notes land on different lanes (each lane ~monophonic)."""
    lanes: list[list[tuple[float, float, int]]] = []
    lane_end: list[float] = []
    for s, e, p in sorted(notes):
        for li in range(len(lanes)):
            if lane_end[li] <= s:
                lanes[li].append((s, e, p))
                lane_end[li] = e
                break
        else:
            if len(lanes) < max_lanes:
                lanes.append([(s, e, p)])
                lane_end.append(e)
            else:
                # Over cap: fold into the lane ending soonest — its
                # per-cell top-note rule absorbs the overlap.
                li = min(range(len(lanes)), key=lambda i: lane_end[i])
                lanes[li].append((s, e, p))
                lane_end[li] = max(lane_end[li], e)
    return lanes


def import_midi(path: str | Path) -> str:
    """MIDI file -> .chip text (v1 importer).

    Limitations (documented, not silent):
      - polyphony is preserved by splitting each MIDI channel into
        monophonic lanes (up to _MAX_LANES per channel); voices beyond
        the cap collapse to the lane's top note
      - constant tempo = first set_tempo event; tempo changes ignored
      - velocity, time signature, CC ignored
      - channel 10 (drums) -> 'x' noise hits; other channels -> melodic
    """
    import mido

    mid = mido.MidiFile(str(path))
    tpq = mid.ticks_per_beat
    tempo_us = 500000
    for tr in mid.tracks:
        tick = 0
        for msg in tr:
            tick += msg.time
            if msg.type == "set_tempo":
                tempo_us = msg.tempo
                break
        else:
            continue
        break
    bpm = max(20, min(300, round(60_000_000 / tempo_us)))
    sec_per_tick = (tempo_us / 1e6) / tpq
    cell_sec = 60.0 / bpm / 4.0

    # Track names -> channel names, so 'Bass'/'Drums' metadata survives
    # into role binding (a channel fed by one named track gets that name).
    chan_track_name: dict[int, str] = {}
    for tr in mid.tracks:
        tname = None
        tr_chans: set[int] = set()
        for msg in tr:
            if msg.type == "track_name":
                tname = msg.name
            elif msg.type in ("note_on", "note_off"):
                tr_chans.add(msg.channel)
        if tname:
            for c in tr_chans:
                chan_track_name.setdefault(c, tname)

    # note intervals per MIDI channel: (start_s, end_s, pitch)
    chan_notes: dict[int, list[tuple[float, float, int]]] = {}
    total_ticks = 0
    for tr in mid.tracks:
        tick = 0
        open_notes: dict[tuple[int, int], int] = {}
        tr_notes: list[tuple[int, int, int, int]] = []
        for msg in tr:
            tick += msg.time
            total_ticks = max(total_ticks, tick)
            if msg.type == "note_on" and msg.velocity > 0:
                open_notes[(msg.channel, msg.note)] = tick
            elif (msg.type == "note_off"
                  or (msg.type == "note_on" and msg.velocity == 0)):
                start = open_notes.pop((msg.channel, msg.note), None)
                if start is not None:
                    tr_notes.append((msg.channel, msg.note, start, tick))
        for (ch, note), start in open_notes.items():
            tr_notes.append((ch, note, start, total_ticks))
        for ch, note, s, e in tr_notes:
            chan_notes.setdefault(ch, []).append(
                (s * sec_per_tick, max(e, s + 1) * sec_per_tick, note))

    if not chan_notes:
        raise ValueError("no notes found in MIDI file")

    n_cells = max(1, int(total_ticks * sec_per_tick / cell_sec) + 1)

    def _cells_for(notes: list[tuple[float, float, int]]) -> list[str]:
        cells: list[str] = []
        prev: int | None = None
        for i in range(n_cells):
            cs, ce = i * cell_sec, (i + 1) * cell_sec
            top = None
            for s, e, pt in notes:
                if s < ce and e > cs and (top is None or pt > top):
                    top = pt
            if top is None:
                cells.append(".")
                prev = None
            elif prev == top:
                cells.append("-")
            else:
                cells.append(midi_pitch_name(top))
                prev = top
        return cells

    def _drum_cells(notes: list[tuple[float, float, int]]) -> list[str]:
        cells = []
        for i in range(n_cells):
            cs, ce = i * cell_sec, (i + 1) * cell_sec
            cells.append("x" if any(s < ce and e > cs
                                    for s, e, _ in notes) else ".")
        return cells

    # Emit drums first, then melodic channels by descending mean pitch so
    # the lead-ish line binds to the first free voice.
    lines = [
        f"# imported from {Path(path).name} via import_midi (v1: top note",
        "# per cell, constant tempo, velocity/CC ignored)",
        "system nes",
        f"tempo {bpm}",
        "",
    ]

    def _ch_name(ch: int) -> str:
        if ch == 9:
            return "drums"
        tname = chan_track_name.get(ch)
        if tname:
            s = re.sub(r"[^A-Za-z0-9]+", "-", tname).strip("-").lower()
            if s:
                return s
        return f"ch{ch + 1}"

    melodic = []
    for ch in sorted(chan_notes):
        notes = chan_notes[ch]
        if ch == 9:
            lines.append(f"drums: {' '.join(_drum_cells(notes))}")
        else:
            lanes = _split_lanes(notes)
            lane_stats = sorted(
                ((sum(p for _, _, p in lane) / len(lane), lane)
                 for lane in lanes),
                key=lambda x: -x[0])
            ch_mean = sum(p for _, _, p in notes) / len(notes)
            melodic.append((ch_mean, ch, lane_stats))
    for _, ch, lane_stats in sorted(melodic, reverse=True):
        base = _ch_name(ch)
        for li, (_, lane) in enumerate(lane_stats):
            suffix = "" if li == 0 else f"_{li + 1}"
            lines.append(f"{base}{suffix}: {' '.join(_cells_for(lane))}")
    return "\n".join(lines) + "\n"


def _lfsr_noise(n: int, clock_div: int = 13, seed: int = 1) -> np.ndarray:
    """Deterministic LFSR noise — the NES/GB-style periodic hash noise."""
    rng = np.random.default_rng(seed)
    # White noise decimated to the LFSR clock gives the gritty periodic feel.
    white = rng.integers(0, 2, size=n * clock_div + 1, dtype=np.int8)
    return white[::clock_div][:n].astype(np.float64) * 2 - 1


def _osc(kind: str, duty: int, phase: np.ndarray) -> np.ndarray:
    """One oscillator cycle evaluated at phases in [0,1)."""
    p = phase % 1.0
    if kind == "pulse":
        d = np.clip(duty, 1, 99) / 100.0
        return np.where(p < d, 1.0, -1.0)
    if kind == "triangle":
        return 4.0 * np.abs(p - 0.5) - 1.0
    if kind == "saw":
        return 2.0 * p - 1.0
    if kind == "wave":  # Game Boy 4-bit wavetable: soft triangle-ish
        table = np.array([0.0, 0.6, 1.0, 0.6, 0.0, -0.6, -1.0, -0.6])
        return table[(p * 8).astype(int) % 8]
    if kind == "vox":  # SNES-ish: saw/triangle blend (BRR approximation)
        saw = 2.0 * p - 1.0
        tri = 4.0 * np.abs(p - 0.5) - 1.0
        return 0.6 * saw + 0.4 * tri
    raise ValueError(kind)


def _fm_voice(phase: np.ndarray, index: float, ratio: float = 1.0) -> np.ndarray:
    """2-operator FM (YM2612-style): modulator sine phase-modulates carrier.

    phase is the carrier phase in cycles; modulator runs at `ratio`×.
    index = modulation depth (YM2612 calls it the feedback-scaled index).
    """
    mod = np.sin(2.0 * np.pi * ratio * phase)
    return np.sin(2.0 * np.pi * phase + index * mod)


def _assign_voices(p: Pattern, chan_specs: list[tuple[str, int]],
                   sysname: str, *, quiet: bool = False) -> list[tuple[str, str, int, list[str]] | None]:
    """Bind channel lines to system voices by role, not position.

    Names containing noise/hat/perc/drum -> the noise voice; 'bass' ->
    the low voice (triangle/wave/saw if the system has one, else last
    pulse); everything else fills remaining tonal voices, densest
    line first so busy imported lanes outlive sparse pads. All-rest
    tonal lines never consume a voice.
    Returns a list aligned to chan_specs; entries are
    (line_name, wave, duty, cells) or None for silent voices.
    For FM voices, the duty field carries fm_index*10.
    """
    slots: list[tuple[str, str, int, list[str]] | None] = [None] * len(chan_specs)
    used: set[int] = set()
    names = list(p.channels)

    def _is_noise(name: str) -> bool:
        low = name.lower()
        return any(k in low for k in ("noise", "hat", "perc", "drum"))

    def _is_rest_line(name: str) -> bool:
        return all(c in ".-" for c in p.channels[name])

    def _density(name: str) -> float:
        cells = p.channels[name]
        return sum(1 for c in cells if c not in ".-") / max(len(cells), 1)

    def _is_noise_slot(i: int) -> bool:
        return chan_specs[i][0] == "noise"

    # Pass 1: noise lines -> noise slots.
    for name in names:
        if not _is_noise(name):
            continue
        for i, spec in enumerate(chan_specs):
            if i not in used and _is_noise_slot(i):
                w, d = p.waves.get(name, spec)
                slots[i] = (name, w, _quantize_duty(d, sysname), p.channels[name])
                used.add(i)
                break

    # Pass 2: bass lines -> deepest free low-voice slots, densest first.
    tonal = [i for i in range(len(chan_specs)) if not _is_noise_slot(i)]
    low_waves = {"triangle", "wave", "saw", "vox", "fm"}
    low_slots = [i for i in reversed(tonal)
                 if chan_specs[i][0] in low_waves] or list(reversed(tonal))
    bass_names = sorted(
        (n for n in names if "bass" in n.lower() and not _is_noise(n)
         and not _is_rest_line(n)),
        key=lambda n: -_density(n))
    for name in bass_names:
        target = next((i for i in low_slots if i not in used), None)
        if target is None:
            break
        w, d = p.waves.get(name, chan_specs[target])
        # For FM voices, store fm_index*10 in duty field
        if w == "fm":
            spec_obj = get_system_spec(sysname)
            fm_channel = next((ch for ch in spec_obj.channels if ch.waveform.value == "fm"), None)
            d = int((fm_channel.fm_index if fm_channel else 1.6) * 10) if fm_channel else int(1.6 * 10)
        slots[target] = (name, w, _quantize_duty(d, sysname), p.channels[name])
        used.add(target)

    # Pass 3: remaining lines fill remaining tonal voices, densest
    # first so imported polyphony keeps its busiest lanes.
    rest = [n for n in names
            if n not in {s[0] for s in slots if s}
            and not _is_noise(n) and not _is_rest_line(n)]
    for name in sorted(rest, key=lambda n: (-_density(n), names.index(n))):
        for i in tonal:
            if i not in used:
                w, d = p.waves.get(name, chan_specs[i])
                # For FM voices, store fm_index*10 in duty field
                if w == "fm":
                    spec_obj = get_system_spec(sysname)
                    fm_channel = next((ch for ch in spec_obj.channels if ch.waveform.value == "fm"), None)
                    d = int((fm_channel.fm_index if fm_channel else 1.6) * 10) if fm_channel else int(1.6 * 10)
                slots[i] = (name, w, _quantize_duty(d, sysname), p.channels[name])
                used.add(i)
                break
        else:
            if not quiet:
                print(f"[chiptune] WARN: channel {name!r} dropped — "
                      f"{sysname} has no free voice for it")
    return slots


# ------------------------------------------------------------
# Nuked-OPN2 FM Voice Renderer
# ------------------------------------------------------------
def _render_fm_nuked_opn2(p: Pattern, voice_name: str, cells: list[str],
                          starts: list[int], sr: int, cell_sec: float, cpu_clock_hz: int = 7670454) -> np.ndarray | None:
    """Render an FM voice using Nuked-OPN2 cycle-accurate emulation.

    Uses algorithm 7 (all 4 operators as carriers) for simplicity.
    Builds a register write timeline and runs the chip cycle-accurate.
    """
    try:
        import nuked_opn2
    except ImportError:
        return None  # Fall back to behavioral

    # Initialize chip with algorithm 7 (all 4 operators as carriers)
    chip = nuked_opn2.NukedOPN2()
    chip.set_chip_type(3)  # MODE_YM2612 | MODE_READMODE

    # Disable DAC for pure FM
    chip.write_register(0x2B, 0x00)
    chip.write_register(0x22, 0x00)  # LFO off
    chip.write_register(0x20, 0x07)  # Algorithm 7: all carriers

    # Configure all 4 operators as carriers with default envelope
    for op_base in [0x30, 0x34, 0x38, 0x3C]:
        chip.write_register(op_base, 0x00)        # MUL=1
        chip.write_register(op_base + 0x10, 0x00)  # TL=0 (max volume)
        chip.write_register(op_base + 0x20, 0x0F)  # AR=15 (fastest attack)
        chip.write_register(op_base + 0x30, 0x00)  # DR=0
        chip.write_register(op_base + 0x40, 0x0F)  # SR=0, RR=15
        chip.write_register(op_base + 0x50, 0x00)  # SL=0
        chip.write_register(op_base + 0x60, 0x00)  # SSG-EG=0

    # Build register write timeline from cells
    events = []  # (sample_index, register, value)
    arp_semitones = [0.0]

    def freq_to_fnum_block(freq_hz: float) -> tuple[int, int]:
        """Convert frequency to F-Number and Block for YM2612."""
        if freq_hz <= 0:
            return 0, 0
        master_clock = cpu_clock_hz
        internal_clock = master_clock / 6.0
        fnum = int(round(freq_hz * (2**20) / internal_clock))
        block = 0
        while fnum >= 0x400 and block < 7:
            fnum >>= 1
            block += 1
        return min(fnum, 0x3FF), block

    for i, cell in enumerate(cells):
        start = starts[i]
        if start >= len(cells) * int(cell_sec * 44100):  # Approximate bound check
            continue

        if cell == ".":
            events.append((start, 0x28, 0x00))  # Key off
            continue
        if cell == "-":
            continue

        porta = cell.startswith(">")
        drop = cell.startswith("<")
        base, _, arp = (cell[1:] if (porta or drop) else cell).partition("~")
        try:
            target = note_to_freq(base)
        except ValueError:
            target = 0.0
        if arp:
            try:
                arp_semitones = [float(x) for x in arp.split(",")]
            except ValueError:
                arp_semitones = [0.0]

        if target <= 0:
            continue

        if porta:
            pass  # Portamento not supported in register-level yet
        elif drop:
            target *= 2.0

        # Apply arpeggio (use first offset for simplicity)
        arp_offset = arp_semitones[0] if arp_semitones else 0.0
        final_freq = target * (2.0 ** (arp_offset / 12.0))

        if final_freq > 0:
            fnum, block = freq_to_fnum_block(final_freq)
            events.extend(((start, 160, fnum & 255), (start, 164, (block & 7) << 3 | fnum >> 8), (start, 40, 240)))  # Key on all operators
        else:
            events.append((start, 0x28, 0x00))

    # Generate audio by running the chip in chunks between events

    # Sort events by sample index
    events.sort(key=operator.itemgetter(0))

    # Convert events to time-based (seconds)
    time_events = [(idx / 44100.0, reg, val) for idx, reg, val in events]
    time_events.sort(key=operator.itemgetter(0))

    if not time_events:
        return np.zeros(0, dtype=np.float32)

    output_chunks = []
    prev_time = 0.0

    for ev_time, reg, val in time_events:
        if ev_time > prev_time:
            duration = ev_time - prev_time
            samples_needed = int(duration * 44100)
            if samples_needed > 0:
                raw = chip.generate(samples_needed, stereo=False)
                import struct
                samples = struct.unpack('<' + 'h' * (len(raw) // 2), raw)
                chunk = np.array(samples, dtype=np.float32) / 32768.0
                output_chunks.append(chunk)
        chip.write_register(reg, val)
        prev_time = ev_time

    # Generate remaining - use pattern tempo and cells for total duration
    total_duration = len(starts) * (60.0 / p.tempo / 4.0)  # Fixed: use p.tempo
    if prev_time < total_duration:
        duration = total_duration - prev_time
        samples_needed = int(duration * 44100)
        if samples_needed > 0:
            raw = chip.generate(samples_needed, stereo=False)
            import struct
            samples = struct.unpack('<' + 'h' * (len(raw) // 2), raw)
            chunk = np.array(samples, dtype=np.float32) / 32768.0
            output_chunks.append(chunk)

    if output_chunks:
        full_output = np.concatenate(output_chunks)
        return full_output.astype(np.float32)

    return None


def render(p: Pattern, system_name: str | None = None, *, core: str | None = None) -> tuple[np.ndarray, int]:
    sysname = system_name or p.system
    # Resolve alias to canonical system name
    try:
        sysname = get_system_spec(sysname).name
    except ValueError:
        pass  # Keep original if not an alias
    if sysname not in SYSTEMS:
        raise ValueError(f"unknown system {sysname!r}; choose from {sorted(SYSTEMS)}")
    spec = SYSTEMS[sysname]
    chan_specs = spec["channels"]

    # Use core from spec if not explicitly provided
    render_core = core or spec.get("core", "behavioral")

    sr = SR  # always synthesize at 44.1k; output_sr decimates once at end

    slots = _assign_voices(p, chan_specs, sysname)
    bound = [s for s in slots if s]
    if not bound:
        raise ValueError("no channel lines could be bound to voices")

    n_cells = max(len(cells) for _, _, _, cells in bound)
    cell_sec = 60.0 / p.tempo / 4.0  # 16th note
    total = n_cells * cell_sec
    t = np.arange(int(total * sr)) / sr
    mix = np.zeros(len(t), dtype=np.float64)
    tonal = np.zeros(len(t), dtype=np.float64)  # filtered as a bus (SID-style)

    # Per-voice gains — keep headroom for 5-voice sums.
    voice_gain = 0.22 if len(chan_specs) <= 4 else 0.16

    # Swing: the off-8th cell of each beat pair (cells 2,3 mod 4) is
    # delayed by (swing-0.5)*2 cells. 0.5 = straight, ~0.6 = shuffled.
    starts = [0] * (n_cells + 1)
    for i in range(n_cells + 1):
        off = ((p.swing - 0.5) * 2 * cell_sec
               if i < n_cells and (i // 2) % 2 == 1 else 0.0)
        starts[i] = int(round((i * cell_sec + off) * sr))

    # Initialize Nuked-OPN2 if using that core for FM voices
    nuked_chip = None
    fm_voice_indices = []  # (bound_index, channel_index) for FM voices
    if render_core == "nuked-opn2":
        try:
            import nuked_opn2
            nuked_chip = nuked_opn2.NukedOPN2()
            nuked_chip.set_chip_type(3)  # MODE_YM2612 | MODE_READMODE
            # Find FM voice indices in bound channels
            for bi, (name, wave_kind, duty, _cells) in enumerate(bound):
                if wave_kind == "fm":
                    fm_voice_indices.append((bi, name, duty))
        except ImportError:
            print("[chiptune] WARNING: nuked-opn2 not available, falling back to behavioral FM")
            render_core = "behavioral"
            nuked_chip = None
        except Exception as e:
            print(f"[chiptune] WARNING: nuked-opn2 init failed: {e}, falling back to behavioral FM")
            render_core = "behavioral"
            nuked_chip = None

    for ci, (name, wave_kind, duty, cells) in enumerate(bound):
        if wave_kind == "noise":
            # Noise voice: each note cell triggers a burst; pitch selects
            # the LFSR clock division (Atari/GB style). 'x' = default hit.
            for i, cell in enumerate(cells):
                if cell in (".", "-"):
                    continue
                tok = cell.split("~", 1)[0]
                try:
                    f = 220.0 if tok == "x" else note_to_freq(tok)
                except ValueError:
                    continue
                div = int(np.clip(sr / (f * 32), 2, 64))
                start = starts[i]
                end = min(starts[i + 1], len(t))
                if end <= start:
                    continue
                seg = _lfsr_noise(end - start, clock_div=div,
                                 seed=0xC0FFEE + ci * 977 + i)
                # Short envelope so hits don't click.
                n = end - start
                env = np.minimum(1.0, np.arange(n) / (0.004 * sr))
                env *= np.minimum(1.0, np.arange(n)[::-1] / (0.006 * sr))
                mix[start:end] += seg * env * voice_gain * 0.8
            continue

        # Tonal voice: per-sample freq track from cells, then integrate
        # to phase. freq==0 regions render as silence.
        freq = np.zeros(len(t), dtype=np.float64)
        cur_f = 0.0
        glide_f = 0.0  # pitch portamento carries from the last sounded note
        arp_semitones = [0.0]
        for i, cell in enumerate(cells):
            start = starts[i]
            end = min(starts[i + 1], len(t))
            if end <= start:
                continue
            if cell == ".":
                freq[start:end] = 0.0
                cur_f = 0.0
                continue
            if cell == "-":
                freq[start:end] = cur_f
                continue
            porta = cell.startswith(">")
            drop = cell.startswith("<")
            base, _, arp = (cell[1:] if (porta or drop) else cell).partition("~")
            try:
                target = note_to_freq(base)
            except ValueError:
                target = 0.0
            if arp:
                try:
                    arp_semitones = [float(x) for x in arp.split(",")]
                except ValueError:
                    arp_semitones = [0.0]
            if target <= 0:
                freq[start:end] = 0.0
                cur_f = 0.0
                continue
            cur_f = target
            if porta and glide_f > 0:
                # Semitone-space glide across the cell.
                n = end - start
                prog = np.arange(n) / max(n - 1, 1)
                dist = 12.0 * math.log2(target / glide_f)
                freq[start:end] = glide_f * (2.0 ** (dist * prog / 12.0))
            elif drop:
                # Pitch-drop (kick design): start one octave up, glide
                # down to the written note across the cell; arp offsets
                # still apply so ~12,8,4 kick shimmer survives the drop.
                n = end - start
                prog = np.arange(n) / max(n - 1, 1)
                sub_idx = (np.arange(n) * 8 // max(n, 1))
                offs = np.array([arp_semitones[s % len(arp_semitones)]
                                 for s in sub_idx])
                freq[start:end] = (target * (2.0 ** (1.0 - prog))
                                   * (2.0 ** (offs / 12.0)))
            else:
                # Arpeggio cycles offsets across 8 substeps inside the cell.
                n = end - start
                sub_idx = (np.arange(n) * 8 // max(n, 1))
                offs = np.array([arp_semitones[s % len(arp_semitones)]
                                 for s in sub_idx])
                freq[start:end] = cur_f * (2.0 ** (offs / 12.0))
            glide_f = target
        # SPC700-style vibrato: LFO on the freq track (post-arpeggio so it
        # rides the final pitch). System preset first, then per-channel
        # 'vibrato <name> <depth_semi> <rate_hz>' pattern directive.
        vib = spec.get("vibrato")
        if vib:
            # Fix: vibrato depth is in semitones, use multiplicative formula like per-channel
            freq *= 2.0 ** (vib["depth"] * np.sin(2.0 * np.pi * vib["rate"] * t) / 12.0)
        chan_vib = p.vibrato.get(name)
        if chan_vib:
            depth, rate = chan_vib
            freq *= 2.0 ** (depth * np.sin(2.0 * np.pi * rate * t) / 12.0)
        phase = np.cumsum(freq) / sr
        if wave_kind == "fm":
            # Use channel spec's fm_index (stored in duty field by _assign_voices)
            # Fall back to 1.6 if not set
            index = duty / 10.0 if duty else 1.6
            # Use Nuked-OPN2 if available and selected for this voice
            if render_core == "nuked-opn2" and nuked_chip is not None:
                # Try Nuked-OPN2 cycle-accurate rendering for this voice
                cpu_clock = spec.get("cpu_clock_hz", 7670454)
                fm_audio = _render_fm_nuked_opn2(p, name, cells, starts, sr, cell_sec, cpu_clock)
                if fm_audio is not None and len(fm_audio) == len(phase):
                    sig = fm_audio
                else:
                    # Fall back to behavioral FM
                    sig = _fm_voice(phase, index=index)
            else:
                sig = _fm_voice(phase, index=index)
        else:
            sig = _osc(wave_kind, duty, phase)
        ring = p.ringmod.get(name)
        if ring:
            # SID ring-mod: voice osc x carrier osc at ratio x freq.
            carrier_kind = (wave_kind if wave_kind in
                            ("pulse", "triangle", "saw", "wave", "vox")
                            else "pulse")
            phase2 = np.cumsum(freq * ring) / sr
            sig = sig * _osc(carrier_kind, duty, phase2)
        sig = np.where(freq > 0, sig, 0.0)
        # 3 ms raised-cosine anti-click envelope on every cell boundary.
        atk = int(0.003 * sr)
        env = np.ones(len(t))
        for b in starts[1:-1]:
            s = max(0, b - atk // 2)
            e = min(len(t), b + atk // 2)
            if e > s:
                env[s:e] = np.minimum(env[s:e],
                                      0.5 - 0.5 * np.cos(
                                          np.pi * np.arange(e - s) / (e - s)))
        tonal += sig * env * voice_gain

    # 'filter <cutoff_hz> <q>' — resonant lowpass on the tonal bus only
    # (SID-style voice filter; noise hits stay unfiltered, like hardware).
    if p.filter:
        from scipy.signal import lfilter
        fc, q = p.filter
        w0 = 2 * math.pi * fc / sr
        alpha = math.sin(w0) / (2 * q)
        cosw = math.cos(w0)
        b0 = (1 - cosw) / 2
        b1 = 1 - cosw
        a0 = 1 + alpha
        tonal = lfilter([b0 / a0, b1 / a0, b0 / a0],
                        [1.0, -2 * cosw / a0, (1 - alpha) / a0], tonal)
    mix += tonal

    # Bandlimit: one-pole lowpass approximating the system's audio
    # bandwidth (lfilter, not a Python loop — 500k+ samples).
    bw = spec["bandwidth"]
    if bw:
        from scipy.signal import lfilter
        a = 1.0 - math.exp(-2 * math.pi * bw / sr)
        mix = lfilter([a], [1.0, -(1.0 - a)], mix)

    # System echo (SPC700-style feedback delay) — applied to the mixed
    # bus, post-bandlimit, pre-normalize.
    echo = spec.get("echo")
    if echo:
        from scipy.signal import lfilter
        d = max(1, int(echo["time_s"] * sr))
        fb = float(echo["feedback"])
        # Feedback delay: wet is the input delayed by d samples recirculated
        # at `fb`; the dry signal passes through plus echo["mix"] * wet.
        b = np.zeros(d + 1)
        b[d] = 1.0
        a = np.zeros(d + 1)
        a[0] = 1.0
        a[d] = -fb
        wet = lfilter(b, a, mix)
        mix = mix + float(echo["mix"]) * wet

    # Normalize to -1..1 with fixed gain staging (deterministic).
    peak = float(np.max(np.abs(mix))) if mix.size else 0.0
    if peak > 0:
        mix = mix * (0.89 / peak)

    # Stereo spread for 'full': Haas-style micro-delay on the right.
    if spec["stereo"]:
        d = int(0.012 * sr)
        right = np.concatenate([np.zeros(d), mix[:-d]]) if d < len(mix) else mix.copy()
        stereo = np.stack([mix, right * 0.9], axis=1)
    else:
        stereo = np.stack([mix, mix], axis=1)

    out_sr = spec.get("output_sr", SR)
    if out_sr != SR:
        # Boxcar decimate (PICO-8's native 22.05 kHz).
        stereo = stereo[:: SR // out_sr]

    pcm = (stereo * 32767).astype(np.int16)
    return pcm, out_sr


# ---------------------------------------------------------------------------
# Pattern + signal analysis — measure before you listen.
#
# Two layers:
#   pattern_report()  — music-theoretic metrics computed from the .chip data
#                        itself (density, range, intervals, repetition,
#                        voice utilization). This is the "is it too basic"
#                        detector: it answers questions like "does the lead
#                        ever leave one octave?" without decoding audio.
#   signal_report()   — DSP metrics on the rendered PCM (level, crest,
#                        spectral centroid/bandwidth, silence ratio, ZCR).
#                        Catches what the pattern can't: clicks, DC offset,
#                        bandlimit actually applied, dead channels.
# ---------------------------------------------------------------------------

_LETTER_SEMI = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_ACCIDENTAL = {"#": 1, "##": 2, "b": -1, "bb": -2, None: 0, "": 0}


def _note_semitone(name: str) -> int | None:
    """Note name -> absolute semitone index (C-4 = 60-ish scale, octave+1)*12."""
    m = re.fullmatch(r"([A-Ga-g])(#{1,2}|b{1,2})?-?(\d+)", name)
    if not m:
        return None
    letter = m.group(1).upper()
    acc = m.group(2)
    if letter not in _LETTER_SEMI or acc not in _ACCIDENTAL:
        return None
    return (int(m.group(3)) + 1) * 12 + _LETTER_SEMI[letter] + _ACCIDENTAL[acc]


_PC_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _shift_note(name: str, semi: int) -> str:
    """Transpose a note name by `semi` semitones; returns name unchanged
    if it isn't a note or would leave octave range 0-8."""
    s = _note_semitone(name)
    if s is None or semi == 0:
        return name
    midi = s + semi
    if not 0 <= midi <= 127:
        return name
    return f"{_PC_NAMES[midi % 12]}-{midi // 12 - 1}"


def transpose_pattern(p: Pattern, semi: int) -> None:
    """Shift every note cell in the pattern (keeps >, <, ~arp, x, ., -)."""
    if not semi:
        return
    for ch, cells in p.channels.items():
        out = []
        for cell in cells:
            body = cell
            pre = ""
            while body[:1] in (">", "<"):
                pre += body[0]
                body = body[1:]
            base, sep, arp = body.partition("~")
            if base in (".", "-", "x") or not base:
                out.append(cell)
                continue
            shifted = _shift_note(base, semi)
            out.append(pre + shifted + (sep + arp if sep else ""))
        p.channels[ch] = out


def pattern_report(p: Pattern, sysname: str) -> dict:
    """Music-theoretic metrics from the pattern data (pre-render)."""
    spec = SYSTEMS[sysname]
    slots = _assign_voices(p, spec["channels"], sysname, quiet=True)
    bound = [s for s in slots if s]
    n_cells = max(len(c) for _, _, _, c in bound) if bound else 0
    bars = max(1, n_cells // 16)

    chan_stats = []
    all_intervals: list[int] = []
    melodic_bars: list[tuple] = []
    total_notes = 0
    total_cells = 0
    for name, wave_kind, _duty, cells in bound:
        notes = rests = holds = ports = arps = noise_hits = 0
        pitches: list[int] = []
        prev = None
        bar_hashes = []
        for i in range(0, len(cells), 16):
            bar = cells[i:i + 16]
            bar_hashes.append(tuple(bar))
            for cell in bar:
                total_cells += 1
                if cell == ".":
                    rests += 1
                elif cell == "-":
                    holds += 1
                elif cell == "x" and wave_kind == "noise":
                    noise_hits += 1
                else:
                    if cell.startswith(">"):
                        ports += 1
                    if "~" in cell:
                        arps += 1
                    s = _note_semitone(cell.lstrip(">").split("~", 1)[0])
                    if s is not None:
                        notes += 1
                        pitches.append(s)
                        if prev is not None and wave_kind != "noise":
                            all_intervals.append(s - prev)
                        prev = s
        melodic_bars.append(tuple(bar_hashes))
        span = (max(pitches) - min(pitches)) if pitches else 0
        chan_stats.append({
            "name": name, "wave": wave_kind, "cells": len(cells),
            "notes": notes, "rests": rests, "holds": holds,
            "porta": ports, "arp": arps, "noise": noise_hits,
            "density": (notes + noise_hits) / max(len(cells), 1),
            "pitch_span_st": span,
            "unique_pitches": len(set(pitches)),
            "_pitches": pitches,
        })
        total_notes += notes

    # Repetition: fraction of adjacent 16-cell bars that are identical
    # across ALL channels (the "is it a loop or a song" metric).
    rep_bars = 0
    comp_bars = 0
    for bi in range(1, bars):
        same = all(
            cells[bi * 16:(bi + 1) * 16] == cells[(bi - 1) * 16:bi * 16]
            for _, _, _, cells in bound if len(cells) >= (bi + 1) * 16
        )
        if same:
            rep_bars += 1
        comp_bars += 1
    rep_ratio = rep_bars / max(comp_bars, 1)

    # Lead channel = named lead/melody/main, else the tonal channel with the
    # highest mean pitch (the "busiest" bass would mislabel the range flag).
    def _mean_pitch(ch):
        name, wave, _d, cells = ch
        semis = [_note_semitone(c.lstrip(">").split("~", 1)[0])
                 for c in cells if c not in (".", "-") and "~" not in c]
        semis = [s for s in semis if s is not None]
        return sum(semis) / len(semis) if semis else -1

    tonal = [ch for ch in bound if ch[1] != "noise"]
    lead_ch = next(
        (ch for ch in tonal
         if any(k in ch[0].lower() for k in ("lead", "melody", "main"))),
        max(tonal, key=_mean_pitch, default=None),
    )
    lead_unique = 0
    lead_stats = None
    if lead_ch:
        lead_name = lead_ch[0]
        lead_cells = next(c for n, _, _, c in bound if n == lead_name)
        shapes = {tuple(lead_cells[i:i + 16]) for i in range(0, len(lead_cells), 16)}
        lead_unique = len(shapes)
        lead_stats = next(c for c in chan_stats if c["name"] == lead_name)

    # Interval histogram (semitone deltas, folded to ±12).
    iv_hist: dict[int, int] = {}
    for d in all_intervals:
        iv_hist[d] = iv_hist.get(d, 0) + 1
    top_intervals = sorted(iv_hist.items(), key=lambda kv: -kv[1])[:5]

    # --- EV-inspired complexity metrics (Eerola & Vipond 2023, EV8) ---
    # Expectancy-violation models treat pitch-class entropy, interval
    # entropy, and mean interval size as complexity predictors. We report
    # them normalized to [0,1] so they read as "how spread is the material".
    def _entropy_norm(counts: dict, k: int) -> float:
        total = sum(counts.values())
        if total == 0:
            return 0.0
        h = -sum((c / total) * math.log2(c / total) for c in counts.values())
        return h / math.log2(k) if k > 1 else 0.0

    lead_pc_entropy = lead_iv_entropy = lead_mean_iv = 0.0
    if lead_stats:
        lp = lead_stats["_pitches"]
        pc: dict[int, int] = {}
        for s in lp:
            pc[s % 12] = pc.get(s % 12, 0) + 1
        lead_pc_entropy = _entropy_norm(pc, 12)
        iv: dict[int, int] = {}
        for a, b in zip(lp, lp[1:], strict=False):
            iv[b - a] = iv.get(b - a, 0) + 1
        lead_iv_entropy = _entropy_norm(iv, 25)  # deltas clamped to ±12
        if iv:
            lead_mean_iv = sum(abs(d) * c for d, c in iv.items()) / sum(iv.values())

    # Arrangement contrast: per-bar note count across all bound channels.
    bar_activity = [0] * bars
    for _, _, _, cells in bound:
        for bi in range(bars):
            seg = cells[bi * 16:(bi + 1) * 16]
            if len(seg) == 16:
                bar_activity[bi] += sum(
                    1 for c in seg if c not in (".", "-"))
    act_mean = sum(bar_activity) / max(bars, 1)
    act_cv = (math.sqrt(sum((a - act_mean) ** 2 for a in bar_activity) / bars)
              / act_mean) if act_mean else 0.0

    voices_used = len(bound)
    voices_total = len(spec["channels"])

    # --- Heuristic verdicts (labelled as heuristics, not truth) ---
    flags = []
    if lead_stats and lead_stats["density"] < 0.15:
        flags.append(f"sparse lead ({lead_stats['density']:.0%} note density)")
    if lead_stats and lead_stats["pitch_span_st"] < 12:
        flags.append(f"narrow lead range ({lead_stats['pitch_span_st']}st)")
    if rep_ratio > 0.6:
        flags.append(f"highly repetitive ({rep_ratio:.0%} identical bars)")
    if voices_used < voices_total * 0.6:
        flags.append(f"under-voiced ({voices_used}/{voices_total} voices)")
    if lead_stats and lead_unique <= max(2, bars // 3):
        flags.append(f"few unique lead bars ({lead_unique}/{bars})")
    if lead_stats and lead_pc_entropy < 0.45:
        flags.append(f"pitch-class concentration ({lead_pc_entropy:.2f})")
    if act_cv < 0.15:
        flags.append(f"flat arrangement density (bar CV {act_cv:.2f})")

    return {
        "system": sysname, "tempo": p.tempo, "cells": n_cells,
        "bars_16th": bars, "duration_s": n_cells * 60 / p.tempo / 4,
        "channels": chan_stats,
        "total_notes": total_notes,
        "note_density": total_notes / max(total_cells, 1),
        "rep_ratio": rep_ratio,
        "lead_unique_bars": lead_unique,
        "interval_hist": top_intervals,
        "lead_pc_entropy": round(lead_pc_entropy, 3),
        "lead_iv_entropy": round(lead_iv_entropy, 3),
        "lead_mean_interval_st": round(lead_mean_iv, 2),
        "bar_activity_cv": round(act_cv, 3),
        "voices_used": voices_used, "voices_total": voices_total,
        "flags": flags,
    }


def signal_report(pcm: np.ndarray, sr: int) -> dict:
    """DSP metrics on rendered PCM: level, crest, spectrum, silence, ZCR."""
    x = pcm.astype(np.float64)
    if x.ndim == 2:
        mono = x.mean(axis=1)
    else:
        mono = x
    n = len(mono)
    if n == 0:
        return {"error": "empty render"}
    peak = float(np.max(np.abs(mono)))
    rms = float(np.sqrt(np.mean(mono ** 2)))
    # Frame-based silence + RMS envelope (50 ms windows).
    w = max(1, int(0.05 * sr))
    frames = mono[: n // w * w].reshape(-1, w)
    frms = np.sqrt(np.mean(frames ** 2, axis=1))
    silence = float(np.mean(frms < rms * 0.05)) if rms > 0 else 1.0
    # Spectral centroid + bandwidth on a mid-file FFT.
    seg = mono[n // 4: n // 4 + min(n // 2, 1 << 20)]
    if len(seg) > 2048:
        spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
        freqs = np.fft.rfftfreq(len(seg), 1 / sr)
        total = spec.sum()
        centroid = float((spec * freqs).sum() / total) if total else 0.0
        bandwidth = float(np.sqrt((spec * (freqs - centroid) ** 2).sum() / total)) \
            if total else 0.0
    else:
        centroid = bandwidth = 0.0
    zcr = float(np.mean(np.abs(np.diff(np.signbit(mono)))))
    return {
        "duration_s": round(n / sr, 2), "sr": sr,
        "peak_dbfs": round(20 * math.log10(max(peak / 32768, 1e-9)), 1),
        "rms_dbfs": round(20 * math.log10(max(rms / 32768, 1e-9)), 1),
        "crest": round(peak / max(rms, 1e-9), 2),
        "spectral_centroid_hz": round(centroid),
        "spectral_bandwidth_hz": round(bandwidth),
        "silence_ratio": round(silence, 3),
        "zcr": round(zcr, 3),
    }


def print_analysis(rep: dict, sig: dict) -> None:
    print("\n[analysis] PATTERN (pre-render, music-theoretic)")
    print(f"  system={rep['system']} tempo={rep['tempo']:g} "
          f"cells={rep['cells']} bars={rep['bars_16th']} "
          f"dur={rep['duration_s']:.2f}s")
    for c in rep["channels"]:
        print(f"  {c['name']:<8} {c['wave']:<7} dens={c['density']:.0%} "
              f"notes={c['notes']} span={c['pitch_span_st']}st "
              f"uniq={c['unique_pitches']} arp={c['arp']} porta={c['porta']}")
    print(f"  note_density={rep['note_density']:.0%} "
          f"rep_bars={rep['rep_ratio']:.0%} "
          f"lead_unique_bars={rep['lead_unique_bars']}")
    print(f"  lead pc_entropy={rep['lead_pc_entropy']} "
          f"iv_entropy={rep['lead_iv_entropy']} "
          f"mean_iv={rep['lead_mean_interval_st']}st "
          f"bar_cv={rep['bar_activity_cv']}")
    if rep["interval_hist"]:
        top = ", ".join(f"{d}st×{n}" for d, n in rep["interval_hist"])
        print(f"  top intervals: {top}")
    print(f"  voices: {rep['voices_used']}/{rep['voices_total']} used")
    if rep["flags"]:
        print("  flags: " + "; ".join(rep["flags"]))
    else:
        print("  flags: none — pattern passes heuristic checks")
    print("[analysis] SIGNAL (rendered PCM)")
    for k, v in sig.items():
        print(f"  {k}: {v}")


def normalize_loudness(pcm: np.ndarray, sr: int,
                       target_lufs: float = -20.0,
                       ceiling: float = 0.7) -> tuple[np.ndarray, dict | None]:
    """BS.1770 integrated loudness -> target, then hard peak ceiling.

    Owner rule for chiptune listening copies (T-MUS-06, 2026-11-07):
    -20 LUFS / 0.7 peak — dense square waves are loudness-efficient and
    -14 LUFS 'studio' targets blow through perceptually.
    """
    try:
        import pyloudnorm as pyln
    except ImportError:
        return pcm, None
    x = pcm.astype(np.float64) / 32768.0
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    lufs = pyln.Meter(sr).integrated_loudness(x)
    if not math.isfinite(lufs) or lufs < -70:
        return pcm, {"lufs_before": None, "note": "too quiet/silent to meter"}
    gain = 10 ** ((target_lufs - lufs) / 20)
    y = x * gain
    peak = float(np.max(np.abs(y)))
    peak_gain = min(1.0, ceiling / peak) if peak > 0 else 1.0
    y *= peak_gain
    info = {"lufs_before": round(lufs, 1),
            "gain_db": round(20 * math.log10(gain * peak_gain), 1),
            "peak_after": round(float(np.max(np.abs(y))), 3)}
    return np.clip(y * 32768, -32768, 32767).astype(np.int16), info


_ROLL_COLORS = [
    (255, 90, 90), (255, 200, 60), (90, 255, 120), (80, 160, 255),
    (200, 110, 255), (255, 140, 40), (90, 230, 220), (240, 240, 240),
]


def render_roll(p: Pattern, sysname: str, path: Path,
                px_cell: int = 8, px_semi: int = 6) -> None:
    """Piano-roll preview PNG — owner PREVIEW-FIRST rule (T-MUS-06).

    x = cell index, y = pitch; each bound channel gets a lane color,
    bars ruled every 16 cells, noise hits as bottom ticks, arp offsets
    as dim dots. Audio follows only on the owner's visual go.
    """
    from PIL import Image, ImageDraw

    slots = _assign_voices(p, SYSTEMS[sysname]["channels"], sysname, quiet=True)
    bound = [s for s in slots if s]
    semis: list[int] = []
    for _, _, _, cells in bound:
        for c in cells:
            s = _note_semitone(c.lstrip(">").split("~", 1)[0])
            if s is not None:
                semis.append(s)
    if not semis:
        raise ValueError("pattern has no pitched notes to roll")
    lo, hi = min(semis) - 1, max(semis) + 1
    n_cells = max(len(c) for _, _, _, c in bound)
    w, h = n_cells * px_cell, (hi - lo + 1) * px_semi + 24
    img = Image.new("RGB", (w, h), (22, 22, 28))
    d = ImageDraw.Draw(img)

    def _y(s: int) -> int:
        return h - 20 - (s - lo) * px_semi

    for ci, (_, _, _, cells) in enumerate(bound):
        color = _ROLL_COLORS[ci % len(_ROLL_COLORS)]
        dim = tuple(max(0, int(c * 0.45)) for c in color)
        for i, cell in enumerate(cells):
            x0 = i * px_cell
            if cell == "x":
                d.rectangle([x0, h - 14, x0 + px_cell - 1, h - 8], fill=color)
                continue
            body = cell.lstrip(">")
            if body in (".", "-"):
                continue
            s = _note_semitone(body.split("~", 1)[0])
            if s is None:
                continue
            d.rectangle([x0, _y(s), x0 + px_cell - 1, _y(s) + px_semi - 2],
                        fill=color)
            if "~" in body:
                for off in body.split("~", 1)[1].split(","):
                    try:
                        os_ = _note_semitone(body.split("~", 1)[0])
                        if os_ is not None:
                            d.point((x0 + px_cell // 2,
                                     _y(os_ + int(float(off)))), fill=dim)
                    except ValueError:
                        pass
    for b in range(0, n_cells, 16):
        d.line([(b * px_cell, 0), (b * px_cell, h - 20)], fill=(58, 58, 70))
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)


def write_wav(path: Path, pcm: np.ndarray, sr: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        # Explicit little-endian for WAV format portability
        w.writeframes(pcm.astype('<i2').tobytes())


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Render a .chip pattern to WAV.")
    ap.add_argument("file", nargs="?", help=".chip pattern file")
    # Include both canonical names and aliases
    from packages.backend.app.core.chiptune_hardware import SYSTEM_ALIASES
    all_names = sorted(set(SYSTEMS.keys()) | set(SYSTEM_ALIASES.keys()))
    ap.add_argument("--system", choices=all_names,
                    help="override the file's system preset (includes aliases like '2a03', 'dmc', etc.)")
    ap.add_argument("--demo", action="store_true", help="render the built-in demo")
    ap.add_argument("--all", action="store_true",
                    help="render across every system preset (A/B)")
    ap.add_argument("--out", help="output WAV path (default output/audio/<name>.wav)")
    ap.add_argument("--list", action="store_true", help="list system presets")
    ap.add_argument("--analyze", action="store_true",
                    help="print pattern + signal metrics after rendering")
    ap.add_argument("--no-render", action="store_true",
                    help="with --analyze: metrics only, skip WAV write")
    ap.add_argument("--roll", action="store_true",
                    help="write a piano-roll preview PNG (owner PREVIEW-FIRST rule)")
    ap.add_argument("--loudness", type=float, default=-20.0,
                    help="integrated LUFS target for listening copies "
                         "(owner rule: -20); ignored with --no-loudnorm")
    ap.add_argument("--no-loudnorm", action="store_true",
                    help="skip loudness normalization + 0.7 peak ceiling")
    ap.add_argument("--transpose", type=int, default=0, metavar="N",
                    help="shift all notes by N semitones (genre/key tool)")
    ap.add_argument("--tempo", type=float, default=None, metavar="BPM",
                    help="override the pattern's tempo")
    ap.add_argument("--midi", action="store_true",
                    help="treat input file as MIDI and convert to .chip "
                         "(prints to stdout or writes --out <name>.chip)")
    args = ap.parse_args(argv)

    if args.midi:
        if not args.file:
            ap.error("--midi requires a .mid file argument")
        try:
            chip_text = import_midi(args.file)
        except Exception as e:
            print(f"[chiptune] midi import failed: {e}", file=sys.stderr)
            return 1
        if args.out:
            out = Path(args.out)
            if out.suffix.lower() != ".chip":
                print(f"[chiptune] warning: --midi output should use .chip extension, got {out.suffix}", file=sys.stderr)
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(chip_text, encoding="utf-8")
            print(f"[chiptune] wrote {out}")
        else:
            sys.stdout.write(chip_text)
        return 0

    if args.list:
        for k, v in SYSTEMS.items():
            print(f"  {k:<8} {v['label']}")
        return 0

    if args.demo:
        text, name = DEMO, "chiptune-demo"
    elif args.file:
        src = Path(args.file)
        if not src.exists():
            print(f"[chiptune] file not found: {src}", file=sys.stderr)
            return 1
        text = src.read_text(encoding="utf-8").lstrip('\ufeff')  # Strip BOM if present
        name = src.stem
    else:
        ap.error("provide a .chip file or --demo")

    try:
        pat = parse_chip(text)
    except ValueError as e:
        print(f"[chiptune] {e}", file=sys.stderr)
        return 1
    if args.transpose:
        transpose_pattern(pat, args.transpose)
    if args.tempo:
        pat.tempo = args.tempo

    systems = [args.system] if args.system else [pat.system]
    if args.all:
        systems = list(SYSTEMS)
    # Resolve aliases for each system
    resolved_systems = []
    for s in systems:
        try:
            resolved_systems.append(get_system_spec(s).name)
        except ValueError:
            resolved_systems.append(s)
    for sysname, resolved_name in zip(systems, resolved_systems, strict=True):
        try:
            pcm, sr = render(pat, system_name=resolved_name)
        except ValueError as e:
            print(f"[chiptune] {sysname}: {e}", file=sys.stderr)
            continue
        spec = SYSTEMS[resolved_name]
        loud_info = None
        if not args.no_loudnorm:
            pcm, loud_info = normalize_loudness(pcm, sr, args.loudness)
        if args.analyze:
            print_analysis(pattern_report(pat, sysname), signal_report(pcm, sr))
        if loud_info:
            print(f"[chiptune] loudnorm: {loud_info}")
        if args.no_render:
            continue
        suffix = "" if sysname == pat.system and not args.all else f"-{sysname}"
        out = (Path(args.out) if args.out and len(systems) == 1
               else OUT_DIR / f"{name}{suffix}.wav")
        write_wav(out, pcm, sr)
        if args.roll:
            roll_path = out.with_suffix(".roll.png")
            render_roll(pat, sysname, roll_path)
            print(f"[chiptune] roll preview -> {roll_path}")
        secs = len(pcm) / sr
        print(f"[chiptune] {spec['label']}")
        print(f"[chiptune] {len(pat.channels)} voices, tempo {pat.tempo:g}, "
              f"{secs:.2f}s @ {sr} Hz -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

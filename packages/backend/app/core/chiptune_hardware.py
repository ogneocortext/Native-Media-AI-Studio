"""
Register-accurate hardware profiles for retro sound chips.
Based on documented datasheets and reverse-engineering.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any


class Waveform(Enum):
    PULSE = "pulse"
    TRIANGLE = "triangle"
    SAW = "saw"
    WAVE = "wave"  # Game Boy 4-bit wavetable
    VOX = "vox"  # SNES BRR approximation
    FM = "fm"  # YM2612 2-op FM
    NOISE = "noise"


class NoiseType(Enum):
    LFSR = "lfsr"  # Periodic (NES, GB, Atari)
    WHITE = "white"  # True white noise


@dataclass
class ChannelSpec:
    """Channel specification with register-accurate defaults."""
    waveform: Waveform
    duty_percent: int = 50  # 0-100 for pulse
    volume: float = 1.0
    pan: float = 0.0  # -1.0 to 1.0
    noise_type: NoiseType = NoiseType.LFSR
    fm_index: float = 1.6  # For FM voices
    fm_ratio: float = 1.0  # Modulator:carrier ratio


@dataclass
class SystemSpec:
    """Complete system specification with register-accurate params."""
    name: str
    label: str
    channels: list[ChannelSpec]
    bandwidth_hz: float | None  # None = no bandlimit
    noise_type: NoiseType = NoiseType.LFSR
    stereo: bool = False
    sample_rate: int = 44100
    output_sample_rate: int | None = None  # For PICO-8 native 22050

    # Core selection: "behavioral" (current Python impl), "nuked-opn2", "nuked-opm", 
    # "nuked-opl3", "residfp", "snes-spc", "sameboy"
    core: str = "behavioral"

    # System-specific effects
    echo: dict[str, float] | None = None  # time_s, feedback, mix
    vibrato: dict[str, float] | None = None  # rate_hz, depth_semitones

    # Filter
    filter_cutoff_hz: float | None = None
    filter_q: float | None = None

    # Clock/timing
    cpu_clock_hz: int = 1789773  # Default NTSC NES
    frame_sequencer_hz: float = 240.0  # NES APU frame counter

    # Volume mixing formula (None = simple sum)
    mix_formula: str | None = None


# ============================================================================
# NES / Famicom - Ricoh 2A03 / 2A07
# ============================================================================

NES_SPEC = SystemSpec(
    name="nes",
    label="NES/Famicom - Ricoh 2A03/2A07 APU",
    channels=[
        ChannelSpec(Waveform.PULSE, 50),   # Square 1 - sweep unit
        ChannelSpec(Waveform.PULSE, 25),   # Square 2 - no sweep
        ChannelSpec(Waveform.TRIANGLE, 0),  # Triangle - linear counter
        ChannelSpec(Waveform.NOISE, 0, noise_type=NoiseType.LFSR),
    ],
    bandwidth_hz=15000,
    noise_type=NoiseType.LFSR,
    stereo=False,
    sample_rate=44100,
    cpu_clock_hz=1789773,  # NTSC
    frame_sequencer_hz=240.0,
    mix_formula="nes",  # Special mixing: square_out = 95.88*(s1+s2)/(8128+s1+s2); tnd_out = 159.79/(1+100/(tri/8227+noise/12241+dmc/22638))
)

# NTSC/PAL variants
NES_NTSC = NES_SPEC
NES_PAL = SystemSpec(
    **{k: v for k, v in NES_SPEC.__dict__.items() if k not in ("cpu_clock_hz", "frame_sequencer_hz", "label")},
    cpu_clock_hz=1662607,
    frame_sequencer_hz=198.4,
    label="NES/Famicom PAL - Ricoh 2A07 APU",
)

# Register map for documentation
NES_REGISTERS = {
    0x4000: "SQ1_VOL", 0x4001: "SQ1_SWEEP", 0x4002: "SQ1_LO", 0x4003: "SQ1_HI",
    0x4004: "SQ2_VOL", 0x4005: "SQ2_SWEEP", 0x4006: "SQ2_LO", 0x4007: "SQ2_HI",
    0x4008: "TRI_LINEAR", 0x400A: "TRI_LO", 0x400B: "TRI_HI",
    0x400C: "NOISE_VOL", 0x400E: "NOISE_LO", 0x400F: "NOISE_HI",
    0x4010: "DMC_FREQ", 0x4011: "DMC_RAW", 0x4012: "DMC_START", 0x4013: "DMC_LEN",
    0x4015: "SND_CHN", 0x4017: "FRAME_CNT",
}


# ============================================================================
# Game Boy (DMG / CGB) - Sharp SM83 / LR35902
# ============================================================================

GAMEBOY_DMG_SPEC = SystemSpec(
    name="gameboy",
    label="Game Boy DMG - Sharp SM83 APU",
    channels=[
        ChannelSpec(Waveform.PULSE, 50),   # CH1 - sweep unit
        ChannelSpec(Waveform.PULSE, 50),   # CH2 - no sweep
        ChannelSpec(Waveform.WAVE, 0),     # CH3 - 4-bit wavetable (32 samples)
        ChannelSpec(Waveform.NOISE, 0, noise_type=NoiseType.LFSR),
    ],
    bandwidth_hz=11000,
    noise_type=NoiseType.LFSR,
    stereo=False,
    sample_rate=44100,
    cpu_clock_hz=4194304,
    frame_sequencer_hz=512.0,  # 4.194304 MHz / 8192
    core="sameboy",  # Use SameBoy for cycle-accurate APU emulation
)

GAMEBOY_CGB_SPEC = SystemSpec(
    **{k: v for k, v in GAMEBOY_DMG_SPEC.__dict__.items() if k not in ("cpu_clock_hz", "frame_sequencer_hz", "label", "name", "core")},
    name="gameboy_cgb",
    cpu_clock_hz=8388608,
    frame_sequencer_hz=1024.0,
    label="Game Boy Color - Sharp SM83 2x",
    core="sameboy",  # Use SameBoy for cycle-accurate APU emulation
)

# Register map
GAMEBOY_REGISTERS = {
    0xFF10: "NR10", 0xFF11: "NR11", 0xFF12: "NR12", 0xFF13: "NR13", 0xFF14: "NR14",
    0xFF16: "NR21", 0xFF17: "NR22", 0xFF18: "NR23", 0xFF19: "NR24",
    0xFF1A: "NR30", 0xFF1B: "NR31", 0xFF1C: "NR32", 0xFF1D: "NR33", 0xFF1E: "NR34",
    0xFF20: "NR41", 0xFF21: "NR42", 0xFF22: "NR43", 0xFF23: "NR44",
    0xFF24: "NR50", 0xFF25: "NR51", 0xFF26: "NR52",
    0xFF30: "WAVE_RAM",  # 16 bytes = 32 4-bit samples
}


# ============================================================================
# SNES / SFC - Sony SPC700 + S-DSP
# ============================================================================

SNES_SPEC = SystemSpec(
    name="snes",
    label="SNES/SFC - Sony SPC700 + S-DSP",
    channels=[
        *[ChannelSpec(Waveform.VOX, 0) for _ in range(6)],  # 6 melodic voices (BRR)
        ChannelSpec(Waveform.NOISE, 0, noise_type=NoiseType.LFSR),
        ChannelSpec(Waveform.PULSE, 50),  # PCM/DAC channel approximated
    ],
    bandwidth_hz=20000,
    noise_type=NoiseType.LFSR,
    stereo=False,
    sample_rate=32000,  # S-DSP native rate
    output_sample_rate=44100,
    cpu_clock_hz=1024000,  # SPC700 effective clock
    frame_sequencer_hz=0,  # No frame sequencer - driver handles timing
    echo={"time_s": 0.09, "feedback": 0.38, "mix": 0.22},
    vibrato={"rate": 5.5, "depth": 0.005},  # ~5.5 Hz, 0.5 cent depth
    core="snes-spc",  # Use snes-spc for cycle-accurate SPC700 emulation
)

# SPC700 register map (partial)
SNES_REGISTERS = {
    0x00: "VOL_LEFT", 0x01: "VOL_RIGHT", 0x02: "EVOL_LEFT", 0x03: "EVOL_RIGHT",
    0x04: "KON", 0x05: "KOFF", 0x06: "FLG", 0x07: "EFB",
    0x08: "PMON", 0x09: "NON", 0x0A: "EON", 0x0B: "DIR",
    0x0C: "ESA", 0x0D: "EDL", 0x0E: "COEF_0", 0x0F: "COEF_1", 0x10: "COEF_2",
    0x11: "COEF_3", 0x12: "COEF_4", 0x13: "COEF_5", 0x14: "COEF_6", 0x15: "COEF_7",
    0x20: "V0_VOL_LEFT", 0x21: "V0_VOL_RIGHT", 0x22: "V0_PITCH_LO", 0x23: "V0_PITCH_HI",
    0x24: "V0_SRC", 0x25: "V0_ADSR1", 0x26: "V0_ADSR2", 0x27: "V0_GAIN",
    0x28: "V0_ENVX", 0x29: "V0_OUTX", 0x2A: "V0_FIR",
    # ... repeats for voices 1-7 at +0x10 per voice
}

# BRR format constants
BRR_HEADER_END = 0x01
BRR_HEADER_LOOP = 0x02
BRR_HEADER_FILTER_MASK = 0x0C  # bits 2-3
BRR_HEADER_RANGE_MASK = 0xF0   # bits 4-7

BRR_FILTERS = [
    lambda prev1, prev2: 0,                           # 0: no filter
    lambda prev1, prev2: prev1 * 15 / 16,               # 1: 15/16 * prev1
    lambda prev1, prev2: prev1 * 61 / 32 - prev2 * 15 / 16,  # 2
    lambda prev1, prev2: prev1 * 115 / 64 - prev2 * 61 / 32 + prev1 * 15 / 16,  # 3
]


# ============================================================================
# Sega Genesis / Mega Drive - Yamaha YM2612 (OPN2)
# ============================================================================

GENESIS_SPEC = SystemSpec(
    name="genesis",
    label="Sega Genesis - Yamaha YM2612 (OPN2) + SN76489 PSG",
    channels=[
        *[ChannelSpec(Waveform.FM, 0, fm_index=1.6, fm_ratio=1.0) for _ in range(3)],  # 3 FM voices
        ChannelSpec(Waveform.PULSE, 50),   # PSG Tone 1
        ChannelSpec(Waveform.PULSE, 25),   # PSG Tone 2
        ChannelSpec(Waveform.TRIANGLE, 0),  # PSG Tone 3
        ChannelSpec(Waveform.NOISE, 0, noise_type=NoiseType.WHITE),  # PSG Noise
    ],
    bandwidth_hz=16000,
    noise_type=NoiseType.WHITE,
    stereo=False,
    sample_rate=53267,  # YM2612 native DAC rate
    output_sample_rate=44100,
    cpu_clock_hz=7670454,  # NTSC master clock
    core="nuked-opn2",  # Use Nuked-OPN2 for cycle-accurate FM
)

# YM2612 Algorithms (8 per channel)
YM2612_ALGORITHMS = {
    0: "1>2>3>4",      # Series - distortion guitar
    1: "1>2, 3>4",     # Parallel - harp
    2: "1>2>3, 4",     # Bass/piano
    3: "1>2>3>4(mod)",  # Strings
    4: "1>2, 3, 4",    # Flute/bells
    5: "1>2>3, 4(mod)",  # Brass/organ
    6: "1, 2, 3>4",    # Xylophone/drums
    7: "1>2>3>4(all)",  # Pipe organ
}

YM2612_REGISTERS = {
    0x22: "LFO", 0x24: "TIMER_A_HI", 0x25: "TIMER_A_LO",
    0x26: "TIMER_B", 0x27: "CH3_MODE", 0x28: "KEY_ON_OFF",
    0x2A: "DAC_DATA", 0x2B: "DAC_ENABLE",
    # Per-operator (x24, bank 0: ch1-3, bank 1: ch4-6)
    0x30: "MUL_DT1", 0x40: "TL", 0x50: "AR_RS", 0x60: "DR_AM",
    0x70: "SR", 0x80: "RR_SL", 0x90: "SSG_EG",
    0xA0: "FREQ_LO", 0xA4: "FREQ_HI", 0xB0: "FB_ALGO",
    0xB4: "PAN_AMS_PMS",
}

# ============================================================================
# YM2612 (OPN2) Envelope Generator Rate Table
# ============================================================================
# Based on Yamaha YM2612 / OPN2 datasheet. The EG runs at master_clock / 72.
# For NTSC Genesis: 7,670,454 Hz / 72 = 106,534 Hz EG clock.
# Rate 0-3: infinite (no envelope change)
# Rate 63: instant (0 samples)
# Rates 4-62: time constant = (1024 * 2^(rate-4)) / EG_clock seconds
# We store the reciprocal (rate in Hz) for efficient envelope computation.
# ============================================================================


def _compute_ym2612_eg_rates(eg_clock_hz: float = 106534.0) -> list[float]:
    """Compute YM2612 EG rates (0-63) as reciprocal time constants in Hz.

    Args:
        eg_clock_hz: EG clock frequency (master_clock / 72). Default is NTSC Genesis.

    Returns:
        List of 64 rate values in Hz. Rate 0-3 = 0 (infinite), Rate 63 = float('inf').
    """
    rates = [0.0] * 64
    for r in range(4, 63):
        # Time constant in samples = 1024 * 2^(r-4)
        # Rate in Hz = EG_clock / time_constant
        time_const = 1024.0 * (2.0 ** (r - 4))
        rates[r] = eg_clock_hz / time_const
    rates[63] = float('inf')  # Instant
    return rates


# Default NTSC Genesis rates (master clock 7,670,454 Hz -> EG clock 106,534 Hz)
YM2612_EG_RATES = _compute_ym2612_eg_rates()

# PAL Genesis variant (master clock 7,600,060 Hz -> EG clock 105,556 Hz)
YM2612_EG_RATES_PAL = _compute_ym2612_eg_rates(105556.0)


# ============================================================================
# Commodore 64 - MOS 6581 / 8580 SID
# ============================================================================

SID_6581_SPEC = SystemSpec(
    name="c64_6581",
    label="C64 SID 6581 (R1) - 3 voices + analog filter",
    channels=[
        ChannelSpec(Waveform.PULSE, 50),   # Voice 1
        ChannelSpec(Waveform.SAW, 0),      # Voice 2
        ChannelSpec(Waveform.TRIANGLE, 0),  # Voice 3
        ChannelSpec(Waveform.NOISE, 0, noise_type=NoiseType.LFSR),
    ],
    bandwidth_hz=9000,
    noise_type=NoiseType.LFSR,
    stereo=False,
    sample_rate=44100,
    cpu_clock_hz=1022727,  # NTSC 1.022 MHz
    filter_cutoff_hz=8000,
    filter_q=4.0,
    core="residfp",  # Use reSIDfp for cycle-accurate SID emulation
)

SID_8580_SPEC = SystemSpec(
    **{k: v for k, v in SID_6581_SPEC.__dict__.items() if k not in ("cpu_clock_hz", "label", "name", "core")},
    name="c64_8580",
    label="C64 SID 8580 (R4/R5) - cleaner filter, HMOS",
    cpu_clock_hz=1022727,
    core="residfp",  # Use reSIDfp for cycle-accurate SID emulation
)

SID_REGISTERS = {
    0x00: "FREQ_LO_1", 0x01: "FREQ_HI_1", 0x02: "PW_LO_1", 0x03: "PW_HI_1",
    0x04: "CR1", 0x05: "AD1", 0x06: "SR1",
    0x07: "FREQ_LO_2", 0x08: "FREQ_HI_2", 0x09: "PW_LO_2", 0x0A: "PW_HI_2",
    0x0B: "CR2", 0x0C: "AD2", 0x0D: "SR2",
    0x0E: "FREQ_LO_3", 0x0F: "FREQ_HI_3", 0x10: "PW_LO_3", 0x11: "PW_HI_3",
    0x12: "CR3", 0x13: "AD3", 0x14: "SR3",
    0x15: "FC_LO", 0x16: "FC_HI", 0x17: "RES_FILT", 0x18: "MODE_VOL",
    0x19: "POTX", 0x1A: "POTY", 0x1B: "OSC3", 0x1C: "ENV3",
}

SID_CONTROL_BITS = {
    "gate": 0, "sync": 1, "ring": 2, "test": 3,
    "triangle": 4, "sawtooth": 5, "pulse": 6, "noise": 7
}

SID_ADSR_RATES = {
    "attack": [2, 8, 16, 24, 38, 56, 68, 80, 100, 250, 500, 800, 1000, 3000, 5000, 8000],  # ms
    "decay": [6, 24, 48, 72, 114, 168, 204, 240, 300, 750, 1500, 2400, 3000, 9000, 15000, 24000],
    "sustain": [i / 15.0 for i in range(16)],
    "release": [6, 24, 48, 72, 114, 168, 204, 240, 300, 750, 1500, 2400, 3000, 9000, 15000, 24000],
}

SID_CAPACITORS = {
    "6581": 2200e-12,  # 2.2nF typical
    "8580": 6800e-12,  # 6.8nF
}


# ============================================================================
# Atari 2600 - TIA
# ============================================================================

ATARI_SPEC = SystemSpec(
    name="atari",
    label="Atari 2600 - TIA (Television Interface Adaptor)",
    channels=[
        ChannelSpec(Waveform.PULSE, 50),
        ChannelSpec(Waveform.PULSE, 50),
        ChannelSpec(Waveform.NOISE, 0, noise_type=NoiseType.LFSR),
    ],
    bandwidth_hz=8000,
    noise_type=NoiseType.LFSR,
    stereo=False,
    sample_rate=44100,
    cpu_clock_hz=1193182,  # NTSC colorburst / 3.58 MHz / 3
)

# Atari TIA duty cycles (8 steps only)
ATARI_DUTIES = [0.0, 0.03125, 0.09375, 0.21875, 0.46875, 0.71875, 0.96875, 1.0]


# ============================================================================
# PICO-8 Fantasy Console
# ============================================================================

PICO8_SPEC = SystemSpec(
    name="pico8",
    label="PICO-8 Fantasy Console - 2 pulse + triangle + noise @ 22.05 kHz",
    channels=[
        ChannelSpec(Waveform.PULSE, 50),
        ChannelSpec(Waveform.PULSE, 50),
        ChannelSpec(Waveform.TRIANGLE, 0),
        ChannelSpec(Waveform.NOISE, 0, noise_type=NoiseType.LFSR),
    ],
    bandwidth_hz=None,  # Native 22.05 kHz content
    noise_type=NoiseType.LFSR,
    stereo=False,
    sample_rate=22050,
    output_sample_rate=22050,
    cpu_clock_hz=133120000,  # 133 MHz emulated
)


# ============================================================================
# OPL2 / OPL3 (AdLib / Sound Blaster)
# ============================================================================

OPL2_SPEC = SystemSpec(
    name="opl2",
    label="YM3812 OPL2 (AdLib) - 9 channels, 2-op FM",
    channels=[ChannelSpec(Waveform.FM, 0, fm_index=1.0) for _ in range(9)],
    bandwidth_hz=None,
    noise_type=NoiseType.WHITE,
    stereo=False,
    sample_rate=49716,
    output_sample_rate=44100,
    cpu_clock_hz=3579545,
    core="nuked-opl3",  # Use Nuked-OPL3 (supports OPL2 mode)
)

OPL3_SPEC = SystemSpec(
    name="opl3",
    label="YMF262 OPL3 (Sound Blaster 16) - 18 channels, 2/4-op FM",
    channels=[ChannelSpec(Waveform.FM, 0, fm_index=1.0) for _ in range(18)],
    bandwidth_hz=None,
    noise_type=NoiseType.WHITE,
    stereo=True,
    sample_rate=49716,
    output_sample_rate=44100,
    cpu_clock_hz=14318180,
    core="nuked-opl3",  # Use Nuked-OPL3 for cycle-accurate FM
    # 4-op mode: channels 0-5 pair as 4-op, 6-17 remain 2-op
)

OPL_WAVEFORMS = {
    "opl2": ["sine", "half_sine", "abs_sine", "quarter_sine"],
    "opl3": ["sine", "half_sine", "abs_sine", "quarter_sine",
             "alt_sine", "camel_sine", "square", "log_saw"],
}

OPL_REGISTERS = {
    0x01: "TEST/WAVE", 0x02: "TIMER1", 0x03: "TIMER2", 0x04: "TIMER_CTRL",
    0x20: "TREM_VIB_SUS_KSR_MUL", 0x40: "KSL_TL", 0x50: "AR_DR",
    0x60: "SR_RR", 0x70: "SL", 0x80: "WAVE", 0xA0: "FREQ_LO", 0xB0: "FREQ_HI_KEYON_BLOCK",
    # OPL3 extras
    0xC0: "FB_CONN_4OP", 0xE0: "WAVE_SEL",
}


# ============================================================================
# Roland MT-32 - LA32 Linear Arithmetic
# ============================================================================

MT32_SPEC = SystemSpec(
    name="mt32",
    label="Roland MT-32 - LA32 Linear Arithmetic Synthesis",
    channels=[
        *[ChannelSpec(Waveform.PULSE, 50) for _ in range(8)],  # 8 parts, 4 partials each
        ChannelSpec(Waveform.NOISE, 0, noise_type=NoiseType.WHITE),
    ],
    bandwidth_hz=None,
    noise_type=NoiseType.WHITE,
    stereo=True,
    sample_rate=32000,
    cpu_clock_hz=8000000,  # LA32 clock
)

MT32_REGISTERS = {
    0x0C00: "INT_STATUS", 0x0E00: "WG_SETUP",
    0x0C80: "WG_PULSE_WIDTH", 0x0C82: "WG_PCM_POS", 0x0E02: "WG_PCM_LEN",
    0x0E03: "TVF_RES", 0x0D00: "TVA_ENV_TIME_SYNTH", 0x0D02: "TVA_ENV_LEVEL_SYNTH",
    0x0C01: "TVA_TVF_ENV_TIME_PCM", 0x0C02: "TVA_TVF_ENV_LEVEL_PCM",
}


# ============================================================================
# Roland Sound Canvas SC-55 / SC-88 / SC-88Pro
# ============================================================================

SC55_SPEC = SystemSpec(
    name="sc55",
    label="Roland SC-55 Sound Canvas - GM/GS, 24 voices, 317 tones",
    channels=[ChannelSpec(Waveform.VOX, 0) for _ in range(16)],  # 16 parts
    bandwidth_hz=None,
    noise_type=NoiseType.WHITE,
    stereo=True,
    sample_rate=32000,
    output_sample_rate=44100,
)

SC88_SPEC = SystemSpec(
    name="sc88",
    label="Roland SC-88 - GM/GS, 32 parts, 64 voices, 654 tones",
    channels=[ChannelSpec(Waveform.VOX, 0) for _ in range(32)],
    bandwidth_hz=None,
    noise_type=NoiseType.WHITE,
    stereo=True,
    sample_rate=32000,
    output_sample_rate=44100,
    echo={"time_s": 0.1, "feedback": 0.4, "mix": 0.2},
)

SC88PRO_SPEC = SystemSpec(
    name="sc88pro",
    label="Roland SC-88Pro - GM/GS/XG-lite, 32 parts, 64 voices, 1117 tones",
    channels=[ChannelSpec(Waveform.VOX, 0) for _ in range(32)],
    bandwidth_hz=None,
    noise_type=NoiseType.WHITE,
    stereo=True,
    sample_rate=32000,
    output_sample_rate=44100,
    echo={"time_s": 0.12, "feedback": 0.45, "mix": 0.25},
    vibrato={"rate": 6.0, "depth": 0.01},
)


# ============================================================================
# Sony PlayStation (PSX) - SPU (Sound Processing Unit)
# ============================================================================
# Based on psx-spx.consoledev.net, psx.wiki, psdevwiki.com, psxrecomp
# Key specs: 24 ADPCM voices, 44.1 kHz, 512 KB SPU RAM, Gaussian interpolation,
# ADSR envelopes, pitch modulation (LFO), noise generator, 22050 Hz stereo reverb
# ============================================================================

# ADPCM/SPU-BRR format constants (16-byte blocks: 2 header + 28 samples at 4-bit = 14 bytes)
SPU_ADPCM_BLOCK_SIZE = 16
SPU_ADPCM_SAMPLES_PER_BLOCK = 28
SPU_ADPCM_FILTERS = 5  # Extended from SNES's 4 filters

# Gaussian interpolation coefficients (4-point, fixed-point lookup table per psxrecomp)
SPU_GAUSSIAN_TABLE = [
    # These match the hardware's 4-point Gaussian interpolation
    0.0, 0.151, 0.290, 0.405, 0.5, 0.595, 0.710, 0.849, 1.0
]

# SPU reverb operates at half rate (22050 Hz) with reconstruction filter
SPU_REVERB_RATE_HZ = 22050

# SPU register map (partial, inferred from SNES/PS2 counterparts)
SPU_REGISTERS = {
    # Voice 0..23 registers (eight 16-bit regs per voice at 0x10 interval)
    # 0x1F801C00 + 0x10 * voice
    0x00: "V_VOL_LEFT",    # Volume left (signed 16-bit)
    0x02: "V_VOL_RIGHT",   # Volume right (signed 16-bit)
    0x04: "V_PITCH",       # Pitch (0=stop, 0x4000=44.1kHz, max 0xFFFF)
    0x06: "V_START_ADDR",  # Sample start address (in SPU RAM, /8)
    0x08: "V_ADSR1",       # ADSR Attack/Decay
    0x0A: "V_ADSR2",       # ADSR Sustain/Release
    0x0C: "V_ADSR_VOL",    # Current ADSR volume
    0x0E: "V_REPEAT_ADDR", # Loop repeat address
    # Voice flags (six 1-bit flags per voice at 0x1F801D88)
    0x100: "V_PLAYING",    # Key on/off
    0x101: "V_NOISE",      # Noise enable
    0x102: "V_REVERB",     # Reverb send enable
    0x103: "V_LOOP",       # Loop repeat flag
    0x104: "V_ENDX",       # End without repeat reached
    0x105: "V_FM",         # Pitch modulation (LFO) enable
    # SPU control
    0x1F801D80: "MVOL_LEFT",  # Main volume left
    0x1F801D82: "MVOL_RIGHT", # Main volume right
    0x1F801D84: "EVOL_LEFT",  # Reverb output volume left
    0x1F801D86: "EVOL_RIGHT", # Reverb output volume right
    0x1F801D88: "PMON0",      # Pitch modulation enable voice 1..15
    0x1F801D8A: "PMON1",      # Pitch modulation enable voice 16..23
    0x1F801D8C: "NON0",       # Noise enable voice 0..15
    0x1F801D8E: "NON1",       # Noise enable voice 16..23
    0x1F801D90: "VOLMOD0",    # Volume sweep mode voice 0..15
    0x1F801D92: "VOLMOD1",    # Volume sweep mode voice 16..23
    0x1F801D94: "EON0",       # Reverb send enable voice 0..15
    0x1F801D96: "EON1",       # Reverb send enable voice 16..23
    0x1F801D98: "KON0",       # Key on voice 0..15
    0x1F801D9A: "KON1",       # Key on voice 16..23
    0x1F801D9C: "KOFF0",      # Key off voice 0..15
    0x1F801D9E: "KOFF1",      # Key off voice 16..23
    0x1F801DA0: "ATTR",       # Attribute (reverb master, CD/external reverb)
    0x1F801DA2: "MBASE",      # Reverb work area start address (/8)
    0x1F801DA4: "ADDR",       # Current SPU RAM address for DMA
    0x1F801DA6: "TS_ADDR",    # Transfer size / address
    0x1F801DA8: "FADDR",      # FIFO address
    0x1F801DAA: "CONTROL",    # SPU control (enable, mute, DMA, etc.)
    0x1F801DAC: "CDVOL_LEFT", # CD volume left
    0x1F801DAE: "CDVOL_RIGHT",# CD volume right
    0x1F801DB0: "EXVOL_LEFT", # External volume left
    0x1F801DB2: "EXVOL_RIGHT",# External volume right
    0x1F801DB4: "CVOL_LEFT",  # Main volume left (alt)
    0x1F801DB6: "CVOL_RIGHT", # Main volume right (alt)
    # Reverb configuration (0x1F801DC0 - 0x1F801DFF)
    0x1F801DC0: "dAPF1", 0x1F801DC2: "dAPF2",
    0x1F801DC4: "vIIR", 0x1F801DC6: "vCOMB1", 0x1F801DC8: "vCOMB2",
    0x1F801DCA: "vCOMB3", 0x1F801DCC: "vCOMB4", 0x1F801DCE: "vWALL",
    0x1F801DD0: "vAPF1", 0x1F801DD2: "vAPF2",
    0x1F801DD4: "mLSAME", 0x1F801DD6: "mRSAME",
    0x1F801DD8: "mLCOMB1", 0x1F801DDA: "mRCOMB1",
    0x1F801DDC: "mLCOMB2", 0x1F801DDE: "mRCOMB2",
    0x1F801DE0: "dLSAME", 0x1F801DE2: "dRSAME",
    0x1F801DE4: "mLDIFF", 0x1F801DE6: "mRDIFF",
    0x1F801DE8: "mLCOMB3", 0x1F801DEA: "mRCOMB3",
    0x1F801DEC: "mLCOMB4", 0x1F801DEE: "mRCOMB4",
    0x1F801DF0: "dLDIFF", 0x1F801DF2: "dRDIFF",
    0x1F801DF4: "mLAPF1", 0x1F801DF6: "mRAPF1",
    0x1F801DF8: "mLAPF2", 0x1F801DFA: "mRAPF2",
    0x1F801DFC: "vLIN", 0x1F801DFE: "vRIN",
}

# Voice pitch range: -12 octaves to +2 octaves (pitch register 0x0000..0xFFFF)
SPU_PITCH_BASE = 0x4000  # 44.1 kHz = 0x4000
SPU_PITCH_MAX = 0xFFFF   # Max ~176.4 kHz (clipped by hardware)

# ADSR envelope rates (linear/exponential curves, per-voice)
# Attack: linear 0..0x7FFF over time; Decay/Release: exponential; Sustain: level 0..0x7FFF
SPU_ADSR_MODES = {
    "attack": ["linear", "exponential"],
    "decay": ["exponential"],
    "sustain": ["linear", "exponential"],
    "release": ["exponential"],
}

# Volume sweep modes (per voice)
SPU_SWEEP_MODES = [
    "off",              # 0: Direct volume
    "linear_inc",       # 1: Linear increment
    "linear_dec",       # 2: Linear decrement
    "exp_inc",          # 3: Exponential increment
    "exp_dec",          # 4: Exponential decrement
    "reverse_idx_inc",  # 5: Reverse indexed increment
    "idx_dec",          # 6: Indexed decrement
    "off_alt",          # 7: Off (alt)
]

# Noise generator: 16-bit LFSR, clock rate shared across voices
SPU_NOISE_CLOCK_RATES = [0x00, 0x20, 0x40, 0x60, 0x80, 0xA0, 0xC0, 0xE0]  # Relative to sample rate

# Memory layout (512 KB = 524,288 bytes)
SPU_RAM_SIZE = 512 * 1024
SPU_RAM_CD_LEFT = 0x0000   # 1 KB
SPU_RAM_CD_RIGHT = 0x0400  # 1 KB
SPU_RAM_V1_CAPTURE = 0x0800  # Voice 1 capture (1 KB)
SPU_RAM_V3_CAPTURE = 0x0C00  # Voice 3 capture (1 KB)
SPU_RAM_SAMPLES_START = 0x1000
SPU_RAM_REVERB_START = None  # Variable, set by MBASE register (default ~0x60000)

PSX_SPU_SPEC = SystemSpec(
    name="psx",
    label="Sony PlayStation (PSX) - SPU: 24 ADPCM voices, 44.1 kHz, 512 KB RAM, Gaussian interp, stereo reverb",
    channels=[
        *[ChannelSpec(Waveform.VOX, 0, pan=-0.5 + (i % 2)) for i in range(24)],  # 24 ADPCM voices
        ChannelSpec(Waveform.NOISE, 0, noise_type=NoiseType.LFSR),  # Noise on any voice
    ],
    bandwidth_hz=None,
    noise_type=NoiseType.LFSR,
    stereo=True,
    sample_rate=44100,
    output_sample_rate=44100,
    cpu_clock_hz=33868800,  # PSX CPU clock (33.8688 MHz)
    echo={
        "time_s": 0.15,
        "feedback": 0.5,
        "mix": 0.3,
        "reverb_rate_hz": SPU_REVERB_RATE_HZ,
        "type": "schroeder_stereo",
    },
    vibrato={"rate": 5.0, "depth": 0.02},  # Pitch modulation via adjacent voice
    filter_cutoff_hz=22050,  # Nyquist at 44.1 kHz
    filter_q=1.0,
    mix_formula="psx_spu",  # Special mixing: 24 voices + CD + External -> Reverb -> Main out
)

# PSX register aliases (match common devkit names)
PSX_REGISTERS = SPU_REGISTERS


# ============================================================================
# Master Profile Registry
# ============================================================================

ALL_SYSTEMS: dict[str, SystemSpec] = {
    "nes": NES_SPEC,
    "nes_pal": NES_PAL,
    "gameboy": GAMEBOY_DMG_SPEC,
    "gameboy_cgb": GAMEBOY_CGB_SPEC,
    "snes": SNES_SPEC,
    "genesis": GENESIS_SPEC,
    "c64": SID_6581_SPEC,
    "c64_8580": SID_8580_SPEC,
    "atari": ATARI_SPEC,
    "pico8": PICO8_SPEC,
    "opl2": OPL2_SPEC,
    "opl3": OPL3_SPEC,
    "mt32": MT32_SPEC,
    "sc55": SC55_SPEC,
    "sc88": SC88_SPEC,
    "sc88pro": SC88PRO_SPEC,
    "psx": PSX_SPU_SPEC,
    "loose": SystemSpec(
        name="loose",
        label="Loose chip - 5 voices, light bandlimit",
        channels=[
            ChannelSpec(Waveform.PULSE, 50),
            ChannelSpec(Waveform.PULSE, 50),
            ChannelSpec(Waveform.TRIANGLE, 0),
            ChannelSpec(Waveform.SAW, 0),
            ChannelSpec(Waveform.NOISE, 0, noise_type=NoiseType.WHITE),
        ],
        bandwidth_hz=16000,
        noise_type=NoiseType.WHITE,
        stereo=False,
    ),
    "full": SystemSpec(
        name="full",
        label="Full - same voices, no bandlimit, stereo spread",
        channels=[
            ChannelSpec(Waveform.PULSE, 50),
            ChannelSpec(Waveform.PULSE, 50),
            ChannelSpec(Waveform.TRIANGLE, 0),
            ChannelSpec(Waveform.SAW, 0),
            ChannelSpec(Waveform.NOISE, 0, noise_type=NoiseType.WHITE),
        ],
        bandwidth_hz=None,
        noise_type=NoiseType.WHITE,
        stereo=True,
    ),
}

# System aliases (for lookup only — not in main registry)
SYSTEM_ALIASES = {
    "2a03": "nes",
    "2a07": "nes_pal",
    "dmc": "nes",
    "dmc_pal": "nes_pal",
    "sm83": "gameboy",
    "lr35902": "gameboy",
    "spc700": "snes",
    "sdsp": "snes",
    "ym2612": "genesis",
    "opn2": "genesis",
    "sid": "c64",
    "6581": "c64",
    "8580": "c64_8580",
    "tia": "atari",
    "opl2": "opl2",
    "opl3": "opl3",
    "ym3812": "opl2",
    "ymf262": "opl3",
    "la32": "mt32",
    "sc55": "sc55",
    "sc88": "sc88",
    "sc88pro": "sc88pro",
    "psx_spu": "psx",
    "playstation": "psx",
    "ps1": "psx",
    "psone": "psx",
}


def get_system_spec(name: str) -> SystemSpec:
    """Get system spec by name or alias."""
    normalized = name.lower().replace("-", "_").replace(" ", "_")
    if normalized in SYSTEM_ALIASES:
        normalized = SYSTEM_ALIASES[normalized]
    if normalized not in ALL_SYSTEMS:
        raise ValueError(f"Unknown system: {name}. Available: {sorted(ALL_SYSTEMS.keys())}")
    return ALL_SYSTEMS[normalized]


def list_systems() -> list[dict[str, Any]]:
    """List all available systems for API."""
    return [
        {"name": k, "label": v.label, "channels": len(v.channels), "bandwidth": v.bandwidth_hz}
        for k, v in sorted(ALL_SYSTEMS.items())
    ]


# ============================================================================
# Dynamic Parameter Framework
# ============================================================================

class HardwareProfile:
    """Hardware profile with dynamic parameters for realistic variation."""

    def __init__(self, spec: SystemSpec):
        self.spec = spec
        self.age_factor = 0.0  # 0.0 = factory new, 1.0 = heavily aged
        self.temperature_c = 25.0
        self.voltage_factor = 1.0  # Power supply variance

    def apply_aging(self, params: dict[str, float], age_factor: float | None = None) -> dict[str, float]:
        """Apply component aging simulation."""
        age = age_factor if age_factor is not None else self.age_factor
        if age <= 0:
            return params

        result = params.copy()
        # Capacitor ESR increase -> more noise floor
        result["noise_floor"] = result.get("noise_floor", 0) * (1 + age * 0.15)
        # Capacitor value drift -> filter cutoff shift
        result["filter_cutoff_hz"] = result.get("filter_cutoff_hz", 10000) * (1 - age * 0.08)
        # Clock crystal aging
        result["cpu_clock_hz"] = int(result.get("cpu_clock_hz", 1789773) * (1 - age * 0.0002))
        # Op-amp slew rate degradation
        result["slew_rate"] = result.get("slew_rate", 1.0) * (1 - age * 0.1)
        return result

    def apply_temperature(self, params: dict[str, float], temp_c: float | None = None) -> dict[str, float]:
        """Apply temperature drift (typical 50ppm/C for crystals)."""
        temp = temp_c if temp_c is not None else self.temperature_c
        delta = temp - 25.0

        result = params.copy()
        # Crystal frequency drift
        result["cpu_clock_hz"] = int(result.get("cpu_clock_hz", 1789773) * (1 + delta * 50e-6))
        # Filter cutoff thermal drift
        result["filter_cutoff_hz"] = result.get("filter_cutoff_hz", 10000) * (1 + delta * 0.0015)
        # Op-amp bias current shift
        result["noise_floor"] = result.get("noise_floor", 0) * (1 + abs(delta) * 0.002)
        return result

    def apply_voltage_variance(self, params: dict[str, float], factor: float | None = None) -> dict[str, float]:
        """Apply power supply voltage variance."""
        v = factor if factor is not None else self.voltage_factor
        result = params.copy()
        result["voltage"] = result.get("voltage", 5.0) * v
        # Linear regulators track input
        result["noise_floor"] = result.get("noise_floor", 0) * v
        return result

    def get_realtime_modulators(self) -> dict[str, Any]:
        """Available real-time modulation sources."""
        return {
            "lfo": {"rate_range": (0.05, 30), "shapes": ["sine", "triangle", "saw", "square", "s&h"]},
            "envelope": ["adsr", "ahdsr", "dadsr", "adsr_loop"],
            "velocity": {"curves": ["linear", "exponential", "logarithmic", "fixed"]},
            "aftertouch": {"range": (0, 127)},
            "modwheel": {"range": (0, 127)},
            "expression": {"range": (0, 127)},
            "breath": {"range": (0, 127)},
            "foot": {"range": (0, 127)},
            "pitch_bend": {"range_semitones": (-12, 12)},
            "aftertouch_poly": {"range": (0, 127)},
        }

    def get_dynamic_params(self, base_params: dict[str, float]) -> dict[str, float]:
        """Apply all dynamic effects to base parameters."""
        params = base_params.copy()
        params = self.apply_aging(params)
        params = self.apply_temperature(params)
        params = self.apply_voltage_variance(params)
        return params


def create_hardware_profile(system_name: str, **overrides) -> HardwareProfile:
    """Factory function with optional parameter overrides."""
    spec = get_system_spec(system_name)
    profile = HardwareProfile(spec)

    # Apply any runtime overrides
    for key, value in overrides.items():
        if hasattr(profile, key):
            setattr(profile, key, value)

    return profile


# Export
__all__ = [
    "Waveform", "NoiseType", "ChannelSpec", "SystemSpec",
    "HardwareProfile",
    "NES_SPEC", "NES_NTSC", "NES_PAL", "NES_REGISTERS",
    "GAMEBOY_DMG_SPEC", "GAMEBOY_CGB_SPEC", "GAMEBOY_REGISTERS",
    "SNES_SPEC", "SNES_REGISTERS", "BRR_FILTERS",
    "GENESIS_SPEC", "YM2612_ALGORITHMS", "YM2612_REGISTERS",
    "SID_6581_SPEC", "SID_8580_SPEC", "SID_REGISTERS", "SID_CONTROL_BITS", "SID_ADSR_RATES", "SID_CAPACITORS",
    "ATARI_SPEC", "ATARI_DUTIES",
    "PICO8_SPEC",
    "OPL2_SPEC", "OPL3_SPEC", "OPL_REGISTERS", "OPL_WAVEFORMS",
    "MT32_SPEC", "MT32_REGISTERS",
    "SC55_SPEC", "SC88_SPEC", "SC88PRO_SPEC",
    "PSX_SPU_SPEC", "PSX_REGISTERS", "SPU_REGISTERS",
    "SPU_ADPCM_BLOCK_SIZE", "SPU_ADPCM_SAMPLES_PER_BLOCK", "SPU_ADPCM_FILTERS",
    "SPU_GAUSSIAN_TABLE", "SPU_REVERB_RATE_HZ", "SPU_PITCH_BASE", "SPU_PITCH_MAX",
    "SPU_ADSR_MODES", "SPU_SWEEP_MODES", "SPU_NOISE_CLOCK_RATES",
    "SPU_RAM_SIZE", "SPU_RAM_CD_LEFT", "SPU_RAM_CD_RIGHT",
    "SPU_RAM_V1_CAPTURE", "SPU_RAM_V3_CAPTURE", "SPU_RAM_SAMPLES_START",
    "ALL_SYSTEMS", "SYSTEM_ALIASES",
    "get_system_spec", "list_systems", "create_hardware_profile",
    "HardwareProfile",
]

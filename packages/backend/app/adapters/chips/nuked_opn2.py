"""
Nuked-OPN2 Adapter (Yamaha YM2612 / YM3438)

Wraps the nuked_opn2 Python C extension for cycle-accurate Genesis/Mega Drive FM emulation.

Upstream: https://github.com/nukeykt/Nuked-OPN2
Version: 1.0.12
"""

import logging
from typing import Any, ClassVar

from . import AdapterRegistry, AudioBuffer, ChipAdapter

logger = logging.getLogger(__name__)


class NukedOPN2Adapter(ChipAdapter):
    """Adapter for Nuked-OPN2 (YM2612/OPN2) emulator."""

    CORE_NAME = "nuked-opn2"
    SUPPORTED_SYSTEMS: ClassVar = ["genesis", "megadrive", "ym2612", "opn2"]

    # YM2612 register map constants
    REG_DAC_ENABLE = 0x2B
    REG_LFO = 0x22
    REG_ALGORITHM = 0x20
    REG_KEY_ON = 0x28
    REG_FNUM_LOW = 0xA0
    REG_FNUM_HIGH = 0xA4

    # Operator register bases (per operator)
    OP_BASES: ClassVar = [0x30, 0x34, 0x38, 0x3C]  # OP1, OP2, OP3, OP4

    def __init__(self, sample_rate: int = 44100, **kwargs):
        super().__init__(sample_rate, **kwargs)
        self._algorithm = 7  # Default: all carriers
        self._primed = False

    def _create_chip(self) -> Any:
        import nuked_opn2
        chip = nuked_opn2.NukedOPN2()
        chip.set_chip_type(3)  # MODE_YM2612 | MODE_READMODE
        return chip

    def _reset_chip(self) -> None:
        self._chip.reset()
        self._primed = False

    def _write_register_raw(self, address: int, value: int) -> None:
        # Use the high-level write_register which handles bus timing
        self._chip.write_register(address, value)

    def _generate_raw(self, num_samples: int, *, stereo: bool) -> bytes:
        return self._chip.generate(num_samples, stereo=stereo)

    def initialize(self) -> None:
        """Initialize and prime the chip."""
        super().initialize()

        # Configure for pure FM (no DAC)
        self.write_register(self.REG_DAC_ENABLE, 0x00)
        self.write_register(self.REG_LFO, 0x00)  # LFO off
        self.set_algorithm(self._algorithm)

        # Configure all 4 operators as carriers with default envelope
        for op_base in self.OP_BASES:
            self.write_register(op_base, 0x00)        # MUL=1
            self.write_register(op_base + 0x10, 0x00)  # TL=0 (max volume)
            self.write_register(op_base + 0x20, 0x0F)  # AR=15 (fastest attack)
            self.write_register(op_base + 0x30, 0x00)  # DR=0
            self.write_register(op_base + 0x40, 0x0F)  # SR=0, RR=15
            self.write_register(op_base + 0x50, 0x00)  # SL=0
            self.write_register(op_base + 0x60, 0x00)  # SSG-EG=0

        # Prime the chip: dummy key-on/off to initialize EG state
        # (Nuked-OPN2 has an issue where first key-on after reset doesn't trigger attack)
        if not self._primed:
            self.write_register(self.REG_FNUM_LOW, 0xBA)
            self.write_register(self.REG_FNUM_HIGH, 0x2C)
            self.write_register(self.REG_KEY_ON, 0xF0)
            self.propagate(50)
            self.write_register(self.REG_KEY_ON, 0x00)
            self.propagate(24)
            self._primed = True

        logger.info("Nuked-OPN2 adapter initialized and primed")

    def set_algorithm(self, algorithm: int) -> None:
        """Set FM algorithm (0-7)."""
        self._algorithm = algorithm & 0x07
        self.write_register(self.REG_ALGORITHM, self._algorithm)

    def key_on(self, channel: int = 0, operators: int = 0xF) -> None:
        """Key on for a channel."""
        if channel == 0:
            self.write_register(self.REG_KEY_ON, operators | 0xF0)
        else:
            # For other channels, need to use the proper key-on register
            pass

    def key_off(self, channel: int = 0) -> None:
        """Key off for a channel."""
        if channel == 0:
            self.write_register(self.REG_KEY_ON, 0x00)

    def set_frequency(self, freq_hz: float, channel: int = 0) -> None:
        """Set frequency for a channel."""
        if freq_hz <= 0:
            return

        master_clock = 7670454
        internal_clock = master_clock / 6.0
        fnum = int(round(freq_hz * (2**20) / internal_clock))
        block = 0
        while fnum >= 0x400 and block < 7:
            fnum >>= 1
            block += 1

        fnum = min(fnum, 0x3FF)

        if channel == 0:
            self.write_register(self.REG_FNUM_LOW, fnum & 0xFF)
            self.write_register(self.REG_FNUM_HIGH, ((block & 7) << 3) | (fnum >> 8))

    def set_operator(self, op: int, mul: int = 1, tl: int = 0,
                     ar: int = 15, dr: int = 0, sr: int = 0, rr: int = 15,
                     sl: int = 0, ssg_eg: int = 0) -> None:
        """Configure an operator (1-4)."""
        if not 1 <= op <= 4:
            raise ValueError("Operator must be 1-4")

        base = self.OP_BASES[op - 1]
        self.write_register(base, (mul - 1) & 0x0F)  # MUL
        self.write_register(base + 0x10, tl & 0x7F)  # TL
        self.write_register(base + 0x20, ar & 0x1F)  # AR
        self.write_register(base + 0x30, dr & 0x1F)  # DR
        self.write_register(base + 0x40, (sr & 0x0F) | ((rr & 0x0F) << 4))  # SR/RR
        self.write_register(base + 0x50, sl & 0x0F)  # SL
        self.write_register(base + 0x60, ssg_eg & 0x0F)  # SSG-EG

    def clock(self, num_cycles: int) -> AudioBuffer | None:
        """Run exact number of internal clock cycles."""
        if not self._initialized:
            self.initialize()
        raw = self._chip.clock(num_cycles)
        if not raw:
            return None

        import struct

        import numpy as np
        samples = struct.unpack('<' + 'h' * (len(raw) // 2), raw)
        audio = np.array(samples, dtype=np.float32).reshape(-1, 2) / 32768.0
        return audio

    def propagate(self, num_cycles: int) -> None:
        """Run cycles for register propagation."""
        if not self._initialized:
            self.initialize()
        self._chip.propagate(num_cycles)

    @property
    def chip_info(self) -> dict:
        info = super().chip_info
        info.update({
            "algorithm": self._algorithm,
            "primed": self._primed,
        })
        return info


# Register the adapter
AdapterRegistry.register("genesis", NukedOPN2Adapter)
AdapterRegistry.register("megadrive", NukedOPN2Adapter)
AdapterRegistry.register("ym2612", NukedOPN2Adapter)
AdapterRegistry.register("opn2", NukedOPN2Adapter)

"""
Nuked-OPL3 Adapter (Yamaha YMF262 / OPL3 / OPL2)

Wraps the nuked_opl3 Python C extension for cycle-accurate OPL2/OPL3 emulation.

Upstream: https://github.com/nukeykt/Nuked-OPL3
"""

import logging
from typing import Any, ClassVar

from . import AdapterRegistry, ChipAdapter

logger = logging.getLogger(__name__)


class NukedOPL3Adapter(ChipAdapter):
    """Adapter for Nuked-OPL3 (YMF262/OPL3/OPL2) emulator."""

    CORE_NAME = "nuked-opl3"
    SUPPORTED_SYSTEMS: ClassVar = ["opl3", "opl2", "ymf262", "ym3812", "adlib", "soundblaster"]

    def __init__(self, sample_rate: int = 44100, **kwargs):
        super().__init__(sample_rate, **kwargs)
        self._sample_rate = sample_rate

    def _create_chip(self) -> Any:
        import nuked_opl3
        chip = nuked_opl3.NukedOPL3()
        return chip

    def _reset_chip(self) -> None:
        self._chip.reset(self._sample_rate)

    def _write_register_raw(self, address: int, value: int) -> None:
        self._chip.write(address, value)

    def _generate_raw(self, num_samples: int, *, stereo: bool) -> bytes:
        return self._chip.generate(num_samples)

    def initialize(self) -> None:
        super().initialize()
        logger.info("Nuked-OPL3 adapter initialized")

    def write_register(self, address: int, value: int) -> None:
        """Write OPL3 register (0x000-0x3FF range)."""
        if not self._initialized:
            self.initialize()
        self._chip.write(address, value)

    def write_buffered(self, address: int, value: int) -> None:
        """Write OPL3 register buffered."""
        if not self._initialized:
            self.initialize()
        self._chip.write_buffered(address, value)

    def set_chip_type(self, *, is_opl3: bool) -> None:
        """Switch between OPL2 (False) and OPL3 (True) mode."""
        if is_opl3:
            # Enable 4-op mode and 4-channel output
            self.write_register(0x105, 0x01)
        else:
            self.write_register(0x105, 0x00)

    def key_on(self, channel: int, note: int) -> None:
        """Key on for a channel with given MIDI note."""
        if not self._initialized:
            self.initialize()
        # OPL3 key-on involves F-Number and Block registers

    def set_frequency(self, freq_hz: float, channel: int) -> None:
        """Set frequency for a channel."""

    def generate_4ch(self, num_samples: int) -> bytes:
        """Generate 4-channel audio (OPL3 4-channel mode)."""
        if not self._initialized:
            self.initialize()
        return self._chip.generate_4ch(num_samples)


AdapterRegistry.register("opl3", NukedOPL3Adapter)
AdapterRegistry.register("opl2", NukedOPL3Adapter)
AdapterRegistry.register("ymf262", NukedOPL3Adapter)
AdapterRegistry.register("ym3812", NukedOPL3Adapter)
AdapterRegistry.register("adlib", NukedOPL3Adapter)
AdapterRegistry.register("soundblaster", NukedOPL3Adapter)

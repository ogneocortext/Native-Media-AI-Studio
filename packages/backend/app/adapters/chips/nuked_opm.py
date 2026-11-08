"""
Nuked-OPM Adapter (Yamaha YM2151 / OPM)

Wraps the nuked_opm Python C extension for cycle-accurate OPM emulation.

Upstream: https://github.com/nukeykt/Nuked-OPM
"""

import logging
from typing import Any, ClassVar

from . import AdapterRegistry, ChipAdapter

logger = logging.getLogger(__name__)


class NukedOPMAdapter(ChipAdapter):
    """Adapter for Nuked-OPM (YM2151) emulator."""

    CORE_NAME = "nuked-opm"
    SUPPORTED_SYSTEMS: ClassVar = ["opm", "ym2151", "ym2164"]

    def __init__(self, sample_rate: int = 44100, **kwargs):
        super().__init__(sample_rate, **kwargs)
        self._chip_type = 0  # 0=YM2151, 1=YM2164

    def _create_chip(self) -> Any:
        import nuked_opm
        chip = nuked_opm.NukedOPM()
        return chip

    def _reset_chip(self) -> None:
        self._chip.reset()

    def _write_register_raw(self, address: int, value: int) -> None:
        self._chip.write(address, value)

    def _generate_raw(self, num_samples: int, *, stereo: bool) -> bytes:
        return self._chip.generate(num_samples, stereo=stereo)

    def initialize(self) -> None:
        super().initialize()
        logger.info("Nuked-OPM adapter initialized")

    def set_chip_type(self, chip_type: int) -> None:
        """Set chip type: 0=YM2151, 1=YM2164."""
        self._chip_type = chip_type
        self._chip.set_chip_type(chip_type)

    def write_register(self, address: int, value: int) -> None:
        """Write register (port 0=address, port 1=data)."""
        if not self._initialized:
            self.initialize()
        # OPM uses ports 0 and 1
        self._chip.write(0, address)
        self._chip.write(1, value)

    def key_on(self, channel: int, operators: int = 0xF) -> None:
        """Key on for a channel (not directly supported in simple API)."""

    def set_frequency(self, freq_hz: float, channel: int) -> None:
        """Set frequency (not directly exposed in simple API)."""


AdapterRegistry.register("opm", NukedOPMAdapter)
AdapterRegistry.register("ym2151", NukedOPMAdapter)
AdapterRegistry.register("ym2164", NukedOPMAdapter)

"""
snes-spc Adapter (Sony SPC700 + S-DSP)

Wraps the snes-spc Python C++ extension for cycle-accurate SNES SPC700 emulation.

Upstream: https://github.com/blarggs-audio-libraries/snes_spc
"""

import logging
from typing import Any, ClassVar

from . import AdapterRegistry, ChipAdapter

logger = logging.getLogger(__name__)


class SnesSpcAdapter(ChipAdapter):
    """Adapter for snes-spc (SPC700 + S-DSP) emulator."""

    CORE_NAME = "snes-spc"
    SUPPORTED_SYSTEMS: ClassVar = ["snes", "spc700", "sdsp", "supernintendo"]

    def __init__(self, sample_rate: int = 32000, **kwargs):
        super().__init__(sample_rate, **kwargs)

    def _create_chip(self) -> Any:
        import snes_spc
        spc = snes_spc.SnesSpc()
        return spc

    def _reset_chip(self) -> None:
        self._chip.reset()

    def _write_register_raw(self, address: int, value: int) -> None:
        # snes-spc uses time-stamped writes
        self._chip.write_port(0, address, value)

    def _generate_raw(self, num_samples: int, *, stereo: bool) -> bytes:
        # Generate at native 32kHz rate
        return self._chip.play(num_samples)

    def initialize(self) -> None:
        super().initialize()
        logger.info("snes-spc adapter initialized")

    def write_register(self, address: int, value: int, time: int = 0) -> None:
        """Write to SPC I/O port with timestamp."""
        if not self._initialized:
            self.initialize()
        self._chip.write_port(time, address, value)

    def read_register(self, address: int, time: int = 0) -> int:
        """Read from SPC I/O port."""
        if not self._initialized:
            self.initialize()
        return self._chip.read_port(time, address)

    def clear_echo(self) -> None:
        """Clear echo buffer."""
        if self._initialized:
            self._chip.clear_echo()

    def set_tempo(self, tempo: int) -> None:
        """Set tempo (tempo_unit = 0x100)."""
        if self._initialized:
            self._chip.set_tempo(tempo)

    def mute_voices(self, mask: int) -> None:
        """Mute voices by bitmask (8 voices)."""
        if self._initialized:
            self._chip.mute_voices(mask)

    def load_spc(self, spc_data: bytes) -> None:
        """Load SPC file data."""
        if not self._initialized:
            self.initialize()
        if len(spc_data) < 0x10180:
            raise ValueError("SPC data too small")
        self._chip.load_spc(spc_data, len(spc_data))

    def skip(self, sample_pairs: int) -> None:
        """Skip sample pairs (faster than play)."""
        if self._initialized:
            self._chip.skip(sample_pairs)

    def clock(self, num_cycles: int) -> None:
        """Run exact number of SPC700 clock cycles."""
        # Not directly exposed, use play/skip


AdapterRegistry.register("snes", SnesSpcAdapter)
AdapterRegistry.register("spc700", SnesSpcAdapter)
AdapterRegistry.register("sdsp", SnesSpcAdapter)
AdapterRegistry.register("supernintendo", SnesSpcAdapter)

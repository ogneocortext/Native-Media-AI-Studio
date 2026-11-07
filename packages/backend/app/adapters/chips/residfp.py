"""
reSIDfp Adapter (MOS 6581 / CSG 8580 SID)

Wraps the libresidfp Python C++ extension for cycle-accurate SID emulation.

Upstream: https://github.com/libsidplayfp/libresidfp
"""

from typing import Any, Optional
import logging

from . import ChipAdapter, AdapterRegistry

logger = logging.getLogger(__name__)


class ResidfpAdapter(ChipAdapter):
    """Adapter for libresidfp (SID 6581/8580) emulator."""
    
    CORE_NAME = "residfp"
    SUPPORTED_SYSTEMS = ["c64", "c64_6581", "c64_8580", "sid", "6581", "8580"]
    
    def __init__(self, sample_rate: int = 44100, model: str = "6581", **kwargs):
        super().__init__(sample_rate, **kwargs)
        self._model = model  # "6581" or "8580"
        self._clock_freq = 1022730 if model == "6581" else 985248
    
    def _create_chip(self) -> Any:
        import residfp
        chip = residfp.Residfp()
        return chip
    
    def _reset_chip(self) -> None:
        self._chip.reset()
    
    def _write_register_raw(self, address: int, value: int) -> None:
        self._chip.write(address, value)
    
    def _generate_raw(self, num_samples: int, stereo: bool) -> bytes:
        # Generate at native rate, then resample if needed
        return self._chip.generate(num_samples, stereo=stereo)
    
    def initialize(self) -> None:
        super().initialize()
        
        # Set chip model
        model_const = 0 if self._model == "6581" else 1  # MOS6581=0, CSG8580=1
        self._chip.set_chip_model(model_const)
        
        # Set sampling parameters (RESAMPLE_INTERPOLATE=1)
        self._chip.set_sampling_parameters(
            clock_freq=self._clock_freq,
            method=1,  # RESAMPLE
            sample_freq=self.sample_rate
        )
        
        # Enable filter
        self._chip.enable_filter(1)
        
        logger.info(f"reSIDfp adapter initialized ({self._model})")
    
    def write_register(self, address: int, value: int) -> None:
        """Write SID register (0x00-0x1F)."""
        if not self._initialized:
            self.initialize()
        self._chip.write(address, value)
    
    def read_register(self, address: int) -> int:
        """Read SID register."""
        if not self._initialized:
            self.initialize()
        return self._chip.read(address)
    
    def set_chip_model(self, model: str) -> None:
        """Set chip model: '6581' or '8580'."""
        self._model = model
        self._clock_freq = 1022730 if model == "6581" else 985248
        if self._initialized:
            model_const = 0 if model == "6581" else 1
            self._chip.set_chip_model(model_const)
            self._chip.set_sampling_parameters(self._clock_freq, 1, self.sample_rate)
    
    def set_filter(self, enable: bool) -> None:
        """Enable/disable filter."""
        if self._initialized:
            self._chip.enable_filter(1 if enable else 0)
    
    def set_filter_curve(self, model: str, curve: float) -> None:
        """Set filter curve."""
        if self._initialized:
            if model == "6581":
                self._chip.set_filter_6581_curve(curve)
            elif model == "8580":
                self._chip.set_filter_8580_curve(curve)
    
    def set_combined_waveforms(self, strength: int) -> None:
        """Set combined waveforms strength: 0=off, 1=weak, 2=medium, 3=strong."""
        if self._initialized:
            self._chip.set_combined_waveforms(strength)
    
    def set_dc_blocker(self, resistance: float) -> None:
        """Set DC blocker resistance (0.0-1.0)."""
        if self._initialized:
            self._chip.set_dc_blocker(resistance)
    
    def set_dac_leakage(self, level: float) -> None:
        """Set DAC leakage (0.0-1.0)."""
        if self._initialized:
            self._chip.set_dac_leakage(level)
    
    def set_6581_caps(self, caps_type: int) -> None:
        """Set 6581 capacitor type: 0=2200pF, 1=470pF, 2=330pF."""
        if self._initialized:
            self._chip.set_6581_caps(caps_type)


AdapterRegistry.register("c64", ResidfpAdapter)
AdapterRegistry.register("c64_6581", ResidfpAdapter)
AdapterRegistry.register("c64_8580", ResidfpAdapter)
AdapterRegistry.register("sid", ResidfpAdapter)
AdapterRegistry.register("6581", ResidfpAdapter)
AdapterRegistry.register("8580", ResidfpAdapter)
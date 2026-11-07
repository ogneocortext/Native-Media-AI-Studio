"""
Chip Emulator Adapters

Provides a unified interface for all cycle-accurate chip emulators.
This abstraction layer isolates the project from upstream API changes.

Usage:
    from app.adapters.chips import get_adapter
    
    adapter = get_adapter("genesis")  # Returns NukedOPN2Adapter
    adapter.write_register(0x28, 0xF0)
    audio = adapter.generate(44100, stereo=True)
"""

from abc import ABC, abstractmethod
from typing import Any, Optional, Dict, List, Tuple
import numpy as np
import logging

logger = logging.getLogger(__name__)

# Type aliases
RegisterWrite = Tuple[int, int]  # (address, value)
AudioBuffer = np.ndarray  # float32, shape (n_samples,) or (n_samples, 2)


class ChipAdapter(ABC):
    """Base class for all chip emulator adapters."""
    
    # Core identification
    CORE_NAME: str = "base"
    SUPPORTED_SYSTEMS: List[str] = []
    
    def __init__(self, sample_rate: int = 44100, **kwargs):
        self.sample_rate = sample_rate
        self._chip = None
        self._initialized = False
        self._init_kwargs = kwargs
    
    @abstractmethod
    def _create_chip(self) -> Any:
        """Create the underlying chip emulator instance."""
        pass
    
    @abstractmethod
    def _reset_chip(self) -> None:
        """Reset the chip to initial state."""
        pass
    
    @abstractmethod
    def _write_register_raw(self, address: int, value: int) -> None:
        """Low-level register write (implementation-specific)."""
        pass
    
    @abstractmethod
    def _generate_raw(self, num_samples: int, stereo: bool) -> bytes:
        """Generate raw audio bytes from the chip."""
        pass
    
    def initialize(self) -> None:
        """Initialize the chip emulator."""
        if self._initialized:
            return
        
        try:
            self._chip = self._create_chip()
            self._reset_chip()
            self._initialized = True
            logger.info(f"Initialized {self.CORE_NAME} adapter")
        except Exception as e:
            logger.error(f"Failed to initialize {self.CORE_NAME}: {e}")
            raise
    
    def write_register(self, address: int, value: int) -> None:
        """Write a register with proper bus timing."""
        if not self._initialized:
            self.initialize()
        self._write_register_raw(address, value)
    
    def write_registers(self, registers: List[RegisterWrite]) -> None:
        """Write multiple registers in sequence."""
        for addr, val in registers:
            self.write_register(addr, val)
    
    def generate(self, num_samples: int, stereo: bool = True) -> AudioBuffer:
        """Generate audio samples as float32 numpy array [-1.0, 1.0]."""
        if not self._initialized:
            self.initialize()
        
        raw_bytes = self._generate_raw(num_samples, stereo)
        if not raw_bytes:
            channels = 2 if stereo else 1
            return np.zeros((num_samples, channels), dtype=np.float32)
        
        # Convert int16 bytes to float32
        import struct
        samples_per_channel = len(raw_bytes) // (2 * (2 if stereo else 1))
        fmt = '<' + 'h' * (len(raw_bytes) // 2)
        samples = struct.unpack(fmt, raw_bytes)
        
        if stereo:
            audio = np.array(samples, dtype=np.float32).reshape(-1, 2)
        else:
            audio = np.array(samples, dtype=np.float32).reshape(-1, 1)
        
        # Normalize to [-1.0, 1.0]
        return audio / 32768.0
    
    def clock(self, num_cycles: int) -> Optional[AudioBuffer]:
        """Run N internal clock cycles (for precise timing)."""
        if not self._initialized:
            self.initialize()
        # Default implementation - subclasses can override
        return None
    
    def propagate(self, num_cycles: int) -> None:
        """Run N cycles without returning audio (for register propagation)."""
        if not self._initialized:
            self.initialize()
        # Default - generate and discard
        self._generate_raw(num_cycles // 100, False)  # Approximate
    
    def reset(self) -> None:
        """Reset the chip to initial state."""
        if self._initialized:
            self._reset_chip()
    
    def is_available(self) -> bool:
        """Check if the underlying emulator is available."""
        try:
            self.initialize()
            return True
        except Exception:
            return False
    
    @property
    def chip_info(self) -> Dict[str, Any]:
        """Return information about the chip."""
        return {
            "core": self.CORE_NAME,
            "sample_rate": self.sample_rate,
            "systems": self.SUPPORTED_SYSTEMS,
            "initialized": self._initialized,
        }


class AdapterRegistry:
    """Registry for chip adapters with lazy loading."""
    
    _adapters: Dict[str, type] = {}
    _instances: Dict[str, ChipAdapter] = {}
    
    @classmethod
    def register(cls, system_name: str, adapter_class: type) -> None:
        """Register an adapter for a system."""
        cls._adapters[system_name] = adapter_class
    
    @classmethod
    def get(cls, system_name: str, sample_rate: int = 44100, **kwargs) -> Optional[ChipAdapter]:
        """Get or create an adapter instance for a system."""
        # Check for existing instance
        key = f"{system_name}:{sample_rate}"
        if key in cls._instances:
            return cls._instances[key]
        
        # Find adapter class
        adapter_class = cls._adapters.get(system_name)
        if adapter_class is None:
            # Try aliases
            from app.core.chiptune_hardware import SYSTEM_ALIASES, get_system_spec
            try:
                canonical = get_system_spec(system_name).name
                adapter_class = cls._adapters.get(canonical)
            except Exception:
                pass
        
        if adapter_class is None:
            return None
        
        # Create instance
        instance = adapter_class(sample_rate=sample_rate, **kwargs)
        cls._instances[key] = instance
        return instance
    
    @classmethod
    def list_available(cls) -> List[str]:
        """List all available adapter systems."""
        return sorted(cls._adapters.keys())


# Convenience function
def get_adapter(system_name: str, sample_rate: int = 44100, **kwargs) -> Optional[ChipAdapter]:
    """Get a chip adapter for a system."""
    return AdapterRegistry.get(system_name, sample_rate, **kwargs)


def list_adapters() -> List[str]:
    """List all available adapter systems."""
    return AdapterRegistry.list_available()
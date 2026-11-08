"""
VRAM configuration constants.

Extracted from vram_manager.py. Contains thresholds, minimums and safety
margins for VRAM orchestration on an 8 GB GTX 1070 Ti.
"""

from __future__ import annotations

# Thresholds for GTX 1070 Ti (8GB VRAM)
VRAM_WARNING = 85.0  # Start considering offload
VRAM_CRITICAL = 92.0  # Must offload immediately
VRAM_AVAILABLE = 50.0  # Safe to reload Ollama

# Minimum free VRAM needed for each workload (in MB)
MIN_VRAM_FOR_3D = 4000  # 4GB for Hunyuan3D-2mini
MIN_VRAM_FOR_MUSIC = 6144  # ACE-Step 1.5 Tier 3 on GTX 1070 Ti
MIN_VRAM_FOR_AUDIO = 1200  # CUDA audio spectral pass STFT peak + headroom
MIN_VRAM_FOR_LIPSYNC = 4096  # MuseTalk v1.5 D42 official minimum
MIN_VRAM_FOR_VOICE = 2560  # F5-TTS v1 Base fp32 on Pascal + headroom

# Safety margins for system stability
MIN_SYSTEM_RAM_FOR_OFFLOAD = 4096  # 4GB free RAM required before offload
MAX_SYSTEM_RAM_PERCENT = 75.0  # Max system RAM usage % for safe offload

# VRAM wait/poll timing
VRAM_WAIT_TIMEOUT = 120  # seconds
VRAM_POLL_INTERVAL = 5  # seconds


__all__ = [
    "VRAM_WARNING",
    "VRAM_CRITICAL",
    "VRAM_AVAILABLE",
    "MIN_VRAM_FOR_3D",
    "MIN_VRAM_FOR_MUSIC",
    "MIN_VRAM_FOR_AUDIO",
    "MIN_VRAM_FOR_LIPSYNC",
    "MIN_VRAM_FOR_VOICE",
    "MIN_SYSTEM_RAM_FOR_OFFLOAD",
    "MAX_SYSTEM_RAM_PERCENT",
    "VRAM_WAIT_TIMEOUT",
    "VRAM_POLL_INTERVAL",
]

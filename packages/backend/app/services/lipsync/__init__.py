"""Local lip-sync services (D42).

MuseTalk (MIT) adapter only. No network calls anywhere in this package --
the studio never integrates third-party lip-sync APIs (owner hard boundary).
"""

from . import batch
from .musetalk_adapter import LipSyncError, LipSyncNotConfiguredError, MuseTalkAdapter

__all__ = ["LipSyncError", "LipSyncNotConfiguredError", "MuseTalkAdapter", "batch"]

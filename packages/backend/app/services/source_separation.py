"""Audio source separation service using Demucs.

Separates audio into isolated stems (vocals, drums, bass, other) for
per-instrument visualization and analysis.

Requires: pip install demucs
Or for lighter weight: pip install spleeter
"""

import asyncio
import json
import logging
import shutil
import subprocess
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

from ..core.config import PROJECT_ROOT

SEPARATION_DIR = PROJECT_ROOT / "output" / "stems"
SEPARATION_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class SeparationResult:
    """Result of source separation."""
    audio_file: str
    model: str
    stems: dict[str, str]
    duration: float
    computed_at: str
    error: str | None = None


class SourceSeparator:
    """Audio source separation using Demucs or Spleeter."""

    SUPPORTED_MODELS = ["htdemucs", "htdemucs_ft", "htdemucs_6s", "mdx_extra"]

    def __init__(self, model: str = "htdemucs", device: str = "auto"):
        self._model = model
        self._device = device

    def is_available(self) -> bool:
        """Check if demucs or spleeter is available."""
        return self._find_demucs() is not None or self._find_spleeter() is not None

    def _find_demucs(self) -> str | None:
        """Locate demucs executable."""
        for name in ["demucs", "demucs.exe"]:
            try:
                result = subprocess.run(
                    [name, "--help"],
                    capture_output=True,
                    timeout=5,
                )
                if result.returncode == 0:
                    return name
            except (FileNotFoundError, subprocess.TimeoutExpired):
                continue
        return None

    def _find_spleeter(self) -> str | None:
        """Locate spleeter executable."""
        for name in ["spleeter"]:
            try:
                result = subprocess.run(
                    [name, "--help"],
                    capture_output=True,
                    timeout=5,
                )
                if result.returncode == 0:
                    return name
            except (FileNotFoundError, subprocess.TimeoutExpired):
                continue
        return None

    def _detect_device(self) -> str:
        """Detect best available device."""
        if self._device != "auto":
            return self._device
        try:
            import torch
            if torch.cuda.is_available():
                return "cuda"
        except ImportError:
            pass
        return "cpu"

    async def separate(
        self,
        audio_path: str,
        model: str | None = None,
        output_dir: str | None = None,
    ) -> SeparationResult:
        """Separate audio into stems.

        Args:
            audio_path: Path to audio file.
            model: Demucs model name (default: htdemucs).
            output_dir: Custom output directory.

        Returns:
            SeparationResult with paths to separated stems.
        """
        model = model or self._model
        device = self._detect_device()

        out_dir = Path(output_dir) if output_dir else SEPARATION_DIR
        out_dir.mkdir(parents=True, exist_ok=True)

        # Try demucs first
        demucs = self._find_demucs()
        if demucs:
            return await self._separate_demucs(audio_path, model, device, out_dir)

        # Fallback to spleeter
        spleeter = self._find_spleeter()
        if spleeter:
            return await self._separate_spleeter(audio_path, out_dir)

        return SeparationResult(
            audio_file=audio_path,
            model="none",
            stems={},
            duration=0.0,
            computed_at="",
            error="No separation tool found. Install demucs: pip install demucs",
        )

    async def _separate_demucs(
        self,
        audio_path: str,
        model: str,
        device: str,
        output_dir: Path,
    ) -> SeparationResult:
        """Separate using Demucs."""
        try:
            cmd = [
                "demucs",
                "-n", model,
                "-d", device,
                "-o", str(output_dir),
                "--filename", "{stem}.{ext}",
                audio_path,
            ]

            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(
                process.communicate(), timeout=600
            )

            if process.returncode != 0:
                error_msg = stderr.decode("utf-8", errors="replace").strip()
                return SeparationResult(
                    audio_file=audio_path,
                    model=model,
                    stems={},
                    duration=0.0,
                    computed_at="",
                    error=f"Demucs failed: {error_msg[:500]}",
                )

            # Find output stems
            stem_dir = output_dir / model / Path(audio_path).stem
            stems = {}
            for stem_name in ["vocals", "drums", "bass", "other"]:
                stem_path = stem_dir / f"{stem_name}.wav"
                if stem_path.exists():
                    stems[stem_name] = str(stem_path)

            # Get duration
            duration = 0.0
            try:
                import librosa
                duration = librosa.get_duration(path=audio_path)
            except Exception:
                pass

            return SeparationResult(
                audio_file=audio_path,
                model=model,
                stems=stems,
                duration=duration,
                computed_at=time.strftime("%Y-%m-%dT%H:%M:%S"),
            )
        except asyncio.TimeoutError:
            return SeparationResult(
                audio_file=audio_path,
                model=model,
                stems={},
                duration=0.0,
                computed_at="",
                error="Demucs timed out (10 min limit)",
            )
        except Exception as e:
            return SeparationResult(
                audio_file=audio_path,
                model=model,
                stems={},
                duration=0.0,
                computed_at="",
                error=str(e),
            )

    async def _separate_spleeter(
        self,
        audio_path: str,
        output_dir: Path,
    ) -> SeparationResult:
        """Separate using Spleeter (fallback)."""
        try:
            cmd = [
                "spleeter",
                "separate",
                "-p", "spleeter:4stems",
                "-o", str(output_dir),
                audio_path,
            ]

            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(
                process.communicate(), timeout=600
            )

            if process.returncode != 0:
                error_msg = stderr.decode("utf-8", errors="replace").strip()
                return SeparationResult(
                    audio_file=audio_path,
                    model="spleeter:4stems",
                    stems={},
                    duration=0.0,
                    computed_at="",
                    error=f"Spleeter failed: {error_msg[:500]}",
                )

            # Find output stems
            stem_dir = output_dir / Path(audio_path).stem
            stems = {}
            for stem_name in ["vocals", "drums", "bass", "other"]:
                stem_path = stem_dir / f"{stem_name}.wav"
                if stem_path.exists():
                    stems[stem_name] = str(stem_path)

            duration = 0.0
            try:
                import librosa
                duration = librosa.get_duration(path=audio_path)
            except Exception:
                pass

            return SeparationResult(
                audio_file=audio_path,
                model="spleeter:4stems",
                stems=stems,
                duration=duration,
                computed_at=time.strftime("%Y-%m-%dT%H:%M:%S"),
            )
        except asyncio.TimeoutError:
            return SeparationResult(
                audio_file=audio_path,
                model="spleeter:4stems",
                stems={},
                duration=0.0,
                computed_at="",
                error="Spleeter timed out (10 min limit)",
            )
        except Exception as e:
            return SeparationResult(
                audio_file=audio_path,
                model="spleeter:4stems",
                stems={},
                duration=0.0,
                computed_at="",
                error=str(e),
            )

    async def analyze_stem_features(self, stem_path: str) -> dict[str, Any]:
        """Analyze features of a separated stem.

        Args:
            stem_path: Path to stem audio file.

        Returns:
            Dict with stem features.
        """
        try:
            import librosa
            import numpy as np

            y, sr = librosa.load(stem_path, sr=22050, mono=True)
            duration = len(y) / sr

            # RMS energy
            rms = librosa.feature.rms(y=y, hop_length=512)[0]
            rms_norm = (rms - rms.min()) / (rms.max() - rms.min() + 1e-10)

            # Spectral centroid
            centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=512)[0]

            # Zero crossing rate
            zcr = librosa.feature.zero_crossing_rate(y=y, hop_length=512)[0]

            return {
                "file": stem_path,
                "duration": duration,
                "sample_rate": sr,
                "rms_mean": float(np.mean(rms)),
                "rms_std": float(np.std(rms)),
                "centroid_mean": float(np.mean(centroid)),
                "zcr_mean": float(np.mean(zcr)),
                "energy_envelope": rms_norm.tolist(),
            }
        except Exception as e:
            return {"file": stem_path, "error": str(e)}


# Global instance
source_separator = SourceSeparator()

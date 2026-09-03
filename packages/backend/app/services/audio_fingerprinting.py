"""Audio fingerprinting service using Chromaprint for semantic duplicate detection.

Provides acoustic fingerprinting that identifies the same song across different
encodings, bitrates, and formats — complementing the hash-based duplicate detection
in outputs.py which only finds exact file matches.

Requires fpcalc (chromaprint) installed: https://acoustid.org/chromaprint
Windows: choco install chromaprint
"""

import asyncio
import hashlib
import json
import logging
import subprocess
import tempfile
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

from ..core.config import PROJECT_ROOT

FINGERPRINT_DIR = PROJECT_ROOT / "output" / "fingerprints"
FINGERPRINT_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class FingerprintResult:
    """Result of audio fingerprinting."""
    audio_file: str
    fingerprint: str
    duration: float
    hash: str
    computed_at: str
    error: str | None = None


@dataclass
class DuplicateGroup:
    """Group of duplicate audio files found by fingerprinting."""
    group_id: str
    fingerprint_hash: str
    files: list[str]
    duration: float
    confidence: float


class AudioFingerprinter:
    """Audio fingerprinting service using Chromaprint."""

    def __init__(self, fpcalc_path: str | None = None):
        self._fpcalc = fpcalc_path or "fpcalc"

    def _find_fpcalc(self) -> str | None:
        """Locate fpcalc executable."""
        for name in [self._fpcalc, "fpcalc.exe"]:
            try:
                result = subprocess.run(
                    [name, "-version"],
                    capture_output=True,
                    timeout=5,
                )
                if result.returncode == 0:
                    return name
            except (FileNotFoundError, subprocess.TimeoutExpired):
                continue
        return None

    def is_available(self) -> bool:
        """Check if fpcalc is available."""
        return self._find_fpcalc() is not None

    async def fingerprint_file(self, audio_path: str) -> FingerprintResult:
        """Generate acoustic fingerprint for an audio file.

        Args:
            audio_path: Path to audio file.

        Returns:
            FingerprintResult with fingerprint data.
        """
        fpcalc = self._find_fpcalc()
        if not fpcalc:
            return FingerprintResult(
                audio_file=audio_path,
                fingerprint="",
                duration=0.0,
                hash="",
                computed_at="",
                error="fpcalc not found. Install chromaprint: https://acoustid.org/chromaprint",
            )

        try:
            process = await asyncio.create_subprocess_exec(
                fpcalc,
                "-json",
                "-length", "120",
                audio_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(
                process.communicate(), timeout=60
            )

            if process.returncode != 0:
                error_msg = stderr.decode("utf-8", errors="replace").strip()
                return FingerprintResult(
                    audio_file=audio_path,
                    fingerprint="",
                    duration=0.0,
                    hash="",
                    computed_at="",
                    error=f"fpcalc failed: {error_msg}",
                )

            data = json.loads(stdout.decode("utf-8"))
            fingerprint = data.get("fingerprint", "")
            duration = float(data.get("duration", 0))
            fp_hash = hashlib.sha256(fingerprint.encode()).hexdigest()[:16]

            return FingerprintResult(
                audio_file=audio_path,
                fingerprint=fingerprint,
                duration=duration,
                hash=fp_hash,
                computed_at=time.strftime("%Y-%m-%dT%H:%M:%S"),
            )
        except asyncio.TimeoutError:
            return FingerprintResult(
                audio_file=audio_path,
                fingerprint="",
                duration=0.0,
                hash="",
                computed_at="",
                error="fpcalc timed out",
            )
        except Exception as e:
            return FingerprintResult(
                audio_file=audio_path,
                fingerprint="",
                duration=0.0,
                hash="",
                computed_at="",
                error=str(e),
            )

    def _fingerprint_similarity(self, fp1: str, fp2: str) -> float:
        """Compute similarity between two fingerprints (0.0 to 1.0).

        Uses bit-level comparison of the chromaprint strings.
        """
        if not fp1 or not fp2:
            return 0.0

        # Decode base64 fingerprints to binary
        import base64
        try:
            bin1 = base64.b64decode(fp1)
            bin2 = base64.b64decode(fp2)
        except Exception:
            return 0.0

        # Compare using Hamming distance on the shorter fingerprint
        min_len = min(len(bin1), len(bin2))
        if min_len == 0:
            return 0.0

        # Count matching bits
        matching_bits = 0
        total_bits = min_len * 8
        for i in range(min_len):
            xor = bin1[i] ^ bin2[i]
            matching_bits += 8 - bin(xor).count("1")

        return matching_bits / total_bits

    async def find_duplicates(
        self,
        audio_files: list[str],
        similarity_threshold: float = 0.85,
    ) -> list[DuplicateGroup]:
        """Find duplicate audio files using acoustic fingerprinting.

        Args:
            audio_files: List of audio file paths to check.
            similarity_threshold: Minimum similarity (0-1) to consider duplicates.

        Returns:
            List of DuplicateGroup objects.
        """
        results: list[FingerprintResult] = []
        for f in audio_files:
            result = await self.fingerprint_file(f)
            if result.fingerprint:
                results.append(result)

        # Group by exact hash first
        hash_groups: dict[str, list[FingerprintResult]] = {}
        for r in results:
            if r.hash not in hash_groups:
                hash_groups[r.hash] = []
            hash_groups[r.hash].append(r)

        # For non-exact matches, compare fingerprints
        duplicates: list[DuplicateGroup] = []
        processed_hashes: set[str] = set()

        for fp_hash, group in hash_groups.items():
            if len(group) >= 2:
                duplicates.append(DuplicateGroup(
                    group_id=fp_hash,
                    fingerprint_hash=fp_hash,
                    files=[r.audio_file for r in group],
                    duration=group[0].duration,
                    confidence=1.0,
                ))
                processed_hashes.add(fp_hash)

        # Cross-comparison for near-duplicates
        all_fps = [(r.audio_file, r.fingerprint, r.duration) for r in results]
        for i, (file1, fp1, dur1) in enumerate(all_fps):
            group_files = [file1]
            for j, (file2, fp2, dur2) in enumerate(all_fps):
                if i == j:
                    continue
                sim = self._fingerprint_similarity(fp1, fp2)
                if sim >= similarity_threshold:
                    group_files.append(file2)

            if len(group_files) > 1:
                group_hash = hashlib.sha256(
                    "".join(sorted(group_files)).encode()
                ).hexdigest()[:16]
                if group_hash not in processed_hashes:
                    duplicates.append(DuplicateGroup(
                        group_id=group_hash,
                        fingerprint_hash=group_hash,
                        files=group_files,
                        duration=dur1,
                        confidence=0.9,
                    ))
                    processed_hashes.add(group_hash)

        return duplicates

    async def save_fingerprint(self, result: FingerprintResult) -> str:
        """Save fingerprint to JSON file."""
        path_id = hashlib.sha256(str(Path(result.audio_file).resolve()).encode()).hexdigest()[:16]
        filename = f"{path_id}.fingerprint.json"
        output_path = FINGERPRINT_DIR / filename
        with open(output_path, "w") as f:
            json.dump(asdict(result), f, indent=2)
        return str(output_path)

    async def load_fingerprint(self, audio_path: str) -> FingerprintResult | None:
        """Load previously saved fingerprint."""
        path_id = hashlib.sha256(str(Path(audio_path).resolve()).encode()).hexdigest()[:16]
        filename = f"{path_id}.fingerprint.json"
        input_path = FINGERPRINT_DIR / filename
        if not input_path.exists():
            return None
        with open(input_path) as f:
            data = json.load(f)
        return FingerprintResult(**data)


# Global instance
audio_fingerprinter = AudioFingerprinter()

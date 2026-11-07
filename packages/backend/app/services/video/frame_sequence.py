"""Frame-sequence inspection, manifests, and gap detection.

One owner for the conventions every producer should share:

- Naming: ``frame_%04d.png`` style printf patterns (what ffmpeg's
  ``image2`` demuxer expects and what the Media Library scanner guards).
- Integrity: ``inspect_sequence`` reports missing indices inside the
  first..last range — ffmpeg ``image2`` silently truncates at the first
  gap, so callers must check before muxing.
- Manifests: ``frames.json`` sidecar recording producer, fps, and
  resolution so a bare directory of PNGs is self-describing.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

DEFAULT_PATTERN = "frame_%04d.png"
MANIFEST_NAME = "frames.json"


@dataclass
class SequenceInfo:
    directory: Path
    pattern: str
    count: int = 0
    first_index: int | None = None
    last_index: int | None = None
    indices: list[int] = field(default_factory=list)
    missing: list[int] = field(default_factory=list)

    @property
    def contiguous(self) -> bool:
        return self.count > 0 and not self.missing

    @property
    def errors(self) -> list[str]:
        out: list[str] = []
        if self.count == 0:
            out.append(f"no frames matching {self.pattern!r} in {self.directory}")
            return out
        if self.missing:
            shown = self.missing[:10]
            suffix = f" (+{len(self.missing) - 10} more)" if len(self.missing) > 10 else ""
            out.append(
                f"{len(self.missing)} missing frame index(es) in "
                f"{self.first_index}..{self.last_index}: {shown}{suffix}"
            )
        return out


def _pattern_regex(pattern: str) -> tuple[re.Pattern[str], str, str]:
    """Split a printf-style pattern into (regex, prefix, suffix).

    ``frame_%04d.png`` -> matches ``frame_0001.png`` etc. The digits group
    captures the frame index; everything else is literal.
    """
    m = re.search(r"%0*\d*d", pattern)
    if not m:
        raise ValueError(f"pattern has no %Nd placeholder: {pattern!r}")
    prefix, suffix = pattern[: m.start()], pattern[m.end() :]
    rx = re.compile(re.escape(prefix) + r"(\d+)" + re.escape(suffix) + r"$")
    return rx, prefix, suffix


def inspect_sequence(directory: str | Path, pattern: str = DEFAULT_PATTERN) -> SequenceInfo:
    """Scan a directory for frames matching ``pattern`` and report gaps."""
    directory = Path(directory)
    info = SequenceInfo(directory=directory, pattern=pattern)
    if not directory.is_dir():
        return info
    rx, prefix, suffix = _pattern_regex(pattern)
    for path in directory.iterdir():
        if not path.is_file():
            continue
        m = rx.match(path.name)
        if m:
            info.indices.append(int(m.group(1)))
    info.indices.sort()
    info.count = len(info.indices)
    if not info.indices:
        return info
    info.first_index, info.last_index = info.indices[0], info.indices[-1]
    present = set(info.indices)
    info.missing = [i for i in range(info.first_index, info.last_index + 1) if i not in present]
    return info


def write_manifest(
    directory: str | Path,
    *,
    producer: str,
    fps: int,
    width: int,
    height: int,
    pattern: str = DEFAULT_PATTERN,
    extra: dict | None = None,
) -> Path:
    """Write ``frames.json`` describing the sequence beside the frames."""
    directory = Path(directory)
    info = inspect_sequence(directory, pattern)
    manifest = {
        "producer": producer,
        "pattern": pattern,
        "frame_count": info.count,
        "first_index": info.first_index,
        "last_index": info.last_index,
        "contiguous": info.contiguous,
        "fps": fps,
        "width": width,
        "height": height,
        "created_utc": datetime.now(UTC).isoformat(timespec="seconds"),
    }
    if extra:
        manifest.update(extra)
    out = directory / MANIFEST_NAME
    out.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return out


def read_manifest(directory: str | Path) -> dict | None:
    path = Path(directory) / MANIFEST_NAME
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

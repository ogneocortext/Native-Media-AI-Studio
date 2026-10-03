"""Deterministic resolution of an audio-analysis file for a library track.

Why this exists
---------------
`output/audio_analysis/` accumulated four incompatible naming conventions
(bare hash, hash+slug, slug-only, `test-`/`orphan-`-prefixed), and `index.json`
grew to ~62 keys pointing at only 17 files. `get_analysis_by_filename`
compensated with three regex fallback passes plus a glob — load-bearing guesswork
that returns whatever it finds first and cannot say *why* a lookup failed.

This module replaces that with an explicit, ordered, testable policy. It is pure
(no filesystem, no JSON) so the whole resolution order is unit-testable;
`tools/audit-analysis-store.py` applies it to the real store.

Resolution order (first match wins)
------------------------------------
1. Current-schema file whose stem equals the requested track's stem.
2. Same, ignoring any ``<hash>_`` / ``<hash>-`` prefix on either side.
3. Same, comparing a slug form (spaces/punctuation collapsed to ``-``).
4. The bare ``<hash>`` form of the track (content-addressed prefix only).

Candidates predating ``current_schema`` are never returned — they are reported
as ``stale`` instead. Serving them is what let incomplete results persist.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

# Tracks are stored content-addressed: `<sha256[:8]>_<original name>`.
_HASH_PREFIX_RE = re.compile(r"^([0-9a-f]{8})[-_]")
# Analysis files historically carried a `test-` / `orphan-` prefix in local runs.
_ANALYSIS_PREFIX_RE = re.compile(r"^(?:orphan|test)-", re.IGNORECASE)

ANALYSIS_SUFFIX = "_analysis.json"


@dataclass(frozen=True)
class AnalysisCandidate:
    """One analysis file on disk, with the parts needed to match it to a track."""

    path: Path
    schema_version: int | None

    @property
    def stem(self) -> str:
        return self.path.name[: -len(ANALYSIS_SUFFIX)]


def hash_prefix(name: str) -> str | None:
    """Return the leading 8-hex content hash, if the name carries one."""
    m = _HASH_PREFIX_RE.match(name)
    return m.group(1) if m else None


def strip_prefix(name: str) -> str:
    """Drop a leading content hash and/or a ``test-``/``orphan-`` prefix."""
    return _HASH_PREFIX_RE.sub("", _ANALYSIS_PREFIX_RE.sub("", name))


def slugify(name: str) -> str:
    """Collapse to a comparison key: lowercase, non-alphanumerics -> ``-``."""
    base = strip_prefix(name)
    if base.lower().endswith(".wav"):
        base = base[: -len(".wav")]
    return re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-")


@dataclass(frozen=True)
class Resolution:
    """Outcome of resolving one track reference."""

    match: AnalysisCandidate | None
    reason: str
    #: Every candidate considered, so a miss can be explained.
    considered: tuple[str, ...] = ()


def resolve_analysis(
    track_ref: str,
    candidates: list[AnalysisCandidate],
    current_schema: int,
) -> Resolution:
    """Find the analysis file for `track_ref`, or explain why there isn't one.

    `track_ref` is whatever the frontend sends — a bare filename, possibly with a
    content-hash prefix, possibly with an extension, possibly subfolder-relative.
    """
    if not track_ref:
        return Resolution(match=None, reason="empty track reference")

    # Strip directories: the library reference may be subfolder-relative.
    base = track_ref.replace("\\", "/").rsplit("/", 1)[-1]
    suffix = Path(base).suffix
    ref_stem = base[: -len(suffix)] if suffix else base
    ref_nohash = strip_prefix(ref_stem)
    ref_slug = slugify(ref_stem)
    ref_hash = hash_prefix(ref_stem)

    considered = tuple(c.path.name for c in candidates)

    # Stale candidates are excluded from the match rather than rejected after it.
    # Picking the first match and then rejecting it meant that when two files
    # shared a slug — one stale, one current — the stale one shadowed the good
    # one and the lookup failed even though a valid answer was on disk.
    def _match(pool: list[AnalysisCandidate]) -> tuple[AnalysisCandidate, str] | None:
        # 1/2: exact stem, then hash-prefix-insensitive.
        for c in pool:
            if c.stem == ref_stem:
                return c, "stem match"
        for c in pool:
            if strip_prefix(c.stem) == ref_nohash:
                return c, "stem match (hash prefix ignored)"
        # 3: slug comparison — absorbs spaces, punctuation, case and prefixes.
        for c in pool:
            if slugify(c.stem) == ref_slug:
                return c, "slug match"
        # 4: the bare content hash, for analyses written before the name was kept.
        if ref_hash:
            for c in pool:
                if c.stem == ref_hash:
                    return c, "hash match"
        return None

    usable = [
        c
        for c in candidates
        if c.schema_version is not None and c.schema_version >= current_schema
    ]
    hit = _match(usable)
    if hit:
        return _finish(hit[0], considered, hit[1])

    # Nothing current. Only mention a stale file when it genuinely matches this
    # track — listing every stale file in the store is noise that buries the
    # actual cause, and reads as if any of them could have served the request.
    stale_hit = _match([c for c in candidates if c not in usable])
    if stale_hit:
        c, how = stale_hit
        return Resolution(
            match=None,
            reason=(
                f"{c.path.name} matches ({how}) but is pre-v{current_schema} "
                f"(v{c.schema_version}); it must be re-analyzed"
            ),
            considered=considered,
        )
    return Resolution(
        match=None,
        reason=f"no analysis file matches {ref_stem!r} under any known naming convention",
        considered=considered,
    )


def _finish(
    candidate: AnalysisCandidate,
    considered: tuple[str, ...],
    how: str,
) -> Resolution:
    """Package a successful hit. Staleness is filtered out before matching."""
    return Resolution(
        match=candidate, reason=f"{how}: {candidate.path.name}", considered=considered
    )


def scan_analysis_dir(analysis_dir: Path, schema_of) -> list[AnalysisCandidate]:
    """List every analysis file in `analysis_dir`.

    `schema_of` is a callable ``(Path) -> int | None``, passed in so this module
    stays free of JSON parsing and importable without touching file contents.
    """
    if not analysis_dir.exists():
        return []
    return [
        AnalysisCandidate(path=p, schema_version=schema_of(p))
        for p in sorted(analysis_dir.glob(f"*{ANALYSIS_SUFFIX}"))
    ]


# Cache of ``dir -> (file fingerprint, {name: schema_version})``. Populated by
# `scan_analysis_dir_cached`; keyed per analysis directory.
_SCAN_CACHE: dict[str, tuple[tuple, dict[str, int | None]]] = {}


def clear_scan_cache() -> None:
    """Drop the memoized schema scan. Exposed for tests and for repair tools."""
    _SCAN_CACHE.clear()


def content_fingerprint(data: dict) -> str | None:
    """Fingerprint an analysis by its *acoustic content*, ignoring provenance.

    Two analyses of the same audio produce identical signal arrays, whatever
    they are named and whatever job produced them. Fields that record *where*
    the analysis came from — `job_id`, `stored_path`, `relative_path`,
    `computed_on`, `metadata`, `timing_contract` — legitimately differ between
    duplicates and must not affect the fingerprint.

    Returns None for a document too sparse to fingerprint, so a truncated or
    corrupt file is never treated as a duplicate of a good one.
    """
    if not isinstance(data, dict):
        return None
    keys = (
        "beat_times",
        "downbeat_times",
        "onset_times",
        "energy_curve",
        "amplitude_envelope",
        "spectral_centroid",
        "spectral_rolloff",
        "spectral_bandwidth",
        "zero_crossing_rate",
    )
    present = [k for k in keys if isinstance(data.get(k), list) and data.get(k)]
    if len(present) < 2:
        return None
    payload = {k: data[k] for k in present}
    payload["tempo_bpm"] = data.get("tempo_bpm")
    payload["duration_seconds"] = data.get("duration_seconds")
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()[:16]


#: Fields that record *where* an analysis came from rather than what it found.
#: These legitimately differ between two analyses of the same audio and are
#: excluded from equivalence checks.
PROVENANCE_FIELDS = frozenset(
    {
        "job_id",
        "stored_path",
        "relative_path",
        "computed_on",
        "metadata",
        "timing_contract",
        "schema_version",
    }
)


def content_diff(a: dict, b: dict) -> list[str]:
    """Field names that differ between two analyses, ignoring provenance.

    Returns an empty list only when every content field matches exactly. This is
    the gate before deleting a "duplicate": a matching fingerprint means the
    audio is the same, but it says nothing about whether the two documents carry
    the same sections, suggestions or confidence values. Deleting on a
    fingerprint alone could drop the only copy that has, say, LLM-refined
    `sections` — the fingerprint deliberately ignores those, because a
    differently-processed analysis of the same audio is still a duplicate *by
    content*, but is not necessarily redundant *as a document*.
    """
    if not isinstance(a, dict) or not isinstance(b, dict):
        return ["<not a dict>"]
    keys = (set(a) | set(b)) - PROVENANCE_FIELDS
    differing = []
    for k in sorted(keys):
        if json.dumps(a.get(k), sort_keys=True) != json.dumps(b.get(k), sort_keys=True):
            differing.append(k)
    return differing


def choose_keeper(candidates: list[AnalysisCandidate]) -> AnalysisCandidate:
    """Pick which file of a duplicate group to keep.

    Preference order: a current-schema file, then the newest write, then the
    shortest name. All three are deterministic, so repeated runs agree and a
    `--dedupe --apply` cannot oscillate.
    """

    def rank(c: AnalysisCandidate):
        version = c.schema_version if c.schema_version is not None else -1
        try:
            mtime = c.path.stat().st_mtime
        except OSError:
            mtime = 0.0
        return (-version, -mtime, len(c.path.name), c.path.name)

    return min(candidates, key=rank)


def scan_analysis_dir_cached(
    analysis_dir: Path, schema_of
) -> list[AnalysisCandidate]:
    """`scan_analysis_dir`, but re-reads only files that actually changed.

    Reading `schema_version` means parsing whole analysis documents — ~2.5 MB
    across the 17 files currently in the store, measured at ~42 ms. The old code
    paid this on every cache miss because it looked the file up through
    `index.json` instead. A `stat` per file is orders of magnitude cheaper than
    a parse, so the fingerprint keys on (size, mtime_ns) and only re-parses a
    file whose stamp moved.

    The fingerprint covers every file, so adding, deleting or rewriting one
    invalidates the cache; there is no staleness window.
    """
    if not analysis_dir.exists():
        return []

    entries = []
    for p in sorted(analysis_dir.glob(f"*{ANALYSIS_SUFFIX}")):
        try:
            st = p.stat()
        except OSError:  # file vanished mid-scan; skip rather than fail the lookup
            continue
        entries.append((p, st.st_size, st.st_mtime_ns))

    key = analysis_dir.resolve()
    fingerprint = tuple((p.name, size, mtime) for p, size, mtime in entries)
    cached = _SCAN_CACHE.get(str(key))

    if cached is not None and cached[0] == fingerprint:
        versions = cached[1]
    else:
        versions = {p.name: schema_of(p) for p, _, _ in entries}
        _SCAN_CACHE[str(key)] = (fingerprint, versions)

    return [
        AnalysisCandidate(path=p, schema_version=versions.get(p.name))
        for p, _, _ in entries
    ]


def resolve_by_job_id(
    job_id: str, candidates: list[AnalysisCandidate], current_schema: int
) -> Resolution:
    """Find the analysis file for a job id.

    Job ids are `uuid4()[:8]`, so they are arbitrary hex and can prefix-collide
    with an unrelated file. An exact stem match wins; otherwise the shortest
    matching prefix wins, so the answer does not depend on directory iteration
    order (the previous `glob(...)[0]` did).
    """
    if not job_id:
        return Resolution(match=None, reason="empty job id")

    prefix = job_id[:8]
    considered = tuple(c.path.name for c in candidates)

    def usable(c: AnalysisCandidate) -> bool:
        return c.schema_version is not None and c.schema_version >= current_schema

    for c in candidates:
        if c.stem == prefix and usable(c):
            return Resolution(
                match=c, reason=f"exact job id match: {c.path.name}", considered=considered
            )

    matches = [c for c in candidates if c.stem.startswith(prefix) and usable(c)]
    if matches:
        best = min(matches, key=lambda c: (len(c.stem), c.stem))
        return Resolution(
            match=best,
            reason=f"job id prefix match: {best.path.name}",
            considered=considered,
        )

    stale = [c for c in candidates if c.stem.startswith(prefix)]
    if stale:
        return Resolution(
            match=None,
            reason=(
                f"{stale[0].path.name} matches job {prefix!r} but is "
                f"pre-v{current_schema} (v{stale[0].schema_version})"
            ),
            considered=considered,
        )
    return Resolution(
        match=None,
        reason=f"no analysis file matches job id {prefix!r}",
        considered=considered,
    )

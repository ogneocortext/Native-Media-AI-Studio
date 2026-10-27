# Storyboard Enrichment S1 — Measured-Grid Input (R1)

**Status:** Proposed  
**Area:** Video Pipeline & Storyboard (T-VID-03)  
**Source:** `docs/knowledge-library/storyboard-enrichment-from-track-practice-2026.md` §3, §5, R1  
**Next Actions:** `docs/plans/next-actions-2026-10.md` §5, S1  
**Last Updated:** 2026-10-27

## Scope

S1 implements **R1**: a board's tempo is a measured beat grid, never metadata. Storyboard generator jobs accept a supplied measured BPM + beat grid + section boundaries. When library/metadata BPM disagrees with the measured grid, the board carries a conflict flag and the grid wins.

S1 consumes a supplied grid — **no dependency on the parked madmom A/B verdict.** The grid source is whatever the caller provides (analysis pipeline, user-uploaded, or manually verified).

## Data Sources (R1-compliant)

| Source | What it provides | How it enters S1 |
|--------|-----------------|------------------|
| **Measured beat grid** | BPM + per-beat timestamps (seconds) + downbeat flags | `analysis.beat_times`, `analysis.beat_grid` |
| **Section boundaries** | Section name + start/end (seconds) | `analysis.sections[]` |
| **Library/metadata BPM** | Stated BPM from track-lyrics library or file tags | `track_lyrics.bpm`, `metadata.bpm` |
| **Conflict flag** | Boolean: library BPM ≠ measured BPM (within tolerance) | Computed by S1, carried on board |

**Not a data source:** estimated timing from `durationSec / line count` spread. That is preview-only and explicitly superseded by R1/R2 data per track (design doc §4).

## Contract Changes

### Generator job params (additive)

Existing params remain; new optional fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `analysis` | object | No | `{ bpm: number, beat_times: number[], downbeats: number[], sections: [{name, start, end}], source: string }` |
| `track_lyrics_id` | string | No | Track-lyrics library entry id (for metadata BPM comparison) |

When `analysis` is absent, the job falls back to the current `{theme, num_scenes, model}` behavior (backward compatible).

### Scene object (additive fields)

Existing scene fields remain; new optional fields:

| Field | Type | Description |
|-------|------|-------------|
| `start_beat` | number | Beat index (0-based) from the measured grid |
| `end_beat` | number | Beat index (0-based) from the measured grid |
| `start_sec` | number | Absolute start time in seconds (derived from grid) |
| `end_sec` | number | Absolute end time in seconds (derived from grid) |
| `bpm_conflict` | boolean | True when library/metadata BPM disagrees with measured BPM |

## Implementation

### 1. Grid validation (new function)

```python
def validate_grid(bpm: float, beat_times: list[float], downbeats: list[int]) -> dict:
    """Validate a supplied measured beat grid.
    
    Returns { ok, bpm, beat_count, downbeat_count, grid_sec, conflict_warnings }.
    """
```

Checks:
- `beat_times` is non-empty and monotonically increasing
- `downbeats` indexes are valid positions in `beat_times`
- Implied BPM from grid (60 / median interval) is within tolerance of stated `bpm` (±2 BPM)
- Grid spans at least 2 beats

### 2. Conflict detection (new function)

```python
def detect_bpm_conflict(measured_bpm: float, library_bpm: float | None, tolerance_bpm: float = 2.0) -> bool:
    """Return True when library BPM disagrees with measured BPM beyond tolerance."""
```

Returns True when:
- `library_bpm` is not None AND `abs(measured_bpm - library_bpm) > tolerance_bpm`

### 3. Scene timing derivation (new function)

```python
def derive_scene_times(sections: list[dict], beat_times: list[float]) -> list[dict]:
    """For each section, compute start_sec/end_sec from the grid and
    start_beat/end_beat as beat indices."""
```

For each section:
- `start_sec` = beat_time at the beat index closest to `section.start`
- `end_sec` = beat_time at the beat index closest to `section.end`
- `start_beat` = beat index for `section.start`
- `end_beat` = beat index for `section.end`

### 4. Generator job param acceptance

The storyboard generator job (`services/storyboard_generator.py`) accepts the new `analysis` param. When present:
1. Validate the grid (step 1)
2. Detect BPM conflict vs library/metadata (step 2)
3. Derive scene times (step 3)
4. Carry `bpm_conflict` flag on the board object

### 5. Board output

The board JSON carries:
- `bpm` (measured, authoritative)
- `bpm_conflict` (boolean)
- `grid_source` (string describing where the grid came from)
- `beat_times`, `downbeats`, `sections` with grid-anchored times

## Conformance Check

**S1 conformance:** Every scene in the board has `start_sec` and `end_sec` derived from the measured grid (not estimated), and `bpm_conflict` is True iff library/metadata BPM disagrees with the measured grid beyond ±2 BPM.

**Verification:**
- Given a grid with known beat times, every scene's `start_sec`/`end_sec` matches `beat_times[start_beat]`/`beat_times[end_beat]` exactly
- Given a library BPM of 136 and measured BPM of 123 (the Unproductive case from design doc §5), `bpm_conflict` is True
- Given matching BPMs, `bpm_conflict` is False
- Scenes without grid data fall back to backward-compatible behavior (no crash, no grid fields)

## Files

| File | Change |
|------|--------|
| `packages/backend/app/services/storyboard_generator.py` | Accept `analysis` param; validate grid; detect conflict; derive scene times; carry `bpm_conflict` |
| `packages/backend/app/services/storyboard_hyperframes.py` | Consume new scene fields; emit absolute start times from grid (shared with S3) |
| `packages/frontend/src/features/storyboard/` (if exists) | Board UI displays `bpm_conflict` flag and measured BPM |

## Acceptance

1. Grid validation rejects non-monotonic beat times and invalid downbeat indexes
2. Conflict detection flags the Unproductive case (library 136 vs measured 123)
3. Scene timing derivation produces grid-anchored `start_sec`/`end_sec` for all sections
4. Backward compatible: jobs without `analysis` produce boards identical to current behavior
5. tsc + lint + pytest pass

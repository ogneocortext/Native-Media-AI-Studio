"""Tests that ``audio_files`` rows carry a real ``file_size``.

``file_size`` was ``0`` on all 58 rows in this database. The insert path used by
audio analysis (``update_audio_analysis``, which creates the row when it does not
exist yet) never listed the column, so it always took the default. That made
size-based duplicate detection impossible and hid genuinely broken rows: an audit
cannot tell "0 bytes" from "never recorded".
"""
import os
import sqlite3
import sys

sys.path.insert(0, os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..")))


def _database_module():
    """Import lazily, inside the test.

    Importing at module scope pulls in the database dependency during collection,
    which opens a connection early and leaves studio.db locked on Windows - later
    tmpdir cleanup then fails with WinError 32 in unrelated tests.
    """
    from app.core import database

    return database


def _with_temp_db(tmp_path, monkeypatch):
    """Point the database module at a throwaway file and create the schema."""
    database = _database_module()
    db_file = tmp_path / "test.db"
    # DB_PATH is a Path (get_connection does DB_PATH.parent.mkdir), so patch in
    # a Path rather than a string.
    monkeypatch.setattr(database, "DB_PATH", db_file, raising=False)
    database.init_db()
    return database, db_file


def test_insert_records_real_file_size(tmp_path, monkeypatch):
    """A row created from a real file must record that file's byte size."""
    database, db_file = _with_temp_db(tmp_path, monkeypatch)

    audio = tmp_path / "probe.wav"
    audio.write_bytes(b"RIFF" + b"\x00" * 1013)  # 1017 bytes
    expected = audio.stat().st_size

    database.update_audio_analysis(
        "probe.wav",
        {"stored_path": str(audio), "tempo_bpm": 120.0, "duration_seconds": 1.0},
    )

    conn = sqlite3.connect(db_file)
    try:
        stored = conn.execute(
            "SELECT file_size FROM audio_files WHERE filename = ?", ("probe.wav",)
        ).fetchone()[0]
    finally:
        conn.close()

    assert stored == expected, f"recorded {stored}, expected {expected}"
    assert stored != 0


def test_insert_still_succeeds_when_file_is_absent(tmp_path, monkeypatch):
    """A missing file must not block the insert; it just records no size."""
    database, db_file = _with_temp_db(tmp_path, monkeypatch)

    database.update_audio_analysis(
        "ghost.wav",
        {"stored_path": str(tmp_path / "nope.wav"), "tempo_bpm": 90.0, "duration_seconds": 2.0},
    )

    conn = sqlite3.connect(db_file)
    try:
        row = conn.execute(
            "SELECT file_size, analysis_result FROM audio_files WHERE filename = ?",
            ("ghost.wav",),
        ).fetchone()
    finally:
        conn.close()

    assert row is not None, "row should still be inserted"
    assert row[0] == 0
    assert row[1], "analysis payload should still be stored"


def test_existing_row_is_updated_not_duplicated(tmp_path, monkeypatch):
    """Re-analysing an existing file must update it, not add a second row."""
    database, db_file = _with_temp_db(tmp_path, monkeypatch)

    audio = tmp_path / "twice.mp3"
    audio.write_bytes(b"\x00" * 42)

    for bpm in (100.0, 140.0):
        database.update_audio_analysis(
            "twice.mp3",
            {"stored_path": str(audio), "tempo_bpm": bpm, "duration_seconds": 1.0},
        )

    conn = sqlite3.connect(db_file)
    try:
        rows = conn.execute(
            "SELECT COUNT(*) FROM audio_files WHERE filename = ?", ("twice.mp3",)
        ).fetchone()[0]
        size = conn.execute(
            "SELECT file_size FROM audio_files WHERE filename = ?", ("twice.mp3",)
        ).fetchone()[0]
    finally:
        conn.close()

    assert rows == 1
    assert size == 42

"""Tests for agent-facing audio library queries.

``search_audio_by_analysis`` / ``get_audio_analysis_field`` existed but had no
callers — agents could list files or fetch one blob at a time, never filter
the library by tempo/key/energy. These tests cover the query layer the new
``POST /api/audio/search`` route and ``search_audio_library`` MCP tool sit on.
"""
import os
import sys

sys.path.insert(0, os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..")))


def _database_module():
    """Import lazily inside the test — see test_audio_file_size.py for why."""
    from app.core import database

    return database


def _with_temp_db(tmp_path, monkeypatch):
    database = _database_module()
    from app.core import connection

    db_file = tmp_path / "test.db"
    monkeypatch.setattr(connection, "DB_PATH", db_file, raising=False)
    database.init_db(db_path=db_file)
    return database


def _analysis(tempo, key=None, energy=0.5, sections=3):
    return {
        "tempo_bpm": tempo,
        "duration_seconds": 100.0,
        "avg_energy": energy,
        "estimated_key": key,
        "sections": [{"type": "verse"}] * sections,
        "schema_version": 3,
    }


def test_update_syncs_key_column(tmp_path, monkeypatch):
    """estimated_key must land in the dedicated `key` column, not just the blob."""
    database = _with_temp_db(tmp_path, monkeypatch)

    database.update_audio_analysis(
        "track.mp3", _analysis(128.0, key="E major")
    )

    # No by-filename getter exists; query through search instead.
    results = database.search_audio_by_analysis(key="E major")
    assert len(results) == 1
    assert results[0]["key"] == "E major"


def test_search_filters_by_tempo_and_key(tmp_path, monkeypatch):
    database = _with_temp_db(tmp_path, monkeypatch)

    database.update_audio_analysis("slow.mp3", _analysis(90.0, key="A minor"))
    database.update_audio_analysis("fast.mp3", _analysis(160.0, key="E major"))

    fast = database.search_audio_by_analysis(min_tempo=140.0)
    assert [r["filename"] for r in fast] == ["fast.mp3"]

    minor = database.search_audio_by_analysis(key="a MINOR")
    assert [r["filename"] for r in minor] == ["slow.mp3"]


def test_search_filters_by_sections_and_energy(tmp_path, monkeypatch):
    database = _with_temp_db(tmp_path, monkeypatch)

    database.update_audio_analysis("simple.mp3", _analysis(120.0, sections=2, energy=0.3))
    database.update_audio_analysis("complex.mp3", _analysis(120.0, sections=6, energy=0.8))

    results = database.search_audio_by_analysis(min_sections=4, min_energy=0.5)
    assert [r["filename"] for r in results] == ["complex.mp3"]


def test_get_audio_analysis_field_extracts_json_path(tmp_path, monkeypatch):
    database = _with_temp_db(tmp_path, monkeypatch)

    database.update_audio_analysis("track.mp3", _analysis(128.0, key="D major"))

    assert database.get_audio_analysis_field("track.mp3", "$.tempo_bpm") == 128.0
    assert database.get_audio_analysis_field("track.mp3", "$.estimated_key") == "D major"
    assert database.get_audio_analysis_field("track.mp3", "$.missing", "fallback") == "fallback"

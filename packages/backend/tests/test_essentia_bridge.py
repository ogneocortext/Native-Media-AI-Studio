"""Tests for the essentia WSL bridge.

No WSL, no essentia, no audio: `subprocess.run` is stubbed, so these are fast and
run anywhere. What is being protected is the contract - degrade instead of raise,
batch instead of per-track, report failures instead of dropping them silently.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
from app.services import essentia_bridge as b


class _Proc:
    def __init__(self, stdout="", rc=0, stderr=""):
        self.stdout = stdout
        self.returncode = rc
        self.stderr = stderr


def _track(tmp_path, name="a"):
    p = tmp_path / name
    p.write_bytes(b"RIFF")
    return p


@pytest.fixture
def stub_ok(monkeypatch, tmp_path):
    """A WSL call that returns two tracks successfully."""
    body = {"results": [
        {"track": "one", "bpm": 143.63, "confidence": 2.02, "error": None},
        {"track": "two", "bpm": 150.22, "confidence": 2.57, "error": None},
    ]}
    seen = {"calls": 0}

    def fake_run(cmd, **kwargs):
        seen["cmd"] = cmd
        seen["input"] = kwargs.get("input")
        seen["calls"] += 1
        return _Proc(stdout=json.dumps(body))

    monkeypatch.setattr(b.subprocess, "run", fake_run)
    monkeypatch.setattr(b, "is_available", lambda: True)
    return seen


# ─── path conversion ──────────────────────────────────────────────────────────


def test_windows_path_becomes_mnt_path():
    assert b.to_wsl_path(Path(r"D:\wsl-essentia\venv")) == "/mnt/d/wsl-essentia/venv"


def test_drive_letter_is_lowercased():
    assert b.to_wsl_path(Path(r"D:\x")).startswith("/mnt/d/")


@pytest.mark.parametrize("bad", ["relative/path", "/etc/hostname", r"\\server\share"])
def test_non_drive_paths_are_rejected(bad):
    with pytest.raises(ValueError):
        b.to_wsl_path(Path(bad))


# ─── batching ─────────────────────────────────────────────────────────────────


def test_all_tracks_go_in_one_call(stub_ok, tmp_path):
    tracks = {"one": _track(tmp_path, "1"), "two": _track(tmp_path, "2")}
    out = b.probe_batch(tracks)
    # One invocation for two tracks. Counting calls rather than matching the
    # command string: `cmd` is a list, so `.count()` compares whole elements.
    assert stub_ok["calls"] == 1, "must batch, not call once per track"
    sent = json.loads(stub_ok["input"])
    assert len(sent) == 2
    assert out["one"]["bpm"] == pytest.approx(143.63)
    assert out["two"]["confidence"] == pytest.approx(2.57)


def test_paths_are_converted_for_wsl(stub_ok, tmp_path):
    b.probe_batch({"one": _track(tmp_path, "1")})
    sent = json.loads(stub_ok["input"])
    assert sent[0]["path"].startswith("/mnt/")


def test_empty_request_short_circuits():
    # No subprocess at all: an empty batch must not pay the WSL round trip.
    def boom(*a, **k):
        raise AssertionError("should not launch wsl")
    import unittest.mock as m
    with m.patch.object(b.subprocess, "run", boom):
        assert b.probe_batch({}) == {}


# ─── degradation: must never raise ────────────────────────────────────────────


def test_unavailable_bridge_returns_empty(monkeypatch):
    monkeypatch.setattr(b, "is_available", lambda: False)
    assert b.probe_batch({"x": Path("y")}) == {}


def test_timeout_returns_empty(monkeypatch, tmp_path):
    monkeypatch.setattr(b, "is_available", lambda: True)

    def timeout(*a, **k):
        raise subprocess.TimeoutExpired(cmd="wsl", timeout=1)
    monkeypatch.setattr(b.subprocess, "run", timeout)
    assert b.probe_batch({"x": _track(tmp_path)}) == {}


def test_missing_wsl_executable_returns_empty(monkeypatch, tmp_path):
    monkeypatch.setattr(b, "is_available", lambda: True)

    def missing(*a, **k):
        raise FileNotFoundError("wsl.exe")
    monkeypatch.setattr(b.subprocess, "run", missing)
    assert b.probe_batch({"x": _track(tmp_path)}) == {}


def test_nonzero_exit_returns_empty(monkeypatch, tmp_path):
    monkeypatch.setattr(b, "is_available", lambda: True)
    monkeypatch.setattr(b.subprocess, "run", lambda *a, **k: _Proc(rc=1, stderr="boom"))
    assert b.probe_batch({"x": _track(tmp_path)}) == {}


def test_non_json_output_returns_empty(monkeypatch, tmp_path):
    monkeypatch.setattr(b, "is_available", lambda: True)
    monkeypatch.setattr(b.subprocess, "run", lambda *a, **k: _Proc(stdout="<h1>error</h1>"))
    assert b.probe_batch({"x": _track(tmp_path)}) == {}


def test_essentia_import_error_reports_empty(monkeypatch, tmp_path):
    monkeypatch.setattr(b, "is_available", lambda: True)
    monkeypatch.setattr(
        b.subprocess, "run",
        lambda *a, **k: _Proc(stdout=json.dumps({"error": "essentia unavailable"})),
    )
    assert b.probe_batch({"x": _track(tmp_path)}) == {}


# ─── per-track failures are reported, not swallowed ───────────────────────────


def test_per_track_error_is_surfaced(monkeypatch, tmp_path):
    monkeypatch.setattr(b, "is_available", lambda: True)
    body = {"results": [{"track": "one", "bpm": None, "confidence": None, "error": "bad file"}]}
    monkeypatch.setattr(b.subprocess, "run", lambda *a, **k: _Proc(stdout=json.dumps(body)))
    out = b.probe_batch({"one": _track(tmp_path)})
    # A silent omission would look like "nobody asked", which is how a broken
    # bridge hides.
    assert out["one"]["error"] == "bad file"
    assert out["one"]["bpm"] is None


def test_one_bad_path_does_not_abort_the_batch(monkeypatch, tmp_path):
    monkeypatch.setattr(b, "is_available", lambda: True)
    captured = {}

    def fake_run(cmd, **kwargs):
        captured["input"] = json.loads(kwargs["input"])
        return _Proc(stdout=json.dumps({"results": []}))
    monkeypatch.setattr(b.subprocess, "run", fake_run)
    b.probe_batch({"good": _track(tmp_path, "1"), "bad": Path("/etc/hostname")})
    assert [r["track"] for r in captured["input"]] == ["good"]


def test_distro_override_is_honoured(monkeypatch, tmp_path):
    monkeypatch.setattr(b, "is_available", lambda: True)
    seen = {}

    def fake_run(cmd, **kwargs):
        seen["cmd"] = cmd
        return _Proc(stdout=json.dumps({"results": []}))
    monkeypatch.setattr(b.subprocess, "run", fake_run)
    monkeypatch.setenv("NMA_WSL_DISTRO", "CustomDistro")
    b.probe_batch({"x": _track(tmp_path)})
    assert "CustomDistro" in seen["cmd"]


def test_venv_override_is_honoured(monkeypatch):
    monkeypatch.setenv("NMA_ESSENTIA_VENV", r"D:\other\venv")
    assert b.venv_python() == Path(r"D:\other\venv\bin\python")

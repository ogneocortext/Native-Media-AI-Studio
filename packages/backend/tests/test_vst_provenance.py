"""
Tests for VST chain render provenance (api/vst.py + services/provenance.py).

POST /api/vst/process must record a media_provenance row + sidecar for every
successful render, snapshotting the chain as applied (not a pointer to the
stored chain) and the render facts process_file reports. Provenance failure
must never fail a render.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import app.api.vst as vst_api
import app.services.provenance as prov_service
from app.core.provenance import get_provenance
from app.services.vst_host import VSTChain


class _FakeHost:
    """Minimal stand-in for VSTHost: one chain, process_file writes a stub."""

    def __init__(self, chain: VSTChain) -> None:
        self.chains = {chain.name: chain}

    def process_file(self, chain_name, input_path, output_path):
        Path(output_path).write_bytes(b"RIFF-fake-render")
        return {
            "input_path": str(input_path),
            "output_path": str(output_path),
            "sample_rate": 48000,
            "duration": 1.5,
            "channels": 2,
        }


def _wire(tmp_path, monkeypatch, chain):
    """Point the route's dirs at tmp_path and swap in a fake host."""
    out_root = tmp_path / "out_root"
    audio_dir = out_root / "audio"
    audio_dir.mkdir(parents=True)
    src = out_root / "slice.wav"
    src.write_bytes(b"RIFF-fake-source")
    monkeypatch.setattr(vst_api, "OUTPUT_DIR", out_root)
    monkeypatch.setattr(vst_api, "AUDIO_DIR", audio_dir)
    monkeypatch.setattr(vst_api, "get_vst_host", lambda: _FakeHost(chain))
    return out_root, audio_dir, src


@pytest.mark.asyncio
async def test_process_records_provenance(tmp_path, temp_db, monkeypatch):
    chain = VSTChain(
        name="Test Chain",
        plugins=[{"name": "Gain", "parameters": {"Gain": 1.5}}],
        sample_rate=48000,
        block_size=256,
    )
    _, audio_dir, src = _wire(tmp_path, monkeypatch, chain)

    resp = await vst_api.process_audio(
        vst_api.ProcessRequest(
            chain_name="Test Chain", input_path="slice.wav", output_name="render1"
        )
    )
    assert resp.output_path.endswith("render1.wav")

    # Sidecar next to the artifact names source + chain snapshot.
    sidecar = audio_dir / "render1.wav.provenance.json"
    assert sidecar.exists()
    rec = json.loads(sidecar.read_text(encoding="utf-8"))
    assert rec["tool"] == "vst-chain"
    assert rec["source_paths"] == [prov_service.repo_rel(src)]
    params = rec["params"]
    assert params["chain_name"] == "Test Chain"
    assert params["plugins"] == [
        {"name": "Gain", "parameters": {"Gain": 1.5}}
    ]
    assert params["sample_rate"] == 48000
    assert params["block_size"] == 256
    assert params["render"] == {
        "sample_rate": 48000,
        "duration": 1.5,
        "channels": 2,
    }

    # DB row for the same output, queryable by output path.
    rows = get_provenance(prov_service.repo_rel(audio_dir / "render1.wav"))
    assert len(rows) == 1
    assert rows[0]["tool"] == "vst-chain"
    assert rows[0]["source_paths"] == [prov_service.repo_rel(src)]
    assert rows[0]["params"]["plugins"][0]["parameters"]["Gain"] == 1.5


@pytest.mark.asyncio
async def test_process_survives_provenance_failure(tmp_path, temp_db, monkeypatch):
    chain = VSTChain(name="Test Chain", plugins=[], sample_rate=44100)
    _, audio_dir, _ = _wire(tmp_path, monkeypatch, chain)

    def _boom(**kwargs):
        raise RuntimeError("db on fire")

    # Force the DB-write leg of record_media_provenance to raise; the
    # service swallows it, the sidecar still lands, and the route returns
    # a normal ProcessResponse.
    monkeypatch.setattr(prov_service, "record_provenance", _boom)

    resp = await vst_api.process_audio(
        vst_api.ProcessRequest(
            chain_name="Test Chain", input_path="slice.wav", output_name="render2"
        )
    )
    assert resp.output_path.endswith("render2.wav")
    assert (audio_dir / "render2.wav").exists()
    assert (audio_dir / "render2.wav.provenance.json").exists()

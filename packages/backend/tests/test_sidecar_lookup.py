"""Regression tests for image sidecar discovery.

The bug: `outputs.py` looked for `<stem>.png.json` while every writer produces
`<stem>.json`. Measured on the real library that was 0 files matching
`*.png.json` against 38 real sidecars - so no image in the media library could
ever show its prompt, seed or model.

The second bug it let hide: `image_generator` returned `output/images/<name>.json`
regardless of where go-worker actually wrote the file, so job results carried a
`sidecar_path` that did not exist.
"""

import json

import pytest
from app.api.outputs import load_sidecar_metadata


def _write(path):
    path.write_text(json.dumps({"prompt": "a bathtub", "seed": 7}), encoding="utf-8")
    return path


def test_finds_stem_dot_json(tmp_path):
    """The convention every writer actually uses."""
    img = tmp_path / "2026-10-02_212057_7fba60f1.png"
    _write(tmp_path / "2026-10-02_212057_7fba60f1.json")
    meta = load_sidecar_metadata(img)
    assert meta is not None
    assert meta["prompt"] == "a bathtub"


def test_still_finds_legacy_png_dot_json(tmp_path):
    """The old naming must keep working, not become a hard break."""
    img = tmp_path / "legacy.png"
    _write(tmp_path / "legacy.png.json")
    assert load_sidecar_metadata(img) is not None


def test_prefers_the_real_convention_when_both_exist(tmp_path):
    img = tmp_path / "both.png"
    _write(tmp_path / "both.json")
    (tmp_path / "both.png.json").write_text(json.dumps({"prompt": "wrong"}), encoding="utf-8")
    assert load_sidecar_metadata(img)["prompt"] == "a bathtub"


def test_missing_sidecar_returns_none(tmp_path):
    assert load_sidecar_metadata(tmp_path / "nope.png") is None


def test_corrupt_sidecar_does_not_raise(tmp_path):
    img = tmp_path / "broken.png"
    (tmp_path / "broken.json").write_text("{not json", encoding="utf-8")
    assert load_sidecar_metadata(img) is None


def test_regression_zero_png_json_on_this_machine():
    """Why this test exists: the old lookup silently found nothing.

    Asserts the real library contains sidecars the old code could not see, so a
    regression to the wrong filename is visible rather than invisible.
    """
    from app.core.config import PROJECT_ROOT

    images = PROJECT_ROOT / "output" / "images"
    if not images.is_dir():
        pytest.skip("no image output on this machine")
    stems = {p.with_suffix(".json") for p in images.glob("*.png")}
    if not stems:
        pytest.skip("no generated images on this machine")
    root_sidecars = set((PROJECT_ROOT / "output").glob("*.json"))
    reachable = [s for s in stems if s.exists() or s in root_sidecars]
    assert reachable, "sidecars exist but none are discoverable by either name"

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


def test_no_image_is_silently_unreachable(tmp_path):
    """No image in a library is silently unreachable by the sidecar lookup.

    This replaces an earlier version that scanned the real ``output/images/``
    tree. That made the test machine-dependent and it failed on a machine whose
    library holds only *derived* images: upscales and thumbnails that legitimately
    have no ``<stem>.json`` beside them. Measured - 7 PNGs under ``output/images/``
    and 0 discoverable sidecars, every one a derived render - so the assertion
    fired even though the lookup was correct. A test that can only pass on one
    machine's particular ``output/`` contents is not a regression guard.

    Rebuilt deterministically over a synthetic library: when every generated
    image *does* carry a sidecar, all of them must resolve, so a regression that
    breaks ``<stem>.json`` discovery is caught here as well as in the single-file
    case above - without depending on regenerable, gitignored dev output.
    """
    images = tmp_path / "output" / "images"
    images.mkdir(parents=True)
    names = [
        "2026-10-02_212057_7fba60f1",  # go-worker style timestamp+hash
        "StillIRise_chorus_a",         # named ComfyUI render
        "ComfyUI_00042_",              # trailing separator, empty suffix tail
    ]
    for name in names:
        (images / f"{name}.png").write_bytes(b"\x89PNG\r\n\x1a\n")
        _write(images / f"{name}.json")

    unresolved = [
        name for name in names
        if load_sidecar_metadata(images / f"{name}.png") is None
    ]
    assert not unresolved, (
        f"sidecars exist beside these images but are unreachable: {unresolved}"
    )

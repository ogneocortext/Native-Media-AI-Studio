"""Tests for the LLM section-refinement chain.

The chain was the real cost of /api/audio/analyze-cuda: 79.9s of an ~81s
request on a GTX 1070 Ti, against 0.5s for the CUDA spectral pass it refines.
These pin the two properties that fix that - the cheap model leads the chain,
and the per-model budget is short enough that a cold model degrades to the
heuristic instead of holding the request open.
"""
import os
import sys

sys.path.insert(0, os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..")))


def _audio():
    """Import lazily, inside the test.

    The helpers under test moved to app/api/audio_analysis.py when the analysis
    block was split out of app/api/audio.py, so import them from there rather
    than reaching into the API module.

    Module-scope import also pulls in the database dependency during collection
    and leaves studio.db locked on Windows, which makes unrelated tmpdir cleanup
    fail with WinError 32.
    """
    import app.api.audio_analysis as audio_analysis

    return audio_analysis


def test_configured_default_is_tried_first():
    assert _audio()._section_models("custom:model")[0] == "custom:model"


def test_deepseek_reasoning_model_excluded():
    """Measured 89s cold, and a poor fit for fixed-schema JSON output."""
    for default in ("gemma4:e2b-it-qat", "llama3.2:3b", "qwen3.5:4b"):
        assert "deepseek-r1:7b" not in _audio()._section_models(default), (
            "deepseek-r1:7b leads a chain that cost 89s per request"
        )


def test_chain_has_no_duplicates():
    models = _audio()._section_models("gemma4:e2b-it-qat")
    assert models.count("gemma4:e2b-it-qat") == 1
    assert len(models) == len(set(models))


def test_small_model_precedes_slow_fallback():
    """llama3.2:3b must be tried before the model that exceeded 120s."""
    models = _audio()._section_models("unknown:model")
    assert models.index("llama3.2:3b") < models.index("qwen3.5:4b")


def test_empty_default_is_skipped():
    models = _audio()._section_models("")
    assert "" not in models
    assert models, "chain must never be empty"


def test_timeout_is_short():
    """A cold load measured ~89s, so the budget must cut that off."""
    assert 0 < _audio()._SECTION_LLM_TIMEOUT <= 25

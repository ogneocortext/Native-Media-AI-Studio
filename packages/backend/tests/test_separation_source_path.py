"""Phase 0.1: the Demucs source-path defect that made separation impossible.

Finding (docs/plans/studio-quality-2026-10.md §0.1, P0): `_separate_demucs`
read `opts.source_path`, which `SeparationOptions` never defined, so *every*
Demucs run raised `AttributeError` — swallowed by a broad `except Exception` into
`SeparationResult.error`, which is why the UI showed a bare Python message
instead of stems. The hierarchical caller additionally passed `source_path=` as a
keyword the signature rejected, so it raised `TypeError` before reaching the
read at all.

Per that plan's guiding rule #1 ("both P0 bugs existed while their tests passed
(monkeypatched / never fetched)"), these tests are written to **execute the real
functions**. The subprocess runner is stubbed so no Demucs or model download is
involved, but `_separate_demucs` itself — the function that was broken — is the
one under test, and the assertions inspect the argv it actually built.
"""

import pytest
from app.services.source_separation import SeparationOptions, SourceSeparator


class _DemucsRecorder:
    """Stands in for `_run_subprocess_async`, recording the real argv built."""

    def __init__(self, returncode: int = 0) -> None:
        self.argv: list[str] = []
        self.returncode = returncode

    async def __call__(self, argv, timeout_s=None):
        self.argv = list(argv)
        return self.returncode, b"", b""


def _sep_with_stub(recorder: _DemucsRecorder) -> SourceSeparator:
    """A SourceSeparator with only the subprocess boundary stubbed.

    Deliberately *not* a monkeypatched `_separate_demucs`: the method under test is
    the real one, so a regression inside it fails here.
    """
    sep = SourceSeparator.__new__(SourceSeparator)
    sep._shifts = 0
    sep._validate_windows_soundfile = lambda: None
    sep._detect_device = lambda: "cpu"
    sep._detect_suno_track = lambda _p: False
    sep._run_subprocess_async = recorder
    return sep


def test_separation_options_does_not_carry_source_path():
    """`source_path` is internal control flow, not a user quality knob.

    If this ever becomes true again, the `opts.source_path` read comes back with
    it — so assert the dataclass stays a pure quality-knob bag.
    """
    assert not hasattr(SeparationOptions(), "source_path")


@pytest.mark.asyncio
async def test_single_pass_points_demucs_at_the_track(tmp_path):
    """Regression: the AttributeError that broke every single-pass run."""
    rec = _DemucsRecorder()
    sep = _sep_with_stub(rec)

    result = await SourceSeparator._separate_demucs(
        sep,
        audio_path="original.wav",
        model="mdx_extra_q",
        device="cpu",
        output_dir=tmp_path,
        demucs_cmd=["demucs"],
        opts=SeparationOptions(),
    )

    # No AttributeError escaped into the error field.
    assert result.error is None, f"separation failed: {result.error}"
    # And Demucs was actually pointed at the track.
    assert rec.argv, "Demucs was never invoked"
    assert "original.wav" in rec.argv
    assert not any("source_path" in a for a in rec.argv)


@pytest.mark.asyncio
async def test_hierarchical_source_is_the_instrumental_residual(tmp_path):
    """The `source_path=` kwarg must be accepted and must reach argv.

    This is the TypeError path: the caller passed a keyword the signature
    rejected, so the call raised before any audio was touched.
    """
    rec = _DemucsRecorder()
    sep = _sep_with_stub(rec)

    result = await SourceSeparator._separate_demucs(
        sep,
        audio_path="original.wav",
        model="mdx_extra_q",
        device="cpu",
        output_dir=tmp_path,
        demucs_cmd=["demucs"],
        opts=SeparationOptions(),
        source_path="instrumental-residual.wav",
    )

    assert result.error is None, f"hierarchical step 2 failed: {result.error}"
    assert "instrumental-residual.wav" in rec.argv
    # Crucially NOT the original track: separating the residual is the whole
    # point of hierarchical mode.
    assert "original.wav" not in rec.argv


@pytest.mark.asyncio
async def test_demucs_argv_is_built_with_the_expected_flags(tmp_path):
    """Argument construction still honours the quality knobs."""
    rec = _DemucsRecorder()
    sep = _sep_with_stub(rec)

    await SourceSeparator._separate_demucs(
        sep,
        audio_path="in.wav",
        model="mdx_extra_q",
        device="cuda",
        output_dir=tmp_path,
        demucs_cmd=["demucs"],
        opts=SeparationOptions(model="mdx_extra_q", overlap=0.25, denoise=True),
    )

    argv = rec.argv
    assert argv[0] == "demucs"
    assert argv[argv.index("-n") + 1] == "mdx_extra_q"
    assert argv[argv.index("-d") + 1] == "cuda"
    assert argv[argv.index("--overlap") + 1] == "0.25"
    assert "--denoise" in argv
    # The input is the positional that immediately follows `-o <dir>`; quality
    # flags are appended after it, so it is NOT argv[-1].
    assert argv[argv.index("-o") + 2] == "in.wav"


@pytest.mark.asyncio
async def test_demucs_failure_still_surfaces_as_error_not_crash(tmp_path):
    """A non-zero exit is reported, not raised — the path the UI renders."""
    rec = _DemucsRecorder(returncode=1)
    sep = _sep_with_stub(rec)

    result = await SourceSeparator._separate_demucs(
        sep,
        audio_path="in.wav",
        model="mdx_extra_q",
        device="cpu",
        output_dir=tmp_path,
        demucs_cmd=["demucs"],
        opts=SeparationOptions(),
    )

    assert result.error is not None
    assert result.stems == {}


@pytest.mark.asyncio
async def test_hierarchical_step2_receives_the_residual_end_to_end(tmp_path):
    """Drive `_separate_hierarchical` itself, with only MDX/Demucs stubbed.

    The unit tests above pin each call site; this one proves the two steps are
    wired together — step 1 MDX-Net for vocals, step 2 Demucs on the residual —
    which is what a user experiences as "hierarchical". Only the two backends are
    replaced, so the real orchestrator, the real residual lookup and the real
    stem merging all execute.
    """
    from types import SimpleNamespace

    calls: list[dict] = []
    residual = tmp_path / "instrumental.wav"
    residual.write_bytes(b"RIFF")

    async def fake_mdx(audio_path, model, opts):
        # Mirrors the real signature (audio_path, model, opts) — positional.
        calls.append({"backend": "mdx", "audio": audio_path})
        return SimpleNamespace(
            audio_file=audio_path, model=model,
            # The real MDX step returns BOTH vocals and the instrumental
            # residual; hierarchical reads `.stems["instrumental"]`.
            stems={"vocals": str(tmp_path / "vocals.wav"), "instrumental": str(residual)},
            duration=1.0, computed_at="", error=None,
        )

    async def fake_demucs(audio_path, model, device, output_dir, demucs_cmd,
                          opts=None, source_path=None):
        calls.append({"backend": "demucs", "audio": audio_path, "source": source_path})
        return SimpleNamespace(
            audio_file=audio_path, model=model,
            stems={"drums": "d.wav", "bass": "b.wav", "other": "o.wav"},
            duration=1.0, computed_at="", error=None, stems_mp3={},
        )

    sep = SourceSeparator.__new__(SourceSeparator)
    sep._shifts = 0
    sep._validate_windows_soundfile = lambda: None
    sep._detect_device = lambda: "cpu"
    sep._detect_suno_track = lambda _p: False
    sep._find_demucs = lambda: ["demucs"]
    sep._separate_mdx_net = fake_mdx
    sep._separate_demucs = fake_demucs

    async def no_mp3(_stems):
        return {}

    sep._encode_mp3_stems = no_mp3

    result = await SourceSeparator._separate_hierarchical(
        sep, audio_path=str(tmp_path / "song.wav"), opts=SeparationOptions()
    )

    assert result.error is None, f"hierarchical failed: {result.error}"
    assert [c["backend"] for c in calls] == ["mdx", "demucs"]
    # Step 2 must be pointed at the residual, not the original track.
    assert calls[1]["source"] == str(residual)
    assert set(result.stems) >= {"vocals", "drums", "bass", "other"}

"""
NMA Stem Separator Producer - Custom ComfyUI node for the Native Media AI Studio.

Produces an AUDIO_STEMS bundle mapping stem names (vocals, drums, bass, other)
to per-stem visual parameters (amplitude, dominant_frequency, pan). The bundle
is consumed downstream by NMAStemRouterNode to drive stem-reactive visualizations.

Part of the ComfyUI bridge layer - lives in config/comfyui/custom_nodes/
and is symlinked into ComfyUI's custom_nodes/ directory on startup.
"""


class NMAStemSeparatorProducer:
    """Produce an AUDIO_STEMS bundle for stem-reactive visual nodes.

    Accepts an optional audio file path and returns an AUDIO_STEMS dict mapping
    each stem name to a dict with:

    - ``amplitude``: float 0–10, perceived loudness of the stem
    - ``dominant_frequency``: float 20–20000 Hz, dominant frequency
    - ``pan``: float 0–1, stereo pan position

    When no audio file is provided, returns neutral bundles (zero amplitude,
    440 Hz center frequency, center pan) for all four stems so downstream
    nodes still execute.
    """

    @classmethod
    def INPUT_TYPES(cls):  # noqa: N802  # ComfyUI convention uses uppercase
        return {
            "required": {},
            "optional": {
                "audio_file": ("STRING", {"default": "", "placeholder": "path/to/track.mp3"}),
            },
        }

    RETURN_TYPES = ("AUDIO_STEMS",)
    RETURN_NAMES = ("audio_stems",)
    FUNCTION = "produce"
    CATEGORY = "Native Media AI"
    OUTPUT_NODE = False

    # Per-stem neutral defaults (amplitude, dominant_frequency, pan)
    _STEM_DEFAULTS: dict[str, tuple[float, float, float]] = {
        "vocals": (0.0, 440.0, 0.5),
        "drums": (0.0, 120.0, 0.5),
        "bass": (0.0, 60.0, 0.5),
        "other": (0.0, 1000.0, 0.5),
    }

    def produce(
        self,
        audio_file: str = "",
    ) -> tuple[dict]:
        """Build the AUDIO_STEMS bundle.

        Args:
            audio_file: Path to an audio file (informational; the real
                separation lives in the backend pipeline and is injected at
                prompt-submission time by the backend).

        Returns:
            A one-tuple containing the AUDIO_STEMS dict mapping stem names
            to {amplitude, dominant_frequency, pan} dicts.
        """
        stems: dict[str, dict] = {}
        for stem_type, (amp, freq, pan) in self._STEM_DEFAULTS.items():
            stems[stem_type] = {
                "amplitude": amp,
                "dominant_frequency": freq,
                "pan": pan,
            }

        return ({"stems": stems, "source_file": str(audio_file) if audio_file else ""},)


NODE_CLASS_MAPPINGS = {
    "NMAStemSeparatorProducer": NMAStemSeparatorProducer,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "NMAStemSeparatorProducer": "NMA Stem Separator Producer",
}

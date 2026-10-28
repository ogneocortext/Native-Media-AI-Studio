from typing import Final

"""
NMA Stem Router Node - Custom ComfyUI node for the Native Media AI Studio.

Routes audio stems (vocals, drums, bass, other) to different visual
channels for stem-reactive visualizations.

Part of the ComfyUI bridge layer.
"""


class NMAStemRouterNode:
    """Routes audio stems to visual parameters.

    Selects one stem by type, applies a gain, and outputs amplitude,
    frequency, and pan. The ``channel`` input selects which visual
    channel the stem drives, modulating the output accordingly.
    """

    @classmethod
    def INPUT_TYPES(cls):  # noqa: N802
        return {
            "required": {
                "stems": ("AUDIO_STEMS",),
                "stem_type": (["vocals", "drums", "bass", "other"],),
                "channel": (["color", "motion", "opacity", "scale"],),
                "gain": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.1}),
            },
        }

    RETURN_TYPES = ("FLOAT", "FLOAT", "FLOAT", "STRING")
    RETURN_NAMES = ("amplitude", "frequency", "pan", "stem_name")
    FUNCTION = "route"
    CATEGORY = "Native Media AI"
    OUTPUT_NODE = False

    # Per-channel modulation factors applied to amplitude.
    _CHANNEL_FACTOR: Final[dict[str, float]] = {
        "color": 1.0,
        "motion": 1.2,
        "opacity": 0.8,
        "scale": 1.5,
    }

    def route(
        self,
        stems: dict,
        stem_type: str,
        channel: str,
        gain: float,
    ) -> tuple[float, float, float, str]:
        """Route a specific stem to visual parameters.

        Args:
            stems: Dict mapping stem names to data dicts with keys like
                ``amplitude``, ``dominant_frequency``, ``pan``.
            stem_type: One of ``vocals``, ``drums``, ``bass``, ``other``.
            channel: Visual channel: ``color``, ``motion``, ``opacity``, ``scale``.
            gain: Multiplier applied to the stem amplitude.

        Returns:
            Tuple of (modulated_amplitude, frequency, pan, stem_name).
        """
        # --- Input validation with safe fallbacks ---
        try:
            stems_dict = dict(stems) if stems else {}
        except (TypeError, ValueError):
            stems_dict = {}

        stem_data = stems_dict.get(stem_type, {})
        if not isinstance(stem_data, dict):
            stem_data = {}

        amplitude = float(stem_data.get("amplitude", 0.0))
        frequency = float(stem_data.get("dominant_frequency", 440.0))
        pan = float(stem_data.get("pan", 0.5))

        # Clamp gain
        gain = max(0.0, min(2.0, float(gain)))

        # Apply channel-specific modulation
        channel_factor = self._CHANNEL_FACTOR.get(channel, 1.0)
        amplitude = amplitude * gain * channel_factor

        # Clamp outputs to sane ranges
        amplitude = max(0.0, min(10.0, amplitude))
        frequency = max(20.0, min(20000.0, frequency))
        pan = max(0.0, min(1.0, pan))

        return (amplitude, frequency, pan, str(stem_type))


NODE_CLASS_MAPPINGS = {
    "NMAStemRouterNode": NMAStemRouterNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "NMAStemRouterNode": "NMA Stem Router",
}

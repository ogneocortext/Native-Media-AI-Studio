"""
NMA Stem Router Node - Custom ComfyUI node for the Native Media AI Studio.

Routes audio stems (vocals, drums, bass, other) to different visual
channels for stem-reactive visualizations.

Part of the ComfyUI bridge layer.
"""



class NMAStemRouterNode:
    """Routes audio stems to visual parameters."""

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

    def route(self, stems, stem_type, channel, gain):
        """Route a specific stem to visual parameters."""
        stem_data = stems.get(stem_type, {})

        amplitude = stem_data.get("amplitude", 0.0) * gain
        frequency = stem_data.get("dominant_frequency", 440.0)
        pan = stem_data.get("pan", 0.5)

        return (amplitude, frequency, pan, stem_type)


NODE_CLASS_MAPPINGS = {
    "NMAStemRouterNode": NMAStemRouterNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "NMAStemRouterNode": "NMA Stem Router",
}

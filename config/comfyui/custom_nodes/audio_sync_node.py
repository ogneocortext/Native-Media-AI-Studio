"""
NMA Audio Sync Node - Custom ComfyUI node for the Native Media AI Studio.

This node synchronizes visual generation parameters to audio analysis data
(BPM, beats, sections, energy curve) extracted by the backend audio analysis
pipeline.

Part of the ComfyUI bridge layer - lives in config/comfyui/custom_nodes/
and is symlinked into ComfyUI's custom_nodes/ directory on startup.
"""


class NMAAudioSyncNode:
    """Sync visual parameters to audio beats and sections.

    Takes audio analysis metadata (tempo BPM, sections, optional energy curve)
    and outputs tempo, section energy, section name, and a beat timestamp
    computed from the actual BPM rather than an arbitrary section fraction.
    """

    @classmethod
    def INPUT_TYPES(cls):  # noqa: N802  # ComfyUI convention uses uppercase
        return {
            "required": {
                "audio_analysis": ("AUDIO_ANALYSIS",),
                "section_index": ("INT", {"default": 0, "min": 0, "max": 1000}),
                "beat_multiplier": (
                    "FLOAT",
                    {"default": 1.0, "min": 0.1, "max": 4.0, "step": 0.1},
                ),
            },
            "optional": {
                "energy_curve": ("ENERGY_CURVE",),
            },
        }

    RETURN_TYPES = ("FLOAT", "FLOAT", "STRING", "FLOAT")
    RETURN_NAMES = ("tempo", "energy", "section_name", "beat_timestamp")
    FUNCTION = "sync"
    CATEGORY = "Native Media AI"
    OUTPUT_NODE = False

    def sync(
        self,
        audio_analysis: dict,
        section_index: int,
        beat_multiplier: float,
        energy_curve: dict | None = None,
    ) -> tuple[float, float, str, float]:
        """Extract audio parameters for the current section.

        Args:
            audio_analysis: Dict with keys like ``tempo_bpm``, ``sections``.
            section_index: Zero-based index into the sections list.
            beat_multiplier: Multiplier applied to the beat period to place
                the timestamp within the section.
            energy_curve: Optional energy curve dict to blend section energy.

        Returns:
            Tuple of (tempo_bpm, section_energy, section_name, beat_timestamp).
        """
        # --- Input validation with safe fallbacks ---
        try:
            analysis = dict(audio_analysis) if audio_analysis else {}
        except (TypeError, ValueError):
            analysis = {}

        tempo = float(analysis.get("tempo_bpm", 120.0))
        # Clamp tempo to a sane musical range
        tempo = max(20.0, min(300.0, tempo))

        sections = analysis.get("sections", [])
        if not isinstance(sections, list):
            sections = []

        if 0 <= section_index < len(sections):
            section = sections[section_index] if isinstance(sections[section_index], dict) else {}
            section_name = str(section.get("type", "unknown"))
            start_time = float(section.get("start", 0.0))
            energy = float(section.get("energy", 0.5))
        else:
            section_name = "outro"
            start_time = 0.0
            energy = 0.0

        # Blend in energy curve if provided
        if energy_curve and isinstance(energy_curve, dict):
            curve_energy = float(energy_curve.get("value", energy))
            energy = (energy + curve_energy) / 2.0

        energy = max(0.0, min(1.0, energy))

        # --- Beat timestamp computed from actual BPM ---
        # Beat period in seconds = 60 / BPM
        beat_period = 60.0 / tempo if tempo > 0 else 0.5
        beat_timestamp = start_time + beat_period * beat_multiplier

        return (tempo, energy, section_name, beat_timestamp)


NODE_CLASS_MAPPINGS = {
    "NMAAudioSyncNode": NMAAudioSyncNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "NMAAudioSyncNode": "NMA Audio Sync",
}

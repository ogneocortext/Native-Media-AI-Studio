"""
NMA Audio Sync Node - Custom ComfyUI node for the Native Media AI Studio.

This node synchronizes visual generation parameters to audio analysis data
(BPM, beats, sections, energy curve) extracted by the backend audio analysis
pipeline.

Part of the ComfyUI bridge layer - lives in config/comfyui/custom_nodes/
and is symlinked into ComfyUI's custom_nodes/ directory on startup.
"""



class NMAAudioSyncNode:
    """Sync visual parameters to audio beats and sections."""

    @classmethod
    def INPUT_TYPES(cls):  # noqa: N802  # noqa: N802 - ComfyUI convention uses uppercase
        return {
            "required": {
                "audio_analysis": ("AUDIO_ANALYSIS",),
                "section_index": ("INT", {"default": 0, "min": 0, "max": 100}),
                "beat_multiplier": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 4.0, "step": 0.1}),
            },
            "optional": {
                "energy_curve": ("ENERGY_CURVE",),
            },
        }

    RETURN_TYPES = ("FLOAT", "FLOAT", "FLOAT", "STRING")
    RETURN_NAMES = ("tempo", "energy", "section_name", "beat_timestamp")
    FUNCTION = "sync"
    CATEGORY = "Native Media AI"

    def sync(self, audio_analysis, section_index, beat_multiplier, energy_curve=None):
        """Extract audio parameters for the current section."""
        tempo = audio_analysis.get("tempo_bpm", 120.0)
        sections = audio_analysis.get("sections", [])

        if section_index < len(sections):
            section = sections[section_index]
            section_name = section.get("type", "unknown")
            start_time = section.get("start", 0.0)
            end_time = section.get("end", 0.0)
            energy = section.get("energy", 0.5)
        else:
            section_name = "outro"
            start_time = 0.0
            end_time = 0.0
            energy = 0.0

        # Calculate beat timestamp within the section
        beat_timestamp = start_time + (end_time - start_time) * beat_multiplier * 0.5

        return (tempo, energy, section_name, str(beat_timestamp))


NODE_CLASS_MAPPINGS = {
    "NMAAudioSyncNode": NMAAudioSyncNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "NMAAudioSyncNode": "NMA Audio Sync",
}

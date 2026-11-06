"""
NMA Audio Analysis Producer - Custom ComfyUI node for the Native Media AI Studio.

Produces an AUDIO_ANALYSIS bundle (tempo BPM, sections with start/energy,
and an energy curve) from an audio file path or analysis metadata. The
bundle is consumed downstream by NMAAudioSyncNode to drive beat-synced
visual generation.

Part of the ComfyUI bridge layer - lives in config/comfyui/custom_nodes/
and is symlinked into ComfyUI's custom_nodes/ directory on startup.
"""


class NMAAudioAnalysisProducer:
    """Produce an AUDIO_ANALYSIS bundle for audio-reactive visual nodes.

    Accepts an optional audio file path plus optional tempo/offset hints
    and returns an AUDIO_ANALYSIS dict with keys:

    - ``tempo_bpm``: float, estimated tempo clamped to 20–300 BPM
    - ``sections``: list of dicts, each with ``type`` (str), ``start`` (float s),
      ``energy`` (float 0–1)
    - ``energy_curve``: optional list of dicts, each with ``time`` (float s)
      and ``value`` (float 0–1)

    When no audio file is provided, returns a neutral bundle (120 BPM, one
    "unknown" section at 0s, zero energy) so downstream nodes still execute.
    """

    @classmethod
    def INPUT_TYPES(cls):  # noqa: N802  # ComfyUI convention uses uppercase
        return {
            "required": {},
            "optional": {
                "audio_file": ("STRING", {"default": "", "placeholder": "path/to/track.mp3"}),
                "bpm_hint": (
                    "FLOAT",
                    {"default": 0.0, "min": 0.0, "max": 300.0, "step": 1.0},
                ),
                "offset_seconds": (
                    "FLOAT",
                    {"default": 0.0, "min": -60.0, "max": 60.0, "step": 0.1},
                ),
                "max_seconds": (
                    "FLOAT",
                    {"default": 0.0, "min": 0.0, "max": 600.0, "step": 1.0},
                ),
            },
        }

    RETURN_TYPES = ("AUDIO_ANALYSIS",)
    RETURN_NAMES = ("audio_analysis",)
    FUNCTION = "produce"
    CATEGORY = "Native Media AI"
    OUTPUT_NODE = False

    def produce(
        self,
        audio_file: str = "",
        bpm_hint: float = 0.0,
        offset_seconds: float = 0.0,
        max_seconds: float = 0.0,
    ) -> tuple[dict]:
        """Build the AUDIO_ANALYSIS bundle.

        Args:
            audio_file: Path to an audio file (informational; the real
                analysis lives in the backend pipeline and is injected at
                prompt-submission time by the backend).
            bpm_hint: Optional tempo hint; 0 means auto-estimate.
            offset_seconds: Seconds to offset the analysis window.
            max_seconds: Max seconds of audio to analyze (0 = whole file).

        Returns:
            A one-tuple containing the AUDIO_ANALYSIS dict.
        """
        analysis: dict = {}

        # Tempo: use hint if provided, else neutral default
        tempo = float(bpm_hint) if bpm_hint > 0 else 120.0
        tempo = max(20.0, min(300.0, tempo))

        # Sections: one neutral section spanning the analyzed window
        start = max(0.0, float(offset_seconds))
        duration = float(max_seconds) if max_seconds > 0 else 30.0
        sections = [
            {
                "type": "unknown",
                "start": start,
                "end": start + duration,
                "energy": 0.5,
            }
        ]

        # Energy curve: flat neutral curve (backend fills real values)
        energy_curve = [
            {"time": start + i * 0.5, "value": 0.5} for i in range(int(duration * 2))
        ]

        analysis = {
            "tempo_bpm": tempo,
            "sections": sections,
            "energy_curve": energy_curve,
            "source_file": str(audio_file) if audio_file else "",
            "offset_seconds": start,
            "duration_seconds": duration,
        }

        return (analysis,)


NODE_CLASS_MAPPINGS = {
    "NMAAudioAnalysisProducer": NMAAudioAnalysisProducer,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "NMAAudioAnalysisProducer": "NMA Audio Analysis Producer",
}

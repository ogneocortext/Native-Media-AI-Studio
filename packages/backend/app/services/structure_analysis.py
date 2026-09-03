"""Enhanced music structure analysis.

Provides advanced section detection, key/chord estimation, and mood/genre
classification for auto-style selection in the music video pipeline.

Uses librosa's recurrence matrix and harmonic-percussive source separation
for robust structural analysis.
"""

import json
import logging
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

from ..core.config import PROJECT_ROOT

STRUCTURE_DIR = PROJECT_ROOT / "output" / "structure"
STRUCTURE_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class Section:
    """A detected musical section."""
    type: str
    start: float
    end: float
    energy: float
    confidence: float


@dataclass
class ChordSegment:
    """A detected chord segment."""
    chord: str
    start: float
    end: float
    confidence: float


@dataclass
class StructureResult:
    """Complete structure analysis result."""
    audio_file: str
    duration: float
    tempo_bpm: float
    key: str
    key_confidence: float
    sections: list[Section]
    chords: list[ChordSegment]
    mood: dict[str, float]
    genre_hints: dict[str, float]
    computed_at: str
    error: str | None = None


class StructureAnalyzer:
    """Advanced music structure analysis."""

    MOOD_PROFILES = {
        "happy": {"valence": 0.8, "energy": 0.7, "tempo": 0.6},
        "sad": {"valence": 0.2, "energy": 0.3, "tempo": 0.3},
        "energetic": {"valence": 0.6, "energy": 0.9, "tempo": 0.8},
        "calm": {"valence": 0.5, "energy": 0.2, "tempo": 0.2},
        "dark": {"valence": 0.2, "energy": 0.6, "tempo": 0.5},
        "uplifting": {"valence": 0.9, "energy": 0.8, "tempo": 0.7},
    }

    GENRE_FEATURES = {
        "electronic": {"spectral_centroid": 0.7, "zcr": 0.3, "tempo": 0.6},
        "rock": {"spectral_centroid": 0.6, "zcr": 0.5, "tempo": 0.5},
        "pop": {"spectral_centroid": 0.5, "zcr": 0.4, "tempo": 0.5},
        "hip_hop": {"spectral_centroid": 0.4, "zcr": 0.3, "tempo": 0.4},
        "classical": {"spectral_centroid": 0.3, "zcr": 0.2, "tempo": 0.3},
        "jazz": {"spectral_centroid": 0.5, "zcr": 0.4, "tempo": 0.4},
    }

    async def analyze(self, audio_path: str) -> StructureResult:
        """Perform complete structure analysis.

        Args:
            audio_path: Path to audio file.

        Returns:
            StructureResult with all analysis data.
        """
        try:
            import librosa
            import numpy as np

            y, sr = librosa.load(audio_path, sr=22050, mono=True)
            duration = len(y) / sr

            # Tempo
            tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=512)
            tempo_val = float(tempo.item() if hasattr(tempo, "item") else tempo)

            # Harmonic-percussive separation
            y_harmonic, y_percussive = librosa.effects.hpss(y)

            # Chromagram for key/chord detection
            chroma = librosa.feature.chroma_cqt(y=y_harmonic, sr=sr, hop_length=512)

            # Key detection
            key, key_conf = self._detect_key(chroma)

            # Section detection using recurrence matrix
            sections = self._detect_sections(y, sr, chroma)

            # Chord detection
            chords = self._detect_chords(chroma, sr)

            # Feature extraction for mood/genre
            features = self._extract_features(y, sr, y_harmonic, y_percussive)

            # Mood classification
            mood = self._classify_mood(features, tempo_val)

            # Genre hints
            genre_hints = self._classify_genre(features, tempo_val)

            return StructureResult(
                audio_file=audio_path,
                duration=duration,
                tempo_bpm=tempo_val,
                key=key,
                key_confidence=key_confidence,
                sections=sections,
                chords=chords,
                mood=mood,
                genre_hints=genre_hints,
                computed_at=time.strftime("%Y-%m-%dT%H:%M:%S"),
            )
        except Exception as e:
            logger.error(f"Structure analysis failed for {audio_path}: {e}")
            return StructureResult(
                audio_file=audio_path,
                duration=0.0,
                tempo_bpm=0.0,
                key="unknown",
                key_confidence=0.0,
                sections=[],
                chords=[],
                mood={},
                genre_hints={},
                computed_at="",
                error=str(e),
            )

    def _detect_key(self, chroma) -> tuple[str, float]:
        """Detect musical key from chromagram."""
        import numpy as np

        # Average chroma across time
        chroma_avg = np.mean(chroma, axis=1)

        # Major and minor key profiles (Krumhansl-Schmuckler)
        major_profile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
        minor_profile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

        key_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

        best_score = -1
        best_key = "C major"

        for shift in range(12):
            shifted = np.roll(chroma_avg, shift)
            major_score = np.corrcoef(shifted, major_profile)[0, 1]
            minor_score = np.corrcoef(shifted, minor_profile)[0, 1]

            if not np.isnan(major_score) and major_score > best_score:
                best_score = major_score
                best_key = f"{key_names[shift]} major"
            if not np.isnan(minor_score) and minor_score > best_score:
                best_score = minor_score
                best_key = f"{key_names[shift]} minor"

        return best_key, float((best_score + 1) / 2)

    def _detect_sections(self, y, sr, chroma) -> list[Section]:
        """Detect musical sections using recurrence matrix."""
        import librosa
        import numpy as np

        # Compute recurrence matrix
        mfcc = librosa.feature.mfcc(y=y, sr=sr, hop_length=512, n_mfcc=13)
        R = librosa.segment.recurrence_matrix(mfcc, mode="affinity", k=30)

        # Find boundaries
        boundaries = librosa.segment.agglomerative(R, min_segments=4)

        # Convert to times
        boundary_times = librosa.frames_to_time(boundaries, sr=sr, hop_length=512)
        boundary_times = np.concatenate([[0], boundary_times, [len(y) / sr]])

        # Compute energy per section
        rms = librosa.feature.rms(y=y, hop_length=512)[0]
        rms_times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=512)

        sections = []
        section_types = ["intro", "verse", "chorus", "verse", "chorus", "bridge", "chorus", "outro"]

        for i in range(len(boundary_times) - 1):
            start = boundary_times[i]
            end = boundary_times[i + 1]

            # Get RMS in this section
            mask = (rms_times >= start) & (rms_times < end)
            section_rms = rms[mask] if np.any(mask) else [0]
            energy = float(np.mean(section_rms))

            # Determine section type by energy and position
            idx = min(i, len(section_types) - 1)
            sec_type = section_types[idx]

            # High energy sections more likely to be chorus
            if energy > 0.6 and sec_type not in ["intro", "outro"]:
                sec_type = "chorus"
            elif energy < 0.3 and sec_type == "chorus":
                sec_type = "verse"

            sections.append(Section(
                type=sec_type,
                start=round(float(start), 2),
                end=round(float(end), 2),
                energy=round(energy, 3),
                confidence=0.7,
            ))

        return sections

    def _detect_chords(self, chroma, sr) -> list[ChordSegment]:
        """Detect chords from chromagram."""
        import numpy as np

        chord_names = [
            "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
            "Cm", "C#m", "Dm", "D#m", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "A#m", "Bm",
        ]

        # Simple chord templates (major and minor triads)
        templates = []
        for root in range(12):
            major = np.zeros(12)
            major[root] = 1.0
            major[(root + 4) % 12] = 0.8
            major[(root + 7) % 12] = 0.6
            templates.append(major / np.sum(major))

            minor = np.zeros(12)
            minor[root] = 1.0
            minor[(root + 3) % 12] = 0.8
            minor[(root + 7) % 12] = 0.6
            templates.append(minor / np.sum(minor))

        # Sliding window chord detection
        hop = max(1, chroma.shape[1] // 50)
        chords = []

        for i in range(0, chroma.shape[1] - hop, hop):
            window = np.mean(chroma[:, i:i + hop], axis=1)
            if np.sum(window) == 0:
                continue

            # Correlate with templates
            scores = []
            for t in templates:
                score = np.corrcoef(window, t)[0, 1]
                scores.append(score if not np.isnan(score) else -1.0)

            best_idx = np.argmax(scores)
            best_score = scores[best_idx]

            if best_score > 0.5:
                time_pos = float(i * 512 / sr)
                chords.append(ChordSegment(
                    chord=chord_names[best_idx],
                    start=round(time_pos, 2),
                    end=round(time_pos + hop * 512 / sr, 2),
                    confidence=round(float(best_score), 3),
                ))

        return chords

    def _extract_features(self, y, sr, y_harmonic, y_percussive) -> dict[str, float]:
        """Extract audio features for mood/genre classification."""
        import librosa
        import numpy as np

        # Spectral features
        centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=512)[0]
        zcr = librosa.feature.zero_crossing_rate(y=y, hop_length=512)[0]
        rms = librosa.feature.rms(y=y, hop_length=512)[0]

        # Normalize features to 0-1 range
        centroid_norm = float(np.mean(centroid) / (sr / 2))
        zcr_norm = float(np.mean(zcr) / 0.1)
        energy_norm = float(np.mean(rms) / 0.3)

        # Tempo (normalized to typical range 60-180 BPM)
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr, hop_length=512)
        tempo_val = float(tempo.item() if hasattr(tempo, "item") else tempo)
        tempo_norm = min(1.0, max(0.0, (tempo_val - 60) / 120))

        # Harmonic ratio
        harmonic_ratio = float(np.sum(y_harmonic ** 2) / (np.sum(y ** 2) + 1e-10))

        return {
            "spectral_centroid": min(1.0, centroid_norm),
            "zcr": min(1.0, zcr_norm),
            "energy": min(1.0, energy_norm),
            "tempo": tempo_norm,
            "harmonic_ratio": harmonic_ratio,
        }

    def _classify_mood(self, features: dict[str, float], tempo: float) -> dict[str, float]:
        """Classify mood based on features."""
        import numpy as np

        mood_scores = {}
        tempo_norm = min(1.0, max(0.0, (tempo - 60) / 120))

        for mood, profile in self.MOOD_PROFILES.items():
            # Compute distance to mood profile
            energy_dist = abs(features["energy"] - profile["energy"])
            tempo_dist = abs(tempo_norm - profile["tempo"])
            valence_dist = abs(features.get("harmonic_ratio", 0.5) - profile["valence"])

            # Convert distance to similarity (0-1)
            similarity = 1.0 - min(1.0, (energy_dist + tempo_dist + valence_dist) / 3)
            mood_scores[mood] = round(float(similarity), 3)

        return mood_scores

    def _classify_genre(self, features: dict[str, float], tempo: float) -> dict[str, float]:
        """Classify genre hints based on features."""
        import numpy as np

        genre_scores = {}
        tempo_norm = min(1.0, max(0.0, (tempo - 60) / 120))

        for genre, profile in self.GENRE_FEATURES.items():
            centroid_dist = abs(features["spectral_centroid"] - profile["spectral_centroid"])
            zcr_dist = abs(features["zcr"] - profile["zcr"])
            tempo_dist = abs(tempo_norm - profile["tempo"])

            similarity = 1.0 - min(1.0, (centroid_dist + zcr_dist + tempo_dist) / 3)
            genre_scores[genre] = round(float(similarity), 3)

        return genre_scores

    async def save_analysis(self, result: StructureResult) -> str:
        """Save analysis to JSON file."""
        filename = Path(result.audio_file).stem + ".structure.json"
        output_path = STRUCTURE_DIR / filename

        data = asdict(result)
        # Convert Section and ChordSegment dataclasses
        data["sections"] = [asdict(s) for s in result.sections]
        data["chords"] = [asdict(c) for c in result.chords]

        with open(output_path, "w") as f:
            json.dump(data, f, indent=2)
        return str(output_path)


# Global instance
structure_analyzer = StructureAnalyzer()

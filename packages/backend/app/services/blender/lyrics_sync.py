"""
Lyrics synchronization module.

Provides lyrics-to-animation event mapping:
- Parse timed lyrics (word-level or line-level timestamps)
- Map lyrics to animation events for Blender scene generation
- Generate beat-aligned lyric display schedules
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class LyricsSyncMapper:
    """Maps timed lyrics to animation events for music video generation."""

    def __init__(self, fps: int = 24):
        self.fps = fps

    def map_to_events(
        self,
        lyrics: list[dict[str, Any]],
        style: str = "fade",
    ) -> list[dict[str, Any]]:
        """Map lyrics to display events with frame-accurate timing.

        Args:
            lyrics: List of dicts with 'text', 'start', 'end' keys.
            style: Animation style ('fade', 'pop', 'typewriter', 'slide').

        Returns:
            List of event dicts with frame numbers and animation params.
        """
        events = []
        for i, lyric in enumerate(lyrics):
            start_frame = int(lyric.get("start", 0) * self.fps)
            end_frame = int(lyric.get("end", start_frame / self.fps + 2) * self.fps)

            events.append({
                "index": i,
                "text": lyric.get("text", ""),
                "start_time": lyric.get("start", 0),
                "end_time": lyric.get("end", 0),
                "start_frame": start_frame,
                "end_frame": end_frame,
                "duration_frames": end_frame - start_frame,
                "style": style,
            })

        return events

    def align_to_beats(
        self,
        lyrics: list[dict[str, Any]],
        beat_times: list[float],
        min_duration: float = 0.5,
    ) -> list[dict[str, Any]]:
        """Snap lyric start/end times to nearest beats for tighter sync.

        Args:
            lyrics: List of lyric dicts with 'text', 'start', 'end'.
            beat_times: Sorted list of beat timestamps.
            min_duration: Minimum lyric display duration.

        Returns:
            List of adjusted lyric dicts.
        """
        if not beat_times:
            return lyrics

        def nearest_beat(time: float) -> float:
            return min(beat_times, key=lambda b: abs(b - time))

        aligned = []
        for lyric in lyrics:
            start = lyric.get("start", 0)
            end = lyric.get("end", start + min_duration)

            new_start = nearest_beat(start)
            new_end = nearest_beat(end)
            if new_end - new_start < min_duration:
                # Find next beat after start for end
                future_beats = [b for b in beat_times if b > new_start + min_duration]
                new_end = future_beats[0] if future_beats else new_start + min_duration

            aligned.append({
                **lyric,
                "start": round(new_start, 3),
                "end": round(new_end, 3),
            })

        return aligned

    def generate_blender_lyrics(self, lyrics: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Format lyrics for the Blender scene builder's add_lyrics_text method.

        Returns list with 'text', 'start', 'end' keys ready for script generation.
        """
        return [
            {
                "text": l.get("text", ""),
                "start": l.get("start", 0),
                "end": l.get("end", 0),
            }
            for l in lyrics
        ]

    def from_whisperx(self, whisperx_output: dict[str, Any]) -> list[dict[str, Any]]:
        """Convert WhisperX alignment output to lyric events.

        WhisperX output has 'words' list with 'word', 'start', 'end'.
        """
        words = whisperx_output.get("words", [])
        lyrics = []
        for w in words:
            text = w.get("word", w.get("text", ""))
            start = w.get("start", 0)
            end = w.get("end", start + 0.3)
            if text.strip():
                lyrics.append({
                    "text": text.strip(),
                    "start": round(start, 3),
                    "end": round(end, 3),
                })
        return lyrics

    def group_by_line(
        self,
        word_lyrics: list[dict[str, Any]],
        words_per_line: int = 5,
    ) -> list[dict[str, Any]]:
        """Group word-level lyrics into multi-word lines.

        Useful for karaoke-style or grouped lyric display.
        """
        lines = []
        for i in range(0, len(word_lyrics), words_per_line):
            chunk = word_lyrics[i:i + words_per_line]
            if not chunk:
                continue
            text = " ".join(l.get("text", "") for l in chunk)
            start = chunk[0].get("start", 0)
            end = chunk[-1].get("end", start)
            lines.append({
                "text": text.strip(),
                "start": round(start, 3),
                "end": round(end, 3),
            })
        return lines


# Singleton
default_lyrics_mapper = LyricsSyncMapper()

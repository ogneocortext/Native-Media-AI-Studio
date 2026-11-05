---
name: audio
description: Analyze audio tracks from the library — BPM, beats, energy, sections — and build music video production plans.
version: "1.0.0"
server: ollama-tools
tools:
  - analyze_audio
  - list_audio_library
  - create_music_video_plan
tags:
  - audio
  - music
  - analysis
  - bpm
---

# Audio Skill

Analyze audio tracks and build music video production plans using the local backend API.

## Tools

### analyze_audio
Analyze an audio file to extract BPM, beats, energy, sections.

**Parameters:**
- `filename` (string, required): Audio filename from the library

### list_audio_library
List all available audio tracks in the library.

### create_music_video_plan
Create a music video production plan based on audio analysis and track characteristics.

**Parameters:**
- `filename` (string, required): Audio filename
- `style` (string, optional): Visual style preference

**Example:**
```
mcp__ollama-tools__create_music_video_plan --filename "track.mp3"
```

**Returns:** A JSON plan with track info, BPM, duration, energy curve, recommended style, and scene breakdown.

## Notes
- Backs onto the local FastAPI backend at http://127.0.0.1:8000
- Nothing leaves the machine
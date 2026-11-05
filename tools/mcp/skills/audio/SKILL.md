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
example_inputs:
  - tool: analyze_audio
    args: { filename: "track.mp3" }
  - tool: list_audio_library
    args: {}
  - tool: create_music_video_plan
    args: { filename: "track.mp3", style: "cyberpunk" }
example_outputs:
  - tool: analyze_audio
    output: '{ "bpm": 128, "beats": [...], "energy": 0.75, "sections": [...] }'
  - tool: list_audio_library
    output: 'track1.mp3\ntrack2.m4a\ntrack3.wav'
  - tool: create_music_video_plan
    output: '{ "track": "track.mp3", "bpm": 128, "duration": 180, "energy_curve": [...], "recommended_style": "cyberpunk", "scenes": [...] }'
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
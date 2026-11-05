---
name: audio
description: Analyzes audio tracks for BPM, beats, energy, and sections, and builds music video production plans. Use when audio needs analysis before video generation or when a production plan is needed from a track.
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

Analyzes audio tracks and builds music video production plans using the local backend API.

## When to Use This Skill

- An audio file needs BPM, beats, energy, or section analysis
- A music video production plan is needed from an audio track
- The library needs to be browsed for available tracks

## Critical Rules

- Backs onto the local FastAPI backend at http://127.0.0.1:8000
- Nothing leaves the machine
- Run analyze_audio first to get BPM/energy, then create_music_video_plan for a plan
- Match visual style to audio genre (cyberpunk for electronic, cinematic for orchestral)

## Quick Start / Workflow

1. Call `list_audio_library` to see available tracks
2. Call `analyze_audio` with `filename` to get BPM, beats, energy, sections
3. Call `create_music_video_plan` with `filename` and optional `style` for a production plan

## Reference Navigation

- See [references/GUIDE.md](references/GUIDE.md) for detailed examples and parameter reference

## Anti-patterns

- Do not call create_music_video_plan without first checking audio analysis results
- Do not pass filenames that are not in the library (list_audio_library first)
- Do not expect the plan to include video rendering; it only recommends style and scenes

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
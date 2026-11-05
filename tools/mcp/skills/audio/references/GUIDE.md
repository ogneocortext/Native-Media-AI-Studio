# Audio Skill Guide

## analyze_audio

### Basic usage
```
mcp__ollama-tools__analyze_audio --filename "track.mp3"
```

### Returns
JSON with track info, BPM, beats, energy curve, and section breakdown.

## list_audio_library

### Basic usage
```
mcp__ollama-tools__list_audio_library
```

### Returns
A list of all available audio track filenames in the library.

## create_music_video_plan

### Basic usage
```
mcp__ollama-tools__create_music_video_plan --filename "track.mp3"
```

### With style preference
```
mcp__ollama-tools__create_music_video_plan --filename "track.mp3" --style cyberpunk
```

### Returns
A JSON plan with track info, BPM, duration, energy curve, recommended style, and scene breakdown.

### Common patterns
- **Audio analysis first**: Call analyze_audio to get BPM/energy, then create_music_video_plan
- **Style matching**: Match visual style to audio genre (cyberpunk for electronic, cinematic for orchestral, etc.)

### Parameters reference
| Tool | Parameter | Type | Required | Default | Description |
|------|-----------|------|----------|---------|-------------|
| analyze_audio | filename | string | Yes | — | Audio filename from library |
| create_music_video_plan | filename | string | Yes | — | Audio filename from library |
| create_music_video_plan | style | string | No | — | Visual style preference |

### Returns
- analyze_audio: JSON with BPM, beats, energy, sections
- list_audio_library: List of track filenames
- create_music_video_plan: JSON plan with track info, BPM, duration, energy curve, style, scenes

### Notes
- Backs onto the local FastAPI backend at http://127.0.0.1:8000
- Nothing leaves the machine
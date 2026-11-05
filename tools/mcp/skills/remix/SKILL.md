---
name: remix
description: Build mashups from stems of different songs — list sources, probe tempo, draft recipes from prompts, preview, build, enhance, and retrieve rendered stems.
version: "1.0.0"
server: ollama-tools
tools:
  - remix_list_sources
  - remix_probe
  - remix_from_prompt
  - remix_preview
  - remix_build
  - remix_job_status
  - remix_enhance
  - remix_list
  - remix_get_file
tags:
  - remix
  - mashup
  - audio
  - stems
  - dj
example_inputs:
  - tool: remix_list_sources
    args: {}
  - tool: remix_probe
    args: { track: "song_name" }
  - tool: remix_from_prompt
    args: { prompt: "make a darker version with more bass" }
  - tool: remix_build
    args: { recipe: { name: "my_remix", slots: [...] }, overwrite: false }
  - tool: remix_get_file
    args: { name: "my_remix", which: "master" }
example_outputs:
  - tool: remix_list_sources
    output: '{ "tracks": [{ "name": "song1", "stems": ["vocals","drums"] }] }'
  - tool: remix_probe
    output: '{ "tempo": 128, "key_confident": false }'
  - tool: remix_get_file
    output: "http://127.0.0.1:8000/api/audio/remix/my_remix/file/master"
---

# Remix Skill

Build mashups from stems of different songs using the local backend API.

## Tools

### remix_list_sources
List tracks with separated stems, per-stem availability, and cached probe data.

### remix_probe
Get tempo and advisory key for one source track.

**Parameters:**
- `track` (string, required): Source track (stem directory) name

### remix_from_prompt
Draft a mashup recipe from a natural-language sentence.

**Parameters:**
- `prompt` (string, required): Natural-language mashup request
- `base_recipe` (object, optional): Recipe to revise

### remix_preview
Resolve a recipe without rendering: timeline, stretch ratios, measured levels, warnings.

**Parameters:**
- `recipe` (object, required): The build recipe

### remix_build
Render a recipe to `output/remixes/<name>/`.

**Parameters:**
- `recipe` (object, required): The build recipe
- `overwrite` (boolean, optional): Replace existing remix. Default: false

### remix_job_status
Check status of a build/enhance job.

**Parameters:**
- `job_id` (string, required): Job id returned by remix_build or remix_enhance

### remix_enhance
Master an already-rendered remix with the Suno chain.

**Parameters:**
- `name` (string, required): Remix name
- `target_peak_dbfs` (number, optional): Default -1.0
- `master_ceiling_dbfs` (number, optional): Default -1.0
- `vocal_balance_db` (number, optional): Default 0.0
- `output_format` (string, optional): "wav" or "mp3". Default: "wav"

### remix_list
List rendered remixes with their manifests.

### remix_get_file
Get the playable URL for one stem or the mastered "master" of a rendered remix.

**Parameters:**
- `name` (string, required): Remix name
- `which` (string, required): vocals | drums | bass | other | master

## Notes
- Backs onto the local FastAPI backend at http://127.0.0.1:8000
- Tempo is detected from drums when present; key is explicit per layer
- Probe caches live in `output/remixes/.probes/`
- Nothing leaves the machine
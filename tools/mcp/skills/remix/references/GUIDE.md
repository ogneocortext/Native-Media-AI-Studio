# Remix Skill Guide

## remix_list_sources

### Basic usage
```
mcp__ollama-tools__remix_list_sources
```

### Returns
Tracks with separated stems, per-stem availability, and cached probe data.

## remix_probe

### Basic usage
```
mcp__ollama-tools__remix_probe --track "song_name"
```

### Returns
Tempo (BPM) and advisory key for one source track.

## remix_from_prompt

### Basic usage
```
mcp__ollama-tools__remix_from_prompt --prompt "make a darker version with more bass"
```

### With base recipe to revise
```
mcp__ollama-tools__remix_from_prompt --prompt "add more vocals in the chorus" --base_recipe '{"name":"my_remix","slots":[...]}'
```

### Returns
A drafted mashup recipe from a natural-language sentence.

## remix_preview

### Basic usage
```
mcp__ollama-tools__remix_preview --recipe '{"name":"test","slots":[...]}'
```

### Returns
Timeline, per-source stretch ratios, measured levels, and warnings without rendering.

## remix_build

### Basic usage
```
mcp__ollama-tools__remix_build --recipe '{"name":"my_remix","slots":[...]}'
```

### Overwrite existing
```
mcp__ollama-tools__remix_build --recipe '{"name":"my_remix","slots":[...]}' --overwrite true
```

### Returns
Rendered remix at `output/remixes/<name>/` with stems (vocals/drums/bass/other.wav) + remix.json.

## remix_job_status

### Basic usage
```
mcp__ollama-tools__remix_job_status --job_id "job-123"
```

### Returns
Status: queued | running | done | failed, with result details.

## remix_enhance

### Basic usage
```
mcp__ollama-tools__remix_enhance --name "my_remix"
```

### With custom mastering
```
mcp__ollama-tools__remix_enhance --name "my_remix" --target_peak_dbfs -1.0 --vocal_balance_db 2.0 --output_format wav
```

### Returns
Mastered remix with highpass, EQ, vocal balance, and limiting.

## remix_list

### Basic usage
```
mcp__ollama-tools__remix_list
```

### Returns
Rendered remixes with their manifests (slots, layers, gains, key shifts, source offsets).

## remix_get_file

### Basic usage
```
mcp__ollama-tools__remix_get_file --name "my_remix" --which master
```

### With specific stem
```
mcp__ollama-tools__remix_get_file --name "my_remix" --which vocals
```

### Returns
The playable URL for one stem (vocals/drums/bass/other) or the mastered "master".

### Common patterns
- **Full workflow**: list_sources → probe → from_prompt → preview → build → job_status → enhance → get_file
- **Stem selection**: Use remix_list to find remixes, then remix_get_file to play specific stems
- **Iterative refinement**: remix_from_prompt with base_recipe to revise an existing recipe

### Parameters reference
| Tool | Parameter | Type | Required | Default | Description |
|------|-----------|------|----------|---------|-------------|
| remix_probe | track | string | Yes | — | Source track (stem directory) name |
| remix_from_prompt | prompt | string | Yes | — | Natural-language mashup request |
| remix_from_prompt | base_recipe | object | No | — | Recipe to revise |
| remix_preview | recipe | object | Yes | — | The build recipe |
| remix_build | recipe | object | Yes | — | The build recipe |
| remix_build | overwrite | boolean | No | false | Replace existing remix |
| remix_job_status | job_id | string | Yes | — | Job id from build/enhance |
| remix_enhance | name | string | Yes | — | Remix name |
| remix_enhance | target_peak_dbfs | number | No | -1.0 | Target peak in dBFS |
| remix_enhance | master_ceiling_dbfs | number | No | -1.0 | Master ceiling in dBFS |
| remix_enhance | vocal_balance_db | number | No | 0.0 | Vocal balance adjustment |
| remix_enhance | output_format | string | No | "wav" | "wav" or "mp3" |
| remix_get_file | name | string | Yes | — | Remix name |
| remix_get_file | which | string | Yes | — | vocals \| drums \| bass \| other \| master |

### Notes
- Backs onto the local FastAPI backend at http://127.0.0.1:8000
- Tempo is detected from drums when present; key is explicit per layer
- Probe caches live in `output/remixes/.probes/`
- Nothing leaves the machine
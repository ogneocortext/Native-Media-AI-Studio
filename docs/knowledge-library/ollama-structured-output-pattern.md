---
tags:
  - ai
  - ollama
aliases:
  - Ollama Structured Output Pattern
cssclasses:
  - ai-guide
date: 2026-10-24
type: entity
---

# Ollama Structured Output Pattern - think:false + Client-Side Validation

**Version**: Ollama 0.40.10  
**Date**: 2026-10-24  
**Status**: Active - implemented across codebase

## Critical Finding

`think: false` with `format: json_schema` is **silently ignored** on MLX models (gemma4:mlx, qwen3.5:mlx) and pre-v0.21.1 gemma4 GGUF. **Always validate response client-side.**

## Model Matrix

| Model Family | think:false + format schema | Client Validation Required |
|--------------|---------------------------|---------------------------|
| gemma4 GGUF  | Works since Ollama v0.21.1 | Yes - defense-in-depth |
| gemma4 MLX   | Silently ignores format   | Yes - format always ignored |
| qwen3.5/qwen3.6 | May skip thinking on easy questions | Yes - always validate |
| MLX models (Apple Silicon) | Format always ignored | Yes - cannot rely on format |

## Recommended Pattern

### 1. Use `think: false` for deterministic output and speed

```python
# Default: think=false for GGUF models on Windows
response, success = maybe_validate_and_retry(
    ollama_client.chat_content,
    model=model_name,
    messages=messages,
    schema=response_schema,
    think=False,  # Request no thinking for deterministic output
)
```

### 2. Always validate client-side

The `validate_ollama_json_response()` function checks that the response
matches the expected JSON schema, since many models silently ignore
`format: json_schema`.

```python
from packages.backend.app.core.ollama_response_validator import (
    validate_ollama_json_response,
    maybe_validate_and_retry,
)

# Validate the response
is_valid, parsed = validate_ollama_json_response(
    response_content,
    schema=response_schema,
    model_name=model_name,
)
```

### 3. Retry with `think: true` if validation fails

If the first attempt with `think=false` fails validation, retry with
`think=true` to see if the model's thinking content helps enforce the schema:

```python
# Retry with think=true if first attempt failed
response, success = maybe_validate_and_retry(
    ollama_client.chat_content,
    model=model_name,
    messages=messages,
    schema=response_schema,
    think=True,  # Enable thinking for more reliable schema enforcement
)
```

### 4. Prompt template requirements

All prompt templates MUST include explicit "Return ONLY JSON" instructions:

```python
from packages.backend.app.core.ollama_prompt_templates import normalize_prompt_template

prompt = normalize_prompt_template(
    "music_analysis",
    track_name="Song Title",
    tempo=120,
    key="C major",
    duration=240,
)
```

**Template includes**: "Return ONLY valid JSON with these exact fields (no prose, no explanation)"

## Code Changes Summary

| File | Change |
|------|--------|
| `packages/backend/app/core/ollama_response_validator.py` | Added `validate_ollama_json_response()` and `maybe_validate_and_retry()` |
| `packages/backend/app/core/ollama_prompt_templates.py` | Added prompt templates with "Return ONLY JSON" instructions |
| `packages/backend/app/api/integrations_generation.py` | Added `run_with_ollama_structured_output()` wrapper |
| `packages/backend/app/api/integrations_misc.py` | Added `run_with_ollama_structured_output()` wrapper |
| `packages/backend/app/api/audio_analysis.py` | Added `run_with_ollama_structured_output()` wrapper |

## Model-Specific Notes

### gemma4 GGUF (Windows)
- `think:false` works with `format: json_schema` since Ollama v0.21.1
- Still validate client-side as defense-in-depth
- This is the primary model family on this Windows machine

### gemma4 MLX (Apple Silicon)
- Format schema is **silently ignored**
- Must use alternative approaches or accept unstructured output

### qwen3.5/qwen3.6
- May skip thinking on easy questions, bypassing schema enforcement
- Recommend `think:true` for reliability, but still validate client-side

### All other models
- Always validate client-side regardless of `think` setting
- Never trust `format: json_schema` alone
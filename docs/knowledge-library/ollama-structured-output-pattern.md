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
**Status**: Partially implemented — `validate_ollama_json_response()` and the prompt templates exist; the `maybe_validate_and_retry()` / `run_with_ollama_structured_output()` wrappers described below were **never added** (verified 2026-11-05). Compose the pattern manually as shown.

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
# chat_content is async and lives in app.core.ollama_client;
# think=False is a real parameter (measured ~65x faster on
# thinking-capable models).
content = await ollama_client.chat_content(
    model=model_name,
    messages=messages,
    think=False,  # Request no thinking for deterministic output
)
```

### 2. Always validate client-side

The `validate_ollama_json_response()` function checks that the response
matches the expected JSON schema, since many models silently ignore
`format: json_schema`. (It is the only export of
`ollama_response_validator.py` — there is no retry wrapper; loop it
yourself.)

```python
from app.core.ollama_response_validator import validate_ollama_json_response

is_valid, parsed = validate_ollama_json_response(
    content,
    schema=response_schema,
    model_name=model_name,
)
```

### 3. Retry with `think: true` if validation fails

If the first attempt with `think=False` fails validation, retry with
`think=True` to see if the model's thinking content helps enforce the schema:

```python
content = await ollama_client.chat_content(
    model=model_name,
    messages=messages,
    think=True,  # Enable thinking for more reliable schema enforcement
)
is_valid, parsed = validate_ollama_json_response(content, response_schema, model_name)
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

## Code Changes Summary (corrected 2026-11-05)

| File | Actual state |
|------|--------|
| `packages/backend/app/core/ollama_response_validator.py` | Exports `validate_ollama_json_response()` only — `maybe_validate_and_retry()` does not exist |
| `packages/backend/app/core/ollama_prompt_templates.py` | `PROMPT_TEMPLATES` + `normalize_prompt_template()` + `validate_and_extract_json()` exist (`music_analysis` etc. carry "Return ONLY JSON" instructions) |
| `packages/backend/app/core/ollama_client.py` | `chat_content(..., think=...)` is the real call site for the think toggle |
| `run_with_ollama_structured_output()` | **Not implemented** — proposed in `integrations_generation.py`, `integrations_misc.py`, `audio_analysis.py`; no such function exists anywhere in the tree |

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
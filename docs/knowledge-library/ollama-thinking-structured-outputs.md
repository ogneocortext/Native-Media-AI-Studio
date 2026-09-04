# Ollama Thinking Mode & Structured Outputs

> **Last Updated:** 2026-09-03
> **Ollama Version:** 0.33.3+
> **Relevant Models:** Qwen3.5, Qwen3, Gemma4, DeepSeek R1

## Problem

When using Qwen3.5:9b (and other Qwen3/DeepSeek reasoning models) via `/api/generate`, the model operates in **thinking mode by default**. Even with `think: false` in options, the model may still:
- Route all output to the `thinking` field
- Leave the `response` field empty
- Return `done_reason: length` without producing usable JSON in `response`

This breaks prompt-based JSON extraction for code generation and planning tools.

## Root Cause

Ollama's `/api/generate` endpoint does not honor `think: false` consistently for all models. The thinking/reasoning behavior is controlled at the chat-template level, and `think` in options is not a reliable override for Qwen3.5.

Reference: https://github.com/ollama/ollama/issues/10976

## Solution: Use `/api/chat` with `chat_template_kwargs`

The reliable way to disable thinking on Qwen3/Qwen3.5 is via the `/api/chat` endpoint with `chat_template_kwargs: {enable_thinking: false}`.

### Working Request Pattern

```json
{
  "model": "qwen3.5:9b",
  "messages": [
    {"role": "system", "content": "You are a Blender Python (bpy) expert. Return ONLY valid JSON."},
    {"role": "user", "content": "Create a Blender Python script for: a low-poly stone obelisk"}
  ],
  "stream": false,
  "keep_alive": "60s",
  "chat_template_kwargs": {"enable_thinking": false},
  "options": {"num_ctx": 8192, "num_predict": 2048, "temperature": 0.2}
}
```

### Response Fields

| Field | Description |
|-------|-------------|
| `message.content` | Final answer text |
| `message.thinking` | Reasoning trace (empty when thinking disabled) |
| `done_reason` | `stop` when generation completed fully |

## Structured Outputs

Ollama supports constrained JSON generation via the `format` parameter.

### JSON Mode

```json
{
  "model": "llama3.2",
  "messages": [...],
  "format": "json",
  "stream": false
}
```

### JSON Schema Mode

```json
{
  "model": "llama3.2",
  "messages": [...],
  "format": {
    "type": "object",
    "properties": {
      "name": {"type": "string"},
      "capital": {"type": "string"},
      "languages": {"type": "array", "items": {"type": "string"}}
    },
    "required": ["name", "capital", "languages"]
  },
  "stream": false
}
```

**Note:** Structured outputs may not work with all thinking models. Test with your target model.

## Model Behavior Matrix (Tested 2026-09-03)

| Model | Endpoint | Thinking Disabled | JSON in Response | Notes |
|-------|----------|-------------------|------------------|-------|
| qwen3.5:9b | `/api/generate` | No | No | Outputs to `thinking` field |
| qwen3.5:9b | `/api/chat` + `chat_template_kwargs:{enable_thinking:false}` | Yes | Yes | **Recommended for code gen** |
| qwen3.5:4b | `/api/generate` | No | No | Same issue as 9b |
| qwen3.5:4b | `/api/chat` + `chat_template_kwargs:{enable_thinking:false}` | Partial | Partial | Smaller model, less reliable |
| llama3.2:3b | `/api/generate` | N/A | Yes | No thinking mode, reliable JSON |
| llama3.2:3b | `/api/chat` | N/A | Yes | Good fallback for simple tasks |
| gemma4:e2b-it-qat | `/api/generate` | N/A | Partial | JSON parse failures on complex output |
| gemma4:e2b-it-qat | `/api/chat` | N/A | Partial | Better but still inconsistent for code |

## Recommendations

1. **Primary:** Use `/api/chat` with `chat_template_kwargs: {enable_thinking: false}` for Qwen3.5
2. **Fallback:** Use `llama3.2:3b` via `/api/chat` for simpler structured outputs
3. **Alternative:** Use `format: "json"` or JSON schema with `/api/chat` for schema enforcement
4. **Avoid:** `/api/generate` with `think: false` for Qwen3.5 - it does not work reliably

## Implementation Notes

### For Planning Tools (`plan_blender_script`, `plan_unity_scene`)

- Switch from `/api/generate` to `/api/chat`
- Add `chat_template_kwargs: {enable_thinking: false}`
- Keep `num_ctx: 8192`, `num_predict: 2048`, `temperature: 0.2`
- Parse `data.message.content` instead of `data.response`
- Check `data.message.thinking` only for debugging

### For Vision/Analysis Tools

- Continue using `/api/generate` or `/api/chat` with `think: true` when reasoning is beneficial
- For vision tasks, thinking mode can improve analysis quality

## References

- [Ollama Thinking Docs](https://docs.ollama.com/capabilities/thinking)
- [Ollama Structured Outputs](https://docs.ollama.com/capabilities/structured-outputs)
- [GitHub Issue #10976](https://github.com/ollama/ollama/issues/10976)
- [GitHub Issue #10538](https://github.com/ollama/ollama/issues/10538)

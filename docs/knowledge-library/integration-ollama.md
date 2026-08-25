# Ollama Integration & Tool Calling

> **Last Updated:** 2026-08-25
> **Ollama Version:** 0.32.15
> **API Version:** v1

## Overview

This document describes how AI agents should interact with Ollama for local LLM inference, including tool calling (function calling), streaming, and agent loop patterns.

## API Endpoints

### Primary Endpoints

| Endpoint | Method | Use Case |
|----------|--------|----------|
| `/api/chat` | POST | Multi-turn conversations with tool calling |
| `/api/generate` | POST | Single-turn generation (legacy, no tools) |
| `/api/tags` | GET | List available models |

**Important:** Always use `/api/chat` for tool calling. The `/api/generate` endpoint does NOT support tools.

## Tool Calling (Function Calling)

### Basic Flow

```
1. Send: messages + tools (JSON schemas)
2. Model returns either:
   a. Normal text message (no tool needed), or
   b. "tool_calls" list with name + arguments
3. Execute each tool call locally
4. Append tool result as "tool" role message
5. Call model again with updated messages
6. Model returns final natural-language answer
```

### Tool Definition Format

```json
{
  "type": "function",
  "function": {
    "name": "tool_name",
    "description": "What this tool does",
    "parameters": {
      "type": "object",
      "properties": {
        "param1": {
          "type": "string",
          "description": "Parameter description"
        }
      },
      "required": ["param1"]
    }
  }
}
```

### Tool Response Format

```json
{
  "role": "tool",
  "tool_name": "tool_name",
  "content": "Tool execution result"
}
```

### Agent Loop Pattern

```python
messages = [{"role": "user", "content": user_input}]
max_iterations = 5

for iteration in range(max_iterations):
    response = chat(model=model, messages=messages, tools=tools, think=True)
    messages.append(response.message)

    if not response.message.tool_calls:
        break  # Done, return content

    for call in response.message.tool_calls:
        result = execute_tool(call.function.name, call.function.arguments)
        messages.append({"role": "tool", "tool_name": call.function.name, "content": str(result)})
```

## Streaming with Tool Calling

When streaming, accumulate partial fields from each chunk:

```python
thinking = ""
content = ""
tool_calls = []

for chunk in stream:
    thinking += chunk.message.thinking or ""
    content += chunk.message.content or ""
    if chunk.message.tool_calls:
        tool_calls.extend(chunk.message.tool_calls)

# After stream completes, add accumulated fields to messages
messages.append({
    "role": "assistant",
    "thinking": thinking,
    "content": content,
    "tool_calls": tool_calls
})
```

## Gemma 4 Specifics

### Known Issues & Workarounds

| Issue | Workaround |
|-------|------------|
| Tool calls with `key=value` format fail to parse | Enable thinking mode (`think: true`) |
| System prompt + `think: false` breaks tool parsing | Use `think: true` or no system prompt |
| Nested tool arguments cause failures | Use flat argument structures |
| Special tokens leak into output | Enable thinking filter in client |

### Recommended Configuration for Gemma 4

```json
{
  "model": "gemma4:e4b",
  "messages": [...],
  "tools": [...],
  "stream": false,
  "think": true
}
```

### Prompt Engineering for Reliable Tool Use

Add to system prompt for better tool calling:

```
IMPORTANT: NEVER generate text before calling a tool. When a question requires a tool,
call it immediately without saying anything. After receiving the result, give your
answer directly.
Forbidden examples: "Let me check", "I'll look that up", "One moment"
Correct example: call the tool silently then provide the answer.
```

## Model Capabilities

| Model | Params | VRAM | Tool Accuracy | Notes |
|-------|--------|------|---------------|-------|
| Qwen 3 (all sizes) | 8B-235B | 6GB+ | Excellent | Best overall for tool calling |
| Gemma 4 | 9B-27B | 7GB+ | Very good | Strong reasoning with tools |
| Llama 3.1/3.3 | 8B-70B | 6GB+ | Good | Reliable for simple tool sets |
| DeepSeek R1 | 14B | 10GB+ | Good | Slower but thorough |
| Mistral Small 3.1 | 24B | 6GB+ | Good | Fast, reliable |

## Configuration Options

### Thinking Mode

```json
{
  "think": true        // Enable thinking (bool)
  "think": "high"      // Thinking level: "high", "medium", "low", "max"
  "think": false       // Disable thinking
}
```

### Context Length

```json
{
  "options": {
    "num_ctx": 32000    // Increase for better tool calling (default: 4096)
  }
}
```

### Generation Options

```json
{
  "options": {
    "temperature": 0.1,  // Lower for deterministic tool selection
    "top_k": 40,
    "top_p": 0.9,
    "num_predict": 4096  // Max tokens to generate
  }
}
```

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `tool_calls: []` with empty content | Parser failure (Gemma 4) | Enable thinking mode |
| Tool not found | Wrong tool name | Verify tool name matches definition |
| Invalid JSON arguments | Model hallucination | Retry with lower temperature |
| Timeout | Model too slow | Increase timeout or use smaller model |

### Retry Strategy

```python
@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))
def llm_call(messages):
    return chat(model=model, messages=messages, tools=tools, think=True)
```

## Backend Implementation

### Project Structure

```
packages/backend/app/
├── adapters/
│   └── ollama.py          # Ollama adapter with tool execution
└── api/
    └── integrations.py    # API routes for Ollama
```

### API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/integrations/ollama/models` | GET | List available models |
| `/api/integrations/ollama/chat` | POST | Chat with tool calling |
| `/api/integrations/ollama/generate` | POST | Legacy text generation |

### Chat Request Format

```json
{
  "message": "User message",
  "model": "qwen3:8b",
  "history": [{"role": "user", "content": "..."}],
  "tools": [{"type": "function", "function": {...}}],
  "think": true,
  "stream": false,
  "max_tool_calls": 5
}
```

### Chat Response Format

```json
{
  "response": "Final response text",
  "model": "qwen3:8b",
  "tool_calls": 3
}
```

## Frontend Implementation

### Key Components

- `AIToolsPage.tsx` - Main AI tools interface
- `api.ts` - Ollama API client functions
- `sseService.ts` - SSE connection for streaming

### API Client Functions

```typescript
// Chat with tool calling
ollamaChat(message, model, {
  tools: toolDefinitions,
  think: true,
  maxToolCalls: 5,
});

// Streaming chat
ollamaChatStream(message, model, {
  tools: toolDefinitions,
  think: true,
});

// Parse SSE stream
parseOllamaStream(stream);
```

## Best Practices

1. **Always use `/api/chat`** for tool calling - `/api/generate` doesn't support tools
2. **Enable thinking mode** for complex tool calling scenarios
3. **Keep tool arguments flat** - avoid deeply nested structures
4. **Set `num_ctx` to 32000+** for better tool calling performance
5. **Use `temperature: 0.1`** for deterministic tool selection
6. **Implement agent loop** - handle multiple tool calls per request
7. **Add error boundaries** - a crashing tool shouldn't kill the agent
8. **Set max iterations** - prevent infinite loops (recommended: 5)
9. **Accumulate streaming fields** - collect thinking, content, and tool_calls separately
10. **Handle parser failures gracefully** - especially with Gemma 4

## Integration with Other Features

### Art Direction
- Generate color palettes, typography suggestions
- Get project structure for asset management
- Search documentation for style references

### Music Video Production
- Generate video concepts and scene descriptions
- Get system health before starting long renders
- Check job queue status

### Storyboards
- Generate structured storyboard JSON
- Validate scene descriptions
- Auto-detect visual elements

### 3D Studio
- Get project structure for asset paths
- Check GPU/VRAM availability before generation
- Monitor job progress

## Troubleshooting

### Tools Not Being Called
- Verify model supports tool calling (check capabilities)
- Enable thinking mode
- Lower temperature to 0.1
- Add explicit instructions to system prompt

### Tool Calls Returning Empty
- Check tool name matches definition exactly
- Verify arguments match JSON schema
- Enable thinking mode (especially for Gemma 4)
- Retry with same messages

### Streaming Issues
- Ensure SSE client handles partial JSON
- Accumulate thinking/content/tool_calls separately
- Handle `done` event for completion
- Reconnect on connection loss

## References

- [Ollama API Docs](https://docs.ollama.com/api)
- [Tool Calling Guide](https://docs.ollama.com/capabilities/tool-calling)
- [Ollama GitHub](https://github.com/ollama/ollama)
- [Ollama Python SDK](https://github.com/ollama/ollama-python)

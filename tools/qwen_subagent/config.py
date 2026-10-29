"""Configuration for the local Qwen sub-agent harness.

Connects Qwen-Agent to the locally-running Ollama instance via its
OpenAI-compatible API endpoint (http://127.0.0.1:11434/v1).

Recommended model: qwen3:8b (better reasoning, still fits 8 GB VRAM).
Fallback: qwen3.5:4b (already loaded, smaller but less reliable at tool use).

Important notes for Qwen3 thinking models:
- Qwen-Agent handles tool-calling parsing internally for Qwen3 models,
  so do NOT pass vLLM flags like --enable-auto-tool-choice or
  --tool-call-parser hermes (those are vLLM-specific, not Ollama).
- For reliable tool execution, set thinking off via generate_cfg or the
  model's Ollama config. Qwen3 in thinking mode can plan a tool call but
  fail to emit it (~60% failure per QwenLM/Qwen3#1817).

Model Evaluation Mode:
- SIMULATE_CONTEXT_WINDOW: If True, truncates tool results to simulate
  limited context windows (default: 8k tokens). This helps evaluate
  how models behave under realistic constraints.
- MAX_TOOL_CALLS: Maximum number of tool calls per task to prevent
  infinite loops and simulate token budget constraints.
- DRY_RUN: If True, previews tool calls without executing them.
"""

from pathlib import Path

# Repository root (this file lives at <repo>/tools/qwen_subagent/config.py)
REPO_ROOT = Path(__file__).resolve().parents[2]

# Ollama connection
OLLAMA_HOST = "http://127.0.0.1:11434"
OLLAMA_API_BASE = f"{OLLAMA_HOST}/v1"  # OpenAI-compatible endpoint
OLLAMA_API_KEY = "ollama"  # dummy key; Ollama ignores it

# Model selection. qwen3:8b is preferred if available; qwen3.5:4b is the
# fallback already loaded on this machine.
DEFAULT_MODEL = "qwen3.5:4b"
FALLBACK_MODEL = "qwen3:8b"

# Model evaluation settings
SIMULATE_CONTEXT_WINDOW = True  # Simulate limited context windows
CONTEXT_WINDOW_TOKENS = 8192  # Simulated context window size (8k tokens)
MAX_TOOL_CALLS = 15  # Maximum tool calls per task
DRY_RUN = False  # Preview tool calls without execution

# LLM config passed to Qwen-Agent's get_chat_model / Assistant
# IMPORTANT: model_type='oai' forces the OpenAI-compatible (Ollama) path.
# Without it, Qwen-Agent routes 'qwen3' model names to Dashscope (cloud).
LLM_CFG = {
    "model_type": "oai",
    "model": DEFAULT_MODEL,
    "api_base": OLLAMA_API_BASE,
    "api_key": OLLAMA_API_KEY,
    "generate_cfg": {
        "temperature": 0.1,
        # Note: 'think' is NOT a valid OpenAI client parameter, so it is
        # omitted here. Qwen3 thinking behavior is controlled by the model
        # itself; if tool calls fail due to thinking-mode fabrication,
        # restart Ollama with the model configured for non-thinking output.
        "max_tokens": 4096,
    },
}

# Working directory the sub-agent operates within
WORK_DIR = str(REPO_ROOT)

# Timeout (seconds) for sub-agent tool invocations
TOOL_TIMEOUT_SECONDS = 300

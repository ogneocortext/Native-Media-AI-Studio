"""LLM tool-calling loop with file-inventory grounding.

Provides ``run_llm_loop``, a ReAct-style loop that:

1. Calls ``audio_list()`` and ``media_list()`` once at startup and injects
   the file inventory into the system prompt, so the model never invents
   paths that don't exist (Problem 3).
2. Enforces tool ordering: ``music_gen_status`` before
   ``music_gen_generate``; ``remix_preview`` before ``remix_build``.
3. Runs the tool-calling loop using the Ollama adapter's ``chat()`` method,
   feeding tool results back until the model emits a final text answer.

The caller supplies an ``execute_tool`` async callable that maps a tool name
and arguments to a result. This keeps the loop decoupled from any particular
tool registry or API surface.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[3]  # app/services/ -> repo root
AUDIO_DIR = PROJECT_ROOT / "output" / "audio"
OUTPUT_DIR = PROJECT_ROOT / "output"

# Tool ordering constraints: (tool, must_have_called_before)
_TOOL_ORDERING: list[tuple[str, str]] = [
    ("music_gen_generate", "music_gen_status"),
    ("remix_build", "remix_preview"),
]

#: System-prompt rule injected at loop start (Problem 3).
INVENTORY_RULE = """

## File inventory (grounding)

The following files actually exist in the studio output directories.
Only use filenames from this inventory or from the user's goal — never
invent paths, hash-prefixes, or re-derive names.

### Audio files
{audio_list}

### Media files
{media_list}

When a tool asks for a filename, use exactly one of the listed filenames.
Do not invent paths.
"""


def audio_list() -> list[dict[str, Any]]:
    """List available audio files for the LLM to reference."""
    files: list[dict[str, Any]] = []
    if AUDIO_DIR.exists():
        for f in sorted(AUDIO_DIR.rglob("*")):
            if f.is_file() and not f.name.startswith("."):
                files.append({
                    "filename": f.name,
                    "relative_path": f.relative_to(AUDIO_DIR).as_posix(),
                    "size_bytes": f.stat().st_size,
                })
    return files


def media_list() -> list[dict[str, Any]]:
    """List available media files for the LLM to reference."""
    files: list[dict[str, Any]] = []
    for sub in ("video", "images"):
        d = OUTPUT_DIR / sub
        if d.exists():
            for f in sorted(d.rglob("*")):
                if f.is_file() and not f.name.startswith("."):
                    files.append({
                        "filename": f.name,
                        "relative_path": f.relative_to(OUTPUT_DIR).as_posix(),
                        "size_bytes": f.stat().st_size,
                    })
    return files


def _check_tool_ordering(
    tool_name: str,
    called_tools: set[str],
) -> str | None:
    """Return an error string if ``tool_name`` violates ordering, else None."""
    for required, prerequisite in _TOOL_ORDERING:
        if required == tool_name and prerequisite not in called_tools:
            return (
                f"Error: {prerequisite} must be called before {tool_name}. "
                f"Call {prerequisite} first."
            )
    return None


async def run_llm_loop(
    adapter,
    system_prompt: str,
    user_message: str,
    tools: list[dict[str, Any]] | None = None,
    model: str | None = None,
    max_iterations: int = 10,
    execute_tool: Callable[[str, dict[str, Any]], Any] | None = None,
) -> dict[str, Any]:
    """Run an LLM tool-calling loop with file-inventory grounding.

    Args:
        adapter: An OllamaAdapter instance (provides ``chat()`` and
            ``get_tool_definitions()``).
        system_prompt: Base system prompt; the file inventory is appended.
        user_message: The user's request.
        tools: Optional OpenAI-compatible tool definitions.
        model: Model name (defaults to adapter's default).
        max_iterations: Maximum ReAct iterations before giving up.
        execute_tool: Optional async callable ``(name, args) -> result`` for
            dispatching tool calls. If None, tool calls are returned
            unexecuted with a placeholder result.

    Returns:
        Dict with ``response`` (final text), ``iterations`` (count), and
        ``tool_calls`` (list of all calls made).
    """
    # --- Problem 3: inject file inventory into system prompt -------------
    audio_files = audio_list()
    media_files = media_list()

    inventory_audio = "\n".join(
        f"  - {f['filename']} ({f['relative_path']})" for f in audio_files
    ) or "  (none)"
    inventory_media = "\n".join(
        f"  - {f['filename']} ({f['relative_path']})" for f in media_files
    ) or "  (none)"

    grounded_system = system_prompt + INVENTORY_RULE.format(
        audio_list=inventory_audio,
        media_list=inventory_media,
    )

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": grounded_system},
        {"role": "user", "content": user_message},
    ]

    called_tools: set[str] = set()
    all_tool_calls: list[dict[str, Any]] = []

    for iteration in range(max_iterations):
        result = await adapter.chat(
            messages=messages,
            model=model,
            tools=tools,
            stream=False,
        )

        assistant_msg = result.get("message", {}) or {}
        content = assistant_msg.get("content", "") or ""
        tool_calls = assistant_msg.get("tool_calls") or []

        messages.append({
            "role": "assistant",
            "content": content,
            **({"tool_calls": tool_calls} if tool_calls else {}),
        })

        all_tool_calls.extend(tool_calls)

        if not tool_calls:
            # No tool calls -> final answer
            return {
                "response": content,
                "iterations": iteration + 1,
                "tool_calls": all_tool_calls,
            }

        # Execute each tool call and feed results back
        for tc in tool_calls:
            fn = tc.get("function", {}) or {}
            name = fn.get("name", "")
            raw_args = fn.get("arguments", "{}")
            try:
                args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
            except json.JSONDecodeError:
                args = {}

            # --- Problem 3: tool ordering enforcement --------------------
            ordering_error = _check_tool_ordering(name, called_tools)
            if ordering_error:
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.get("id", ""),
                    "content": ordering_error,
                })
                called_tools.add(name)
                continue

            called_tools.add(name)

            if execute_tool is not None:
                try:
                    tool_result = await execute_tool(name, args)
                except Exception as exc:  # noqa: BLE001
                    tool_result = {"ok": False, "error": str(exc)}
            else:
                tool_result = {
                    "ok": True,
                    "tool": name,
                    "args": args,
                    "note": "execute_tool not provided; call not dispatched",
                }

            messages.append({
                "role": "tool",
                "tool_call_id": tc.get("id", ""),
                "name": name,
                "content": json.dumps(tool_result),
            })

    # Max iterations reached without a final answer
    last_content = messages[-1].get("content", "") if messages else ""
    return {
        "response": last_content,
        "iterations": max_iterations,
        "tool_calls": all_tool_calls,
        "truncated": True,
    }

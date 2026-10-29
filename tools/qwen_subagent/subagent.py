"""Local Qwen sub-agent harness.

Uses the raw OpenAI client pointed at the locally-running Ollama instance
(OpenAI-compatible endpoint) with a manual non-streaming function-calling
loop. This avoids Qwen-Agent's LLM-wrapper streaming issues with Qwen3
thinking models on small local LLMs.

Qwen-Agent's `BaseTool` and `register_tool` are still used for tool
definitions, keeping the tool schema compatible with Qwen-Agent.

Usage:
    # Single-shot task
    python tools/qwen_subagent/subagent.py "run the ruff gate and report results"

    # Interactive chat
    python tools/qwen_subagent/subagent.py --interactive

    # Non-streaming output
    python tools/qwen_subagent/subagent.py --task "..." --no-stream
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Callable

# Configuration values (no external dependencies).
# Relative import when used as a package, absolute when run as a script.
try:
    from .config import (
        CONTEXT_WINDOW_TOKENS,
        DEFAULT_MODEL,
        DRY_RUN,
        FALLBACK_MODEL,
        MAX_TOOL_CALLS,
        OLLAMA_API_BASE,
        OLLAMA_API_KEY,
        SIMULATE_CONTEXT_WINDOW,
    )
except ImportError:
    from config import (
        CONTEXT_WINDOW_TOKENS,
        DEFAULT_MODEL,
        DRY_RUN,
        FALLBACK_MODEL,
        MAX_TOOL_CALLS,
        OLLAMA_API_BASE,
        OLLAMA_API_KEY,
        SIMULATE_CONTEXT_WINDOW,
    )

# Tool definitions (requires qwen_agent package).
# Fails gracefully when qwen_agent isn't installed — subagent then
# runs with an empty tool set rather than crashing on import.
try:
    from .tools import TOOL_NAMES, TOOLS
except ImportError:
    try:
        from tools import TOOL_NAMES, TOOLS
    except ImportError:
        TOOL_NAMES = []
        TOOLS = []

from openai import OpenAI

SYSTEM_MESSAGE = """You are a local software-engineering sub-agent for the Native Media AI Studio repository.

Your job is to help the user review, fix, and improve the codebase using only the tools provided to you.

Available tools:
- read_file(path): Read a file's full text contents.
- list_directory(path): List files/subdirectories in a repo directory.
- grep_search(pattern, path?, include?): Search file contents for a regex.
- run_gates(only?, fix?): Run the project gate suite (docs, ruff, arch, routes, pytest, type, lint, unit).
- run_pytest(paths?, timeout?): Run backend pytest on specific test files.
- run_cmd(command, cwd?): Run an allow-listed command (python, pnpm, node, npm, npx, curl).

CRITICAL RULES:
1. Always verify your work by running gates or tests after making changes.
2. Prefer read_file + grep_search to understand code before editing.
3. Do not invent commands outside the allow-listed binaries (python, pnpm, node, npm, npx, curl).
4. All paths are repository-relative (e.g. 'packages/backend/app/core/migrations.py').
5. NEVER guess file or directory names - use list_directory to verify paths exist before reading them.
6. Report concrete results: command run, return code, and key output lines.
7. If a tool returns an error, analyze it and try a corrected approach rather than repeating the same call.
8. When you get "File not found" or "Directory not found", IMMEDIATELY use list_directory to check what actually exists.

Examples of BAD patterns to avoid:
- Don't: read_file("packages/backend/tests/conftest.py") without first checking if tests/ exists
- Don't: grep_search("foo", "packages/backend/unknown/") without listing directories first
- Don't: Run the same command repeatedly if it fails with a syntax error
- Don't: Assume file structure based on patterns - always verify with list_directory

Examples of GOOD patterns:
- list_directory("packages/backend") → see what's there → read_file only existing files
- grep_search with broad pattern first → narrow down based on results
- If read_file fails with "not found", immediately list_directory to find the correct path

You have limited context. Be efficient: read only what you need, summarize long outputs, and focus on the task at hand.

Be concise. Do not claim success without evidence from a tool result."""

DEFAULT_MAX_ITERATIONS = 10
TOOL_RESULT_TRUNCATE = 2000  # chars per tool result to keep context manageable
# Context window simulation: estimate 4 chars per token
SIMULATED_CONTEXT_CHARS = CONTEXT_WINDOW_TOKENS * 4 if SIMULATE_CONTEXT_WINDOW else None


def build_client() -> OpenAI:
    """Build an OpenAI client pointed at the local Ollama instance."""
    return OpenAI(base_url=OLLAMA_API_BASE, api_key=OLLAMA_API_KEY)


def tools_to_openai_format(tools: list[Any]) -> list[dict[str, Any]]:
    """Convert Qwen-Agent BaseTool instances to OpenAI function-calling format.

    Sets ``strict: true`` on each tool so the model is required to follow the
    schema exactly, which improves tool-call reliability on smaller local
    models (qwen3.5:4b).
    """
    out = []
    for t in tools:
        out.append(
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description or "",
                    "parameters": t.parameters if isinstance(t.parameters, dict) else {},
                    "strict": True,
                },
            }
        )
    return out


def build_tools_map(tools: list[Any]) -> dict[str, Any]:
    """Map tool name -> BaseTool instance."""
    return {t.name: t for t in tools}


def _truncate(text: str, max_chars: int = TOOL_RESULT_TRUNCATE) -> str:
    """Truncate a tool result to keep context window manageable."""
    if len(text) <= max_chars:
        return text
    return (
        text[: max_chars - 50] + f"\n... [truncated, {len(text) - max_chars + 50} more chars] ..."
    )


def _simulate_context_window(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Simulate limited context window by truncating message history.

    Keeps system message and most recent messages within simulated token budget.
    """
    if not SIMULATED_CONTEXT_CHARS:
        return messages

    # Keep system message and user task
    system_msg = messages[0]
    user_msg = messages[1]

    # Estimate character count for remaining messages
    # Start from the end and keep adding until we hit the budget
    trimmed = [system_msg, user_msg]
    char_count = len(str(system_msg)) + len(str(user_msg))

    for msg in reversed(messages[2:]):
        msg_chars = len(str(msg))
        if char_count + msg_chars > SIMULATED_CONTEXT_CHARS:
            break
        trimmed.insert(2, msg)
        char_count += msg_chars

    if len(trimmed) < len(messages):
        # Add a note that context was truncated
        trimmed.append(
            {
                "role": "system",
                "content": f"[Context truncated to simulate {CONTEXT_WINDOW_TOKENS} token window. Some earlier tool results are omitted.]",
            }
        )

    return trimmed


def _run_react_loop(
    client: OpenAI,
    tools_map: dict[str, Any],
    openai_tools: list[dict[str, Any]],
    messages: list[dict[str, Any]],
    model: str,
    max_iterations: int = DEFAULT_MAX_ITERATIONS,
    *,
    stream: bool = True,
    on_output: Callable[[str], None] | None = None,
) -> tuple[str, dict[str, Any]]:
    """Manual ReAct loop with non-streaming OpenAI chat completions.

    Pattern (from Qwen-Agent examples/function_calling.py):
      1. Ask the LLM (with function definitions) what to do.
      2. If it requests a tool call, execute the tool and feed the result back
         as a ``tool`` role message.
      3. Repeat until the LLM gives a final text answer (no tool calls) or
         max_iterations is reached.

    Args:
        on_output: Optional callback called with each piece of output text
            (assistant content and tool results). Used for SSE streaming.

    Returns:
        Tuple of (final_answer, metrics_dict) where metrics includes tool_calls,
        iterations, context_truncations, etc.
    """
    final = ""
    tool_call_count = 0
    tool_usage: dict[str, int] = {}
    context_truncations = 0

    for iteration in range(max_iterations):
        # Simulate context window before each LLM call
        messages_before = len(messages)
        messages = _simulate_context_window(messages)
        if len(messages) < messages_before:
            context_truncations += 1

        if stream:
            print(f"\n[iteration {iteration + 1}/{max_iterations}] ", end="", flush=True)
            if on_output:
                on_output(f"\n[iteration {iteration + 1}/{max_iterations}] ")

        response = client.chat.completions.create(
            model=model,
            messages=messages,
            tools=openai_tools,
            tool_choice="required",
            temperature=0.1,
            max_tokens=4096,
            stream=False,
        )

        msg = response.choices[0].message
        content = msg.content or ""
        tool_calls = msg.tool_calls or []

        # Append assistant message to conversation
        assistant_entry: dict[str, Any] = {"role": "assistant", "content": content}
        if tool_calls:
            assistant_entry["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": tc.type,
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                }
                for tc in tool_calls
            ]
        messages.append(assistant_entry)

        if content and stream:
            print(content, end="", flush=True)
        if content and on_output:
            on_output(content)
        final = content

        if not tool_calls:
            # No tool calls. If content is empty, the model may have gotten
            # stuck (e.g. Qwen3 thinking mode produced no output). Prompt it
            # once more to produce a final answer based on tool results.
            if not content.strip() and iteration < max_iterations - 1:
                messages.append(
                    {
                        "role": "system",
                        "content": "You must provide a final text answer summarizing the tool results above. Do not make further tool calls.",
                    }
                )
                continue
            break

        # Execute each tool call and feed results back
        for tc in tool_calls:
            tool_call_count += 1

            # Check tool call budget
            if tool_call_count > MAX_TOOL_CALLS:
                messages.append(
                    {
                        "role": "system",
                        "content": f"Tool call budget exceeded ({MAX_TOOL_CALLS} calls). Provide a final answer based on the results you have so far. Do not make further tool calls.",
                    }
                )
                break

            name = tc.function.name
            raw_args = tc.function.arguments or "{}"
            try:
                args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
            except json.JSONDecodeError:
                args = {}

            tool = tools_map.get(name)
            if tool is None:
                result = f"ERROR: Unknown tool '{name}'."
            else:
                # Track tool usage
                tool_usage[name] = tool_usage.get(name, 0) + 1

                if DRY_RUN:
                    result = f"[DRY RUN] Would call {name} with args: {args}"
                else:
                    try:
                        result = tool.call(args)
                    except Exception as exc:  # noqa: BLE001
                        result = f"ERROR: Tool '{name}' raised: {exc}"

            result_str = str(result)
            truncated = _truncate(result_str)
            if stream:
                print(f"\n[tool: {name}] {truncated}", end="", flush=True)
            if on_output:
                on_output(f"\n[tool: {name}] {truncated}")

            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "name": name,
                    "content": truncated,
                }
            )

    if stream:
        print()
    if on_output:
        on_output("\n")

    metrics = {
        "tool_calls": tool_call_count,
        "iterations": iteration + 1,
        "tool_usage": tool_usage,
        "context_truncations": context_truncations,
        "simulated_context_window": CONTEXT_WINDOW_TOKENS if SIMULATE_CONTEXT_WINDOW else None,
        "dry_run": DRY_RUN,
    }

    return final, metrics


def run_task(
    task: str,
    model: str | None = None,
    *,
    stream: bool = True,
    max_iterations: int = DEFAULT_MAX_ITERATIONS,
    on_output: Callable[[str], None] | None = None,
) -> tuple[str, dict[str, Any]]:
    """Run a single task through the sub-agent and return the final response.

    Returns:
        Tuple of (final_answer, metrics_dict)
    """
    model = model or DEFAULT_MODEL
    client = build_client()
    tools_map = build_tools_map(TOOLS)
    openai_tools = tools_to_openai_format(TOOLS)

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM_MESSAGE},
        {"role": "user", "content": task},
    ]

    try:
        return _run_react_loop(
            client, tools_map, openai_tools, messages, model, max_iterations, stream, on_output
        )
    except Exception as exc:  # noqa: BLE001
        print(f"\n[subagent] Error: {exc}", file=sys.stderr)
        print(f"[subagent] Falling back to {FALLBACK_MODEL}...", file=sys.stderr)
        client = build_client()
        messages = [
            {"role": "system", "content": SYSTEM_MESSAGE},
            {"role": "user", "content": task},
        ]
        return _run_react_loop(
            client,
            tools_map,
            openai_tools,
            messages,
            FALLBACK_MODEL,
            max_iterations,
            stream,
            on_output,
        )


def main(argv: list[str] | None = None) -> int:
    global SIMULATE_CONTEXT_WINDOW, CONTEXT_WINDOW_TOKENS, DRY_RUN
    parser = argparse.ArgumentParser(
        description="Local Qwen sub-agent for Native Media AI Studio.",
    )
    parser.add_argument("task", nargs="?", help="Task description to run (single-shot mode).")
    parser.add_argument(
        "--interactive",
        "-i",
        action="store_true",
        help="Interactive chat mode.",
    )
    parser.add_argument(
        "--no-stream",
        action="store_true",
        help="Disable streaming output (single-shot mode).",
    )
    parser.add_argument(
        "--model",
        default=None,
        help=f"Ollama model (default: {DEFAULT_MODEL}, fallback: {FALLBACK_MODEL}).",
    )
    parser.add_argument(
        "--max-iterations",
        type=int,
        default=DEFAULT_MAX_ITERATIONS,
        help=f"Maximum ReAct loop iterations (default: {DEFAULT_MAX_ITERATIONS}).",
    )
    parser.add_argument(
        "--simulate-context",
        action="store_true",
        help="Simulate limited context window (default: uses config setting).",
    )
    parser.add_argument(
        "--no-simulate-context",
        action="store_true",
        help="Disable context window simulation.",
    )
    parser.add_argument(
        "--context-window",
        type=int,
        default=None,
        help=f"Context window size in tokens (default: {CONTEXT_WINDOW_TOKENS if SIMULATE_CONTEXT_WINDOW else 'disabled'}).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview tool calls without executing them.",
    )
    args = parser.parse_args(argv)

    # Override config settings based on CLI flags
    if args.no_simulate_context:
        SIMULATE_CONTEXT_WINDOW = False
    elif args.simulate_context:
        SIMULATE_CONTEXT_WINDOW = True
    if args.context_window is not None:
        CONTEXT_WINDOW_TOKENS = args.context_window
    if args.dry_run:
        DRY_RUN = True

    if args.interactive:
        return _interactive(args.model or DEFAULT_MODEL, args.max_iterations)
    if args.task:
        result, metrics = run_task(
            args.task,
            model=args.model,
            stream=not args.no_stream,
            max_iterations=args.max_iterations,
        )
        print("\n\n=== METRICS ===")
        print(f"Tool calls: {metrics['tool_calls']}")
        print(f"Iterations: {metrics['iterations']}")
        print(f"Context truncations: {metrics['context_truncations']}")
        print(f"Tool usage: {metrics['tool_usage']}")
        if metrics.get("simulated_context_window"):
            print(f"Simulated context window: {metrics['simulated_context_window']} tokens")
        if metrics.get("dry_run"):
            print(f"Dry run: {metrics['dry_run']}")
        return 0
    parser.print_help()
    return 1


def _interactive(model: str, max_iterations: int) -> int:
    client = build_client()
    tools_map = build_tools_map(TOOLS)
    openai_tools = tools_to_openai_format(TOOLS)
    print(f"Local Qwen sub-agent ready. Model: {model}")
    print(f"Max iterations: {max_iterations}")
    print(
        f"Context simulation: {SIMULATE_CONTEXT_WINDOW} ({CONTEXT_WINDOW_TOKENS} tokens if enabled)"
    )
    print(f"Tool call budget: {MAX_TOOL_CALLS}")
    print(f"Dry run: {DRY_RUN}")
    print("Tools: " + ", ".join(TOOL_NAMES))
    print("Type 'exit' or 'quit' to leave. Type 'help' for this message.\n")
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM_MESSAGE},
    ]
    while True:
        try:
            user = input("you> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not user:
            continue
        if user in {"exit", "quit"}:
            break
        if user == "help":
            print("Available tools: " + ", ".join(TOOL_NAMES))
            print("Enter a task description; the agent will use tools and report back.\n")
            continue
        messages.append({"role": "user", "content": user})
        print("agent> ", end="", flush=True)
        result, metrics = _run_react_loop(
            client, tools_map, openai_tools, messages, model, max_iterations, stream=True
        )
        print("\n=== METRICS ===")
        print(f"Tool calls: {metrics['tool_calls']}")
        print(f"Iterations: {metrics['iterations']}")
        print(f"Context truncations: {metrics['context_truncations']}")
        print(f"Tool usage: {metrics['tool_usage']}")
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

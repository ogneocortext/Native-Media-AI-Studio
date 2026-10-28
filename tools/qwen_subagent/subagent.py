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
from typing import Any

try:
    from .config import DEFAULT_MODEL, FALLBACK_MODEL, OLLAMA_API_BASE, OLLAMA_API_KEY
    from .tools import TOOL_NAMES, TOOLS
except ImportError:
    from config import DEFAULT_MODEL, FALLBACK_MODEL, OLLAMA_API_BASE, OLLAMA_API_KEY

    from tools import TOOL_NAMES, TOOLS

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

Rules:
1. Always verify your work by running gates or tests after making changes.
2. Prefer read_file + grep_search to understand code before editing.
3. Do not invent commands outside the allow-listed binaries.
4. All paths are repository-relative (e.g. 'packages/backend/app/core/migrations.py').
5. Report concrete results: command run, return code, and key output lines.
6. If a tool returns an error, analyze it and try a corrected approach rather than repeating the same call.

Be concise. Do not claim success without evidence from a tool result."""

DEFAULT_MAX_ITERATIONS = 10
TOOL_RESULT_TRUNCATE = 2000  # chars per tool result to keep context manageable


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
        out.append({
            "type": "function",
            "function": {
                "name": t.name,
                "description": t.description or "",
                "parameters": t.parameters if isinstance(t.parameters, dict) else {},
                "strict": True,
            },
        })
    return out


def build_tools_map(tools: list[Any]) -> dict[str, Any]:
    """Map tool name -> BaseTool instance."""
    return {t.name: t for t in tools}


def _truncate(text: str, max_chars: int = TOOL_RESULT_TRUNCATE) -> str:
    """Truncate a tool result to keep context window manageable."""
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 50] + f"\n... [truncated, {len(text) - max_chars + 50} more chars] ..."


def _run_react_loop(
    client: OpenAI,
    tools_map: dict[str, Any],
    openai_tools: list[dict[str, Any]],
    messages: list[dict[str, Any]],
    model: str,
    max_iterations: int = DEFAULT_MAX_ITERATIONS,
    stream: bool = True,
) -> str:
    """Manual ReAct loop with non-streaming OpenAI chat completions.

    Pattern (from Qwen-Agent examples/function_calling.py):
      1. Ask the LLM (with function definitions) what to do.
      2. If it requests a tool call, execute the tool and feed the result back
         as a ``tool`` role message.
      3. Repeat until the LLM gives a final text answer (no tool calls) or
         max_iterations is reached.
    """
    final = ""
    for iteration in range(max_iterations):
        if stream:
            print(f"\n[iteration {iteration + 1}/{max_iterations}] ", end="", flush=True)

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
        final = content

        if not tool_calls:
            # No tool calls -> final answer
            break

        # Execute each tool call and feed results back
        for tc in tool_calls:
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
                try:
                    result = tool.call(args)
                except Exception as exc:  # noqa: BLE001
                    result = f"ERROR: Tool '{name}' raised: {exc}"

            result_str = str(result)
            truncated = _truncate(result_str)
            if stream:
                print(f"\n[tool: {name}] {truncated}", end="", flush=True)

            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "name": name,
                "content": truncated,
            })

    if stream:
        print()
    return final


def run_task(
    task: str,
    model: str | None = None,
    stream: bool = True,
    max_iterations: int = DEFAULT_MAX_ITERATIONS,
) -> str:
    """Run a single task through the sub-agent and return the final response."""
    model = model or DEFAULT_MODEL
    client = build_client()
    tools_map = build_tools_map(TOOLS)
    openai_tools = tools_to_openai_format(TOOLS)

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM_MESSAGE},
        {"role": "user", "content": task},
    ]

    try:
        return _run_react_loop(client, tools_map, openai_tools, messages, model, max_iterations, stream)
    except Exception as exc:  # noqa: BLE001
        print(f"\n[subagent] Error: {exc}", file=sys.stderr)
        print(f"[subagent] Falling back to {FALLBACK_MODEL}...", file=sys.stderr)
        client = build_client()
        messages = [
            {"role": "system", "content": SYSTEM_MESSAGE},
            {"role": "user", "content": task},
        ]
        return _run_react_loop(client, tools_map, openai_tools, messages, FALLBACK_MODEL, max_iterations, stream)


def main(argv: list[str] | None = None) -> int:
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
    args = parser.parse_args(argv)

    if args.interactive:
        return _interactive(args.model or DEFAULT_MODEL, args.max_iterations)
    if args.task:
        run_task(args.task, model=args.model, stream=not args.no_stream, max_iterations=args.max_iterations)
        return 0
    parser.print_help()
    return 1


def _interactive(model: str, max_iterations: int) -> int:
    client = build_client()
    tools_map = build_tools_map(TOOLS)
    openai_tools = tools_to_openai_format(TOOLS)
    print(f"Local Qwen sub-agent ready. Model: {model}")
    print(f"Max iterations: {max_iterations}")
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
        _run_react_loop(client, tools_map, openai_tools, messages, model, max_iterations, stream=True)
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

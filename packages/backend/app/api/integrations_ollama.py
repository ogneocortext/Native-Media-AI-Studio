"""
Ollama integration routes.

Chat (streaming + non-streaming agent loop), embeddings, semantic search,
scene state, tool listing, the LLM tool-calling loop, and benchmark endpoints.
Mounted under /api/integrations by main.py.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import operator
import re
from typing import TYPE_CHECKING, Any, cast

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

import aiohttp  # noqa: F401  (retained for parity with the original module's imports)
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from ..adapters.adapter_base import AdapterStatus
from ..adapters.registry import adapter_registry
from ..core import database as db
from ..core import ollama_client as _oc
from ..core.config import config
from ..services.llm_loop import run_llm_loop

logger = logging.getLogger(__name__)
# Router without prefix - included by main.py with prefix "/api/integrations"
router = APIRouter(tags=["Integrations-Ollama"])


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------
class OllamaEmbedRequest(BaseModel):
    """Request for generating embeddings via Ollama."""

    text: str
    model: str | None = None


class OllamaSemanticSearchRequest(BaseModel):
    """Request for semantic search over tracks/visuals."""

    query: str
    limit: int = 10
    model: str | None = None


class OllamaChatRequest(BaseModel):
    """Request for Ollama chat with tool calling support."""

    message: str
    model: str | None = None
    history: list[dict] | None = None
    think: bool | None = None
    stream: bool = False
    max_tool_calls: int = 5
    options: dict | None = None
    system: str | None = None
    tools: bool | list | None = None


class OllamaGenerateRequest(BaseModel):
    """Request for generating text via Ollama /api/generate."""

    prompt: str
    model: str = "gemma4:e2b-it-qat"


class LLMLoopRequest(BaseModel):
    """Request to run the LLM tool-calling loop.

    Body: { "system_prompt": "...", "user_message": "...", "model?: "...",
            "max_iterations?: 10 }
    """

    system_prompt: str
    user_message: str
    model: str | None = None
    max_iterations: int = 10


# ---------------------------------------------------------------------------
# Ollama embed / semantic search
# ---------------------------------------------------------------------------
@router.post("/ollama/embed")
async def ollama_embed(body: OllamaEmbedRequest) -> dict:
    """Generate embedding via nomic-embed-text. Uses config.embedding_model by default."""
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text/input required")
    model = body.model or config.embedding_model
    try:
        emb = await _oc.embed_text(text, model=model)
        if emb is None:
            raise HTTPException(status_code=502, detail="Embedding failed")
        return {"model": model, "embedding": emb, "dimensions": len(emb)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/ollama/search")
async def ollama_semantic_search(body: OllamaSemanticSearchRequest) -> dict:
    """Semantic search over tracks/visuals using nomic embeddings."""
    query = body.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="query required")
    limit = min(body.limit, 20)
    model = body.model or config.embedding_model
    # Embed query
    qemb = await _oc.embed_text(query, model=model)
    if qemb is None:
        raise HTTPException(status_code=502, detail="Embedding failed")
    # Fetch candidates from DB (tracks)
    candidates = []
    try:
        tracks = getattr(db, "get_all_tracks", list)()
        for t in (tracks or [])[:200]:
            text = f"{t.get('title', '')} {t.get('artist', '')} {t.get('music_prompt', '')} {t.get('lyrics', '')[:200]}"
            candidates.append({"type": "track", "id": t.get("id"), "text": text, "meta": t})
    except Exception:
        pass
    if not candidates:
        return {"query": query, "results": [], "model": model}
    # Embed candidates with concurrency limit (was sequential 200*15s = 50min)
    candidates = candidates[: min(len(candidates), limit * 5)]  # cap to 5x limit before embedding
    sem = asyncio.Semaphore(5)

    async def _embed_one(c):
        async with sem:
            try:
                emb = await _oc.embed_text(c["text"][:800], model=model, timeout=15)
                if emb is None:
                    return None
                dot = sum(a * b for a, b in zip(qemb, emb, strict=True))
                nq = math.sqrt(sum(a * a for a in qemb))
                nb = math.sqrt(sum(a * a for a in emb))
                sim = dot / (nq * nb) if nq and nb else 0
                return {**c, "score": round(sim, 4)}
            except Exception:
                return None

    results = [
        r for r in await asyncio.gather(*[_embed_one(c) for c in candidates]) if r is not None
    ]
    results.sort(key=operator.itemgetter("score"), reverse=True)
    return {"query": query, "model": model, "results": results[:limit]}


# ---------------------------------------------------------------------------
# Chat streaming helpers (extracted from the monolithic integrations_generation)
# ---------------------------------------------------------------------------
async def _emit_tool_call_events(
    tool_calls: list[dict[str, Any]],
    assistant_content: str,
    tool_adapter: Any,
    current_messages: list[dict[str, Any]],
):
    """Yield tool_calls/tool_result SSE events and append messages."""
    yield {
        "event": "tool_calls",
        "data": json.dumps(
            {
                "tool_calls": [
                    {
                        "name": tc["function"]["name"],
                        "arguments": tc["function"]["arguments"],
                    }
                    for tc in tool_calls
                ]
            }
        ),
    }
    current_messages.append(
        {
            "role": "assistant",
            "content": assistant_content,
            "tool_calls": tool_calls,
        }
    )
    for tc in tool_calls:
        assert tool_adapter is not None
        result = await tool_adapter.execute_tool_call(
            tc["function"]["name"],
            tc["function"]["arguments"],
            {},
        )
        # Stream the result back to the client so it can display tool
        # output (and render things like the visualization canvas) without
        # having to re-parse the model's prose.
        yield {
            "event": "tool_result",
            "data": json.dumps({"name": tc["function"]["name"], "result": result}),
        }
        current_messages.append(
            {
                "role": "tool",
                "tool_name": tc["function"]["name"],
                "content": result,
            }
        )


async def _explicit_tool_fallback(
    message: str,
    tools: list[Any],
    tool_adapter: Any,
    current_messages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Execute a single explicitly-named tool when the model produced no
    tool call and no content. Returns SSE event dicts, or [] when the
    request does not name exactly one registered tool."""
    explicit_names = [
        tool.get("function", {}).get("name", "")
        for tool in tools
        if isinstance(tool, dict)
    ]
    explicit_names = [name for name in explicit_names if name and name.lower() in message.lower()]
    if len(explicit_names) != 1:
        return []
    name = explicit_names[0]
    args: dict[str, object] = {}
    depth_match = re.search(r"depth\s*[=:]\s*(\d+)", message, re.IGNORECASE)
    if depth_match:
        args["depth"] = min(6, int(depth_match.group(1)))
    assert tool_adapter is not None
    result = await tool_adapter.execute_tool_call(name, args, {})
    current_messages.extend(
        [
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [{"function": {"name": name, "arguments": args}}],
            },
            {"role": "tool", "tool_name": name, "content": result},
        ]
    )
    return [
        {
            "event": "tool_calls",
            "data": json.dumps({"tool_calls": [{"name": name, "arguments": args}]}),
        },
        {"event": "tool_result", "data": json.dumps({"name": name, "result": result})},
    ]


def _done_chunk_events(
    chunk: dict[str, Any],
    model: Any,
    final_content: str,
    tool_call_count: int,
    *,
    saw_thinking: bool,
) -> list[dict[str, Any]]:
    """Build the terminal SSE events for a done chunk."""
    if not final_content and tool_call_count == 0:
        if saw_thinking:
            no_response_msg = "The model finished reasoning but produced no answer. Try rephrasing, or disable thinking mode."
        else:
            no_response_msg = "The model produced no response. Try rephrasing, or use a model with native tool support."
        return [
            {
                "event": "error",
                "data": json.dumps(
                    {"message": no_response_msg, "model": chunk.get("model", model)}
                ),
            }
        ]
    return [
        {
            "event": "done",
            "data": json.dumps(
                {
                    "content": final_content,
                    "model": chunk.get("model", model),
                    "tool_calls": tool_call_count,
                }
            ),
        }
    ]


async def _stream_chat_events(
    adapter: Any,
    messages: list[dict[str, Any]],
    model: Any,
    tools: list[Any],
    think: Any,
    ollama_options: dict,
    max_tool_calls: int,
    tool_adapter: Any,
    message: str,
):
    """Run the streaming agent loop, yielding SSE event dicts."""
    tool_call_count = 0
    fallback_executed = False
    current_messages = messages.copy()
    # Ollama streams the answer as deltas; the final "done"
    # chunk carries an empty message.content. Accumulate the
    # streamed text so a completed answer is never mistaken
    # for "no response" (measured on Ollama 0.40.2).
    streamed_content = ""
    saw_thinking = False
    while tool_call_count < max_tool_calls:
        async for chunk in cast(
            "AsyncIterator[dict[str, Any]]",
            await adapter.chat(
                messages=current_messages,
                model=model,
                tools=tools,
                stream=True,
                think=think,
                **ollama_options,
            ),
        ):
            msg = chunk.get("message", {}) or {}
            tool_calls = msg.get("tool_calls", [])
            # Tool calls can arrive in a non-done chunk on
            # Ollama streaming (measured on 0.40.2: the
            # tool_calls chunk has done=false and the
            # following done chunk is empty). Handle them
            # wherever they appear so the call is never
            # dropped.
            if tool_calls and tool_call_count < max_tool_calls:
                tool_call_count += 1
                async for ev in _emit_tool_call_events(
                    tool_calls,
                    msg.get("content", "") or "",
                    tool_adapter,
                    current_messages,
                ):
                    yield ev
                break
            if chunk.get("done"):
                # The done chunk's content is empty on
                # Ollama streaming; the real answer was
                # streamed as deltas above.
                done_content = msg.get("content", "") or ""
                final_content = done_content or streamed_content
                # Guarded fallback for explicit, unambiguous
                # requests: small local models sometimes
                # describe a tool instead of emitting the
                # native tool call. Execute only a named
                # registered tool, never guess a tool. Only
                # on the first completion (tool_call_count
                # == 0) so it never re-fires after a real
                # tool call and executes the tool twice.
                if (
                    not final_content
                    and not fallback_executed
                    and tool_call_count == 0
                    and tool_call_count < max_tool_calls
                ):
                    events = await _explicit_tool_fallback(
                        message, tools, tool_adapter, current_messages
                    )
                    if events:
                        tool_call_count += 1
                        fallback_executed = True
                        for ev in events:
                            yield ev
                        break
                for ev in _done_chunk_events(
                    chunk, model, final_content, tool_call_count, saw_thinking=saw_thinking
                ):
                    yield ev
                return
            else:
                content = chunk.get("message", {}).get("content", "")
                thinking = chunk.get("message", {}).get("thinking", "")
                if content:
                    streamed_content += content
                if thinking:
                    saw_thinking = True
                if content or thinking:
                    yield {
                        "event": "content",
                        "data": json.dumps({"content": content, "thinking": thinking}),
                    }
    # Send done event to properly close the stream
    yield {"event": "done", "data": json.dumps({"status": "complete"})}


async def _run_nonstream_chat(
    adapter: Any,
    messages: list[dict[str, Any]],
    model: Any,
    tools: list[Any],
    think: Any,
    ollama_options: dict,
    max_tool_calls: int,
    tool_adapter: Any,
) -> dict[str, Any]:
    """Non-streaming agent loop: chat -> execute tool calls -> repeat."""
    tool_call_count = 0
    current_messages = messages.copy()
    last_response = ""
    tool_details = []
    # Loop until the model produces a final answer. The bound is
    # the tool-call guard below, not the loop condition: with
    # max_tool_calls == 0 the model must still be called once to
    # answer, and after the last allowed tool call it must be
    # called again to produce the final text. The old
    # `while tool_call_count < max_tool_calls` skipped both and
    # returned an empty response (measured 2026-10-11).
    while True:
        result = await adapter.chat(
            messages=current_messages,
            model=model,
            tools=tools,
            stream=False,
            think=think,
            **ollama_options,
        )
        if not isinstance(result, dict):
            # Non-streaming chat should always return a dict
            raise RuntimeError("Unexpected async iterator from non-streaming chat")
        msg = result.get("message", {})
        tool_calls = msg.get("tool_calls", [])
        content = msg.get("content", "")
        if not (tool_calls and tool_call_count < max_tool_calls):
            last_response = content
            break
        tool_call_count += 1
        # Add assistant message with tool calls
        current_messages.append(
            {
                "role": "assistant",
                "content": content,
                "tool_calls": tool_calls,
            }
        )
        # Execute each tool and add results
        for tc in tool_calls:
            assert tool_adapter is not None
            tool_result = await tool_adapter.execute_tool_call(
                tc["function"]["name"],
                tc["function"]["arguments"],
                {},
            )
            tool_details.append(
                {
                    "name": tc["function"]["name"],
                    "arguments": tc["function"]["arguments"],
                    "result": tool_result,
                }
            )
            current_messages.append(
                {
                    "role": "tool",
                    "tool_name": tc["function"]["name"],
                    "content": tool_result,
                }
            )
    return {
        "response": last_response,
        "model": model,
        "tool_calls": tool_call_count,
        "tool_details": tool_details,
    }


# ---------------------------------------------------------------------------
# Ollama chat / generate
# ---------------------------------------------------------------------------
@router.post("/ollama/chat")
async def ollama_chat(body: OllamaChatRequest) -> Any:
    """
    Chat with Ollama or Atomic Chat using the /api/chat endpoint with tool calling support.
    When ``atomic_chat_enabled`` is true, routes through Atomic Chat (Qwen) instead of Ollama (gemma4).
    """
    # Choose the adapter based on the Atomic Chat feature flag.
    # Atomic Chat (Qwen) and Ollama (gemma4) are separate adapters in separate files.
    using_atomic_chat = False
    if config.atomic_chat_enabled:
        adapter = adapter_registry.get("atomic-chat")
        if not adapter or adapter.get_status() in (AdapterStatus.ERROR, AdapterStatus.OFFLINE):
            # Atomic Chat not available or unhealthy — fall back to Ollama
            adapter = adapter_registry.get("ollama")
        else:
            using_atomic_chat = True
    else:
        adapter = adapter_registry.get("ollama")
    if not adapter:
        raise HTTPException(status_code=404, detail="No LLM adapter available")
    # Tool execution is handled by OllamaAdapter regardless of which LLM
    # serves the chat (scene manipulation, system info, etc. are backend
    # operations independent of the chat model).
    tool_adapter = adapter_registry.get("ollama")
    message = body.message
    # Ollama needs an explicit default model (gemma4:e2b-it-qat); Atomic Chat
    # discovers the resident model from /v1/models.
    if using_atomic_chat:
        model = body.model
    else:
        model = body.model or config.default_model
    history = body.history or []
    think = body.think
    stream = body.stream
    max_tool_calls = body.max_tool_calls
    ollama_options = body.options or {}
    system_prompt = body.system
    # Track activity for this model
    adapter.set_activity(model or config.default_model, "chat", message[:80])
    # Normalize tools: can be boolean (True/False) or list
    tools_raw = body.tools if body.tools is not None else []
    if tools_raw is True:
        tools = adapter.get_tool_definitions() if adapter else []
    elif tools_raw is False or tools_raw is None:
        tools = []
    else:
        tools = tools_raw
    # If no Ollama adapter is available for tool execution, disable tools
    if tool_adapter is None:
        tools = []
    # Small local models are much more reliable when the request names one
    # tool. Keep the full registry for ambiguous requests, but narrow a
    # prompt such as "call get_project_structure" to that single callable.
    if tools and any(
        tool.get("function", {}).get("name", "").lower() in message.lower()
        for tool in tools
        if isinstance(tool, dict)
    ):
        named = [
            tool
            for tool in tools
            if isinstance(tool, dict)
            and tool.get("function", {}).get("name", "").lower() in message.lower()
        ]
        if len(named) == 1:
            tools = named
    logger.info(
        "Ollama chat request: model=%s, stream=%s, tools=%d, message_len=%d, system_len=%d, options=%s",
        model,
        stream,
        len(tools),
        len(message),
        len(system_prompt or ""),
        ollama_options,
    )
    # Build messages array (system first, then history, then user)
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    elif tools:
        # Small local models are far more reliable when the request names
        # the callable tools explicitly. List every tool we are about to
        # send so the model knows what it can call. Without this, a vague
        # prompt plus several tools makes the model think for hundreds of
        # tokens and emit nothing (measured on Ollama 0.40.2 /
        # gemma4:e2b-it-qat: 351 thinking chunks, zero content, no call).
        tool_list = "\n".join(
            f"- {t.get('function', {}).get('name', '')}: {t.get('function', {}).get('description', '')}"
            for t in tools
            if isinstance(t, dict)
        )
        messages.append(
            {
                "role": "system",
                "content": (
                    "You have callable tools. Available tools:\n"
                    + tool_list
                    + "\n\nIf the user's request requires data from a tool, call "
                    "that tool now. Respond by calling the tool, not by describing "
                    "it. Do not invent results; wait for the tool result before "
                    "answering."
                ),
            }
        )
    for h in history:
        # Support system role in history as well
        role = h.get("role", "user")
        if role not in ("user", "assistant", "system", "tool"):
            role = "user"
        msg: dict[str, Any] = {"role": role, "content": h.get("content", "")}
        if "tool_calls" in h:
            msg["tool_calls"] = h["tool_calls"]
        messages.append(msg)
    messages.append({"role": "user", "content": message})
    try:
        if stream:
            # Streaming response with SSE
            async def event_generator():
                try:
                    # Send initial event to confirm connection
                    yield {"event": "connected", "data": json.dumps({"status": "streaming"})}
                    async for ev in _stream_chat_events(
                        adapter,
                        messages,
                        model,
                        tools,
                        think,
                        ollama_options,
                        max_tool_calls,
                        tool_adapter,
                        message,
                    ):
                        yield ev
                finally:
                    adapter.clear_activity(model or config.default_model)

            return EventSourceResponse(event_generator())
        else:
            # Non-streaming response with agent loop
            result = await _run_nonstream_chat(
                adapter,
                messages,
                model,
                tools,
                think,
                ollama_options,
                max_tool_calls,
                tool_adapter,
            )
            adapter.clear_activity(model or config.default_model)
            return result
    except Exception as e:
        adapter.clear_activity(model or config.default_model)
        logger.error("Ollama chat error: %s", str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/ollama/generate")
async def ollama_generate(body: OllamaGenerateRequest) -> dict:
    """Generate text using Ollama (legacy endpoint)"""
    adapter = adapter_registry.get("ollama")
    if not adapter:
        raise HTTPException(status_code=404, detail="Ollama not available")
    try:
        result = await adapter.generate({"prompt": body.prompt, "model": body.model})
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


# ---------------------------------------------------------------------------
# Ollama scene state
# ---------------------------------------------------------------------------
@router.get("/ollama/scene-state")
async def get_scene_state() -> dict:
    """Get the current AI-generated scene state."""
    adapter = adapter_registry.get("ollama")
    if not adapter:
        raise HTTPException(status_code=404, detail="Ollama not available")
    return adapter._scene_state  # type: ignore[reportAttributeAccessIssue]


@router.post("/ollama/scene-clear")
async def clear_scene() -> dict:
    """Clear the AI-generated scene state."""
    adapter = adapter_registry.get("ollama")
    if not adapter:
        raise HTTPException(status_code=404, detail="Ollama not available")
    adapter._scene_state = {  # type: ignore[reportAttributeAccessIssue]
        "objects": [],
        "lights": [],
        "particles": {"count": 300, "color": "#8b5cf6", "speed": 0.5},
        "camera": "orbit",
        "bloom": 0.8,
        "duration": 30,
        "keyframes": [],
    }
    return {"status": "cleared"}


# ---------------------------------------------------------------------------
# Ollama tools / LLM loop
# ---------------------------------------------------------------------------
@router.get("/ollama/tools")
async def list_ollama_tools() -> dict:
    """Return the built-in tool definitions from the Ollama adapter."""
    try:
        adapter = adapter_registry.get("ollama")
        if not adapter:
            return {"tools": []}
        return {"tools": adapter.get_tool_definitions()}
    except Exception as e:
        logger.error("Failed to list Ollama tools: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/ollama/loop")
async def run_llm_loop_endpoint(body: LLMLoopRequest) -> dict:
    """Run the LLM tool-calling loop with file-inventory grounding.

    At loop start, calls ``audio_list()`` and ``media_list()`` once and
    injects the results into the system prompt so the model never invents
    paths. Enforces tool ordering:
    ``music_gen_status`` before ``music_gen_generate``;
    ``remix_preview`` before ``remix_build``.
    """
    adapter = adapter_registry.get("ollama")
    if not adapter:
        raise HTTPException(status_code=404, detail="Ollama not available")

    tools = adapter.get_tool_definitions()

    async def execute_tool(name: str, args: dict[str, Any]) -> dict[str, Any]:
        from ..services.llm_loop import audio_list as _al
        from ..services.llm_loop import media_list as _ml

        if name == "audio_list":
            return {"files": _al()}
        if name == "media_list":
            return {"files": _ml()}
        return {
            "ok": False,
            "error": f"Tool {name!r} not implemented in loop executor",
        }

    try:
        result = await run_llm_loop(
            adapter=adapter,
            system_prompt=body.system_prompt,
            user_message=body.user_message,
            tools=tools,
            model=body.model,
            max_iterations=body.max_iterations,
            execute_tool=execute_tool,
        )
        return result
    except Exception as e:
        logger.error("LLM loop error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e)) from e


# ---------------------------------------------------------------------------
# Benchmark Endpoints
# ---------------------------------------------------------------------------
@router.get("/ollama/benchmark/results")
async def get_benchmark_results() -> dict:
    """Get cached Ollama Three.js scene benchmark results."""
    try:
        from tools.scripts.ollama_benchmark import get_all_results

        return get_all_results()
    except Exception as e:
        logger.error("Failed to load benchmark results: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/ollama/benchmark/run")
async def run_benchmark(body: dict | None = None) -> dict:
    """Run Ollama Three.js scene benchmark and return results."""
    adapter = adapter_registry.get("ollama")
    if not adapter:
        raise HTTPException(status_code=404, detail="Ollama not available")
    try:
        from tools.scripts.ollama_benchmark import run_benchmark

        models = None
        max_models = 8
        if body:
            if isinstance(body, dict):
                models = body.get("models")
                if models and isinstance(models, list):
                    models = [str(m) for m in models if str(m).strip()]
                max_models = int(body.get("max_models", max_models))
        results = await run_benchmark(models=models, adapter=adapter, max_models=max_models)
        return results
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Benchmark run failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/ollama/benchmark/best")
async def get_best_benchmark() -> dict:
    """Get the best model from cached Ollama Three.js scene benchmarks."""
    try:
        from tools.scripts.ollama_benchmark import get_all_results, get_best_model

        data = get_all_results()
        best = get_best_model()
        return {
            "best": best,
            "result": data.get("results", {}).get(best) if best else None,
            "results": data,
        }
    except Exception as e:
        logger.error("Failed to get best benchmark model: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/ollama/coding-benchmark/results")
async def get_coding_benchmark_results() -> dict:
    """Get cached coding benchmark results."""
    try:
        from tools.scripts.coding_benchmark import get_all_results

        return get_all_results()
    except Exception as e:
        logger.error("Failed to load coding benchmark results: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/ollama/coding-benchmark/run")
async def run_coding_benchmark(body: dict | None = None) -> dict:
    """Run coding benchmark and return results."""
    adapter = adapter_registry.get("ollama")
    if not adapter:
        raise HTTPException(status_code=404, detail="Ollama not available")
    try:
        from tools.scripts.coding_benchmark import run_benchmark

        models = None
        max_models = 12
        quick = False
        num_ctx = None
        if body:
            if isinstance(body, dict):
                models = body.get("models")
                if models and isinstance(models, list):
                    models = [str(m) for m in models if str(m).strip()]
                max_models = int(body.get("max_models", max_models))
                quick = bool(body.get("quick", quick))
                num_ctx = body.get("num_ctx")
                if num_ctx is not None:
                    num_ctx = int(num_ctx)
        results = await run_benchmark(
            models=models, adapter=adapter, max_models=max_models, quick=quick, num_ctx=num_ctx
        )
        return results
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Coding benchmark run failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/ollama/coding-benchmark/best")
async def get_best_coding_benchmark() -> dict:
    """Get the best model from cached coding benchmarks."""
    try:
        from tools.scripts.coding_benchmark import get_all_results, get_best_model

        data = get_all_results()
        best = get_best_model()
        return {
            "best": best,
            "result": data.get("results", {}).get(best) if best else None,
            "results": data,
        }
    except Exception as e:
        logger.error("Failed to get best coding benchmark model: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e)) from e

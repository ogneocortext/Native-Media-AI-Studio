"""Live characterisation tests for the Ollama adapter.

These talk to a real Ollama server, so they skip automatically when none is
running (``NMA_OLLAMA_TESTS=1`` requires one, ``NMA_OLLAMA_URL`` repoints it).
They exist because the adapter had **no** coverage, and because what it depends
on are server behaviours rather than code behaviours:

  * with ``think=False`` the ``thinking`` key is **absent**, not empty;
  * ``tool_calls[].function.arguments`` is a **dict**, not a JSON string, which
    is what ``execute_tool_call``'s ``**arguments`` relies on;
  * an unknown model is HTTP 404 with ``{"error": ...}``;
  * an empty ``messages`` list is HTTP 200, *not* an error.

Pinning the last one matters: an empty conversation looks like success, so a
caller trusting `done` will happily persist nothing.

The model is chosen once per session and reused, because the first call pays a
model load - measured at 52 s here versus 0.7 s warm.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import urllib.request

import pytest

sys.path.insert(0, os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..")))

OLLAMA_URL = os.environ.get("NMA_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
FORCE = os.environ.get("NMA_OLLAMA_TESTS") == "1"


def _ollama_reachable() -> bool:
    try:
        with urllib.request.urlopen(f"{OLLAMA_URL}/api/version", timeout=3) as r:
            return r.status == 200
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not (FORCE or _ollama_reachable()),
    reason=f"no Ollama at {OLLAMA_URL} (set NMA_OLLAMA_TESTS=1 to require it)",
)


_ADAPTERS: list = []


def _adapter():
    """A fresh adapter, tracked so the autouse fixture can close its session."""
    from app.adapters.ollama import OllamaAdapter

    a = OllamaAdapter(base_url=OLLAMA_URL)
    _ADAPTERS.append(a)
    return a


def _post(payload: dict, timeout: float = 120.0) -> dict:
    """POST JSON to the live server and return the parsed body."""
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _smallest_local_model() -> str | None:
    """Cheapest local text model, so the suite stays quick.

    Cloud models are excluded: they report size 0 and return HTTP 402 without a
    paid key, which would measure the network rather than the adapter.
    """
    try:
        with urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=10) as r:
            models = json.loads(r.read().decode("utf-8")).get("models", [])
    except Exception:
        return None
    local = [
        m for m in models
        if "embed" not in m.get("name", "")
        and ":cloud" not in m.get("name", "")
        and int(m.get("size", 0)) > 0
    ]
    if not local:
        return None
    return min(local, key=lambda m: int(m.get("size", 0)))["name"]


@pytest.fixture(scope="module")
def model() -> str:
    name = _smallest_local_model()
    if not name:
        pytest.skip("no local Ollama model available")
    return name


@pytest.fixture(autouse=True)
def _close_adapters():
    """Close each adapter's aiohttp session after the test.

    `_adapter()` is a fresh instance per call and each opens a `ClientSession`
    on first use. Without this, aiohttp logs "Unclosed connector" at
    interpreter shutdown - a genuine handle leak in the test, not in the
    adapter (which does expose `close()`).
    """
    yield
    created = list(_ADAPTERS)
    _ADAPTERS.clear()
    for adapter in created:
        asyncio.run(adapter.close())


def test_health_check_true_against_live_server():
    assert asyncio.run(_adapter().health_check()) is True


def test_chat_without_think_omits_the_thinking_key(model):
    """`think=False` removes the key entirely.

    A caller doing `msg["thinking"]` would raise; the adapter and frontend both
    use `.get(...)`, which is why this is worth pinning.
    """
    result = asyncio.run(
        _adapter().chat(
            messages=[{"role": "user", "content": "Reply with exactly: OK"}],
            model=model,
            think=False,
            num_predict=16,
        )
    )
    assert "message" in result
    msg = result["message"]
    assert isinstance(msg.get("content"), str)
    assert "thinking" not in msg, (
        "with think=False the server omits 'thinking'; a caller using [] would break"
    )
    assert msg.get("thinking", "") == ""


def test_chat_returns_done_and_counters(model):
    result = asyncio.run(
        _adapter().chat(
            messages=[{"role": "user", "content": "Reply with exactly: OK"}],
            model=model,
            think=False,
            num_predict=16,
        )
    )
    assert result.get("done") is True
    # eval_count is what the "last inference took N" display reads.
    assert isinstance(result.get("eval_count"), int)


def test_unknown_model_raises_runtime_error(model):
    """A bad model must raise, not return an empty result that looks like success.

    `_chat_request` raises `RuntimeError(f"Ollama error: {error}")` on a non-200,
    so the type is pinned rather than catching a blind `Exception`.
    """
    with pytest.raises(RuntimeError, match="Ollama error"):
        asyncio.run(
            _adapter().chat(
                messages=[{"role": "user", "content": "hi"}],
                model="definitely-not-a-real-model",
                think=False,
            )
        )


def test_empty_messages_is_accepted_by_the_server(model):
    """Characterisation: an empty conversation is HTTP 200, not an error.

    It looks like success and yields nothing, so a caller must not treat `done`
    alone as proof of a usable answer. Pinned so a change here is noticed.
    """
    body = _post({"model": model, "messages": [], "stream": False, "think": False})
    assert body.get("message", {}).get("content", "") == ""


def test_tool_call_arguments_arrive_as_a_dict(model):
    """`execute_tool_call` does `**arguments`, which requires a dict.

    If a server ever returned a JSON *string* here, every tool call would raise
    TypeError. This pins the shape the adapter depends on.
    """
    body = _post({
        "model": model,
        "messages": [{"role": "user", "content": "What is 2+2? Use the calculator."}],
        "stream": False,
        "think": False,
        "tools": [{
            "type": "function",
            "function": {
                "name": "calculator",
                "description": "Evaluate arithmetic",
                "parameters": {
                    "type": "object",
                    "properties": {"expression": {"type": "string"}},
                    "required": ["expression"],
                },
            },
        }],
        "options": {"num_predict": 48},
    })
    calls = body.get("message", {}).get("tool_calls")
    if not calls:
        pytest.skip("model declined to call the tool; shape not observable")
    fn = calls[0]["function"]
    assert isinstance(fn["arguments"], dict), (
        "execute_tool_call uses **arguments, which breaks on a JSON string"
    )
    # Splattable is the real contract, not merely "is a dict".
    def _sink(**kwargs):
        return kwargs

    assert _sink(**fn["arguments"]) == fn["arguments"]


def test_execute_tool_call_splats_arguments():
    """The built-in calculator path proves `**arguments` works end to end."""
    out = asyncio.run(
        _adapter().execute_tool_call("calculator", {"expression": "2+2"}, {})
    )
    assert out is not None


def test_unknown_tool_returns_a_marker_string_not_an_exception():
    """Characterisation: an unknown tool does NOT raise.

    `execute_tool_call` ends with `return f"Unknown tool: {tool_name}"`, so a
    caller that never checks the result will feed that sentence back to the model
    as a successful tool result. My first version of this test asserted a raise,
    which was the test being wrong about the contract rather than the code
    disagreeing. Pinned so a future change to raising is noticed.
    """
    out = asyncio.run(_adapter().execute_tool_call("no_such_tool", {}, {}))
    assert isinstance(out, str)
    assert out.startswith("Unknown tool")


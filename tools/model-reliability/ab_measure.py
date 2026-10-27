#!/usr/bin/env python3
"""T-MOD-01: Atomic Chat vs Ollama A/B measurement.

Runs the same prompt set cold on both engines (Qwen3.5-4B):
- cold-load-to-first-token (streaming time to first token)
- total wall time
- model load time (from engine timing where available)

Results appended to tools/model-reliability/observed.jsonl
"""
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime

OLLAMA_URL = "http://127.0.0.1:11434"
ATOMIC_URL = "http://127.0.0.1:1337"

PROMPT = (
    "Write a two-paragraph product description for a retro-futuristic "
    "turntable that plays both vinyl and holographic memory crystals. "
    "Tone: warm, slightly melancholic, evocative. Max 150 words."
)

OBSERVED_PATH = "tools/model-reliability/observed.jsonl"


def now_ms():
    return time.perf_counter() * 1000


def stream_ollama(model, prompt):
    """Ollama native /api/chat with streaming.
    Returns (first_token_ms, total_ms, load_ms, text, error).
    """
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": True,
        "options": {"num_predict": 200, "temperature": 0.7},
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/chat",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    start = now_ms()
    first_token = None
    chunks = []
    load_ms = None

    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            for raw_line in resp:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if chunk.get("load_duration") is not None:
                    load_ms = chunk["load_duration"] / 1_000_000  # ns -> ms
                msg = chunk.get("message", {})
                content = msg.get("content", "")
                thinking = msg.get("thinking", "")
                if (content or thinking) and first_token is None:
                    first_token = now_ms() - start
                if content:
                    chunks.append(content)
                if chunk.get("done"):
                    break
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return None, None, None, f"HTTP {e.code}: {body}", ""
    except Exception as e:  # noqa: BLE001
        return None, None, None, f"{type(e).__name__}: {e}", ""

    total = now_ms() - start
    return first_token, total, load_ms, None, "".join(chunks)


def stream_atomic(model, prompt):
    """Atomic Chat OpenAI-compatible /v1/chat/completions streaming."""
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": True,
        "max_tokens": 200,
        "temperature": 0.7,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{ATOMIC_URL}/v1/chat/completions",
        data=data,
        headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
        method="POST",
    )

    start = now_ms()
    first_token = None
    chunks = []

    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            for raw_line in resp:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line.startswith("data:"):
                    continue
                data_str = line[5:].strip()
                if data_str == "[DONE]":
                    break
                try:
                    chunk = json.loads(data_str)
                except json.JSONDecodeError:
                    continue
                delta = chunk.get("choices", [{}])[0].get("delta", {})
                content = delta.get("content", "")
                reasoning = delta.get("reasoning_content", "")
                if (content or reasoning) and first_token is None:
                    first_token = now_ms() - start
                if content:
                    chunks.append(content)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return None, None, None, f"HTTP {e.code}: {body}", ""
    except Exception as e:  # noqa: BLE001
        return None, None, None, f"{type(e).__name__}: {e}", ""

    total = now_ms() - start
    return first_token, total, None, None, "".join(chunks)


def try_unload_ollama(model):
    """Best-effort: tell Ollama to unload the model after this request."""
    try:
        payload = {"model": model, "keep_alive": 0}
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{OLLAMA_URL}/api/generate",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=10)
    except Exception:  # noqa: BLE001
        pass


def main():
    results = []

    for engine_name, fn, model in [
        ("Ollama", stream_ollama, "qwen3.5:4b"),
        ("Atomic Chat", stream_atomic, "unsloth/Qwen3_5-4B-GGUF-Qwen3_5-4B-Q4_K_M"),
    ]:
        print(f"\n=== {engine_name} ({model}) ===", flush=True)

        # Best-effort unload for cold start
        if engine_name == "Ollama":
            try_unload_ollama(model)
        time.sleep(2)

        first_token_ms, total_ms, load_ms, error, text = fn(model, PROMPT)

        print(f"  First token: {first_token_ms:.0f} ms" if first_token_ms else "  First token: N/A (error)", flush=True)
        print(f"  Total: {total_ms:.0f} ms" if total_ms else "  Total: N/A (error)", flush=True)
        if load_ms:
            print(f"  Model load: {load_ms:.0f} ms", flush=True)
        print(f"  Response: {text[:120]!r}..." if isinstance(text, str) and len(text) > 120 else f"  Response: {text!r}", flush=True)

        results.append({
            "engine": engine_name,
            "model": model,
            "first_token_ms": first_token_ms,
            "total_ms": total_ms,
            "load_ms": load_ms,
            "response_preview": text[:200] if isinstance(text, str) else str(text),
            "error": error,
        })

    # Append to observed.jsonl
    timestamp = datetime.now(UTC).strftime("%Y-%m-%d")
    entries = []
    for r in results:
        worked = r["first_token_ms"] is not None
        detail = (
            f"{r['engine']}: first_token={r['first_token_ms']}ms "
            f"total={r['total_ms']}ms load={r['load_ms'] or 'n/a'}ms "
            f"{r['error'] or ''}"
        )
        entry = {
            "date": timestamp,
            "model": r["model"],
            "route": r["engine"].lower().replace(" ", "_"),
            "worked": worked,
            "note": f"A/B measurement vs {{'Ollama': 'ollama', 'Atomic Chat': 'atomic_chat'}}[{r['engine']}]: {detail}",
        }
        entries.append(entry)

    with open(OBSERVED_PATH, "a", encoding="utf-8") as f:
        for entry in entries:
            f.write(json.dumps(entry) + "\n")

    print(f"\nAppended {len(entries)} entries to {OBSERVED_PATH}", flush=True)
    return 0 if all(r["first_token_ms"] is not None for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())

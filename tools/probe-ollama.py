#!/usr/bin/env python3
"""Probe a live Ollama server and record what it actually does.

Characterisation needs observed behaviour, not documented behaviour. This
queries the running server for the facts a test should pin: version, model
inventory, the `think` field's presence and type across models, the tool-call
shape, and whether a malformed body produces an error or empty output.

Read-only apart from short inference calls. Point it at any Ollama with
`--url`; it never mutates anything.

Usage::

    python tools/probe-ollama.py
    python tools/probe-ollama.py --url http://127.0.0.1:11434 --fast
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request


def post(url: str, payload: dict, timeout: float) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get(url: str, timeout: float) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--url", default="http://127.0.0.1:11434")
    ap.add_argument("--model", default=None, help="model to probe (default: smallest text model)")
    ap.add_argument("--timeout", type=float, default=120.0)
    ap.add_argument("--fast", action="store_true", help="skip tool-call probing")
    args = ap.parse_args()

    base = args.url.rstrip("/")
    print(f"ollama: {base}")

    version = get(f"{base}/api/version", 10)
    print(f"version: {version}")

    tags = get(f"{base}/api/tags", 15)
    models = tags.get("models", [])
    print(f"models: {len(models)}")
    for m in models:
        det = m.get("details", {})
        print(
            f"  {m.get('name',''):34} {round(m.get('size',0)/1048576):>6} MB "
            f"{det.get('parameter_size','?'):>6} {det.get('quantization_level','?')}"
        )

    # Smallest loaded model is the cheapest thing to get a real answer from.
    def size_of(name: str) -> int:
        for m in models:
            if m.get("name") == name:
                return int(m.get("size", 0))
        return 1 << 62

    if args.model:
        model = args.model
    else:
        candidates = [
            m.get("name", "") for m in models
            if "embed" not in m.get("name", "")
            and ":cloud" not in m.get("name", "")
            and int(m.get("size", 0)) > 0
        ]
        cloud = [m for m in models if ":cloud" in m.get("name", "")]
        if cloud:
            print(f"\nnote: skipping {len(cloud)} cloud model(s) - they need a paid key (HTTP 402)")
        if not candidates:
            print("no local model available; pass --model explicitly")
            return 1
        model = min(candidates, key=size_of)
    print(f"probing with: {model}")

    t0 = time.perf_counter()
    resp = post(
        f"{base}/api/chat",
        {
            "model": model,
            "messages": [{"role": "user", "content": "Reply with exactly: OK"}],
            "stream": False,
            "think": False,
            "options": {"num_predict": 16},
        },
        args.timeout,
    )
    elapsed = time.perf_counter() - t0

    msg = resp.get("message", {})
    print(f"chat think=false: {elapsed:.1f}s")
    print(f"  top-level keys : {sorted(resp)}")
    print(f"  message keys   : {sorted(msg)}")
    print(f"  content        : {msg.get('content', '')[:60]!r}")
    print(f"  thinking       : {msg.get('thinking', '<absent>')!r}")
    print(f"  has tool_calls : {'tool_calls' in msg}")
    print(f"  done_reason    : {resp.get('done_reason', '<absent>')!r}")
    print(f"  eval_count     : {resp.get('eval_count', '<absent>')!r}")

    if not args.fast:
        t0 = time.perf_counter()
        tooled = post(
            f"{base}/api/chat",
            {
                "model": model,
                "messages": [{"role": "user", "content": "What is 2+2? Use the calculator."}],
                "stream": False,
                "think": False,
                "tools": [
                    {
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
                    }
                ],
                "options": {"num_predict": 48},
            },
            args.timeout,
        )
        elapsed = time.perf_counter() - t0
        tmsg = tooled.get("message", {})
        calls = tmsg.get("tool_calls")
        print(f"\nchat with tools: {elapsed:.1f}s")
        print(f"  tool_calls type : {type(calls).__name__}")
        if calls:
            print(f"  first call keys : {sorted(calls[0])}")
            fn = calls[0].get("function", {})
            print(f"  function keys   : {sorted(fn)}")
            print(f"  arguments type  : {type(fn.get('arguments')).__name__}")

    # Error shapes the adapters must survive.
    print("\nerror handling:")
    for label, payload in (
        ("nonexistent model", {"model": "definitely-not-a-model", "messages": [{"role": "user", "content": "hi"}], "stream": False}),
        ("empty messages", {"model": model, "messages": [], "stream": False}),
    ):
        try:
            r = post(f"{base}/api/chat", payload, args.timeout)
            print(f"  {label:18} -> HTTP 200, keys={sorted(r)}")
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:100]
            print(f"  {label:18} -> HTTP {e.code} {body}")
        except Exception as e:  # pragma: no cover - reported
            print(f"  {label:18} -> {type(e).__name__}: {e}")

    return 0


if __name__ == "__main__":
    sys.exit(main())

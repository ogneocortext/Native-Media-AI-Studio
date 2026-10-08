#!/usr/bin/env python3
"""Test every local Ollama model through the live stack and measure performance.

Paths exercised
---------------
1. Direct Ollama `/api/chat` (basic prompt, think=False)
2. Direct Ollama `/api/generate` (single-turn prompt)
3. Vision pipeline (`node tools/vision/analyze.mjs`) for vision-capable models
4. Structured-output path (`/api/chat` with JSON schema) — what plan_blender_script uses

Optimizations over the original sequential runner
-----------------------------------------------
* PROJECT_ROOT is derived from this file's location (no hardcoded path).
* Models are deduped by name (Ollama's /api/tags lists one entry per digest).
* CLI filters: --only / --exclude / --routes / --quick / --concurrency.
* Live progress with elapsed time and a running ETA on stderr.
* Results persist to JSON (--out); --resume skips model/route pairs that
  already passed, so re-runs after a failure are incremental.
* Optional thread pool (default 1 = sequential; Ollama serializes GPU work
  anyway, but overlapping HTTP/model-load latency helps on multi-GPU rigs).

Output: JSON to stdout, one object per tested route.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

BASE = "http://127.0.0.1:11434"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
TEST_IMAGE = PROJECT_ROOT / "output" / "test-vision-input.png"
VISION_SCRIPT = PROJECT_ROOT / "tools" / "vision" / "analyze.mjs"
NODE = shutil.which("node") or "node"

ALL_ROUTES = ("chat", "generate", "structured", "vision")

MODEL_TIMEOUT_OVERRIDES: dict[str, float] = {
    "ornith-1.5:9b": 600.0,
}


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class ModelResult:
    model: str
    route: str
    ok: bool
    elapsed_s: float = 0.0
    tokens: int | None = None
    tokens_per_sec: float | None = None
    error: str | None = None
    details: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Ollama helpers
# ---------------------------------------------------------------------------

def get_models() -> list[dict[str, Any]]:
    with urllib.request.urlopen(f"{BASE}/api/tags", timeout=15) as r:
        data = json.loads(r.read())
    seen: dict[str, dict[str, Any]] = {}
    for m in data.get("models", []):
        if _is_remote(m):
            continue
        # /api/tags returns one entry per digest; keep the first per name.
        seen.setdefault(m["name"], m)
    return list(seen.values())


def _is_remote(m: dict) -> bool:
    if m.get("remote_host") or m.get("remote_model"):
        return True
    return str(m.get("name", "")).endswith(":cloud")


def _post(url: str, payload: dict, timeout: float = 120) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


# ---------------------------------------------------------------------------
# Route 1: /api/chat basic
# ---------------------------------------------------------------------------

def test_chat(model: str, timeout: float = 120, quick: bool = False) -> ModelResult:
    t0 = time.perf_counter()
    try:
        resp = _post(
            f"{BASE}/api/chat",
            {
                "model": model,
                "messages": [{"role": "user", "content": "Reply with exactly: OK"}],
                "stream": False,
                "think": False,
                "options": {"num_predict": max(16, 32 if quick else 64)},
            },
            timeout,
        )
        elapsed = time.perf_counter() - t0
        msg = resp.get("message", {})
        content = msg.get("content", "")
        thinking = msg.get("thinking", "")
        eval_count = resp.get("eval_count")
        eval_duration = resp.get("eval_duration") or resp.get("total_duration", 0)
        tps = None
        if eval_count and eval_duration and eval_duration > 0:
            tps = eval_count / (eval_duration / 1e9)
        return ModelResult(
            model=model,
            route="chat-basic",
            ok=bool(content.strip() or thinking.strip()),
            elapsed_s=round(elapsed, 2),
            tokens=eval_count,
            tokens_per_sec=round(tps, 2) if tps else None,
            details={
                "content_preview": content[:60],
                "thinking_present": bool(thinking),
                "done_reason": resp.get("done_reason"),
            },
        )
    except Exception as e:
        return ModelResult(model=model, route="chat-basic", ok=False,
                           elapsed_s=round(time.perf_counter() - t0, 2),
                           error=str(e))


# ---------------------------------------------------------------------------
# Route 2: /api/generate
# ---------------------------------------------------------------------------

def test_generate(model: str, timeout: float = 120, quick: bool = False) -> ModelResult:
    t0 = time.perf_counter()
    try:
        resp = _post(
            f"{BASE}/api/generate",
            {
                "model": model,
                "prompt": "Reply with exactly: OK",
                "stream": False,
                "options": {"num_predict": max(16, 32 if quick else 64)},
            },
            timeout,
        )
        elapsed = time.perf_counter() - t0
        content = resp.get("response", "")
        thinking = resp.get("thinking", "")
        eval_count = resp.get("eval_count")
        eval_duration = resp.get("eval_duration") or resp.get("total_duration", 0)
        tps = None
        if eval_count and eval_duration and eval_duration > 0:
            tps = eval_count / (eval_duration / 1e9)
        return ModelResult(
            model=model,
            route="generate",
            ok=bool(content.strip() or thinking.strip()),
            elapsed_s=round(elapsed, 2),
            tokens=eval_count,
            tokens_per_sec=round(tps, 2) if tps else None,
            details={"content_preview": content[:60], "thinking_present": bool(thinking), "done_reason": resp.get("done_reason")},
        )
    except Exception as e:
        return ModelResult(model=model, route="generate", ok=False,
                           elapsed_s=round(time.perf_counter() - t0, 2),
                           error=str(e))


# ---------------------------------------------------------------------------
# Route 3: Structured output (JSON schema) — what plan_blender_script uses
# ---------------------------------------------------------------------------

def test_structured(model: str, timeout: float = 180, quick: bool = False) -> ModelResult:
    schema = {
        "type": "object",
        "properties": {
            "status": {"type": "string"},
            "value": {"type": "number"},
        },
        "required": ["status", "value"],
    }
    t0 = time.perf_counter()
    try:
        resp = _post(
            f"{BASE}/api/chat",
            {
                "model": model,
                "messages": [
                    {"role": "system", "content": "Return only valid JSON matching the schema."},
                    {"role": "user", "content": "Return {\"status\": \"ok\", \"value\": 42}"},
                ],
                "stream": False,
                "think": False,
                "format": schema,
                "options": {"num_predict": max(32, 64 if quick else 128), "temperature": 0},
            },
            timeout,
        )
        elapsed = time.perf_counter() - t0
        content = resp.get("message", {}).get("content", "")
        thinking = resp.get("message", {}).get("thinking", "")
        eval_count = resp.get("eval_count")
        eval_duration = resp.get("eval_duration") or resp.get("total_duration", 0)
        tps = None
        if eval_count and eval_duration and eval_duration > 0:
            tps = eval_count / (eval_duration / 1e9)
        parsed = None
        try:
            parsed = json.loads(content)
        except Exception:
            import re
            m = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', content)
            if m:
                try:
                    parsed = json.loads(m.group())
                except Exception:
                    pass
        ok = isinstance(parsed, dict) and "status" in parsed and "value" in parsed
        return ModelResult(
            model=model,
            route="structured-output",
            ok=ok,
            elapsed_s=round(elapsed, 2),
            tokens=eval_count,
            tokens_per_sec=round(tps, 2) if tps else None,
            details={
                "content_preview": content[:120],
                "thinking_present": bool(thinking),
                "parsed": parsed,
                "done_reason": resp.get("done_reason"),
            },
        )
    except Exception as e:
        return ModelResult(model=model, route="structured-output", ok=False,
                           elapsed_s=round(time.perf_counter() - t0, 2),
                           error=str(e))


# ---------------------------------------------------------------------------
# Route 4: Vision pipeline
# ---------------------------------------------------------------------------

def test_vision(model: str, image: Path, timeout: float = 300, quick: bool = False) -> ModelResult:
    t0 = time.perf_counter()
    try:
        proc = subprocess.run(
            [
                NODE,
                str(VISION_SCRIPT),
                str(image),
                "Describe this image in one sentence.",
                "--backend", "ollama",
                "--model", model,
                "--json",
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=timeout,
            cwd=str(PROJECT_ROOT),
        )
        elapsed = time.perf_counter() - t0
        stdout = proc.stdout.strip()
        stderr = proc.stderr.strip()
        parsed = None
        error = None
        if stdout:
            try:
                parsed = json.loads(stdout)
            except Exception:
                error = f"non-json stdout: {stdout[:200]}"
        elif stderr:
            if "Ollama" in stderr or "error" in stderr.lower():
                error = stderr[-300:]
            else:
                error = f"empty stdout; stderr tail: {stderr[-200:]}"
        else:
            error = "no output at all"
        ok = bool(parsed and parsed.get("analysis", "").strip())
        return ModelResult(
            model=model,
            route="vision-pipeline",
            ok=ok,
            elapsed_s=round(elapsed, 2),
            error=error,
            details={
                "analysis_preview": (parsed.get("analysis", "")[:120] if parsed else ""),
                "backend": parsed.get("backend") if parsed else None,
                "fallback_used": parsed.get("fallback_used") if parsed else None,
                "returncode": proc.returncode,
            },
        )
    except subprocess.TimeoutExpired:
        return ModelResult(model=model, route="vision-pipeline", ok=False,
                           elapsed_s=round(time.perf_counter() - t0, 2),
                           error="timeout")
    except Exception as e:
        return ModelResult(model=model, route="vision-pipeline", ok=False,
                           elapsed_s=round(time.perf_counter() - t0, 2),
                           error=str(e))


# ---------------------------------------------------------------------------
# Progress reporter (thread-safe)
# ---------------------------------------------------------------------------

class Progress:
    def __init__(self, total: int) -> None:
        self.total = total
        self.done = 0
        self.t0 = time.perf_counter()
        self._lock = threading.Lock()

    def report(self, label: str, result: ModelResult) -> None:
        with self._lock:
            self.done += 1
            elapsed = time.perf_counter() - self.t0
            rate = self.done / elapsed if elapsed > 0 else 0
            eta = (self.total - self.done) / rate if rate > 0 else 0
            status = "OK " if result.ok else "FAIL"
            detail = f" {result.elapsed_s:.1f}s"
            if result.error:
                detail += f" err={result.error[:60]}"
            print(
                f"  [{self.done}/{self.total}] {status} {label}{detail}"
                f"  (elapsed {elapsed:.0f}s, ETA {eta:.0f}s)",
                file=sys.stderr,
                flush=True,
            )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--only", help="comma-separated model name substrings to include")
    p.add_argument("--exclude", help="comma-separated model name substrings to skip")
    p.add_argument("--routes", default=",".join(ALL_ROUTES),
                   help=f"comma-separated subset of {ALL_ROUTES} (default: all)")
    p.add_argument("--quick", action="store_true",
                   help="fewer tokens, shorter timeouts (smoke test)")
    p.add_argument("--concurrency", type=int, default=1,
                   help="parallel test threads (default 1; Ollama serializes GPU work)")
    p.add_argument("--out", default=str(PROJECT_ROOT / "output" / "ollama-model-test.json"),
                   help="where to persist the JSON results")
    p.add_argument("--resume", action="store_true",
                   help="skip model/route pairs that already passed in --out")
    p.add_argument("--vision-image", default=str(TEST_IMAGE),
                   help="image used for the vision route")
    return p.parse_args(argv)


def _filter_models(models: list[dict[str, Any]], args: argparse.Namespace) -> list[dict[str, Any]]:
    only = [s.strip().lower() for s in args.only.split(",")] if args.only else []
    exclude = [s.strip().lower() for s in args.exclude.split(",")] if args.exclude else []
    filtered = []
    for m in models:
        name = m["name"].lower()
        if only and not any(s in name for s in only):
            continue
        if any(s in name for s in exclude):
            continue
        # Skip models that have no completion capability for text routes.
        caps = [c.lower() for c in m.get("capabilities", [])]
        if "completion" not in caps:
            continue
        filtered.append(m)
    return filtered


def _load_prior(path: Path) -> dict[str, bool]:
    if not path.exists():
        return {}
    try:
        prior = json.loads(path.read_text(encoding="utf-8"))
        return {f"{r['model']}|{r['route']}": bool(r.get("ok")) for r in prior}
    except Exception:
        return {}


def main() -> int:
    args = parse_args(sys.argv[1:])
    routes = [r.strip() for r in args.routes.split(",") if r.strip()]
    unknown = [r for r in routes if r not in ALL_ROUTES]
    if unknown:
        print(f"unknown routes: {unknown} (valid: {ALL_ROUTES})", file=sys.stderr)
        return 2

    models = _filter_models(get_models(), args)
    if not models:
        print("no models matched the filters", file=sys.stderr)
        return 2

    vision_models = [m["name"] for m in models if "vision" in m.get("capabilities", [])]
    print(f"Testing {len(models)} local models "
          f"({len(vision_models)} vision-capable), routes={routes}, "
          f"concurrency={args.concurrency}, quick={args.quick}", file=sys.stderr)

    out_path = Path(args.out)
    prior = _load_prior(out_path) if args.resume else {}

    # Build the work list: (label, callable)
    work: list[tuple[str, Any]] = []
    for m in models:
        name = m["name"]
        chat_timeout = MODEL_TIMEOUT_OVERRIDES.get(name, 180 if args.quick else 240)
        generate_timeout = MODEL_TIMEOUT_OVERRIDES.get(name, 180 if args.quick else 240)
        structured_timeout = MODEL_TIMEOUT_OVERRIDES.get(name, 240 if args.quick else 360)
        if "chat" in routes and not prior.get(f"{name}|chat-basic"):
            work.append((f"chat-basic:{name}", lambda n=name: test_chat(n, chat_timeout, args.quick)))
        if "generate" in routes and not prior.get(f"{name}|generate"):
            work.append((f"generate:{name}", lambda n=name: test_generate(n, generate_timeout, args.quick)))
        if "structured" in routes and not prior.get(f"{name}|structured-output"):
            work.append((f"structured:{name}", lambda n=name: test_structured(n, structured_timeout, args.quick)))

    image = Path(args.vision_image)
    if "vision" in routes:
        if not image.exists():
            print(f"WARNING: test image {image} not found, skipping vision tests", file=sys.stderr)
        else:
            for name in vision_models:
                if prior.get(f"{name}|vision-pipeline"):
                    continue
                work.append((f"vision:{name}", lambda n=name: test_vision(n, image, 120 if args.quick else 300, args.quick)))

    if not work:
        print("nothing to do (all selected pairs already passed with --resume)", file=sys.stderr)
        return 0

    progress = Progress(len(work))
    results: list[dict[str, Any]] = []
    results_lock = threading.Lock()

    def run_one(label: str, fn) -> None:
        result = fn()
        progress.report(label, result)
        with results_lock:
            results.append(_result_to_dict(result))

    if args.concurrency > 1:
        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            futures = [pool.submit(run_one, label, fn) for label, fn in work]
            for fut in as_completed(futures):
                fut.result()  # surface exceptions
    else:
        for label, fn in work:
            run_one(label, fn)

    # Merge with prior results when resuming so --out stays complete:
    # keep prior passing entries, add/overwrite with the fresh results.
    if args.resume and prior:
        by_key = {f"{r['model']}|{r['route']}": r for r in results}
        prior_entries = _load_prior_entries(out_path)
        results = [r for k, r in prior_entries.items() if k not in by_key] + results

    # --- Summary ---
    failures = [r for r in results if not r["ok"]]
    print(f"\n=== SUMMARY ===", file=sys.stderr)
    print(f"Total tests: {len(results)}", file=sys.stderr)
    print(f"Passed: {sum(1 for r in results if r['ok'])}", file=sys.stderr)
    print(f"Failed: {len(failures)}", file=sys.stderr)

    if failures:
        print(f"\n=== FAILURES ===", file=sys.stderr)
        for f in failures:
            print(f"  {f['model']} / {f['route']}: {f.get('error', 'unknown')}", file=sys.stderr)

    ok_results = [r for r in results if r["ok"] and r.get("tokens_per_sec")]
    if ok_results:
        print(f"\n=== PERFORMANCE (tok/s, successful runs) ===", file=sys.stderr)
        by_model: dict[str, list[float]] = {}
        for r in ok_results:
            by_model.setdefault(r["model"], []).append(r["tokens_per_sec"])
        for model, rates in sorted(by_model.items()):
            avg = sum(rates) / len(rates)
            print(f"  {model:40} avg {avg:6.1f} tok/s ({len(rates)} runs)", file=sys.stderr)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"\nResults written to {out_path}", file=sys.stderr)

    json.dump(results, sys.stdout, indent=2)
    print()
    return 1 if failures else 0


def _load_prior_entries(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    try:
        entries = json.loads(path.read_text(encoding="utf-8"))
        return {f"{r['model']}|{r['route']}": r for r in entries}
    except Exception:
        return {}


def _result_to_dict(r: ModelResult) -> dict[str, Any]:
    return {
        "model": r.model,
        "route": r.route,
        "ok": r.ok,
        "elapsed_s": r.elapsed_s,
        "tokens": r.tokens,
        "tokens_per_sec": r.tokens_per_sec,
        "error": r.error,
        "details": r.details,
    }


if __name__ == "__main__":
    sys.exit(main())

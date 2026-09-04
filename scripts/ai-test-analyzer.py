#!/usr/bin/env python3
"""AI test failure analyzer using local Ollama models.

When pytest fails, this script reads the failure output, sends it to Ollama,
and gets a structured diagnosis + suggested fix.

Usage:
    python scripts/ai-test-analyzer.py --pytest-output /path/to/pytest_output.txt
    python scripts/ai-test-analyzer.py --last-failure
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    import urllib.request
    import urllib.error
except ImportError:
    print("urllib not available", file=sys.stderr)
    sys.exit(1)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_ROOT = PROJECT_ROOT / "packages" / "backend"
DEFAULT_MODEL = os.getenv("OLLAMA_TEST_MODEL", "qwen2.5:7b")
OLLAMA_BASE = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")


def run_pytest_capture(args: list[str]) -> tuple[int, str, str]:
    """Run pytest and capture stdout/stderr."""
    result = subprocess.run(
        [sys.executable, "-m", "pytest"] + args,
        cwd=str(BACKEND_ROOT),
        capture_output=True,
        text=True,
        timeout=300,
    )
    return result.returncode, result.stdout, result.stderr


def ollama_analyze(failure_text: str, model: str = DEFAULT_MODEL) -> str | None:
    """Send failure text to Ollama and get analysis."""
    # Truncate very long output to stay within context limits
    max_chars = 12000
    if len(failure_text) > max_chars:
        failure_text = failure_text[-max_chars:] + "\n...[truncated]..."

    prompt = f"""You are a senior Python engineer and QA specialist.
A pytest test suite failed. Analyze the failure output below and provide:

1. ROOT CAUSE: What is the most likely cause of the failure?
2. AFFECTED CODE: Which files/functions are likely involved?
3. SUGGESTED FIX: Concrete code changes to fix the issue.
4. PREVENTION: How to add a regression test so this doesn't happen again.

Be specific and actionable. Reference exact function names, line numbers, and error messages.

FAILURE OUTPUT:
{failure_text}
"""

    url = f"{OLLAMA_BASE}/api/generate"
    payload = json.dumps({
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.2, "num_predict": 2048},
    }).encode("utf-8")

    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result.get("response", "").strip()
    except Exception as e:
        print(f"Ollama request failed: {e}", file=sys.stderr)
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description="AI test failure analyzer")
    parser.add_argument("--pytest-output", type=str, help="Path to a file containing pytest output")
    parser.add_argument("--last-failure", action="store_true", help="Run pytest and analyze the last failure")
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL, help="Ollama model")
    parser.add_argument("--pytest-args", nargs="*", default=["tests/"], help="pytest arguments")
    args = parser.parse_args()

    if args.pytest_output:
        failure_text = Path(args.pytest_output).read_text(encoding="utf-8")
    elif args.last_failure:
        print(f"Running pytest: pytest {' '.join(args.pytest_args)}")
        returncode, stdout, stderr = run_pytest_capture(args.pytest_args)
        combined = stdout + "\n" + stderr
        if returncode == 0:
            print("All tests passed — nothing to analyze.")
            return 0
        failure_text = combined
        # Also save for inspection
        tmp = Path(tempfile.gettempdir()) / "pytest_last_failure.txt"
        tmp.write_text(failure_text, encoding="utf-8")
        print(f"Failure output saved to {tmp}")
    else:
        print("Provide --pytest-output or --last-failure", file=sys.stderr)
        return 1

    print(f"Analyzing failure with model={args.model}...")
    analysis = ollama_analyze(failure_text, model=args.model)
    if analysis:
        print("\n" + "=" * 60)
        print("AI ANALYSIS:")
        print("=" * 60)
        print(analysis)
        print("=" * 60)
        return 0
    else:
        print("Failed to get analysis from Ollama.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

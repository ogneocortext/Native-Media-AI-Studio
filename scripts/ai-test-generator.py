#!/usr/bin/env python3
"""AI-powered test generation using local Ollama models.

Scans backend source files, identifies untested branches and edge cases,
and uses Ollama to generate pytest test cases for uncovered paths.

Usage:
    python scripts/ai-test-generator.py [--dry-run] [--model gemma4:e2b-it-qat] [--path app/api/jobs.py]
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import sys
from pathlib import Path
from typing import Any

try:
    import urllib.request
    import urllib.error
except ImportError:
    print("urllib not available; cannot call Ollama", file=sys.stderr)
    sys.exit(1)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_ROOT = PROJECT_ROOT / "packages" / "backend"
DEFAULT_MODEL = os.getenv("OLLAMA_TEST_MODEL", "gemma4:e2b-it-qat")
OLLAMA_BASE = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")


def resolve_path(path_str: str) -> Path:
    """Resolve a user-provided path to an absolute path under BACKEND_ROOT."""
    p = Path(path_str)
    if p.is_absolute():
        return p
    # Try relative to project root first, then relative to cwd
    candidates = [PROJECT_ROOT / p, Path.cwd() / p]
    for cand in candidates:
        try:
            return cand.resolve()
        except Exception:
            continue
    return (PROJECT_ROOT / p).resolve()


def find_backend_files() -> list[Path]:
    """Return all Python source files in the backend app directory."""
    return sorted((BACKEND_ROOT / "app").rglob("*.py"))


def load_existing_tests() -> set[str]:
    """Load names of existing test files to avoid duplicates."""
    test_dir = BACKEND_ROOT / "tests"
    if not test_dir.exists():
        return set()
    return {f.stem for f in test_dir.glob("test_*.py")}


def parse_functions(filepath: Path) -> list[dict[str, Any]]:
    """Extract function/method definitions from a Python file using AST."""
    try:
        source = filepath.read_text(encoding="utf-8")
        tree = ast.parse(source)
    except Exception as e:
        print(f"  [skip] {filepath}: {e}", file=sys.stderr)
        return []

    functions: list[dict[str, Any]] = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            # Skip private helpers and test files
            if node.name.startswith("_") and node.name != "__init__":
                continue
            lineno = node.lineno
            # Extract docstring if present
            docstring = ast.get_docstring(node) or ""
            # Extract decorators
            decorators = []
            for dec in node.decorator_list:
                try:
                    decorators.append(ast.unparse(dec))
                except Exception:
                    pass
            # Determine if async
            is_async = isinstance(node, ast.AsyncFunctionDef)
            # Count branches: if/elif/else, for, while, try/except, with
            branches = 0
            for child in ast.walk(node):
                if isinstance(child, (ast.If, ast.For, ast.While, ast.Try)):
                    branches += 1
                elif isinstance(child, ast.ExceptHandler):
                    branches += 1

            functions.append({
                "name": node.name,
                "lineno": lineno,
                "is_async": is_async,
                "decorators": decorators,
                "docstring": docstring.strip()[:200],
                "branches": branches,
                "args": [arg.arg for arg in node.args.args],
            })
    return functions


def ollama_generate(prompt: str, model: str = DEFAULT_MODEL, timeout: int = 240) -> str | None:
    """Call local Ollama model and return the generated text."""
    url = f"{OLLAMA_BASE}/api/generate"
    payload = json.dumps({
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.2,
            "num_predict": 8192,
        },
        "keep_alive": "5m",
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result.get("response", "").strip()
    except urllib.error.URLError as e:
        print(f"  [ollama error] {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  [ollama unexpected] {e}", file=sys.stderr)
        return None


def save_generated_test(filepath: Path, content: str, dry_run: bool = False) -> Path | None:
    """Save generated test content to the tests directory."""
    test_name = f"test_ai_generated_{filepath.stem}.py"
    out_path = BACKEND_ROOT / "tests" / test_name
    if out_path.exists() and not dry_run:
        print(f"  [skip] {out_path} already exists", file=sys.stderr)
        return None
    if dry_run:
        print(f"  [dry-run] would write {out_path}")
        return out_path
    out_path.write_text(content, encoding="utf-8")
    print(f"  [wrote] {out_path}")
    return out_path


def run_pytest_on_file(test_path: Path) -> bool:
    """Run pytest on a single generated test file to verify it passes."""
    import subprocess
    result = subprocess.run(
        [sys.executable, "-m", "pytest", str(test_path), "-v", "--tb=short", "-x"],
        cwd=str(BACKEND_ROOT),
        capture_output=True,
        text=True,
        timeout=120,
    )
    passed = result.returncode == 0
    if passed:
        print(f"  [pytest] PASSED {test_path.name}")
    else:
        print(f"  [pytest] FAILED {test_path.name}")
        if result.stdout:
            print(result.stdout[-2000:])
        if result.stderr:
            print(result.stderr[-1000:])
    return passed


def validate_generated_test(code: str) -> bool:
    """Validate generated test code via AST and basic completeness checks.
    
    Returns True if the code looks like a complete, parseable pytest file.
    Rejects truncated or syntactically invalid output before it is written.
    """
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        print(f"  [validate] syntax error: {e}", file=sys.stderr)
        return False

    # Must contain at least one test function
    test_functions = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name.startswith("test_")
    ]
    if not test_functions:
        print("  [validate] no test_ functions found", file=sys.stderr)
        return False

    # Reject obviously truncated functions: empty body or single Pass only
    for fn in test_functions:
        body = fn.body
        if not body:
            print(f"  [validate] empty test function: {fn.name}", file=sys.stderr)
            return False
        # A single `pass` is acceptable, but nothing else is suspicious
        if len(body) == 1 and isinstance(body[0], ast.Pass):
            continue

    # Reject files with unmatched parentheses/brackets as a quick heuristic
    if code.count("(") != code.count(")"):
        print("  [validate] unmatched parentheses", file=sys.stderr)
        return False
    if code.count("[") != code.count("]"):
        print("  [validate] unmatched brackets", file=sys.stderr)
        return False
    if code.count("{") != code.count("}"):
        print("  [validate] unmatched braces", file=sys.stderr)
        return False

    return True


def process_file(filepath: Path, model: str, dry_run: bool = False, verify: bool = False) -> bool:
    """Process a single source file: extract functions, generate tests, optionally verify."""
    # Compute path relative to BACKEND_ROOT for display/prompt purposes
    try:
        rel_path = filepath.relative_to(BACKEND_ROOT)
    except ValueError:
        rel_path = filepath.name
    print(f"\n[analyze] {rel_path}")
    functions = parse_functions(filepath)
    if not functions:
        print("  [skip] no functions found")
        return False

    # Focus on functions with branches (more likely to have untested paths)
    branch_functions = [f for f in functions if f["branches"] > 0]
    if not branch_functions:
        print("  [skip] no branched functions")
        return False

    print(f"  [found] {len(functions)} functions, {len(branch_functions)} with branches")
    existing_tests = load_existing_tests()
    prompt = build_prompt_for(filepath, rel_path, branch_functions, existing_tests)

    print(f"  [ollama] querying {model}...")
    response = ollama_generate(prompt, model=model)
    if not response:
        print("  [ollama] no response", file=sys.stderr)
        return False

    # Extract Python code from response (strip markdown fences if present)
    code = response.strip()
    if "```python" in code:
        code = code.split("```python", 1)[1].split("```", 1)[0].strip()
    elif "```" in code:
        code = code.split("```", 1)[1].split("```", 1)[0].strip()

    if not code or "def test_" not in code:
        print("  [skip] no test code in response", file=sys.stderr)
        print("  [debug] raw response preview:\n" + response[:1200], file=sys.stderr)
        return False

    if not validate_generated_test(code):
        print("  [skip] generated code failed AST validation", file=sys.stderr)
        # Print first 1200 chars of extracted code to aid prompt tuning
        print("  [debug] extracted code preview:\n" + code[:1200], file=sys.stderr)
        return False

    out_path = save_generated_test(filepath, code, dry_run=dry_run)
    if not out_path or dry_run:
        return False

    if verify:
        print(f"  [pytest] verifying {out_path.name}...")
        return run_pytest_on_file(out_path)
    return True


def build_prompt_for(filepath: Path, rel_path: Path, functions: list[dict[str, Any]], existing_tests: set[str]) -> str:
    """Build a prompt asking Ollama to generate tests for uncovered paths."""
    existing_test_hint = ", ".join(sorted(existing_tests)) if existing_tests else "none"

    func_descriptions = []
    for fn in functions:
        async_tag = "async " if fn["is_async"] else ""
        decorators = ", ".join(fn["decorators"]) if fn["decorators"] else ""
        dec_tag = f" @{decorators}" if decorators else ""
        args = ", ".join(fn["args"])
        doc = fn["docstring"][:120] if fn["docstring"] else "no docstring"
        func_descriptions.append(
            f"- {async_tag}def {fn['name']}({args}) [line {fn['lineno']}, branches={fn['branches']}]: {doc}{dec_tag}"
        )

    prompt = f"""You are a senior Python QA engineer. Generate pytest tests for the following backend module.

Module: {rel_path}
Existing test files: {existing_test_hint}

Functions/methods in this module:
{chr(10).join(func_descriptions)}

Requirements:
- Generate tests that cover edge cases, error paths, and branch conditions not yet covered.
- Use the async test fixtures from conftest.py (client, temp_db, mock_adapter_registry, make_job, queue_manager_instance, sse_manager_instance, connection_manager_instance).
- Use pytest-asyncio for async tests.
- Import the FastAPI app from app.main: app.
- Use AsyncClient(transport=ASGITransport(app=app), base_url="http://test") for HTTP tests.
- Focus on hidden issues: race conditions, missing error handling, boundary values, concurrent access, state leaks.
- Do NOT duplicate existing test patterns from test_queue.py, test_health.py, etc.
- Output ONLY valid Python code. No markdown, no explanations.

Generate a new test file named test_ai_generated_{filepath.stem}.py with exactly 1 complete, focused test function.
The test must be fully self-contained and end cleanly.
IMPORTANT: Complete every test function fully. Do not truncate code mid-function. Do not leave unclosed strings or brackets.
"""
    return prompt


def main() -> int:
    parser = argparse.ArgumentParser(description="AI test generator using Ollama")
    parser.add_argument("--path", type=str, default=None, help="Specific file to analyze")
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL, help="Ollama model name")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be generated without writing")
    parser.add_argument("--verify", action="store_true", help="Run pytest on generated tests")
    parser.add_argument("--all", action="store_true", help="Process all backend source files")
    args = parser.parse_args()

    if args.path:
        files = [resolve_path(args.path)]
    elif args.all:
        files = find_backend_files()
    else:
        # Default: focus on high-value targets with complex logic
        default_targets = [
            "app/api/jobs.py",
            "app/queue/manager.py",
            "app/queue/processor.py",
            "app/sse/handler.py",
            "app/websocket/handler.py",
            "app/diagnostics/health.py",
            "app/diagnostics/resources.py",
            "app/services/comfyui_manager.py",
            "app/adapters/registry.py",
        ]
        files = [BACKEND_ROOT / rel for rel in default_targets if (BACKEND_ROOT / rel).exists()]

    if not files:
        print("No files to process.", file=sys.stderr)
        return 1

    print(f"Ollama test generator — model={args.model} verify={args.verify} dry_run={args.dry_run}")
    print(f"Processing {len(files)} file(s)")

    results: list[tuple[Path, bool]] = []
    for filepath in files:
        if not filepath.exists():
            print(f"  [skip] {filepath} not found")
            continue
        ok = process_file(filepath, model=args.model, dry_run=args.dry_run, verify=args.verify)
        results.append((filepath, ok))

    print("\n" + "=" * 60)
    print("Summary:")
    for fp, ok in results:
        status = "OK" if ok else "FAIL"
        print(f"  {status:4s} {fp.relative_to(BACKEND_ROOT)}")

    # If verify mode, run full suite at the end
    if args.verify and not args.dry_run:
        print("\n[pytest] running full backend suite...")
        import subprocess
        result = subprocess.run(
            [sys.executable, "-m", "pytest", "tests/", "-v", "--tb=short"],
            cwd=str(BACKEND_ROOT),
            capture_output=True,
            text=True,
            timeout=300,
        )
        print(result.stdout[-3000:])
        if result.stderr:
            print(result.stderr[-1000:])
        return result.returncode

    return 0


if __name__ == "__main__":
    sys.exit(main())

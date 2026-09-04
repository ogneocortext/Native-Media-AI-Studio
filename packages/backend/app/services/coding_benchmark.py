"""
Coding Model Benchmark Service.

Runs a standardized suite of coding tasks against each available Ollama model:
1. Python code generation with strict requirements
2. Tool use / structured output (JSON function calling)
3. Pytest test generation for a target function
4. Edge case identification and test authoring

Results are stored to output/coding-benchmarks.json for harness selection.

Scoring is deterministic and cheap (AST + regex + JSON parse), so benchmarks
can be re-run without GPU-heavy execution.
"""

from __future__ import annotations

import ast
import json
import re
import time
import logging
import subprocess
import tempfile
import asyncio
from pathlib import Path
from datetime import datetime, timezone
from typing import Any

from ..core.config import PROJECT_ROOT

logger = logging.getLogger(__name__)

BENCHMARK_FILE = PROJECT_ROOT / "output" / "coding-benchmarks.json"

# ---------------------------------------------------------------------------
# Task definitions
# ---------------------------------------------------------------------------

TASK_CODE_GENERATION = {
    "name": "python_code_generation",
    "weight": 30,
    "system": (
        "You are a senior Python engineer. Output ONLY valid Python code. "
        "No markdown fences, no explanations, no comments beyond docstrings."
    ),
    "user": """Write a function `validate_email(email: str | None) -> bool` that:
- Returns False for None, empty string, or non-string input
- Uses a compiled regex pattern for RFC 5322-like validation
- Has a proper docstring
- Uses type hints
- Handles leading/trailing whitespace by stripping
- Is fully self-contained in one function

Output ONLY the function definition. No extra text.""",
    "validator": "code_generation",
}

TASK_TOOL_USE = {
    "name": "tool_use_structured",
    "weight": 25,
    "system": (
        "You are a function-calling assistant. Output ONLY a valid JSON object. "
        "No markdown fences, no explanations, no extra text."
    ),
    "user": """Call the `search_files` tool with these arguments:
- pattern: "*.py"
- path: "/app"
- recursive: true
- max_results: 20

Output ONLY the JSON tool call object:
{
  "tool": "search_files",
  "arguments": { ... }
}""",
    "validator": "tool_use",
}

TASK_TEST_GENERATION = {
    "name": "pytest_generation",
    "weight": 30,
    "system": (
        "You are a senior Python QA engineer. Generate pytest tests for the given function. "
        "Output ONLY valid Python code. No markdown fences, no explanations."
    ),
    "user": """Generate pytest tests for this function:

def divide(a: float, b: float) -> float:
    \"\"\"Divide a by b. Raises ZeroDivisionError if b is 0.\"\"\"
    if b == 0:
        raise ZeroDivisionError("division by zero")
    return a / b

Requirements:
- Use pytest (not unittest)
- Test normal case, zero division, and at least one edge case
- Include descriptive test function names starting with test_
- Output ONLY the test code. No markdown, no explanations.""",
    "validator": "test_generation",
}

TASK_EDGE_CASES = {
    "name": "edge_case_identification",
    "weight": 15,
    "system": (
        "You are a senior Python QA engineer. Analyze the code for edge cases and bugs, "
        "then generate pytest tests for them. Output ONLY valid Python code. "
        "No markdown fences, no explanations."
    ),
    "user": """Analyze this function for edge cases and hidden bugs, then generate pytest tests:

def get_user_badge(username: str, score: int) -> str:
    if score > 1000:
        return "gold"
    elif score > 500:
        return "silver"
    elif score > 0:
        return "bronze"
    else:
        return "none"

Requirements:
- Identify at least 3 edge cases or bugs (boundary values, type issues, logic gaps)
- Write one test function per edge case
- Use pytest assertions
- Output ONLY the test code. No markdown, no explanations.""",
    "validator": "edge_cases",
}

# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def _validate_code_generation(code: str) -> dict[str, Any]:
    details = []
    score = 0
    max_score = 100

    # Must define the function with exact name
    if re.search(r"def\s+validate_email\s*\(", code):
        score += 15
        details.append({"rule": "has_function", "passed": True, "weight": 15})
    else:
        details.append({"rule": "has_function", "passed": False, "weight": 15})

    # Type hints
    if "-> bool" in code and "str" in code and "None" in code:
        score += 15
        details.append({"rule": "has_type_hints", "passed": True, "weight": 15})
    else:
        details.append({"rule": "has_type_hints", "passed": False, "weight": 15})

    # Docstring
    if '"""' in code or "'''" in code:
        score += 10
        details.append({"rule": "has_docstring", "passed": True, "weight": 10})
    else:
        details.append({"rule": "has_docstring", "passed": False, "weight": 10})

    # Regex usage
    if "re." in code or "import re" in code:
        score += 15
        details.append({"rule": "uses_regex", "passed": True, "weight": 15})
    else:
        details.append({"rule": "uses_regex", "passed": False, "weight": 15})

    # None handling
    if "None" in code and ("if" in code or "return False" in code):
        score += 15
        details.append({"rule": "handles_none", "passed": True, "weight": 15})
    else:
        details.append({"rule": "handles_none", "passed": False, "weight": 15})

    # Strip whitespace
    if "strip()" in code:
        score += 10
        details.append({"rule": "strips_whitespace", "passed": True, "weight": 10})
    else:
        details.append({"rule": "strips_whitespace", "passed": False, "weight": 10})

    # Syntax valid
    try:
        ast.parse(code)
        score += 20
        details.append({"rule": "valid_syntax", "passed": True, "weight": 20})
    except SyntaxError:
        details.append({"rule": "valid_syntax", "passed": False, "weight": 20})

    # Reasonable length
    lines = len(code.strip().splitlines())
    if 3 <= lines <= 30:
        score += 0  # no penalty
        details.append({"rule": "reasonable_length", "passed": True, "weight": 0})
    else:
        details.append({"rule": "reasonable_length", "passed": False, "weight": 0})

    passed = sum(1 for d in details if d["passed"])
    return {
        "score": min(score, max_score),
        "raw_score": score,
        "max_score": max_score,
        "passed_rules": passed,
        "total_rules": len(details),
        "details": details,
        "metrics": {"lines": lines, "chars": len(code)},
    }


def _validate_tool_use(text: str) -> dict[str, Any]:
    details = []
    score = 0
    max_score = 100

    # Extract JSON from response
    code = text.strip()
    if code.startswith("```"):
        code = re.sub(r"^```(?:json)?\s*", "", code)
        code = re.sub(r"\s*```$", "", code)

    try:
        obj = json.loads(code)
    except json.JSONDecodeError:
        # Try to find JSON object in text
        m = re.search(r"\{.*\}", code, re.DOTALL)
        if m:
            try:
                obj = json.loads(m.group(0))
            except json.JSONDecodeError:
                obj = None
        else:
            obj = None

    if obj is None:
        return {
            "score": 0,
            "raw_score": 0,
            "max_score": max_score,
            "passed_rules": 0,
            "total_rules": 4,
            "details": [
                {"rule": "valid_json", "passed": False, "weight": 25},
                {"rule": "has_tool_key", "passed": False, "weight": 25},
                {"rule": "has_arguments_key", "passed": False, "weight": 25},
                {"rule": "correct_tool_name", "passed": False, "weight": 25},
            ],
            "metrics": {"parseable": False},
        }

    # Valid JSON object
    score += 25
    details.append({"rule": "valid_json", "passed": True, "weight": 25})

    # Has 'tool' key
    if isinstance(obj, dict) and "tool" in obj:
        score += 25
        details.append({"rule": "has_tool_key", "passed": True, "weight": 25})
    else:
        details.append({"rule": "has_tool_key", "passed": False, "weight": 25})

    # Has 'arguments' key
    if isinstance(obj, dict) and "arguments" in obj and isinstance(obj["arguments"], dict):
        score += 25
        details.append({"rule": "has_arguments_key", "passed": True, "weight": 25})
    else:
        details.append({"rule": "has_arguments_key", "passed": False, "weight": 25})

    # Correct tool name
    if isinstance(obj, dict) and obj.get("tool") == "search_files":
        score += 25
        details.append({"rule": "correct_tool_name", "passed": True, "weight": 25})
    else:
        details.append({"rule": "correct_tool_name", "passed": False, "weight": 25})

    passed = sum(1 for d in details if d["passed"])
    return {
        "score": score,
        "raw_score": score,
        "max_score": max_score,
        "passed_rules": passed,
        "total_rules": len(details),
        "details": details,
        "metrics": {"parseable": True, "tool": obj.get("tool") if isinstance(obj, dict) else None},
    }


def _validate_test_generation(code: str) -> dict[str, Any]:
    details = []
    score = 0
    max_score = 100

    # Must be valid Python
    try:
        tree = ast.parse(code)
        score += 20
        details.append({"rule": "valid_syntax", "passed": True, "weight": 20})
    except SyntaxError:
        details.append({"rule": "valid_syntax", "passed": False, "weight": 20})
        return {
            "score": 0,
            "raw_score": 0,
            "max_score": max_score,
            "passed_rules": 0,
            "total_rules": 6,
            "details": details,
            "metrics": {"lines": len(code.splitlines()), "test_functions": 0},
        }

    # Must have test functions
    test_fns = [
        n for n in ast.walk(tree)
        if isinstance(n, ast.FunctionDef) and n.name.startswith("test_")
    ]
    if test_fns:
        score += 20
        details.append({"rule": "has_test_functions", "passed": True, "weight": 20})
    else:
        details.append({"rule": "has_test_functions", "passed": False, "weight": 20})

    # Must import pytest
    has_pytest_import = any(
        isinstance(n, ast.Import) and any(m.name == "pytest" for m in n.names)
        for n in ast.walk(tree)
    ) or any(
        isinstance(n, ast.ImportFrom) and n.module == "pytest"
        for n in ast.walk(tree)
    )
    if has_pytest_import:
        score += 15
        details.append({"rule": "imports_pytest", "passed": True, "weight": 15})
    else:
        details.append({"rule": "imports_pytest", "passed": False, "weight": 15})

    # Must test zero division
    if "ZeroDivisionError" in code or "zero" in code.lower():
        score += 20
        details.append({"rule": "tests_zero_division", "passed": True, "weight": 20})
    else:
        details.append({"rule": "tests_zero_division", "passed": False, "weight": 20})

    # Must test normal case
    if "divide(" in code and "2" in code and "1" in code:
        score += 15
        details.append({"rule": "tests_normal_case", "passed": True, "weight": 15})
    else:
        details.append({"rule": "tests_normal_case", "passed": False, "weight": 15})

    # Must have at least 2 test functions
    if len(test_fns) >= 2:
        score += 10
        details.append({"rule": "multiple_tests", "passed": True, "weight": 10})
    else:
        details.append({"rule": "multiple_tests", "passed": False, "weight": 10})

    # Bonus: uses pytest.raises
    if "pytest.raises" in code:
        score += 10
        details.append({"rule": "uses_pytest_raises", "passed": True, "weight": 10})
    else:
        details.append({"rule": "uses_pytest_raises", "passed": False, "weight": 10})

    passed = sum(1 for d in details if d["passed"])
    return {
        "score": min(score, max_score),
        "raw_score": score,
        "max_score": max_score,
        "passed_rules": passed,
        "total_rules": len(details),
        "details": details,
        "metrics": {
            "lines": len(code.splitlines()),
            "test_functions": len(test_fns),
        },
    }


def _validate_edge_cases(code: str) -> dict[str, Any]:
    details = []
    score = 0
    max_score = 100

    try:
        tree = ast.parse(code)
        score += 20
        details.append({"rule": "valid_syntax", "passed": True, "weight": 20})
    except SyntaxError:
        details.append({"rule": "valid_syntax", "passed": False, "weight": 20})
        return {
            "score": 0,
            "raw_score": 0,
            "max_score": max_score,
            "passed_rules": 0,
            "total_rules": 5,
            "details": details,
            "metrics": {"test_functions": 0, "edge_cases_covered": 0},
        }

    test_fns = [
        n for n in ast.walk(tree)
        if isinstance(n, ast.FunctionDef) and n.name.startswith("test_")
    ]

    # At least 3 test functions for 3+ edge cases
    if len(test_fns) >= 3:
        score += 30
        details.append({"rule": "three_plus_tests", "passed": True, "weight": 30})
    else:
        details.append({"rule": "three_plus_tests", "passed": False, "weight": 30})

    # Checks for specific edge case patterns
    code_lower = code.lower()
    edge_checks = [
        ("boundary_1001", "1001" in code, "Tests score > 1000 boundary"),
        ("boundary_501", "501" in code, "Tests score > 500 boundary"),
        ("boundary_0", "0" in code, "Tests score == 0 boundary"),
        ("negative_score", "-" in code and "score" in code_lower, "Tests negative score"),
        ("non_int_score", "str" in code or "type" in code_lower, "Tests non-int input"),
        ("none_username", "none" in code_lower, "Tests None username"),
    ]

    passed_edges = 0
    for name, cond, desc in edge_checks:
        if cond:
            score += 10
            passed_edges += 1
            details.append({"rule": name, "passed": True, "weight": 10})
        else:
            details.append({"rule": name, "passed": False, "weight": 10})

    # Must import pytest
    has_pytest = "pytest" in code
    if has_pytest:
        score += 0  # already implied by test functions

    passed = sum(1 for d in details if d["passed"])
    return {
        "score": min(score, max_score),
        "raw_score": score,
        "max_score": max_score,
        "passed_rules": passed,
        "total_rules": len(details),
        "details": details,
        "metrics": {
            "test_functions": len(test_fns),
            "edge_cases_covered": passed_edges,
        },
    }


VALIDATORS = {
    "code_generation": _validate_code_generation,
    "tool_use": _validate_tool_use,
    "test_generation": _validate_test_generation,
    "edge_cases": _validate_edge_cases,
}


def _validate_task(task_type: str, content: str) -> dict[str, Any]:
    validator = VALIDATORS.get(task_type)
    if validator is None:
        return {"score": 0, "raw_score": 0, "max_score": 100, "passed_rules": 0, "total_rules": 0, "details": [], "metrics": {}}
    return validator(content)


# ---------------------------------------------------------------------------
# File I/O helpers
# ---------------------------------------------------------------------------

def _load_file() -> dict[str, Any]:
    if BENCHMARK_FILE.exists():
        try:
            with open(BENCHMARK_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Failed to load coding benchmark file: {e}")
    return {"updated_at": None, "results": {}}


def _save_file(data: dict[str, Any]) -> None:
    BENCHMARK_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(BENCHMARK_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


# ---------------------------------------------------------------------------
# Core benchmark logic
# ---------------------------------------------------------------------------

def get_all_results() -> dict[str, Any]:
    return _load_file()


def get_result(model: str) -> dict[str, Any] | None:
    data = _load_file()
    return data.get("results", {}).get(model)


def get_best_model() -> str | None:
    data = _load_file()
    results = data.get("results", {})
    if not results:
        return None
    best = None
    best_score = -1
    best_latency = float("inf")
    for name, r in results.items():
        score = r.get("total_score", 0)
        latency = r.get("total_latency_ms", 999999)
        if r.get("success") is False:
            continue
        if score > best_score or (score == best_score and latency < best_latency):
            best = name
            best_score = score
            best_latency = latency
    return best

async def run_single_benchmark(model: str, adapter, task_timeout: float = 60.0, quick: bool = False, num_ctx: int | None = None) -> dict[str, Any]:
    """Run the full coding benchmark suite for a single model."""
    start = time.perf_counter()

    all_tasks = [
        TASK_CODE_GENERATION,
        TASK_TOOL_USE,
        TASK_TEST_GENERATION,
        TASK_EDGE_CASES,
    ]
    tasks = all_tasks[:2] if quick else all_tasks

    # 2026 tuning: quick mode uses a smaller context window for lower latency
    if num_ctx is None:
        num_ctx = 8192 if not quick else 4096

    task_results = []
    total_score = 0
    total_max = 0
    any_success = False

    for task in tasks:
        task_start = time.perf_counter()
        try:
            response = await asyncio.wait_for(
                adapter.chat(
                    messages=[
                        {"role": "system", "content": task["system"]},
                        {"role": "user", "content": task["user"]},
                    ],
                    model=model,
                    stream=False,
                    think=False,
                    temperature=0.2,
                    num_predict=1024,
                    keep_alive="5m",
                    num_ctx=num_ctx,
                ),
                timeout=task_timeout,
            )
            content = response.get("message", {}).get("content", "") if isinstance(response, dict) else str(response)
            validation = _validate_task(task["validator"], content)
            task_ok = bool(content and len(content.strip()) > 20 and validation["score"] >= 40)
            if task_ok:
                any_success = True
            task_results.append({
                "task": task["name"],
                "weight": task["weight"],
                "success": task_ok,
                "latency_ms": int((time.perf_counter() - task_start) * 1000),
                "validation": validation,
                "preview": content[:400],
                "error": None,
            })
            total_score += validation["score"] * (task["weight"] / 100)
            total_max += task["weight"]
        except Exception as e:
            logger.error(f"Coding benchmark task {task['name']} failed for {model}: {e}")
            task_results.append({
                "task": task["name"],
                "weight": task["weight"],
                "success": False,
                "latency_ms": int((time.perf_counter() - task_start) * 1000),
                "validation": {"score": 0, "raw_score": 0, "max_score": 100, "passed_rules": 0, "total_rules": 0, "details": [], "metrics": {}},
                "preview": "",
                "error": str(e)[:300],
            })

    total_latency_ms = int((time.perf_counter() - start) * 1000)
    normalized_score = round((total_score / total_max) * 100) if total_max else 0

    return {
        "model": model,
        "success": any_success,
        "total_score": normalized_score,
        "raw_score": total_score,
        "max_score": total_max,
        "total_latency_ms": total_latency_ms,
        "tasks": task_results,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


async def run_benchmark(models: list[str] | None, adapter, max_models: int = 12, quick: bool = False, num_ctx: int | None = None) -> dict[str, Any]:
    """Run coding benchmark for given models (or all available if None), store results."""
    if not models:
        try:
            available = await adapter.list_models()
            models = [m.get("name") for m in available if m.get("name")]
        except Exception as e:
            logger.error(f"Failed to list models for coding benchmark: {e}")
            models = []

    models = models[:max_models]

    if not models:
        return {"error": "No models available", "results": {}}

    data = _load_file()
    if "results" not in data:
        data["results"] = {}

    for model in models:
        logger.info(f"Coding benchmark: {model}...")
        result = await run_single_benchmark(model, adapter, quick=quick, num_ctx=num_ctx)
        data["results"][model] = result
        data["updated_at"] = datetime.now(timezone.utc).isoformat()
        _save_file(data)

    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    _save_file(data)
    return data

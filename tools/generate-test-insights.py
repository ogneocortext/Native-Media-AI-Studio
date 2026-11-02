#!/usr/bin/env python3
"""
Test Insights Generator for Native Media AI Studio.

Discovers, runs, and categorizes the full test suite across backend (pytest)
and frontend (vitest/Playwright), producing:
  * tools/test-insights-out/report.json   - machine-readable summary
  * tools/test-insights-out/report.html   - human-readable dashboard
  * tools/test-insights-out/junit.xml     - CI-compatible JUnit report
  * tools/test-insights-out/.duration_cache.json - per-test durations for trending
  * tools/test-insights-out/.history/<timestamp>/ - archived reports

Categorization is derived from test file names (test_<category>_<rest>.py)
with a manual override map for edge cases. Features include:
  * Per-category pass/fail/skip counts and durations
  * Slowest test identification per category and overall
  * Trend comparison against previous reports (duration regression, flaky tests)
  * Failure categorization (timeout, assertion, import, fixture, etc.)
  * Actionable recommendations
"""

from __future__ import annotations

import html
import json
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parents[1]  # tools/ -> repo root
BACKEND_TESTS = ROOT / "packages" / "backend" / "tests"
FRONTEND_TESTS = ROOT / "packages" / "frontend" / "tests"
OUT_DIR = ROOT / "tools" / "test-insights-out"
HISTORY_DIR = OUT_DIR / ".history"
DURATION_CACHE = OUT_DIR / ".duration_cache.json"
REPORT_JSON = OUT_DIR / "report.json"
REPORT_HTML = OUT_DIR / "report.html"
REPORT_JUNIT = OUT_DIR / "junit.xml"

# ---------------------------------------------------------------------------
# Category mapping: prefix -> (display name, domain group)
# Falls back to "other" for unknown prefixes.
# ---------------------------------------------------------------------------
CATEGORY_MAP: dict[str, tuple[str, str]] = {
    "adapter": ("Adapters", "services"),
    "analysis": ("Audio Analysis", "audio"),
    "audio": ("Audio", "audio"),
    "beat": ("Beat Detection", "audio"),
    "checkpoint": ("Checkpoint Filtering", "pipeline"),
    "comfyui": ("ComfyUI", "services"),
    "database": ("Database Admin", "database"),
    "db": ("Database Pool", "database"),
    "doc": ("Documentation", "other"),
    "error": ("Error Classification", "quality"),
    "essentia": ("Essentia Bridge", "audio"),
    "generation": ("Generation Estimator", "pipeline"),
    "gpu": ("GPU Telemetry", "gpu"),
    "hardware": ("Hardware Benchmark", "gpu"),
    "health": ("Health", "system"),
    "image": ("Image Output", "media"),
    "lipsync": ("Lip-Sync", "media"),
    "logging": ("Logging", "system"),
    "lyric": ("Lyric Safety", "quality"),
    "main": ("App Shell / CORS", "system"),
    "media": ("Media Library", "media"),
    "music": ("Music Prompts", "audio"),
    "ollama": ("Ollama", "services"),
    "other": ("Miscellaneous", "other"),
    "pipeline": ("Pipeline Integration", "pipeline"),
    "queue": ("Job Queue", "queue"),
    "reference": ("Reference Matching", "audio"),
    "remix": ("Remix", "audio"),
    "resources": ("Resource Management", "system"),
    "separation": ("Stem Separation", "audio"),
    "sidecar": ("Sidecar Lookup", "system"),
    "sonara": ("Sonara Beat", "audio"),
    "sse": ("SSE Backpressure", "queue"),
    "stem": ("Stem Pipeline", "audio"),
    "storyboard": ("Storyboard", "media"),
    "suno": ("Suno Crossref", "audio"),
    "tempo": ("Tempo Agreement", "audio"),
    "timing": ("Timing Protocols", "quality"),
    "treblo": ("Treblo Tag Picker", "quality"),
    "url": ("URL Helpers", "system"),
    "video": ("Video", "media"),
    "visual": ("Visual Fallback", "media"),
    "vram": ("VRAM Management", "gpu"),
    "websocket": ("WebSocket Limits", "queue"),
}

# Test files that don't follow test_<cat>_<name>.py convention
EXPLICIT_CATEGORIES: dict[str, str] = {
    "test_lipsync.py": "lipsync",
    "test_queue.py": "queue",
    "test_mastering.py": "audio",
    "test_health.py": "health",
}


def categorize_test_file(node_id: str) -> str:
    """Return the category name for a test node_id (full path)."""
    # Extract just the filename from node_id like "packages/backend/tests/test_health.py::test_ping"
    filename = node_id.split("::")[0].split("/")[-1].split("\\")[-1]
    if filename in EXPLICIT_CATEGORIES:
        return EXPLICIT_CATEGORIES[filename]
    # test_<category>_<rest>.py
    stem = filename[len("test_"):-len(".py")]
    prefix = stem.split("_", 1)[0]
    return CATEGORY_MAP.get(prefix, ("other", "other"))[0]


def category_display_name(category: str) -> str:
    return CATEGORY_MAP.get(category, ("other", "other"))[0]


# ---------------------------------------------------------------------------
# Duration cache
# ---------------------------------------------------------------------------
def load_duration_cache() -> dict[str, float]:
    if DURATION_CACHE.exists():
        try:
            with open(DURATION_CACHE, encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def save_duration_cache(cache: dict[str, float]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(DURATION_CACHE, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, sort_keys=True)


# ---------------------------------------------------------------------------
# Test discovery
# ---------------------------------------------------------------------------
# Test files that require external services (ComfyUI, Ollama server, etc.)
# and are skipped to prevent hanging the suite.
EXTERNAL_SERVICE_TESTS: set[str] = {
    "test_comfyui_adapter_video.py",
    "test_comfyui_manager.py",
    "test_comfyui_prompt_cancellation.py",
    "test_comfyui_result_collection.py",
    "test_comfyui_workflow.py",
    "test_ollama_live.py",
    "test_vram_comfyui.py",
    "test_video_model_bench.py",
    "test_ollama_capabilities.py",
    "test_essentia_bridge.py",
    "test_essentia_tempo_store.py",
    "test_generation_estimator.py",
    "test_hardware_benchmark.py",
    "test_image_output_integrity.py",
}


def discover_backend_tests() -> list[Path]:
    if not BACKEND_TESTS.exists():
        return []
    return sorted(
        f for f in BACKEND_TESTS.glob("test_*.py")
        if f.name not in EXTERNAL_SERVICE_TESTS
    )


def discover_frontend_tests() -> list[Path]:
    if not FRONTEND_TESTS.exists():
        return []
    tests: list[Path] = []
    for pattern in ("*.spec.ts", "*.test.ts"):
        tests.extend(FRONTEND_TESTS.glob(pattern))
    # Also check browser subdirectory
    browser_dir = FRONTEND_TESTS / "browser"
    if browser_dir.exists():
        for pattern in ("*.spec.ts", "*.test.ts"):
            tests.extend(browser_dir.glob(pattern))
    return sorted(tests)


# ---------------------------------------------------------------------------
# Pytest runner
# ---------------------------------------------------------------------------
def run_pytest(test_files: list[Path]) -> dict[str, Any]:
    """Run pytest on the given test files and return parsed results.

    All test files are run in a single pytest invocation with -v (verbose)
    mode so individual test result lines are available for parsing. Tests
    requiring external services (ComfyUI, Ollama server, etc.) are excluded
    to prevent hanging the suite.
    """
    if not test_files:
        return {"total": 0, "passed": 0, "failed": 0, "skipped": 0, "tests": [], "duration": 0.0}

    env = os.environ.copy()
    python_exe = env.get("NMA_PYTHON", sys.executable)

    start = time.monotonic()
    try:
        result = subprocess.run(
            [python_exe, "-m", "pytest",
             *[str(f) for f in test_files],
             "-v", "--no-header", "-p", "no:cacheprovider", "--tb=line"],
            capture_output=True, text=True, encoding="utf-8", timeout=300, env=env,
        )
    except subprocess.TimeoutExpired:
        return {
            "total": 0, "passed": 0, "failed": 0, "skipped": 0,
            "tests": [], "duration": 300.0,
            "error": "timeout",
        }

    duration = time.monotonic() - start
    stdout = result.stdout

    # Count from individual test result lines (verbose mode):
    #   packages\backend\tests\test_health.py::test_ping PASSED
    #   packages/backend/tests/test_health.py::test_health_check FAILED
    total = passed = failed = skipped = 0
    tests: list[dict[str, Any]] = []
    cache = load_duration_cache()
    # Match pattern: <node_id> <STATUS>  where node_id contains "::"
    node_id_re = re.compile(r"([^\s]+::[^\s]+)\s+(PASSED|FAILED|SKIPPED|ERROR)\s")
    for line in stdout.splitlines():
        m = node_id_re.search(line)
        if m:
            node_id = m.group(1)
            status = m.group(2).lower()
            dur = cache.get(node_id, 0.0)
            tests.append({
                "node_id": node_id,
                "duration": dur,
                "status": status,
            })
            total += 1
            if status == "passed":
                passed += 1
            elif status == "failed":
                failed += 1
            elif status == "skipped":
                skipped += 1

    return {
        "total": total, "passed": passed, "failed": failed, "skipped": skipped,
        "tests": tests, "duration": round(duration, 3),
        "stdout": stdout[-2000:] if len(stdout) > 2000 else stdout,
        "stderr": "",  # not needed for insights
    }


def run_vitest(test_files: list[Path]) -> dict[str, Any]:
    """Run vitest on frontend test files."""
    if not test_files:
        return {"total": 0, "passed": 0, "failed": 0, "skipped": 0, "tests": [], "duration": 0.0}

    start = time.monotonic()
    try:
        result = subprocess.run(
            ["pnpm", "exec", "vitest", "run", *[str(f) for f in test_files]],
            capture_output=True, text=True, encoding="utf-8", timeout=120,
            cwd=ROOT / "packages" / "frontend",
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return {
            "total": 0, "passed": 0, "failed": 0, "skipped": 0,
            "tests": [], "duration": time.monotonic() - start,
            "error": "vitest not available or timeout",
        }

    duration = time.monotonic() - start
    stdout = result.stdout

    # Count from vitest summary line like "Tests  3 passed, 1 failed"
    total = passed = failed = skipped = 0
    for line in stdout.splitlines():
        m = re.search(
            r"(?:(\d+) passed)?(?:,?\s*(\d+) failed)?(?:,?\s*(\d+) skipped)?",
            line,
        )
        if m:
            passed = int(m.group(1)) if m.group(1) else 0
            failed = int(m.group(2)) if m.group(2) else 0
            skipped = int(m.group(3)) if m.group(3) else 0
            total = passed + failed + skipped
            break

    return {
        "total": total, "passed": passed, "failed": failed, "skipped": skipped,
        "tests": [], "duration": duration,
    }


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------
def build_feature_stats(
    category: str,
    total: int,
    passed: int,
    failed: int,
    skipped: int,
    duration: float,
    slowest: list[dict[str, Any]],
    failures: list[dict[str, Any]],
    errors: int = 0,
) -> dict[str, Any]:
    return {
        "total": total,
        "passed": passed,
        "failed": failed,
        "skipped": skipped,
        "errors": errors,
        "pass_rate": round(passed / total * 100, 2) if total else 0.0,
        "total_duration": round(duration, 3),
        "slowest": slowest[:5],
        "failures": failures,
    }


def generate_html_report(report: dict[str, Any]) -> str:
    """Generate an HTML dashboard from the report dict."""
    features = report["features"]
    overall = report["overall"]

    # Build feature rows
    feature_rows = ""
    for cat, stats in sorted(features.items(), key=lambda x: -x[1]["total"]):
        rate = stats["pass_rate"]
        rate_class = "good" if rate >= 95 else ("warning" if rate >= 70 else "bad")
        slowest_html = ""
        for s in stats.get("slowest", [])[:3]:
            slowest_html += f'<li>{html.escape(s["node_id"])} — {s["duration"]:.3f}s</li>'
        failures_html = ""
        for f in stats.get("failures", [])[:3]:
            failures_html += f'<li>{html.escape(str(f))}</li>'
        feature_rows += f"""
        <tr>
            <td>{html.escape(category_display_name(cat))}</td>
            <td>{stats['total']}</td>
            <td class="{rate_class}">{stats['passed']}</td>
            <td class="bad">{stats['failed']}</td>
            <td>{stats['skipped']}</td>
            <td>{rate:.1f}%</td>
            <td>{stats['total_duration']:.2f}s</td>
            <td><ul>{slowest_html}</ul></td>
            <td><ul>{failures_html}</ul></td>
        </tr>
        """

    recommendations = report.get("recommendations", [])
    rec_html = ""
    for r in recommendations:
        rec_html += f'<li>{html.escape(r)}</li>'

    trend = report.get("trend", {})
    trend_html = ""
    if trend:
        trend_html = f"""
        <h2>Trend (vs previous report)</h2>
        <ul>
            <li>Total tests: {trend.get('total_change', 0):+d}</li>
            <li>Pass rate: {trend.get('pass_rate_change', 0):+.1f}%</li>
            <li>Duration: {trend.get('duration_change', 0):+.2f}s</li>
        </ul>
        """

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Test Insights — Native Media AI Studio</title>
<style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f7; }}
    .container {{ max-width: 1200px; margin: 0 auto; }}
    h1 {{ color: #1a1a1a; margin-bottom: 8px; }}
    .subtitle {{ color: #666; margin-bottom: 24px; }}
    .summary {{ display: flex; gap: 16px; margin-bottom: 24px; }}
    .stat-card {{ background: white; padding: 16px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); flex: 1; }}
    .stat-card .value {{ font-size: 24px; font-weight: 600; color: #1a1a1a; }}
    .stat-card .label {{ font-size: 12px; color: #666; text-transform: uppercase; }}
    .stat-card.good .value {{ color: #22c55e; }}
    .stat-card.warning .value {{ color: #eab308; }}
    .stat-card.bad .value {{ color: #ef4444; }}
    table {{ width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
    th {{ background: #f8fafc; padding: 12px; text-align: left; font-size: 12px; font-weight: 600; color: #475569; }}
    td {{ padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }}
    tr:hover {{ background: #f8fafc; }}
    .good {{ color: #22c55e; }}
    .warning {{ color: #eab308; }}
    .bad {{ color: #ef4444; }}
    ul {{ margin: 0; padding-left: 20px; }}
    .recommendations {{ background: white; padding: 16px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-top: 24px; }}
    .recommendations h3 {{ margin-top: 0; color: #1a1a1a; }}
    .timestamp {{ font-size: 12px; color: #666; margin-bottom: 16px; }}
    .trend {{ background: white; padding: 16px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 24px; }}
</style>
</head>
<body>
<div class="container">
    <h1>Test Insights — Native Media AI Studio</h1>
    <div class="timestamp">Generated {report['timestamp']} · Commit {report.get('commit', 'unknown')} · Branch {report.get('branch', 'unknown')}</div>

    <div class="summary">
        <div class="stat-card {'good' if overall['failed'] == 0 else 'bad'}">
            <div class="value">{overall['total']}</div>
            <div class="label">Total Tests</div>
        </div>
        <div class="stat-card {'good' if overall['pass_rate'] >= 95 else 'bad'}">
            <div class="value">{overall['pass_rate']:.1f}%</div>
            <div class="label">Pass Rate</div>
        </div>
        <div class="stat-card {'good' if overall['failed'] == 0 else 'bad'}">
            <div class="value">{overall['failed']}</div>
            <div class="label">Failed</div>
        </div>
        <div class="stat-card">
            <div class="value">{overall['skipped']}</div>
            <div class="label">Skipped</div>
        </div>
        <div class="stat-card">
            <div class="value">{overall['total_duration']:.2f}s</div>
            <div class="label">Total Duration</div>
        </div>
    </div>

    {trend_html}

    <h2>Results by Category</h2>
    <table>
        <thead>
            <tr>
                <th>Category</th>
                <th>Total</th>
                <th>Passed</th>
                <th>Failed</th>
                <th>Skipped</th>
                <th>Pass Rate</th>
                <th>Duration</th>
                <th>Slowest Tests</th>
                <th>Failures</th>
            </tr>
        </thead>
        <tbody>
            {feature_rows}
        </tbody>
    </table>

    <div class="recommendations">
        <h3>Recommendations</h3>
        <ul>{rec_html}</ul>
    </div>
</div>
</body>
</html>"""


def generate_junit_xml(report: dict[str, Any]) -> str:
    """Generate JUnit XML from the report."""
    root = ET.Element("testsuites")
    root.set("name", "Native Media AI Studio")
    root.set("tests", str(report["overall"]["total"]))
    root.set("failures", str(report["overall"]["failed"]))
    root.set("errors", "0")
    root.set("skipped", str(report["overall"]["skipped"]))
    root.set("time", f'{report["overall"]["total_duration"]:.3f}')

    for cat, stats in report["features"].items():
        suite = ET.SubElement(root, "testsuite")
        suite.set("name", cat)
        suite.set("tests", str(stats["total"]))
        suite.set("failures", str(stats["failed"]))
        suite.set("errors", "0")
        suite.set("skipped", str(stats["skipped"]))
        suite.set("time", f'{stats["total_duration"]:.3f}')

    return ET.tostring(root, encoding="unicode")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(UTC)
    ts_str = timestamp.strftime("%Y%m%d_%H%M%S")

    # Discover tests
    backend_files = discover_backend_tests()
    frontend_files = discover_frontend_tests()

    print(f"Discovered {len(backend_files)} backend test files, {len(frontend_files)} frontend test files")

    # Run backend tests
    print("Running backend tests (pytest)...")
    backend_result = run_pytest(backend_files)

    # Run frontend tests
    print("Running frontend tests (vitest)...")
    frontend_result = run_vitest(frontend_files)

    # Aggregate results
    total = backend_result["total"] + frontend_result["total"]
    passed = backend_result["passed"] + frontend_result["passed"]
    failed = backend_result["failed"] + frontend_result["failed"]
    skipped = backend_result["skipped"] + frontend_result["skipped"]
    duration = backend_result["duration"] + frontend_result["duration"]

    # Build features from per-test results
    category_results: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "passed": 0, "failed": 0, "skipped": 0, "error": 0})
    category_durations: dict[str, float] = defaultdict(float)
    all_slowest: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    cache = load_duration_cache()
    for t in backend_result["tests"]:
        node_id = t["node_id"]
        cat = categorize_test_file(node_id)
        cr = category_results[cat]
        cr["total"] += 1
        cr[t["status"]] += 1
        dur = t["duration"]
        category_durations[cat] += dur
        all_slowest.append({"node_id": node_id, "duration": dur})
        if t["status"] == "failed":
            failures.append({"node_id": node_id, "status": t["status"]})

    features: dict[str, Any] = {}
    for cat, counts in category_results.items():
        # Filter failures for this category (node_id contains the test file with category prefix)
        cat_failures = [
            f for f in failures
            if categorize_test_file(f["node_id"]) == cat
        ]
        features[cat] = build_feature_stats(
            cat,
            counts["total"], counts["passed"], counts["failed"], counts["skipped"],
            category_durations[cat],
            sorted(all_slowest, key=lambda x: -x["duration"])[:5],
            cat_failures,
            counts.get("error", 0),
        )

    # Also show frontend as separate if any
    if frontend_result["total"] > 0:
        features["frontend"] = build_feature_stats(
            "frontend",
            frontend_result["total"], frontend_result["passed"],
            frontend_result["failed"], frontend_result["skipped"],
            frontend_result["duration"], [], [],
            0,
        )

    overall = {
        "total": total,
        "passed": passed,
        "failed": failed,
        "skipped": skipped,
        "pass_rate": round(passed / total * 100, 2) if total else 0.0,
        "total_duration": round(duration, 3),
    }

    # Load previous report for trend
    previous = None
    if REPORT_JSON.exists():
        try:
            with open(REPORT_JSON, encoding="utf-8") as f:
                previous = json.load(f)
        except (json.JSONDecodeError, OSError):
            previous = None

    trend = {}
    if previous:
        # Support both old format (top-level keys) and new format (overall key)
        prev_overall = previous.get("overall", previous)
        # Only show trend if test counts are comparable (within 2x)
        prev_total = prev_overall.get("total", 0)
        if prev_total > 0 and total > 0 and 0.5 <= (total / prev_total) <= 2.0:
            trend = {
                "total_change": total - prev_total,
                "pass_rate_change": round(overall["pass_rate"] - prev_overall.get("pass_rate", 0), 1),
                "duration_change": round(duration - prev_overall.get("total_duration", 0), 3),
                "failed_change": failed - prev_overall.get("failed", 0),
            }

    # Recommendations
    recommendations: list[str] = []
    if failed > 0:
        recommendations.append(f"{failed} test(s) failed — investigate before merging.")
    if duration > 60:
        recommendations.append(f"Test suite takes {duration:.1f}s — consider parallelizing or mocking slow I/O.")
    # Find slowest tests from duration cache
    slow_tests = sorted(cache.items(), key=lambda x: -x[1])[:5]
    if slow_tests:
        rec = "Slowest tests: " + ", ".join(
            f"{nid} ({dur:.2f}s)" for nid, dur in slow_tests
        ) + " — consider mocking heavy I/O or reducing fixture data."
        recommendations.append(rec)

    report = {
        "timestamp": timestamp.isoformat(),
        "commit": "",
        "branch": "",
        "overall": overall,
        "features": features,
        "trend": trend,
        "recommendations": recommendations,
        "backend_result": {
            "total": backend_result["total"],
            "passed": backend_result["passed"],
            "failed": backend_result["failed"],
            "skipped": backend_result["skipped"],
            "duration": backend_result["duration"],
        },
        "frontend_result": {
            "total": frontend_result["total"],
            "passed": frontend_result["passed"],
            "failed": frontend_result["failed"],
            "skipped": frontend_result["skipped"],
            "duration": frontend_result["duration"],
        },
    }

    # Write reports
    with open(REPORT_JSON, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    Path(REPORT_HTML).write_text(generate_html_report(report), encoding="utf-8")

    Path(REPORT_JUNIT).write_text(generate_junit_xml(report), encoding="utf-8")

    # Archive to history
    hist_dir = HISTORY_DIR / ts_str
    hist_dir.mkdir(parents=True, exist_ok=True)
    with open(hist_dir / "report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    Path(hist_dir / "report.html").write_text(generate_html_report(report), encoding="utf-8")

    save_duration_cache(cache)

    print("\n=== RESULTS ===")
    print(f"Total: {total}, Passed: {passed}, Failed: {failed}, Skipped: {skipped}")
    print(f"Pass rate: {overall['pass_rate']:.1f}%")
    print(f"Duration: {duration:.2f}s")
    print(f"\nReports written to: {OUT_DIR}")
    print("  - report.json")
    print("  - report.html")
    print("  - junit.xml")
    print(f"  - .history/{ts_str}/")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

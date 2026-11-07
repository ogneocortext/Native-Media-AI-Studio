"""
tools/test_insights.py

Insight-driven Python test reporting for the Native Media AI Studio backend.

Runs the pytest suite with JUnit XML output, parses the results, and produces:

  1. A per-feature-category breakdown (audio, remix, queue, health, ...)
     with pass/fail rates and slowest tests.
  2. Flaky-test detection: re-runs a sample of tests N times and flags any
     that change result between runs.
  3. Historical trend tracking: every run is archived under
     tools/test-insights-out/.history/<timestamp>/ so you can diff runs,
     spot flaky tests across commits, and correlate failures to code changes.
  4. Two-lane pipeline support: --fast-gate runs only fast tests (< 1s each)
     for sub-10-second feedback during development; --full runs everything.
  5. Actionable recommendations framed as product improvements.

Usage:

    python tools/test_insights.py                    # full suite report
    python tools/test_insights.py --only audio       # one feature area
    python tools/test_insights.py --fast-gate        # fast feedback (<10s)
    python tools/test_insights.py --flaky-runs 3     # flaky detection
    python tools/test_insights.py --html --json      # HTML + JSON reports
    python tools/test_insights.py --no-run           # re-analyse last report

Outputs (default directory: tools/test-insights-out/):

    report.json          machine-readable summary
    report.html          human-readable HTML with charts and recommendations
    flaky.json           flaky-test detection results
    .history/<ts>/       archived run (JUnit XML + JSON + HTML)
"""

from __future__ import annotations

import argparse
import concurrent.futures
import html
import json
import subprocess
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "packages" / "backend"
OUT_DIR = ROOT / "tools" / "test-insights-out"
HISTORY_DIR = OUT_DIR / ".history"
REPORT_JSON = OUT_DIR / "report.json"
REPORT_HTML = OUT_DIR / "report.html"
FLAKY_JSON = OUT_DIR / "flaky.json"
JUNIT_XML = OUT_DIR / "junit.xml"

# Thresholds for the fast-gate lane (sub-10s feedback loop).
FAST_GATE_MAX_DURATION = 1.0  # tests slower than this are excluded from fast gate
FAST_GATE_MAX_TOTAL = 10.0  # total budget for fast-gate lane

# ---------------------------------------------------------------------------
# Feature categorization
# ---------------------------------------------------------------------------

FEATURE_PREFIXES: list[tuple[str, str]] = [
    ("test_audio_", "audio"),
    ("test_remix_", "remix"),
    ("test_queue", "queue"),
    ("test_queue_", "queue"),
    ("test_health", "health"),
    ("test_health_", "health"),
    ("test_database_", "database"),
    ("test_db_", "database"),
    ("test_websocket_", "websocket"),
    ("test_sse_", "websocket"),
    ("test_stem_", "audio"),
    ("test_separation_", "audio"),
    ("test_mastering", "audio"),
    ("test_lipsync", "audio"),
    ("test_beat_", "audio"),
    ("test_tempo_", "audio"),
    ("test_essentia_", "audio"),
    ("test_vram", "gpu"),
    ("test_gpu_", "gpu"),
    ("test_comfyui", "integration"),
    ("test_ollama", "integration"),
    ("test_video_", "integration"),
    ("test_pipeline_", "integration"),
    ("test_adapter_", "integration"),
]

OTHER_CATEGORY = "other"


def categorize(node_id: str) -> str:
    """Return the feature area for a test node id."""
    fname = Path(node_id.split("::")[0]).name
    for prefix, area in FEATURE_PREFIXES:
        if fname.startswith(prefix):
            return area
    return OTHER_CATEGORY


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


class TestResult:
    def __init__(self, node_id: str, outcome: str, duration: float,
                 message: str = "", traceback: str = ""):
        self.node_id = node_id
        self.outcome = outcome  # passed, failed, skipped, error
        self.duration = duration
        self.message = message
        self.traceback = traceback
        self.category = categorize(node_id)
        self.file = Path(node_id.split("::")[0]).name
        self.name = node_id.split("::")[-1] if "::" in node_id else node_id


class FeatureReport:
    def __init__(self, name: str):
        self.name = name
        self.tests: list[TestResult] = []

    @property
    def total(self) -> int:
        return len(self.tests)

    @property
    def passed(self) -> int:
        return sum(1 for t in self.tests if t.outcome == "passed")

    @property
    def failed(self) -> int:
        return sum(1 for t in self.tests if t.outcome in ("failed", "error"))

    @property
    def skipped(self) -> int:
        return sum(1 for t in self.tests if t.outcome == "skipped")

    @property
    def pass_rate(self) -> float:
        if self.total == 0:
            return 100.0
        return 100.0 * self.passed / self.total

    @property
    def total_duration(self) -> float:
        return sum(t.duration for t in self.tests)

    @property
    def slowest(self) -> list[TestResult]:
        return sorted(self.tests, key=lambda t: t.duration, reverse=True)[:5]

    @property
    def failures(self) -> list[TestResult]:
        return [t for t in self.tests if t.outcome in ("failed", "error")]


class InsightsReport:
    def __init__(self):
        self.timestamp = datetime.now(UTC).isoformat()
        self.commit = _get_git_commit()
        self.branch = _get_git_branch()
        self.features: dict[str, FeatureReport] = {}
        self.all_tests: list[TestResult] = []
        self.total_duration = 0.0
        self.flaky: list[dict[str, Any]] = []
        self.recommendations: list[str] = []

    def add_test(self, result: TestResult) -> None:
        self.all_tests.append(result)
        if result.category not in self.features:
            self.features[result.category] = FeatureReport(result.category)
        self.features[result.category].tests.append(result)
        self.total_duration += result.duration

    @property
    def total(self) -> int:
        return len(self.all_tests)

    @property
    def passed(self) -> int:
        return sum(1 for t in self.all_tests if t.outcome == "passed")

    @property
    def failed(self) -> int:
        return sum(1 for t in self.all_tests if t.outcome in ("failed", "error"))

    @property
    def skipped(self) -> int:
        return sum(1 for t in self.all_tests if t.outcome == "skipped")

    @property
    def pass_rate(self) -> float:
        if self.total == 0:
            return 100.0
        return 100.0 * self.passed / self.total

    @property
    def overall_slowest(self) -> list[TestResult]:
        return sorted(self.all_tests, key=lambda t: t.duration, reverse=True)[:10]

    @property
    def all_failures(self) -> list[TestResult]:
        return [t for t in self.all_tests if t.outcome in ("failed", "error")]

    def to_dict(self, flaky: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "commit": self.commit,
            "branch": self.branch,
            "total": self.total,
            "passed": self.passed,
            "failed": self.failed,
            "skipped": self.skipped,
            "pass_rate": self.pass_rate,
            "total_duration": self.total_duration,
            "features": {
                name: {
                    "total": f.total, "passed": f.passed, "failed": f.failed,
                    "skipped": f.skipped, "pass_rate": f.pass_rate,
                    "total_duration": f.total_duration,
                    "slowest": [{"node_id": t.node_id, "duration": t.duration}
                                for t in f.slowest],
                    "failures": [{"node_id": t.node_id,
                                  "error": t.message[:200]}
                                 for t in f.failures],
                }
                for name, f in self.features.items() if f.total > 0
            },
            "slowest": [{"node_id": t.node_id, "duration": t.duration,
                         "category": t.category}
                        for t in self.overall_slowest],
            "recommendations": self.recommendations,
            "flaky": flaky,
        }


def _get_git_commit() -> str | None:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=ROOT, capture_output=True, text=True, encoding="utf-8", timeout=5,
        )
        return out.stdout.strip() or None
    except Exception:
        return None


def _get_git_branch() -> str | None:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=ROOT, capture_output=True, text=True, encoding="utf-8", timeout=5,
        )
        return out.stdout.strip() or None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Pytest runner (JUnit XML)
# ---------------------------------------------------------------------------


def run_pytest(test_args: list[str] | None = None,
               junit_file: Path | None = None,
               *,
               fast_gate: bool = False,
               test_files: list[str] | None = None) -> ET.Element | None:
    """Run pytest and return the parsed JUnit XML root element.

    When fast_gate is True, only runs tests that finished under
    FAST_GATE_MAX_DURATION in the last run (using a duration cache),
    adds --maxfail=1 for fast failure, and limits test discovery to
    fast test files so slow/hanging tests are never collected.
    """
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if junit_file is None:
        junit_file = JUNIT_XML

    cmd = [sys.executable, "-m", "pytest", "--junit-xml", str(junit_file)]

    if fast_gate:
        # Determine which test files contain only fast tests.
        duration_cache = OUT_DIR / ".duration_cache.json"
        fast_files: set[str] = set()
        if duration_cache.is_file():
            try:
                cache = json.loads(duration_cache.read_text(encoding="utf-8"))
                # Group durations by file; a file is "fast" if ALL its tests
                # are under the threshold.
                file_durations: dict[str, list[float]] = {}
                for nid, dur in cache.items():
                    fname = nid.split("::")[0]
                    file_durations.setdefault(fname, []).append(dur)
                for fname, durs in file_durations.items():
                    if all(d <= FAST_GATE_MAX_DURATION for d in durs):
                        fast_files.add(fname)
            except Exception:
                pass

        if fast_files:
            # Pass only fast test files as positional args so pytest doesn't
            # discover slow/hanging tests in other files.
            cmd.extend(sorted(fast_files))
        cmd.extend(["--maxfail=1", "-q"])
    elif test_files:
        cmd.extend(test_files)
    elif test_args:
        cmd.extend(test_args)

    print(f"[test_insights] running: {' '.join(cmd)}", file=sys.stderr)
    proc = subprocess.run(cmd, cwd=BACKEND, capture_output=True, text=True,
                          encoding="utf-8")
    print(proc.stdout, end="")
    if proc.stderr:
        print(proc.stderr, end="", file=sys.stderr)

    if not junit_file.is_file():
        print(f"[test_insights] ERROR: no JUnit XML at {junit_file}",
              file=sys.stderr)
        return None

    try:
        tree = ET.parse(junit_file)
        return tree.getroot()
    except ET.ParseError as exc:
        print(f"[test_insights] ERROR: invalid JUnit XML: {exc}",
              file=sys.stderr)
        return None


def parse_junit(root: ET.Element) -> InsightsReport:
    """Convert JUnit XML root into an InsightsReport."""
    report = InsightsReport()

    testsuites = root.findall("testsuite")
    if not testsuites:
        testsuites = [root] if root.tag == "testsuite" else []

    for suite in testsuites:
        for tc in suite.findall("testcase"):
            classname = tc.get("classname", "")
            name = tc.get("name", "unknown")
            if classname:
                parts = classname.split(".")
                if parts and parts[-1][:1].isupper():
                    parts = parts[:-1]
                module_path = "/".join(parts)
                node_id = f"{module_path}.py::{name}"
            else:
                node_id = f"tests/unknown.py::{name}"
            duration = float(tc.get("time", 0.0))

            failure = tc.find("failure")
            error = tc.find("error")
            skipped = tc.find("skipped")

            if failure is not None:
                outcome = "failed"
                message = failure.get("message", "") or ""
                traceback = failure.text or ""
            elif error is not None:
                outcome = "error"
                message = error.get("message", "") or ""
                traceback = error.text or ""
            elif skipped is not None:
                outcome = "skipped"
                message = skipped.get("message", "") or ""
                traceback = ""
            else:
                outcome = "passed"
                message = ""
                traceback = ""

            result = TestResult(node_id, outcome, duration, message, traceback)
            report.add_test(result)

    return report


# ---------------------------------------------------------------------------
# Duration cache (for fast-gate lane)
# ---------------------------------------------------------------------------


def update_duration_cache(report: InsightsReport) -> None:
    """Persist per-test durations so the fast-gate lane can skip slow tests."""
    cache_file = OUT_DIR / ".duration_cache.json"
    cache: dict[str, float] = {}
    if cache_file.is_file():
        try:
            cache = json.loads(cache_file.read_text(encoding="utf-8"))
        except Exception:
            cache = {}
    for t in report.all_tests:
        cache[t.node_id] = t.duration
    cache_file.write_text(json.dumps(cache, indent=2), encoding="utf-8")


# ---------------------------------------------------------------------------
# Historical archiving
# ---------------------------------------------------------------------------


def archive_run(report: InsightsReport, flaky: list[dict[str, Any]],
                junit_file: Path | None = None) -> Path:
    """Archive this run under .history/<timestamp>/ for trend analysis."""
    ts = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    run_dir = HISTORY_DIR / ts
    run_dir.mkdir(parents=True, exist_ok=True)

    # Copy the JSON report.
    (run_dir / "report.json").write_text(
        json.dumps(report.to_dict(flaky), indent=2), encoding="utf-8"
    )
    # Copy JUnit XML if available.
    if junit_file and junit_file.is_file():
        import shutil
        shutil.copy2(junit_file, run_dir / "junit.xml")

    # Append to a trends log (one line per run).
    trends_file = HISTORY_DIR / "trends.jsonl"
    trends_line = {
        "timestamp": report.timestamp,
        "commit": report.commit,
        "branch": report.branch,
        "total": report.total,
        "passed": report.passed,
        "failed": report.failed,
        "skipped": report.skipped,
        "pass_rate": report.pass_rate,
        "total_duration": report.total_duration,
    }
    with trends_file.open("a", encoding="utf-8") as f:
        f.write(json.dumps(trends_line) + "\n")

    # Keep only the last 30 runs (velvet-report style).
    if trends_file.is_file():
        lines = trends_file.read_text(encoding="utf-8").strip().splitlines()
        if len(lines) > 30:
            trends_file.write_text(
                "\n".join(lines[-30:]) + "\n", encoding="utf-8"
            )

    return run_dir


def load_trends() -> list[dict[str, Any]]:
    """Load historical trend data."""
    trends_file = HISTORY_DIR / "trends.jsonl"
    if not trends_file.is_file():
        return []
    lines = trends_file.read_text(encoding="utf-8").strip().splitlines()
    return [json.loads(line) for line in lines if line.strip()]


# ---------------------------------------------------------------------------
# Flaky test detection
# ---------------------------------------------------------------------------


def detect_flaky(test_args: list[str] | None = None,
                 runs: int = 3,
                 sample_per_category: int = 5) -> list[dict[str, Any]]:
    """Run a sample of passed tests N times and flag any that change result."""
    root = run_pytest(test_args=test_args)
    if root is None:
        return []

    testsuites = root.findall("testsuite")
    if not testsuites:
        testsuites = [root] if root.tag == "testsuite" else []

    by_category: dict[str, list[ET.Element]] = {}
    for suite in testsuites:
        for tc in suite.findall("testcase"):
            if tc.find("failure") is not None or tc.find("error") is not None:
                continue  # only sample passing tests
            classname = tc.get("classname", "")
            name = tc.get("name", "unknown")
            if classname:
                parts = classname.split(".")
                if parts and parts[-1][:1].isupper():
                    parts = parts[:-1]
                module_path = "/".join(parts)
                node_id = f"{module_path}.py::{name}"
            else:
                node_id = f"tests/unknown.py::{name}"
            cat = categorize(node_id)
            by_category.setdefault(cat, []).append(tc)

    # Sample: fastest tests per category
    sample: list[str] = []
    for _cat, tcs in by_category.items():
        tcs.sort(key=lambda e: float(e.get("time", 0.0)))
        for tc in tcs[:sample_per_category]:
            classname = tc.get("classname", "")
            name = tc.get("name", "unknown")
            if classname:
                parts = classname.split(".")
                if parts and parts[-1][:1].isupper():
                    parts = parts[:-1]
                module_path = "/".join(parts)
                sample.append(f"{module_path}.py::{name}")
            else:
                sample.append(f"tests/unknown.py::{name}")

    if not sample:
        return []

    print(f"[test_insights] flaky detection: {len(sample)} candidate tests, "
          f"{runs} runs each", file=sys.stderr)

    outcomes_by_test: dict[str, list[str]] = defaultdict(list)

    # Each pytest invocation is independent and already uses pytest-xdist
    # (-n auto) internally, so we cap parallel workers at 2 to avoid CPU
    # contention on the 6C/12T Ryzen 5 5500 workstation. Running the flaky
    # detection passes in parallel cuts wall time roughly in half.
    max_workers = min(2, runs)

    def _run_flaky_pass(_run_idx: int) -> dict[str, str]:
        raw_run = run_pytest(test_args=test_args)
        if raw_run is None:
            return {}
        suites = raw_run.findall("testsuite")
        if not suites:
            suites = [raw_run] if raw_run.tag == "testsuite" else []
        run_outcomes: dict[str, str] = {}
        for suite in suites:
            for tc in suite.findall("testcase"):
                classname = tc.get("classname", "")
                name = tc.get("name", "unknown")
                if classname:
                    parts = classname.split(".")
                    if parts and parts[-1][:1].isupper():
                        parts = parts[:-1]
                    module_path = "/".join(parts)
                    nid = f"{module_path}.py::{name}"
                else:
                    nid = f"tests/unknown.py::{name}"
                if tc.find("failure") is not None:
                    run_outcomes[nid] = "failed"
                elif tc.find("error") is not None:
                    run_outcomes[nid] = "error"
                elif tc.find("skipped") is not None:
                    run_outcomes[nid] = "skipped"
                else:
                    run_outcomes[nid] = "passed"
        return run_outcomes

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(_run_flaky_pass, i) for i in range(runs)]
        for future in concurrent.futures.as_completed(futures):
            run_outcomes = future.result()
            for nid in sample:
                outcomes_by_test[nid].append(run_outcomes.get(nid, "missing"))

    flaky = []
    for nid, outcomes in outcomes_by_test.items():
        unique = set(outcomes)
        if len(unique) > 1:
            flaky.append({
                "node_id": nid,
                "category": categorize(nid),
                "outcomes": outcomes,
            })

    return flaky


# ---------------------------------------------------------------------------
# Recommendations
# ---------------------------------------------------------------------------


def build_recommendations(report: InsightsReport,
                          flaky: list[dict[str, Any]],
                          trends: list[dict[str, Any]]) -> list[str]:
    recs: list[str] = []

    # 1. Feature areas with low pass rates
    for name, feat in sorted(report.features.items(),
                             key=lambda kv: kv[1].pass_rate):
        if feat.total == 0:
            continue
        if feat.pass_rate < 100.0 and feat.failed > 0:
            recs.append(
                f"[{name}] {feat.failed} of {feat.total} tests failing — "
                f"this feature area has the lowest reliability. Prioritize "
                f"fixing these before adding new features."
            )

    # 2. Slowest tests overall
    slowest = report.overall_slowest[:5]
    if slowest:
        slow_names = ", ".join(f"{t.file}::{t.name} ({t.duration:.2f}s)"
                               for t in slowest)
        recs.append(
            f"Slowest tests: {slow_names}. Consider mocking heavy I/O or "
            f"reducing fixture data to speed up the feedback loop."
        )

    # 3. Feature areas with no tests
    covered = set(report.features.keys())
    known_areas = {area for _, area in FEATURE_PREFIXES}
    known_areas.add(OTHER_CATEGORY)
    missing = known_areas - covered
    if missing:
        recs.append(
            f"No tests found for feature areas: {', '.join(sorted(missing))}. "
            f"Add regression coverage before these areas reach users."
        )

    # 4. Flaky tests
    if flaky:
        flaky_names = ", ".join(f"{f['node_id'].split('::')[-1]} "
                                f"({f['category']})" for f in flaky[:5])
        recs.append(
            f"Flaky tests detected: {flaky_names}. Tests that change result "
            f"between runs erode confidence — pin them down or mark them slow."
        )

    # 5. High-duration feature areas
    for name, feat in sorted(report.features.items(),
                             key=lambda kv: kv[1].total_duration,
                             reverse=True)[:3]:
        if feat.total_duration > 5.0:
            recs.append(
                f"[{name}] takes {feat.total_duration:.1f}s total — the slowest "
                f"feature area. Consider parallelizing or mocking external calls."
            )

    # 6. Overall pass rate
    if report.pass_rate < 95.0:
        recs.append(
            f"Overall pass rate is {report.pass_rate:.1f}% — below the 95% "
            f"threshold. Fix failing tests before shipping."
        )

    # 7. Trend analysis: pass rate degrading over time
    if len(trends) >= 3:
        recent = trends[-3:]
        rates = [t["pass_rate"] for t in recent]
        if rates[0] > rates[-1] + 5:
            recs.append(
                f"Pass rate trending downward: {rates[0]:.1f}% -> "
                f"{rates[-1]:.1f}% over last 3 runs. Investigate regressions."
            )
        elif rates[-1] == 100.0 and all(r == 100.0 for r in recent):
            recs.append(
                "Pass rate has been 100% across the last 3 runs — suite is "
                "stable and ready for refactoring."
            )

    # 8. Fast-gate suitability
    fast_tests = [t for t in report.all_tests if t.duration < FAST_GATE_MAX_DURATION]
    if fast_tests:
        fast_total = sum(t.duration for t in fast_tests)
        if fast_total < FAST_GATE_MAX_TOTAL:
            recs.append(
                f"Fast-gate lane viable: {len(fast_tests)} tests total "
                f"{fast_total:.1f}s — sub-10s feedback for development."
            )

    if not recs:
        recs.append("All tests passing, coverage is healthy — no action needed.")

    return recs


# ---------------------------------------------------------------------------
# HTML report
# ---------------------------------------------------------------------------


def _esc(text: str) -> str:
    return html.escape(str(text), quote=True)


def generate_html(report: InsightsReport,
                  flaky: list[dict[str, Any]],
                  trends: list[dict[str, Any]]) -> str:
    """Build a self-contained HTML report."""
    feature_rows = ""
    for name in sorted(report.features.keys()):
        feat = report.features[name]
        if feat.total == 0:
            continue
        status_class = "pass" if feat.pass_rate == 100 else (
            "warn" if feat.pass_rate >= 80 else "fail")
        feature_rows += f"""
        <tr>
            <td><strong>{_esc(name)}</strong></td>
            <td>{feat.total}</td>
            <td class="{status_class}">{feat.passed}</td>
            <td class="{status_class}">{feat.failed}</td>
            <td class="{status_class}">{feat.skipped}</td>
            <td class="{status_class}">{feat.pass_rate:.0f}%</td>
            <td>{feat.total_duration:.2f}s</td>
        </tr>
        """

    slow_rows = ""
    for t in report.overall_slowest:
        slow_rows += f"""
        <tr>
            <td>{_esc(t.file)}::{_esc(t.name)}</td>
            <td>{_esc(t.category)}</td>
            <td>{t.duration:.2f}s</td>
            <td>{_esc(t.outcome)}</td>
        </tr>
        """

    fail_rows = ""
    for t in report.all_failures:
        fail_rows += f"""
        <tr>
            <td>{_esc(t.file)}::{_esc(t.name)}</td>
            <td>{_esc(t.category)}</td>
            <td><pre>{_esc(t.message[:300])}</pre></td>
        </tr>
        """

    flaky_rows = ""
    for f in flaky:
        flaky_rows += f"""
        <tr>
            <td>{_esc(f['node_id'].split('::')[-1])}</td>
            <td>{_esc(f['category'])}</td>
            <td>{', '.join(f['outcomes'])}</td>
        </tr>
        """

    # Trend sparkline (simple text-based)
    trend_rows = ""
    for t in trends[-10:]:
        trend_rows += f"""
        <tr>
            <td>{t['timestamp'][:16]}</td>
            <td>{t.get('commit', '?')}</td>
            <td>{t['total']}</td>
            <td class="{'pass' if t['pass_rate'] == 100 else 'fail'}">{t['pass_rate']:.0f}%</td>
            <td>{t['total_duration']:.2f}s</td>
        </tr>
        """

    rec_items = "".join(f"<li>{_esc(r)}</li>" for r in report.recommendations)

    build_info = f"{report.commit or 'unknown'} on {report.branch or 'unknown'}"

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Test Insights Report — Native Media AI Studio</title>
<style>
  body {{ font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
          margin: 2rem; background: #f8fafc; color: #1e293b; }}
  h1 {{ color: #0f172a; }}
  h2 {{ color: #334155; margin-top: 1.5rem; }}
  table {{ border-collapse: collapse; width: 100%; margin: 1rem 0;
           background: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
  th, td {{ border: 1px solid #e2e8f0; padding: 0.75rem; text-align: left; }}
  th {{ background: #f1f5f9; color: #475569; font-size: 0.875rem; }}
  tr:nth-child(even) {{ background: #f8fafc; }}
  .pass {{ color: #15803d; }} .warn {{ color: #d97706; }} .fail {{ color: #dc2626; }}
  .summary {{ display: flex; gap: 1rem; margin: 1rem 0; }}
  .stat {{ background: #ffffff; padding: 1rem 1.5rem; border-radius: 0.5rem;
           box-shadow: 0 1px 3px rgba(0,0,0,0.1); flex: 1; }}
  .stat .big {{ font-size: 1.75rem; font-weight: 700; color: #0f172a; }}
  .stat .label {{ font-size: 0.875rem; color: #64748b; }}
  .build-info {{ font-size: 0.875rem; color: #64748b; margin-bottom: 1rem;
                 background: #ffffff; padding: 0.75rem 1rem; border-radius: 0.5rem;
                 box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
  .recommendations {{ background: #eff6ff; border-left: 4px solid #2563eb;
                      padding: 1rem; margin: 1rem 0; border-radius: 0 0.5rem 0.5rem 0; }}
  .recommendations ul {{ margin: 0.5rem 0; padding-left: 1.2rem; }}
  .recommendations li {{ margin: 0.5rem 0; }}
  .meta {{ font-size: 0.875rem; color: #64748b; margin-bottom: 1rem; }}
  pre {{ font-size: 0.8rem; background: #f1f5f9; padding: 0.5rem;
         border-radius: 0.25rem; max-width: 600px; overflow: auto; }}
</style>
</head>
<body>
  <h1>Test Insights Report</h1>
  <div class="build-info"><strong>Build:</strong> {_esc(build_info)} ·
      <strong>Time:</strong> {_esc(report.timestamp)}</div>
  <div class="meta">Native Media AI Studio · {_esc(report.timestamp)}</div>

  <div class="summary">
    <div class="stat"><div class="big">{report.total}</div>
        <div class="label">total tests</div></div>
    <div class="stat"><div class="big {'pass' if report.pass_rate == 100 else 'fail'}">{report.pass_rate:.1f}%</div>
        <div class="label">pass rate</div></div>
    <div class="stat"><div class="big {'fail' if report.failed else 'pass'}">{report.failed}</div>
        <div class="label">failed</div></div>
    <div class="stat"><div class="big">{report.skipped}</div>
        <div class="label">skipped</div></div>
    <div class="stat"><div class="big">{report.total_duration:.1f}s</div>
        <div class="label">total duration</div></div>
  </div>

  <h2>Feature Area Breakdown</h2>
  <table>
    <thead><tr>
      <th>Feature</th><th>Tests</th><th>Passed</th><th>Failed</th><th>Skipped</th><th>Pass %</th><th>Duration</th>
    </tr></thead>
    <tbody>{feature_rows}</tbody>
  </table>

  <h2>Slowest Tests</h2>
  <table>
    <thead><tr><th>Test</th><th>Category</th><th>Duration</th><th>Outcome</th></tr></thead>
    <tbody>{slow_rows}</tbody>
  </table>

  {f'''
  <h2>Failing Tests</h2>
  <table>
    <thead><tr><th>Test</th><th>Category</th><th>Error</th></tr></thead>
    <tbody>{fail_rows}</tbody>
  </table>
  ''' if report.all_failures else ''}

  {f'''
  <h2>Flaky Tests (result changes between runs)</h2>
  <table>
    <thead><tr><th>Test</th><th>Category</th><th>Outcomes observed</th></tr></thead>
    <tbody>{flaky_rows}</tbody>
  </table>
  ''' if flaky else ''}

  <h2>Run History (last 10)</h2>
  <table>
    <thead><tr><th>Timestamp</th><th>Commit</th><th>Tests</th><th>Pass %</th><th>Duration</th></tr></thead>
    <tbody>{trend_rows}</tbody>
  </table>

  <h2>Recommendations</h2>
  <div class="recommendations">
    <ul>{rec_items}</ul>
  </div>
</body>
</html>"""


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Insight-driven Python test reporting for NMA Studio backend")
    parser.add_argument("--only", metavar="FEATURE",
                        help="only run tests matching this feature keyword")
    parser.add_argument("--fast-gate", action="store_true",
                        help="fast feedback lane: run only fast tests "
                             f"(< {FAST_GATE_MAX_DURATION}s each), "
                             f"--maxfail=1, target < {FAST_GATE_MAX_TOTAL}s total")
    parser.add_argument("--flaky-runs", type=int, default=1,
                        help="re-run tests N times to detect flaky tests")
    parser.add_argument("--html", action="store_true",
                        help="write HTML report")
    parser.add_argument("--json", action="store_true",
                        help="write JSON summary")
    parser.add_argument("--no-ascii", action="store_true",
                        help="skip the ASCII-art console summary")
    parser.add_argument("--no-run", action="store_true",
                        help="re-analyse the last JUnit XML without running pytest")
    parser.add_argument("extra_args", nargs="*",
                        help="extra arguments passed to pytest")
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    test_args = list(args.extra_args)
    if args.only:
        test_args.append(f"-k {args.only}")

    root = None
    if not args.no_run:
        root = run_pytest(test_args=test_args, fast_gate=args.fast_gate)
        if root is None:
            return 1

    if root is None:
        if JUNIT_XML.is_file():
            tree = ET.parse(JUNIT_XML)
            root = tree.getroot()
        else:
            print("[test_insights] ERROR: no report to analyse", file=sys.stderr)
            return 1

    report = parse_junit(root)
    update_duration_cache(report)

    flaky = []
    if args.flaky_runs > 1:
        flaky = detect_flaky(test_args=test_args, runs=args.flaky_runs)
        report.flaky = flaky

    trends = load_trends()
    report.recommendations = build_recommendations(report, flaky, trends)

    run_dir = archive_run(report, flaky, JUNIT_XML)

    should_write_json = args.json or not (args.html or args.json)
    if should_write_json:
        REPORT_JSON.write_text(json.dumps(report.to_dict(flaky), indent=2),
                               encoding="utf-8")

    if args.html:
        REPORT_HTML.write_text(generate_html(report, flaky, trends),
                               encoding="utf-8")
        print(f"[test_insights] HTML report: {REPORT_HTML}", file=sys.stderr)

    print(f"[test_insights] JSON report: {REPORT_JSON}", file=sys.stderr)
    print(f"[test_insights] Archived run: {run_dir}", file=sys.stderr)
    print(f"[test_insights] {report.total} tests, "
          f"{report.pass_rate:.1f}% pass rate, {report.failed} failed",
          file=sys.stderr)

    for rec in report.recommendations:
        print(f"  • {rec}", file=sys.stderr)

    if not args.no_ascii:
        print_ascii_summary(report, flaky)

    return 0 if report.failed == 0 else 1


def print_ascii_summary(report: InsightsReport,
                        flaky: list[dict[str, Any]]) -> None:
    """Print the shared ASCII-art report (cli_output.py) to stdout.

    The plain-text recommendation lines above stay on stderr so this block
    is the single canonical 'how do I read this run' surface for both humans
    and agents.
    """
    try:
        if str(ROOT) not in sys.path:
            sys.path.insert(0, str(ROOT))
        from cli_output import (
            CLIOutput,
            build_test_insights,
            safe_print,
        )

        failures = [
            {
                "name": t.node_id,
                "file": t.file,
                "line": None,
                "message": (t.message or "").splitlines()[0][:120]
                if t.message else "",
            }
            for t in report.all_failures[:20]
        ]
        slowest = [
            {"name": t.node_id, "duration_s": t.duration}
            for t in report.overall_slowest[:8]
        ]
        insights = list(report.recommendations)
        if flaky:
            insights.insert(
                0,
                f"{len(flaky)} flaky test(s) detected — results changed "
                f"between runs; treat pass/fail for these as unreliable.",
            )
        if not insights:
            insights = build_test_insights(
                failed=report.failed, skipped=report.skipped, errors=0,
                slowest=slowest or None, suite="pytest backend",
            )

        safe_print("")
        safe_print(CLIOutput().format_test_results(
            passed=report.passed,
            failed=report.failed,
            skipped=report.skipped,
            duration_s=report.total_duration,
            suite="pytest backend",
            failures=failures,
            slowest=slowest,
            insights=insights,
            meta={"commit": report.commit or "", "branch": report.branch or ""},
            rerun_hint="python -m pytest",
        ))
    except Exception as exc:  # cosmetics must never break the report
        print(f"[test_insights] ascii summary skipped: {exc}",
              file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())

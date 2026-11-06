"""
CLI Output Formatter - Cross-platform terminal output presentation
Works on Windows (cp1252), Linux, and macOS
Usage: from cli_output import CLIOutput; cli = CLIOutput()
"""

import json
import sys
import os
import random
from dataclasses import dataclass, field
from typing import Any, Optional
from enum import Enum


# Force UTF-8 stdout on Windows
if sys.platform == "win32":
    try:
        import io
        # Reconfigure stdout to use UTF-8
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        else:
            # For older Python versions
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    except Exception:
        pass


class Status(Enum):
    SUCCESS = "[OK]"
    ERROR = "[ERR]"
    WARNING = "[WARN]"
    INFO = "[INFO]"
    RUNNING = "[RUN]"
    PENDING = "[...]"


@dataclass
class CLIResult:
    status: Status
    command: str
    output: str
    duration_ms: float
    exit_code: int = 0


# ASCII Art Library for Test Results
ASCII_ART_LIBRARY = {
    "success": [
        """
  _______________________
 /_  __/ ____/ ___/_  __/
 / / / __/  \\__ \\ / /   
 / / / /___ ___/ // /    
/_/ /_____//____//_/     
                          """,
        """
  __  __     ______     ______     ______  
 /\\ \\_\\ \\   /\\  ___\\   /\\  == \\   /\\__  _\\  
 \\ \\  __ \\  \\ \\  __\\   \\ \\  __<   \\/_/\\ \\/  
  \\ \\_\\ \\_\\  \\ \\_____\\  \\ \\_\\ \\_\\  \\ \\_\\  
   \\/_/\\/_/   \\/_____/   \\/_/ /_/   \\/_/  
                                        """,
        """
   _____ _____ _____ _____ _____ 
  |_   _|_   _|_   _|_   _|_   _|
    | |   | |   | |   | |   | |  
    | |   | |   | |   | |   | |  
    |_|   |_|   |_|   |_|   |_|  
                                 """,
        """
  ████████████████████████████████
  █  ALL TESTS PASSED!          █
  ████████████████████████████████
        """
    ],
    "failure": [
        """
  ████████████████████████████████
  █  SOME TESTS FAILED!         █
  ████████████████████████████████
        """,
        """
  _______________________
 /_  __/ ____/ ___/_  __/
  / / / __/  \\__ \\ / /   
 / / / /___ ___/ // /    
/_/ /_____//____//_/     
                          """,
        """
  ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
  █ TEST FAILURE DETECTED █
  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
        """
    ],
    "warning": [
        """
  ████████████████████████████████
  █  WARNING: SOME TESTS SKIPPED  █
  ████████████████████████████████
        """,
        """
  ⚠ ⚠ ⚠ ⚠ ⚠ ⚠ ⚠ ⚠ ⚠ ⚠ ⚠ ⚠
  ⚠  SOME TESTS WERE SKIPPED  ⚠
  ⚠ ⚠ ⚠ ⚠ ⚠ ⚠ ⚠ ⚠ ⚠ ⚠ ⚠ ⚠
        """
    ],
    "running": [
        """
  ████████████████████████████████
  █  TESTS RUNNING...           █
  ████████████████████████████████
        """,
        """
  ⠋ Running tests...
  ⠙ Running tests...
  ⠹ Running tests...
  ⠸ Running tests...
  ⠼ Running tests...
  ⠴ Running tests...
  ⠦ Running tests...
  ⠧ Running tests...
  ⠇ Running tests...
  ⠏ Running tests...
        """
    ],
    "coverage": [
        """
  ████████████████████████████████
  █  COVERAGE REPORT             █
  ████████████████████████████████
        """,
        """
  ████████████████████████████████
  █  Lines: 85%  Branches: 72%  █
  █  Functions: 88%  Statements: 85%  █
  ████████████████████████████████
        """
    ],
    "performance": [
        """
  ████████████████████████████████
  █  PERFORMANCE REPORT          █
  ████████████████████████████████
        """,
        """
  ⚡ Fast: 42ms avg  |  🐢 Slow: 1.2s max
  📊 95th percentile: 245ms
  💾 Memory: 45MB peak
        """
    ]
}

# Test-specific message templates
TEST_MESSAGES = {
    "all_passed": [
        "All tests passed! The force is strong with this code. ⭐",
        "Perfect! Every test shines like a star. ✨",
        "Clean sweep! Your tests are sparkling clean. 🌟",
        "Zero failures! Your code is bulletproof. 🛡️",
    ],
    "some_failed": [
        "Some tests stumbled. Time to investigate! 🔍",
        "A few tests tripped. Let's help them up! 🤝",
        "Failures detected. Your debugger is calling. 🐛",
        "Not all heroes wear caps - some fix tests. 🦸"
    ],
    "some_skipped": [
        "Some tests took a coffee break. ☕",
        "A few tests decided to skip leg day. 🏃",
        "Skipped tests are just taking a breather. 😴"
    ],
    "slow_tests": [
        "Some tests are taking the scenic route. 🐢",
        "Slow tests detected. Time to optimize! ⚡",
        "These tests need a coffee boost. ☕"
    ],
    "coverage_low": [
        "Coverage could use a boost! 📈",
        "Time to write more tests! 📝",
        "Uncovered code is lonely code. 🤝"
    ],
    "all_passed_fast": [
        "Blazing fast! All tests at warp speed. 🚀",
        "Lightning fast! Your tests are on fire. ⚡",
        "Speed demon! Tests completed in record time. 🏎️"
    ]
}

def get_random_message(category: str) -> str:
    """Get a random contextual message for a test result category."""
    messages = TEST_MESSAGES.get(category, ["Test completed."])
    return random.choice(messages)


def get_ascii_art(category: str, index: int = -1) -> str:
    """Get ASCII art for a category. If index is -1, pick random."""
    art_list = ASCII_ART_LIBRARY.get(category, [""])
    if index >= 0 and index < len(art_list):
        return art_list[index]
    return random.choice(art_list)


@dataclass
class CLIResult:
    status: Status
    command: str
    output: str
    duration_ms: float
    exit_code: int = 0
    test_details: dict = field(default_factory=dict)  # Test-specific details


class CLIOutput:
    """Cross-platform CLI output formatter for terminal results."""
    
    def __init__(self, width: int = 80):
        self.width = width
        self.results: list[CLIResult] = []
    
    def _hr(self, char: str = "-") -> str:
        return char * self.width
    
    def _section(self, title: str, char: str = "=") -> str:
        return f"\n{char * self.width}\n{title}\n{char * self.width}\n"
    
    def _status_icon(self, status: Status) -> str:
        return status.value
    
    def format_result(self, result: CLIResult) -> str:
        """Format a single CLI result with consistent styling."""
        icon = self._status_icon(result.status)
        duration = f"{result.duration_ms:.0f}ms" if result.duration_ms < 1000 else f"{result.duration_ms/1000:.2f}s"
        exit_info = f" (exit {result.exit_code})" if result.exit_code != 0 else ""
        
        header = f"{icon} {result.command} {duration}{exit_info}"
        
        # Truncate long output
        output = result.output.strip()
        if len(output) > 500:
            output = output[:500] + "\n... (truncated)"
        
        return f"{header}\n{self._hr('─')}\n{output}\n"
    
    def format_table(self, headers: list[str], rows: list[list[str]], title: str = "") -> str:
        """Format data as an ASCII table."""
        if not rows:
            return f"{self._section(title)}_No data_\n"
        
        # Calculate column widths
        col_widths = [len(h) for h in headers]
        for row in rows:
            for i, cell in enumerate(row):
                col_widths[i] = max(col_widths[i], len(str(cell)))
        
        # Build table using ASCII characters
        def format_row(cells: list[str]) -> str:
            return "| " + " | ".join(str(c).ljust(w) for c, w in zip(cells, col_widths)) + " |"
        
        sep = "+" + "+".join("-" * (w + 2) for w in col_widths) + "+"
        
        lines = []
        if title:
            lines.append(self._section(title))
        lines.append(sep)
        lines.append(format_row(headers))
        lines.append(sep)
        for row in rows:
            lines.append(format_row([str(c) for c in row]))
        lines.append(sep)
        
        return "\n".join(lines)
    
    def format_json(self, data: Any, title: str = "") -> str:
        """Pretty-print JSON with syntax highlighting hint."""
        output = json.dumps(data, indent=2, default=str, ensure_ascii=False)
        if title:
            return f"{self._section(title)}\n```json\n{output}\n```\n"
        return f"```json\n{output}\n```\n"
    
    def format_kv_pairs(self, data: dict[str, Any], title: str = "") -> str:
        """Format key-value pairs as a simple table."""
        headers = ["Key", "Value"]
        rows = [[k, str(v)] for k, v in data.items()]
        return self.format_table(headers, rows, title)
    
    def format_summary(self, results: list[CLIResult], title: str = "Summary") -> str:
        """Create a summary table of multiple results."""
        if not results:
            return ""
        
        passed = sum(1 for r in results if r.status == Status.SUCCESS)
        failed = sum(1 for r in results if r.status == Status.ERROR)
        total = len(results)
        total_time = sum(r.duration_ms for r in results)
        
        lines = [self._section(title, "=")]
        lines.append(f"Total: {total} | [OK] {passed} | [ERR] {failed} | {total_time:.0f}ms")
        lines.append("")
        
        # Status counts
        status_counts = {}
        for r in results:
            status_counts[r.status] = status_counts.get(r.status, 0) + 1
        
        for status, count in status_counts.items():
            lines.append(f"  {status.value} {status.name}: {count}")
        
        return "\n".join(lines)

    # ─── Test Result Formatting with ASCII Art ──────────────────────────────────

    def format_test_results_with_art(
        self,
        passed: int,
        failed: int,
        skipped: int,
        duration_ms: float,
        test_details: list[dict] = None,
        coverage: dict = None,
        performance: dict = None
    ) -> str:
        """
        Format test results with ASCII art and contextual messages.
        
        Args:
            passed: Number of passed tests
            failed: Number of failed tests
            skipped: Number of skipped tests
            duration_ms: Total duration in milliseconds
            test_details: Optional list of test details (name, status, duration, etc.)
            coverage: Optional coverage data (lines, branches, functions, statements)
            performance: Optional performance data (avg, max, p95, memory)
        """
        total = passed + failed + skipped
        
        # Determine category and get ASCII art
        if failed > 0:
            category = "failure"
            category_msg = "some_failed"
        elif skipped > 0 and failed == 0:
            category = "warning"
            category_msg = "some_skipped"
        else:
            category = "success"
            category_msg = "all_passed_fast" if duration_ms < 5000 else "all_passed"
        
        # Get ASCII art
        ascii_art = get_ascii_art(category)
        message = get_random_message(category_msg)
        
        # Build output
        lines = []
        
        # ASCII Art Banner
        lines.append(self._section("TEST RESULTS", "="))
        lines.append(ascii_art)
        lines.append("")
        lines.append(f"  {message}")
        lines.append("")
        
        # Summary table
        headers = ["Status", "Count", "Percentage"]
        total = passed + failed + skipped
        rows = [
            ["[OK] Passed", str(passed), f"{passed/total*100:.1f}%" if total > 0 else "0%"],
            ["[ERR] Failed", str(failed), f"{failed/total*100:.1f}%" if total > 0 else "0%"],
            ["[...] Skipped", str(skipped), f"{skipped/total*100:.1f}%" if total > 0 else "0%"],
            ["Total", str(total), "100%"],
        ]
        lines.append(self.format_table(["Status", "Count", "%"], [
            ["[OK] Passed", str(passed), f"{passed/total*100:.1f}%" if total > 0 else "0%"],
            ["[ERR] Failed", str(failed), f"{failed/total*100:.1f}%" if total > 0 else "0%"],
            ["[...] Skipped", str(skipped), f"{skipped/total*100:.1f}%" if total > 0 else "0%"],
            ["Total", str(total), "100%"],
        ], "Summary"))
        
        # Duration
        duration_str = format_duration(duration_ms)
        lines.append(f"Duration: {duration_str}")
        lines.append("")
        
        # Test details if provided
        if test_details:
            lines.append(self._section("Test Details", "-"))
            detail_rows = []
            for test in test_details:
                status_icon = {"passed": "[OK]", "failed": "[ERR]", "skipped": "[...]"}.get(test.get("status", ""), "[?]")
                name = test.get("name", "Unknown")
                duration = format_duration(test.get("duration_ms", 0))
                detail_rows.append([status_icon, name, duration])
            if detail_rows:
                lines.append(self.format_table(["Status", "Test", "Duration"], detail_rows))
            lines.append("")
        
        # Coverage info
        if coverage:
            lines.append(self._section("Coverage", "-"))
            coverage_rows = [
                ["Lines", f"{coverage.get('lines', 0)}%"],
                ["Branches", f"{coverage.get('branches', 0)}%"],
                ["Functions", f"{coverage.get('functions', 0)}%"],
                ["Statements", f"{coverage.get('statements', 0)}%"],
            ]
            lines.append(self.format_table(["Metric", "Coverage"], coverage_rows))
            lines.append("")
        
        # Performance info
        if performance:
            lines.append(self._section("Performance", "-"))
            perf_rows = [
                ["Avg Duration", format_duration(performance.get("avg_ms", 0))],
                ["Max Duration", format_duration(performance.get("max_ms", 0))],
                ["P95", format_duration(performance.get("p95_ms", 0))],
                ["Peak Memory", f"{performance.get('peak_memory_mb', 0)}MB"],
            ]
            lines.append(self.format_table(["Metric", "Value"], perf_rows))
            lines.append("")
        
        # Contextual message
        category_map = {
            "failure": "some_failed",
            "warning": "some_skipped",
            "success": "all_passed_fast" if duration_ms < 5000 else "all_passed"
        }
        message = get_random_message(category_map.get(category, "all_passed"))
        lines.append(f"💬 {message}")
        
        return "\n".join(lines)

    def format_test_suite_start(self, suite_name: str, test_count: int) -> str:
        """Format a test suite start banner with ASCII art."""
        ascii_art = get_ascii_art("running")
        lines = []
        lines.append(self._section(f"TEST SUITE: {suite_name}", "="))
        lines.append(get_ascii_art("running"))
        lines.append(f"Running {test_count} tests...")
        lines.append("")
        return "\n".join(lines)

    def format_test_suite_progress(self, current: int, total: int, current_test: str = "") -> str:
        """Format a progress update for test suite."""
        return format_progress(current, total, "Running tests", 30)


# Windows-safe print function
def safe_print(text: str) -> None:
    """Print text safely on Windows (handles encoding issues)."""
    try:
        print(text)
    except UnicodeEncodeError:
        # Fallback: replace non-ASCII characters
        safe_text = text.encode('ascii', errors='replace').decode('ascii')
        print(safe_text)


def format_kv_pairs(data: dict[str, Any], title: str = "") -> str:
    """Format key-value pairs as a simple table."""
    cli = CLIOutput()
    headers = ["Key", "Value"]
    rows = [[k, str(v)] for k, v in data.items()]
    return cli.format_table(headers, rows, title)


def format_progress(current: int, total: int, prefix: str = "", width: int = 40) -> str:
    """Format a progress bar."""
    if total == 0:
        return ""
    pct = current / total
    filled = int(width * pct)
    bar = "█" * filled + "░" * (width - filled)
    pct_str = f"{pct*100:.1f}%"
    return f"{prefix} [{bar}] {pct_str} ({current}/{total})"


def format_duration(ms: float) -> str:
    """Format duration in human-readable format."""
    if ms < 1000:
        return f"{ms:.0f}ms"
    elif ms < 60000:
        return f"{ms/1000:.1f}s"
    elif ms < 3600000:
        minutes = int(ms / 60000)
        seconds = (ms % 60000) / 1000
        return f"{minutes}m {seconds:.0f}s"
    else:
        hours = int(ms / 3600000)
        minutes = int((ms % 3600000) / 60000)
        return f"{hours}h {minutes}m"


def format_command_help(commands: dict[str, str], title: str = "Commands") -> str:
    """Format a dictionary of commands as a help table."""
    cli = CLIOutput()
    headers = ["Command", "Description"]
    rows = [[cmd, desc] for cmd, desc in commands.items()]
    return cli.format_table(headers, rows, title)


# Example usage
if __name__ == "__main__":
    cli = CLIOutput()
    
    # Example 1: Single command result
    result = CLIResult(
        status=Status.SUCCESS,
        command="pytest tests/test_retrieval_routes.py -x -q",
        output="44 passed in 65.72s",
        duration_ms=65720,
        exit_code=0
    )
    safe_print(cli.format_result(result))
    
    # Example 2: Table
    headers = ["Endpoint", "Method", "Status"]
    rows = [
        ["/api/visualizer/state", "GET", "[OK] 200"],
        ["/api/visualizer/track", "POST", "[OK] 200"],
        ["/api/animationstudio/clip", "POST", "[OK] 200"],
    ]
    safe_print(cli.format_table(headers, rows, "New API Endpoints"))
    
    # Example 3: JSON
    data = {"endpoint": "/api/visualizer/track", "status": 200, "body": {"track": "test.wav"}}
    safe_print(cli.format_json(data, "API Response"))
    
    # Example 4: Test summary
    safe_print(format_test_results(44, 0, 0, 65720))
    
    # Example 5: Key-value pairs
    config = {
        "backend_url": "http://127.0.0.1:8000",
        "frontend_url": "http://127.0.0.1:5173",
        "ollama_url": "http://127.0.0.1:11434",
        "default_model": "gemma4:e2b-it-qat",
    }
    safe_print(cli.format_kv_pairs(config, "Configuration"))
    
    # Example 6: Progress bar
    safe_print(format_progress(42, 100, "Processing", 30))
    
    # Example 7: Duration formatting
    safe_print(f"Duration: {format_duration(65720)}")
    safe_print(f"Duration: {format_duration(125000)}")
    safe_print(f"Duration: {format_duration(7200000)}")
    
    # Example 8: Command help
    commands = {
        "visualizer_open": "Open Visualizer with track",
        "threestudio_generate_scene": "Generate 3D scene from prompt",
        "animationstudio_create_clip": "Create animation clip",
        "ai_generate_scene": "Generate 3D scene via AI",
    }
    safe_print(format_command_help(commands, "Available 3D Tools"))
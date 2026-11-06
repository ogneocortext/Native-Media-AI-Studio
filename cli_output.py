"""
CLI Output Formatter - Cross-platform terminal output presentation
Works on Windows (cp1252), Linux, and macOS
Usage: from cli_output import CLIOutput; cli = CLIOutput()
"""

import json
import sys
import os
from dataclasses import dataclass
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


# Convenience function for quick formatting
def format_cli_output(command: str, output: str, duration_ms: float, 
                     status: Status = Status.SUCCESS, exit_code: int = 0) -> str:
    """Quick format a single CLI result."""
    result = CLIResult(
        status=status,
        command=command,
        output=output,
        duration_ms=duration_ms,
        exit_code=exit_code
    )
    return CLIOutput().format_result(result)


def format_test_results(passed: int, failed: int, skipped: int, duration_ms: float) -> str:
    """Format test results in a nice table."""
    cli = CLIOutput()
    headers = ["Status", "Count"]
    rows = [
        ["[OK] Passed", str(passed)],
        ["[ERR] Failed", str(failed)],
        ["[...] Skipped", str(skipped)],
        ["[...] Duration", f"{duration_ms/1000:.2f}s"],
    ]
    return cli.format_table(headers, rows, "Test Results")


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
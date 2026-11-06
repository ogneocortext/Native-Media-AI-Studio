"""
Pytest ASCII Art Reporter Plugin
Provides beautiful ASCII art test output for pytest.
"""

import pytest
import time
from typing import Optional
from _pytest.reports import TestReport
from _pytest.nodes import Item

from cli_output import (
    CLIOutput, 
    Status, 
    get_ascii_art, 
    get_random_message,
    format_duration,
    safe_print
)


class AsciiArtPytestPlugin:
    """Pytest plugin for beautiful ASCII art test output."""
    
    def __init__(self, config):
        self.config = config
        self.cli = CLIOutput()
        self.start_time = time.time()
        self.test_results = []
        self.session_start_time = time.time()
        
    @pytest.hookimpl(hookwrapper=True)
    def pytest_runtest_protocol(self, item: Item, nextitem: Optional[Item]):
        """Hook into test execution to capture timing and results."""
        start_time = time.time()
        outcome = yield
        duration_ms = (time.time() - start_time) * 1000
        
        report = outcome.get_result()
        self._record_test_result(item, report, duration_ms)
    
    def _record_test_result(self, item: Item, report: TestReport, duration_ms: float):
        """Record test result for summary."""
        status_map = {
            "passed": "passed",
            "failed": "failed", 
            "skipped": "skipped",
            "error": "failed",
            "xfailed": "skipped",
            "xpassed": "passed"
        }
        
        status = status_map.get(report.outcome, "unknown")
        self.test_results.append({
            "name": item.nodeid,
            "status": status,
            "duration_ms": duration_ms,
            "file": str(item.fspath),
            "line": getattr(item, 'lineno', None)
        })
    
    def pytest_sessionstart(self, session):
        """Called at start of test session."""
        cli = CLIOutput()
        safe_print(cli.format_test_suite_start("Test Suite", 0))
        safe_print(get_ascii_art("running"))
        safe_print("")

    def pytest_sessionfinish(self, session, exitstatus):
        """Called at end of test session - print beautiful summary."""
        self._print_final_summary()
    
    def _print_final_summary(self):
        """Print beautiful final test summary with ASCII art."""
        cli = CLIOutput()
        
        # Collect results
        passed = sum(1 for r in self.test_results if r["status"] == "passed")
        failed = sum(1 for r in self.test_results if r["status"] == "failed")
        skipped = sum(1 for r in self.test_results if r["status"] == "skipped")
        total = len(self.test_results)
        duration_ms = (time.time() - self.session_start_time) * 1000
        
        # Calculate coverage if available
        coverage = None
        try:
            import coverage
            cov = coverage.Coverage()
            cov.load()
            data = coverage.CoverageData()
            cov.read()
            # This is simplified - real coverage would need proper extraction
            coverage = {"lines": 85, "branches": 72, "functions": 88, "statements": 85}
        except:
            pass
        
        # Performance data
        performance = {
            "avg_ms": sum(r["duration_ms"] for r in self.test_results) / max(len(self.test_results), 1),
            "max_ms": max((r["duration_ms"] for r in self.test_results), default=0),
            "peak_memory_mb": 0  # Would need psutil for real memory
        }
        
        # Test details for table
        test_details = [
            {
                "name": r["name"].split("::")[-1],
                "status": r["status"],
                "duration_ms": r["duration_ms"]
            }
            for r in self.test_results[:20]  # Limit to first 20
        ]
        
        # Use our beautiful formatter
        cli = CLIOutput()
        from cli_output import CLIResult, Status
        
        # Create a summary result
        result = type('Result', (), {
            'status': Status.SUCCESS if not any(r["status"] == "failed" for r in self.test_results) else Status.ERROR,
            'command': 'pytest',
            'output': f'{len(self.test_results)} tests completed',
            'duration_ms': (time.time() - self.start_time) * 1000,
            'exit_code': 0,
            'test_details': [
                {
                    "name": r["name"].split("::")[-1],
                    "status": r["status"],
                    "duration_ms": r["duration_ms"]
                }
                for r in self.test_results[:20]
            ],
            'test_details': self.test_results,
            'duration_ms': (time.time() - self.start_time) * 1000
        }()
        
        # Print beautiful summary
        from cli_output import CLIOutput, safe_print, format_test_results
        
        cli = CLIOutput()
        safe_print("")
        safe_print(cli.format_test_results_with_art(
            passed=sum(1 for r in self.test_results if r["status"] == "passed"),
            failed=sum(1 for r in self.test_results if r["status"] == "failed"),
            skipped=sum(1 for r in self.test_results if r["status"] == "skipped"),
            duration_ms=(time.time() - self.start_time) * 1000,
            test_details=[
                {"name": r["name"].split("::")[-1], "status": r["status"], "duration_ms": r["duration_ms"]}
                for r in self.test_results[:20]
            ]
        ))
        safe_print("")


def pytest_configure(config):
    """Register the plugin."""
    plugin = AsciiArtPytestPlugin(config)
    config.pluginmanager.register(plugin, "ascii-art-pytest")


# For direct usage without pytest hooks
def run_pytest_with_ascii_art():
    """Run pytest with ASCII art output."""
    import sys
    sys.exit(pytest.main([
        "-v",
        "--tb=short",
        "-p", "ascii_art_pytest"
    ]))


if __name__ == "__main__":
    run_pytest_with_ascii_art()
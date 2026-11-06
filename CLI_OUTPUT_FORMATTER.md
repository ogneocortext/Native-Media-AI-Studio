# CLI Output Formatter - Cross-Platform Terminal Output

## Overview
A cross-platform CLI output formatter that works on Windows (cp1252), Linux, and macOS. Handles encoding issues on Windows by forcing UTF-8 stdout and using ASCII-safe characters.

## Features

### Core Classes
- **CLIOutput**: Main formatter class with methods for formatting CLI results
- **CLIResult**: Dataclass for storing command results
- **Status**: Enum for result statuses (SUCCESS, ERROR, WARNING, INFO, RUNNING, PENDING)

### Formatting Methods

| Method | Description |
|--------|-------------|
| `format_result()` | Format a single CLI command result |
| `format_table()` | ASCII table with headers and rows |
| `format_json()` | Pretty-print JSON with code block |
| `format_summary()` | Summary of multiple results |
| `format_kv_pairs()` | Key-value pairs as table |
| `format_progress()` | Progress bar with percentage |
| `format_duration()` | Human-readable duration formatting |
| `format_command_help()` | Command help table |

### Status Icons (ASCII-safe)
- `[OK]` - Success
- `[ERR]` - Error
- `[WARN]` - Warning
- `[INFO]` - Info
- `[RUN]` - Running
- `[...]` - Pending/Other

### Cross-Platform Support
- **Windows**: Forces UTF-8 stdout via `sys.stdout.reconfigure()` or `io.TextIOWrapper`
- **Linux/macOS**: Uses native UTF-8 support
- All output uses ASCII-safe characters (no Unicode box-drawing)

## Usage Examples

```python
from cli_output import CLIOutput, CLIResult, Status, safe_print, format_test_results

cli = CLIOutput()

# 1. Single command result
result = CLIResult(
    status=Status.SUCCESS,
    command="pytest tests/test_retrieval_routes.py -x -q",
    output="44 passed in 65.72s",
    duration_ms=65720,
    exit_code=0
)
safe_print(cli.format_result(result))

# 2. Table formatting
headers = ["Endpoint", "Method", "Status"]
rows = [
    ["/api/visualizer/state", "GET", "[OK] 200"],
    ["/api/visualizer/track", "POST", "[OK] 200"],
]
safe_print(cli.format_table(headers, rows, "API Endpoints"))

# 3. JSON with code block
data = {"endpoint": "/api/visualizer/track", "status": 200}
safe_print(cli.format_json(data, "API Response"))

# 4. Test summary
safe_print(format_test_results(44, 0, 0, 65720))

# 5. Key-value pairs
config = {"backend_url": "http://127.0.0.1:8000", "model": "gemma4:e2b-it-qat"}
safe_print(cli.format_kv_pairs(config, "Configuration"))

# 6. Progress bar
safe_print(format_progress(42, 100, "Processing", 30))

# 7. Duration formatting
safe_print(f"Duration: {format_duration(65720)}")  # "1m 6s"

# 8. Command help
commands = {"visualizer_open": "Open Visualizer with track"}
safe_print(format_command_help(commands, "Available Tools"))
```

## Cross-Platform Encoding Handling

The module automatically detects Windows and reconfigures stdout to use UTF-8 with error replacement:

```python
if sys.platform == "win32":
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    else:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
```

All output uses ASCII-safe characters:
- Tables use `+`, `-`, `|` instead of Unicode box-drawing
- Status uses `[OK]`, `[ERR]`, `[WARN]` instead of emoji
- Progress bars use ASCII `█` and `░` (with fallback)

## Integration with Safe Print

The `safe_print()` function handles encoding errors gracefully:

```python
from cli_output import safe_print, CLIOutput, CLIResult, Status

cli = CLIOutput()
result = CLIResult(status=Status.SUCCESS, command="test", output="done", duration_ms=100)
safe_print(cli.format_result(result))
```

On Windows, if UTF-8 fails, it falls back to ASCII with replacement characters.

## Integration with Project

The formatter is used throughout the Native Media AI Studio project for:
- Backend API test results
- Frontend build output
- API endpoint testing
- Configuration display
- Progress tracking for long-running operations
- JSON API response formatting

## Files
- `cli_output.py` - Main formatter module
- `cli_output.py` (in project root) - Demo script
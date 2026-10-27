#!/usr/bin/env python
"""Combine hook types and function body into the final hook file."""
from pathlib import Path

types_path = Path("tools/hook_types.ts")
function_path = Path("packages/frontend/src/features/visualizer/useVisualizerState.ts")

types = types_path.read_text(encoding="utf-8")
function = function_path.read_text(encoding="utf-8")

# Remove the leading docstring from the function path (it's already inserted there)
# The function file should contain only the export function
result = types + "\n" + function

target = Path("packages/frontend/src/features/visualizer/useVisualizerState.ts")
target.write_text(result, encoding="utf-8")
print("Written:", len(result), "chars")

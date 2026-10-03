"""Run subprocesses off the event loop.

A leaf module on purpose: it imports nothing from the project, so anything can
use it without risking an import cycle. It used to live in `api/outputs.py`,
which meant a *service* wanting to shell out had to reach back into the API
layer - the one layering inversion in the codebase.
"""

import asyncio
import subprocess


async def run_subprocess_thread(args: list[str], **kwargs) -> subprocess.CompletedProcess:
    """Run a subprocess in a thread pool so the event loop is not blocked."""
    return await asyncio.to_thread(subprocess.run, args, **kwargs)

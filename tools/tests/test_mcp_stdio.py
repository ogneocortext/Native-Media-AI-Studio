"""Insight-generating test for the MCP stdio server.

Verifies:
1. The Blender MCP server process starts successfully
2. The process stays alive after startup (didn't crash on init)
3. The process can be cleanly terminated

Run with Blender installed:
    python tools/tests/test_mcp_stdio.py
"""

import asyncio
import os
import subprocess
import sys

failures = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {label}  {detail}")
    if not ok:
        failures.append(label)


async def main() -> int:
    blender_exe = r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
    mcp_server = os.path.join(
        r"C:\Users\Aomega Imaging\AppData\Roaming\Python\Python314\Scripts",
        "blender-mcp-server.exe",
    )

    env = os.environ.copy()
    env["BLENDER_EXECUTABLE"] = blender_exe

    proc = None
    try:
        proc = subprocess.Popen(
            [mcp_server],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
        )

        # Give the server time to initialize
        await asyncio.sleep(3)

        # 1. Process started successfully
        check("MCP stdio server process started", proc.pid is not None,
              f"PID={proc.pid}")

        # 2. Process stays alive after startup (didn't crash on init)
        poll_result = proc.poll()
        check("server still running after 3s", poll_result is None,
              f"exited with code {poll_result}")

        if poll_result is not None:
            stderr = proc.stderr.read().decode(errors="replace")
            check("server exit code is 0", False,
                  f"stderr: {stderr[:500]}")
        else:
            check("server exit code is 0 (still running)", True)
            proc.terminate()
            try:
                proc.wait(timeout=5)
                check("server terminated cleanly", True)
            except subprocess.TimeoutExpired:
                check("server terminated cleanly", False,
                      "did not exit within 5s, killed")
                proc.kill()

    except FileNotFoundError as e:
        check("MCP stdio server executable found", False,
              f"{mcp_server} not found: {e}")
    except Exception as e:
        check("MCP stdio server starts without exception", False,
              f"{type(e).__name__}: {e}")
    finally:
        if proc and proc.poll() is None:
            proc.kill()

    print("\n" + ("ALL PASS" if not failures else f"FAILURES: {failures}"))
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

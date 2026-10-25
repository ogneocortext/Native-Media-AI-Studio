"""Insight-generating test for the MCP Streamable HTTP server.

Verifies:
1. The MCP server at http://127.0.0.1:9876/mcp accepts a streamable HTTP connection
2. The session can be initialized (session handshake completes)
3. The server exposes at least one tool
4. Tool names are returned as strings (not empty/None)

Run with the MCP server running:
    python tools/tests/test_mcp.py
"""

import asyncio
import sys
from mcp.client.streamable_http import streamablehttp_client
from mcp import ClientSession

failures = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {label}  {detail}")
    if not ok:
        failures.append(label)


async def main() -> int:
    try:
        async with streamablehttp_client("http://127.0.0.1:9876/mcp") as (
            read,
            write,
            _,
        ):
            # 1. Connection established (no exception = pass)
            check("streamable HTTP connection established", True)

            async with ClientSession(read, write) as session:
                # 2. Session initialize completes
                await session.initialize()
                check("MCP session initialized", True)

                # 3. Server exposes at least one tool
                tools = await session.list_tools()
                tool_names = [t.name for t in tools.tools]
                check("server exposes at least one tool", len(tool_names) > 0,
                      f"got {len(tool_names)} tools")

                # 4. Tool names are non-empty strings
                all_named = all(isinstance(n, str) and n.strip() for n in tool_names)
                check("all tool names are non-empty strings", all_named,
                      f"names={tool_names[:10]}")

                print(f"  Found {len(tool_names)} tools: {tool_names[:10]}")

    except Exception as e:
        check("MCP server reachable and responsive", False,
              f"{type(e).__name__}: {e}")

    print("\n" + ("ALL PASS" if not failures else f"FAILURES: {failures}"))
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

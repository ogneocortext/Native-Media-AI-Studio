#!/usr/bin/env python3
"""
Test script to verify open-computer-use MCP server works.
Connects via stdio and calls list_apps tool.
"""

import asyncio
import json
import subprocess
import sys
from typing import Any, Dict

async def test_mcp_server():
    """Test the open-computer-use MCP server."""
    print("Starting open-computer-use MCP server...")
    
    # Start the server process
    proc = await asyncio.create_subprocess_exec(
        "open-computer-use", "mcp",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    
    try:
        # Wait a moment for server to start
        await asyncio.sleep(1)
        
        # Send initialize request
        init_request = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "test-client", "version": "1.0.0"}
            }
        }
        
        request_json = json.dumps(init_request) + "\n"
        proc.stdin.write(request_json.encode())
        await proc.stdin.drain()
        
        # Read response
        response_line = await asyncio.wait_for(proc.stdout.readline(), timeout=5.0)
        if response_line:
            response = json.loads(response_line.decode())
            print(f"Initialize response: {json.dumps(response, indent=2)}")
        else:
            print("No response to initialize")
            return False
        
        # Send initialized notification
        initialized = {"jsonrpc": "2.0", "method": "notifications/initialized"}
        proc.stdin.write((json.dumps(initialized) + "\n").encode())
        await proc.stdin.drain()
        
        # Call list_apps tool
        tool_request = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "list_apps",
                "arguments": {}
            }
        }
        
        proc.stdin.write((json.dumps(tool_request) + "\n").encode())
        await proc.stdin.drain()
        
        # Read response
        response_line = await asyncio.wait_for(proc.stdout.readline(), timeout=10.0)
        if response_line:
            response = json.loads(response_line.decode())
            print(f"list_apps response: {json.dumps(response, indent=2)}")
            return True
        else:
            print("No response to list_apps")
            return False
            
    except asyncio.TimeoutError:
        print("Timeout waiting for response")
        return False
    except Exception as e:
        print(f"Error: {e}")
        return False
    finally:
        proc.terminate()
        await proc.wait()

if __name__ == "__main__":
    result = asyncio.run(test_mcp_server())
    sys.exit(0 if result else 1)
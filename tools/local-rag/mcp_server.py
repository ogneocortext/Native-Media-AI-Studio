#!/usr/bin/env python3
"""
MCP Server for local-rag
Exposes search functionality via Model Context Protocol for agent integration.

Run: python -m local_rag.mcp_server
"""

import json
import sys

from .__main__ import DEFAULT_DB, get_db, search

# MCP Protocol Types
MCP_TOOLS = {
    "local_rag_search": {
        "name": "local_rag_search",
        "description": "Search the local knowledge corpus using hybrid BM25+vector retrieval with optional cross-encoder reranking",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query text"},
                "top_k": {"type": "integer", "default": 10, "description": "Number of results to return"},
                "mode": {"type": "string", "enum": ["bm25", "vector", "hybrid", "hybrid+rerank"], "default": "hybrid", "description": "Search mode"},
                "rerank": {"type": "boolean", "default": False, "description": "Enable cross-encoder reranking"}
            },
            "required": ["query"]
        }
    },
    "local_rag_index": {
        "name": "local_rag_index",
        "description": "Index or reindex the local knowledge corpus",
        "inputSchema": {
            "type": "object",
            "properties": {
                "force": {"type": "boolean", "default": False, "description": "Force full reindex"}
            }
        }
    },
    "local_rag_status": {
        "name": "local_rag_status",
        "description": "Get index status and statistics",
        "inputSchema": {"type": "object", "properties": {}}
    }
}


def handle_initialize(request: dict) -> dict:
    return {
        "jsonrpc": "2.0",
        "id": request.get("id"),
        "result": {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "local-rag", "version": "1.0.0"}
        }
    }


def handle_tools_list(request: dict) -> dict:
    return {
        "jsonrpc": "2.0",
        "id": request.get("id"),
        "result": {"tools": list(MCP_TOOLS.values())}
    }


def handle_tools_call(request: dict) -> dict:
    params = request.get("params", {})
    tool_name = params.get("name")
    args = params.get("arguments", {})

    try:
        if tool_name == "local_rag_search":
            result = search(
                args["query"],
                DEFAULT_DB,
                top_k=args.get("top_k", 10),
                mode=args.get("mode", "hybrid"),
                rerank=args.get("rerank", False)
            )
            return {"jsonrpc": "2.0", "id": request.get("id"), "result": {"content": [{"type": "text", "text": json.dumps(result, indent=2)}]}}

        elif tool_name == "local_rag_index":
            from .__main__ import index_corpus
            result = index_corpus(Path("docs/knowledge-library").resolve(), DEFAULT_DB, force=args.get("force", False))
            return {"jsonrpc": "2.0", "id": request.get("id"), "result": {"content": [{"type": "text", "text": json.dumps(result, indent=2)}]}}

        elif tool_name == "local_rag_status":
            conn = get_db(DEFAULT_DB)
            total = conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
            fts_total = conn.execute("SELECT COUNT(*) FROM documents_fts").fetchone()[0]
            model = conn.execute("SELECT value FROM meta WHERE key='embed_model'").fetchone()
            return {
                "jsonrpc": "2.0",
                "id": request.get("id"),
                "result": {"content": [{"type": "text", "text": json.dumps({
                    "total_chunks": total,
                    "fts_chunks": fts_total,
                    "embed_model": model[0] if model else "unknown",
                    "db_path": str(DEFAULT_DB)
                }, indent=2)}]}
            }

        else:
            return {"jsonrpc": "2.0", "id": request.get("id"), "error": {"code": -32601, "message": f"Unknown tool: {tool_name}"}}

    except Exception as e:
        return {"jsonrpc": "2.0", "id": request.get("id"), "error": {"code": -32603, "message": str(e)}}


def main():
    """MCP stdio server loop."""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            continue

        method = request.get("method")

        if method == "initialize":
            response = handle_initialize(request)
        elif method == "tools/list":
            response = handle_tools_list(request)
        elif method == "tools/call":
            response = handle_tools_call(request)
        else:
            response = {"jsonrpc": "2.0", "id": request.get("id"), "error": {"code": -32601, "message": f"Unknown method: {method}"}}

        print(json.dumps(response), flush=True)


if __name__ == "__main__":
    from pathlib import Path
    main()

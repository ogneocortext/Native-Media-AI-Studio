"""MCP Server for local-rag using MCP Python SDK v2."""


from mcp.server import MCPServer
from mcp.types import TextContent

from .config import Config, get_config
from .database import close_pool, init_database
from .indexing import index_corpus
from .search import get_status, search


def create_server(config: Config | None = None) -> MCPServer:
    """Create MCP server instance."""
    if config is None:
        config = get_config()

    mcp = MCPServer(
        name=config.mcp.server_name,
        version=config.mcp.server_version,
        instructions=config.mcp.instructions
    )

    @mcp.tool()
    def local_rag_search(
        query: str,
        top_k: int = 10,
        mode: str = "hybrid",
        rerank: bool = False
    ) -> list[TextContent]:
        """
        Search the local knowledge corpus using hybrid BM25+vector retrieval
        with optional cross-encoder reranking.
        
        Args:
            query: Search query text
            top_k: Number of results to return (default: 10)
            mode: Search mode - bm25, vector, hybrid, hybrid+rerank (default: hybrid)
            rerank: Enable cross-encoder reranking (default: false)
        """
        result = search(
            query=query,
            top_k=top_k,
            mode=mode,
            rerank=rerank,
            config=config
        )
        return [TextContent(type="text", text=str(result))]

    @mcp.tool()
    def local_rag_index(
        force: bool = False,
        corpus: str | None = None
    ) -> list[TextContent]:
        """
        Index or reindex the local knowledge corpus.
        
        Args:
            force: Force full reindex (default: false)
            corpus: Corpus root directory (optional, uses config default)
        """
        corpus_path = Path(corpus) if corpus else config.corpus.root
        result = index_corpus(
            corpus_root=corpus_path,
            db_path=config.database.path,
            force=force,
            config=config
        )
        return [TextContent(type="text", text=str(result))]

    @mcp.tool()
    def local_rag_status() -> list[TextContent]:
        """
        Get index status and statistics.
        """
        result = get_status()
        return [TextContent(type="text", text=str(result))]

    @mcp.tool()
    def local_rag_config() -> list[TextContent]:
        """
        Get current configuration.
        """
        return [TextContent(type="text", text=config.to_toml())]

    return mcp


def run_server(config: Config | None = None):
    """Run MCP server with stdio transport."""
    if config is None:
        config = get_config()

    # Initialize database
    init_database()

    try:
        mcp = create_server(config)
        # Run with stdio transport (default)
        mcp.run()
    finally:
        close_pool()


if __name__ == "__main__":
    from pathlib import Path
    run_server()
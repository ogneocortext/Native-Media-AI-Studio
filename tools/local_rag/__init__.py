"""local-rag: Local-first hybrid RAG for markdown corpus."""

__version__ = "2.0.0"

from .config import Config, get_config, set_config
from .search import search, get_status
from .indexing import index_corpus
from .mcp_server import create_server, run_server

__all__ = [
    "Config",
    "get_config",
    "set_config",
    "search",
    "get_status",
    "index_corpus",
    "create_server",
    "run_server",
]
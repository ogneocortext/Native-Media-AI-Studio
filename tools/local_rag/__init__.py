"""local-rag: Local-first hybrid RAG for markdown corpus."""

__version__ = "2.0.0"

from .config import Config, get_config, set_config
from .indexing import index_corpus
from .mcp_server import create_server, run_server
from .search import get_status, search

__all__ = [
    "Config",
    "create_server",
    "get_config",
    "get_status",
    "index_corpus",
    "run_server",
    "search",
    "set_config",
]
"""Configuration management for local-rag."""

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

try:
    import tomllib
except ImportError:
    import tomli as tomllib


@dataclass
class EmbeddingConfig:
    model: str = "nomic-embed-text"
    dim: int = 768
    batch_size: int = 32
    max_workers: int = 4
    timeout: int = 60
    ollama_host: str = "http://127.0.0.1:11434"


@dataclass
class ChunkingConfig:
    chunk_tokens: int = 500
    overlap_tokens: int = 50


@dataclass
class SearchConfig:
    default_top_k: int = 10
    rerank_top_k: int = 5
    rrf_k: int = 60


@dataclass
class RerankConfig:
    model: str = "BAAI/bge-reranker-v2-m3"
    max_length: int = 512


@dataclass
class DatabaseConfig:
    path: Path = field(default_factory=lambda: Path.home() / ".local-rag" / "index.sqlite3")
    wal_mode: bool = True


@dataclass
class CorpusConfig:
    root: Path = field(default_factory=lambda: Path("docs/knowledge-library"))
    extensions: tuple = (".md", ".markdown")


@dataclass
class MCPConfig:
    server_name: str = "local-rag"
    server_version: str = "2.0.0"
    instructions: str = "Local-first hybrid RAG for markdown corpus with BM25+vector search and cross-encoder reranking"


@dataclass
class Config:
    embedding: EmbeddingConfig = field(default_factory=EmbeddingConfig)
    chunking: ChunkingConfig = field(default_factory=ChunkingConfig)
    search: SearchConfig = field(default_factory=SearchConfig)
    rerank: RerankConfig = field(default_factory=RerankConfig)
    database: DatabaseConfig = field(default_factory=DatabaseConfig)
    corpus: CorpusConfig = field(default_factory=CorpusConfig)
    mcp: MCPConfig = field(default_factory=MCPConfig)

    @classmethod
    def from_env(cls) -> "Config":
        """Create config from environment variables."""
        config = cls()

        # Embedding
        if model := os.getenv("LOCAL_RAG_EMBED_MODEL"):
            config.embedding.model = model
        if dim := os.getenv("LOCAL_RAG_EMBED_DIM"):
            config.embedding.dim = int(dim)
        if batch := os.getenv("LOCAL_RAG_BATCH_SIZE"):
            config.embedding.batch_size = int(batch)
        if workers := os.getenv("LOCAL_RAG_MAX_WORKERS"):
            config.embedding.max_workers = int(workers)
        if host := os.getenv("LOCAL_RAG_OLLAMA_HOST"):
            config.embedding.ollama_host = host

        # Chunking
        if chunk := os.getenv("LOCAL_RAG_CHUNK_TOKENS"):
            config.chunking.chunk_tokens = int(chunk)
        if overlap := os.getenv("LOCAL_RAG_OVERLAP_TOKENS"):
            config.chunking.overlap_tokens = int(overlap)

        # Search
        if top_k := os.getenv("LOCAL_RAG_TOP_K"):
            config.search.default_top_k = int(top_k)
        if rerank_k := os.getenv("LOCAL_RAG_RERANK_TOP_K"):
            config.search.rerank_top_k = int(rerank_k)

        # Database
        if db_path := os.getenv("LOCAL_RAG_DB"):
            config.database.path = Path(db_path).expanduser().resolve()

        # Corpus
        if corpus := os.getenv("LOCAL_RAG_CORPUS"):
            config.corpus.root = Path(corpus).resolve()

        return config

    @classmethod
    def from_file(cls, path: Path) -> "Config":
        """Load config from TOML file."""
        if not path.exists():
            raise FileNotFoundError(f"Config file not found: {path}")

        with open(path, "rb") as f:
            data = tomllib.load(f)

        config = cls()

        if "embedding" in data:
            config.embedding = EmbeddingConfig(**data["embedding"])
        if "chunking" in data:
            config.chunking = ChunkingConfig(**data["chunking"])
        if "search" in data:
            config.search = SearchConfig(**data["search"])
        if "rerank" in data:
            config.rerank = RerankConfig(**data["rerank"])
        if "database" in data:
            config.database = DatabaseConfig(**data["database"])
        if "corpus" in data:
            config.corpus = CorpusConfig(**data["corpus"])
        if "mcp" in data:
            config.mcp = MCPConfig(**data["mcp"])

        return config

    @classmethod
    def load(cls, config_path: Optional[Path] = None) -> "Config":
        """Load config with precedence: file > env > defaults."""
        config = cls.from_env()

        if config_path and config_path.exists():
            file_config = cls.from_file(config_path)
            # Merge file config over env config
            for field_name in ["embedding", "chunking", "search", "rerank", "database", "corpus", "mcp"]:
                file_value = getattr(file_config, field_name)
                if any(getattr(file_value, f) != getattr(getattr(cls, field_name).default_factory(), f)
                       for f in file_value.__dataclass_fields__):
                    setattr(config, field_name, file_value)

        return config

    def to_toml(self) -> str:
        """Export config as TOML."""
        import tomli_w
        data = {
            "embedding": self.embedding.__dict__,
            "chunking": self.chunking.__dict__,
            "search": self.search.__dict__,
            "rerank": self.rerank.__dict__,
            "database": {k: str(v) if isinstance(v, Path) else v for k, v in self.database.__dict__.items()},
            "corpus": {k: str(v) if isinstance(v, Path) else v for k, v in self.corpus.__dict__.items()},
            "mcp": self.mcp.__dict__,
        }
        return tomli_w.dumps(data)


# Global config instance
_config: Optional[Config] = None


def get_config() -> Config:
    """Get global config instance."""
    global _config
    if _config is None:
        _config = Config.load()
    return _config


def set_config(config: Config):
    """Set global config instance."""
    global _config
    _config = config
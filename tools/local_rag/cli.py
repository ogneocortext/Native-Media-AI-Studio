"""CLI for local-rag."""

import json
import sys
from pathlib import Path
from typing import Optional

import typer

from .config import Config, get_config, set_config
from .indexing import index_corpus
from .search import search, get_status
from .database import init_database, close_pool


app = typer.Typer(
    name="local-rag",
    help="Local-first hybrid RAG for markdown corpus",
    add_completion=False,
    no_args_is_help=True
)


# ─── Global Options ───────────────────────────────────────────────────────────

def common_options(ctx: typer.Context):
    """Add common options to context."""
    pass


# ─── Commands ─────────────────────────────────────────────────────────────────

@app.command()
def index(
    corpus: Optional[Path] = typer.Option(
        None, "--corpus", "-c", help="Corpus root directory", exists=True, file_okay=False, dir_okay=True
    ),
    db: Optional[Path] = typer.Option(
        None, "--db", "-d", help="Database path", file_okay=True, dir_okay=False
    ),
    force: bool = typer.Option(False, "--force", "-f", help="Force full reindex"),
    config_file: Optional[Path] = typer.Option(
        None, "--config", help="Config file path", exists=True, file_okay=True, dir_okay=False
    ),
    json_output: bool = typer.Option(False, "--json", help="Output JSON"),
):
    """Index markdown corpus."""
    # Load config
    if config_file:
        config = Config.from_file(config_file)
        if corpus:
            config.corpus.root = corpus
        if db:
            config.database.path = db
        set_config(config)
    else:
        config = get_config()
        if corpus:
            config.corpus.root = corpus
        if db:
            config.database.path = db
        set_config(config)

    # Progress callback
    def progress(stage: str, current: int, total: int):
        if not json_output:
            if total > 0:
                typer.echo(f"[{stage}] {current}/{total}", err=True)
            else:
                typer.echo(f"[{stage}]", err=True)

    try:
        result = index_corpus(
            corpus_root=config.corpus.root,
            db_path=config.database.path,
            force=force,
            progress_callback=progress,
            config=config,
            json_output=json_output
        )
        if json_output:
            typer.echo(json.dumps(result, indent=2))
        else:
            typer.echo(f"Status: {result['status']}")
            if result['status'] != 'skipped':
                typer.echo(f"Files indexed: {result['files_indexed']}")
                typer.echo(f"Files skipped: {result['files_skipped']}")
                typer.echo(f"Total chunks: {result['total_chunks']}")
            if result.get('errors'):
                typer.echo(f"Errors: {len(result['errors'])}", err=True)
    finally:
        close_pool()


@app.command(name="search")
def cmd_search(
    query: str = typer.Argument(..., help="Search query"),
    top_k: int = typer.Option(10, "--top-k", "-k", help="Number of results"),
    mode: str = typer.Option("hybrid", "--mode", "-m", help="Search mode: bm25, vector, hybrid, hybrid+rerank"),
    rerank: bool = typer.Option(False, "--rerank", "-r", help="Enable cross-encoder reranking"),
    db: Optional[Path] = typer.Option(None, "--db", "-d", help="Database path"),
    config_file: Optional[Path] = typer.Option(None, "--config", help="Config file path"),
    json_output: bool = typer.Option(False, "--json", help="Output JSON"),
):
    """Search the corpus."""
    # Load config
    if config_file:
        config = Config.from_file(config_file)
        if db:
            config.database.path = db
        set_config(config)
    elif db:
        config = get_config()
        config.database.path = db
        set_config(config)
    else:
        config = get_config()

    try:
        result = search(
            query=query,
            top_k=top_k,
            mode=mode,
            rerank=rerank,
            config=config
        )
        if json_output:
            typer.echo(json.dumps(result, indent=2))
        else:
            for r in result['results']:
                score = r['score']
                rerank_score = r.get('rerank_score')
                score_str = f"{score:.4f}"
                if rerank_score is not None:
                    score_str += f" (rerank: {rerank_score:.4f})"
                typer.echo(f"[{score_str}] {r['rel_path']} (chunk {r['chunk_index']})")
                typer.echo(f"  {r['text'][:200]}...")
                typer.echo()
    finally:
        close_pool()


@app.command()
def status(
    db: Optional[Path] = typer.Option(None, "--db", "-d", help="Database path"),
    config_file: Optional[Path] = typer.Option(None, "--config", help="Config file path"),
    json_output: bool = typer.Option(False, "--json", help="Output JSON"),
):
    """Get index status and statistics."""
    if config_file:
        config = Config.from_file(config_file)
        if db:
            config.database.path = db
        set_config(config)
    elif db:
        config = get_config()
        config.database.path = db
        set_config(config)
    else:
        config = get_config()

    try:
        result = get_status()
        if json_output:
            typer.echo(json.dumps(result, indent=2))
        else:
            typer.echo(f"Total chunks: {result['total_chunks']}")
            typer.echo(f"FTS chunks: {result['fts_chunks']}")
            typer.echo(f"Embedding model: {result['embed_model']} ({result['embed_dim']}d)")
            typer.echo(f"Reranker available: {result['reranker_available']}")
            typer.echo(f"DB path: {result['db_path']}")
            if result['indexed_at']:
                import datetime
                dt = datetime.datetime.fromtimestamp(float(result['indexed_at']))
                typer.echo(f"Last indexed: {dt.strftime('%Y-%m-%d %H:%M:%S')}")
    finally:
        close_pool()


@app.command()
def config_show(
    config_file: Optional[Path] = typer.Option(None, "--config", help="Config file path"),
):
    """Show current configuration."""
    if config_file:
        config = Config.from_file(config_file)
    else:
        config = get_config()

    typer.echo(config.to_toml())


@app.command()
def config_init(
    output: Path = typer.Option(Path("local-rag.toml"), "--output", "-o", help="Output config file"),
):
    """Generate default configuration file."""
    config = Config()
    toml_str = config.to_toml()
    output.write_text(toml_str)
    typer.echo(f"Config written to {output}")


@app.command()
def serve(
    db: Optional[Path] = typer.Option(None, "--db", "-d", help="Database path"),
    config_file: Optional[Path] = typer.Option(None, "--config", help="Config file path"),
):
    """Run MCP stdio server."""
    if config_file:
        config = Config.from_file(config_file)
        if db:
            config.database.path = db
        set_config(config)
    elif db:
        config = get_config()
        config.database.path = db
        set_config(config)
    else:
        config = get_config()

    # Import and run MCP server
    from .mcp_server import run_server
    run_server(config)


# ─── Entry Point ──────────────────────────────────────────────────────────────

def main():
    """Main entry point."""
    app()


if __name__ == "__main__":
    main()
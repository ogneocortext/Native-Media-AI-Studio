"""
Docs API — serves Obsidian vault (docs/knowledge-library) and project docs to the frontend.
Connects Documentation page directly to vault so edits appear instantly.
"""

import logging
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..core.config import PROJECT_ROOT
from ..services.doc_search_index import DocIndex

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/docs", tags=["Docs"])

DOCS_ROOT = PROJECT_ROOT / "docs"
VAULT_ROOT = DOCS_ROOT / "knowledge-library"


def _parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    """Extract YAML frontmatter if present. Returns (meta, body)."""
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            fm = text[3:end].strip()
            body = text[end + 4 :].lstrip("\n")
            meta: dict[str, Any] = {}
            # Minimal YAML parse for tags/aliases/title
            for line in fm.splitlines():
                if ":" in line:
                    k, v = line.split(":", 1)
                    k = k.strip()
                    v = v.strip()
                    if k in ("tags", "aliases", "cssclasses"):
                        # Handle list like "- tag" or "[a, b]"
                        if v.startswith("["):
                            v = v.strip("[]")
                            meta[k] = [x.strip().strip('"').strip("'") for x in v.split(",") if x.strip()]
                        elif not v:
                            # multiline list follows
                            continue
                        else:
                            meta[k] = [v.strip().strip('"').strip("'")]
                    else:
                        meta[k] = v.strip().strip('"').strip("'")
            # Handle multiline tags
            if "tags" not in meta:
                tags = re.findall(r"^\s*-\s*(\S.+)", fm, re.MULTILINE)
                # crude but captures tags list
                if tags and any(t in fm for t in ["tags:"]):
                    # Only keep first block after tags:
                    m = re.search(r"tags:\s*\n((?:\s*-\s*.+\n)+)", fm)
                    if m:
                        meta["tags"] = [x.strip().strip('"').strip("'").lstrip("- ").strip() for x in m.group(1).strip().splitlines()]
            return meta, body
    return {}, text


def _title_from_path(path: Path) -> str:
    name = path.stem.replace("-", " ").replace("_", " ")
    # Keep original caps for known files
    return name.title()


class DocEntry(BaseModel):
    path: str  # relative to DOCS_ROOT, posix
    vault_path: str  # relative to VAULT_ROOT if inside vault, else same as path
    title: str
    file_type: str
    tags: list[str] = []
    aliases: list[str] = []
    in_vault: bool


class DocContent(BaseModel):
    path: str
    title: str
    tags: list[str] = []
    aliases: list[str] = []
    raw_markdown: str
    html_hint: str | None = None


def _scan_docs() -> list[DocEntry]:
    entries: list[DocEntry] = []
    if not DOCS_ROOT.exists():
        return entries

    # Walk docs, but skip hidden, node_modules, .obsidian internals
    seen: set[str] = set()
    for p in list(DOCS_ROOT.rglob("*.md")) + list(VAULT_ROOT.glob("*.json")) + list(VAULT_ROOT.glob("*.canvas")):
        if ".obsidian" in p.parts:
            continue
        if "node_modules" in p.parts:
            continue
        key = p.resolve().as_posix()
        if key in seen:
            continue
        seen.add(key)
        try:
            rel = p.relative_to(DOCS_ROOT).as_posix()
            in_vault = p.is_relative_to(VAULT_ROOT) if hasattr(p, "is_relative_to") else str(p).startswith(str(VAULT_ROOT))
            vault_rel = p.relative_to(VAULT_ROOT).as_posix() if in_vault else rel
            # Quick frontmatter read for title/tags
            try:
                text = p.read_text(encoding="utf-8", errors="ignore")
                # JSON / canvas files: extract title from JSON content
                if p.suffix.lower() in (".json", ".canvas"):
                    import json
                    data = json.loads(text)
                    if p.suffix.lower() == ".canvas":
                        title = data.get("title") or "Knowledge Graph"
                        tags = ["canvas", "knowledge-graph"]
                        aliases = []
                    else:
                        title = data.get("title") or data.get("name") or _title_from_path(p)
                        tags = []
                        aliases = []
                else:
                    meta, _ = _parse_frontmatter(text)
                    title = meta.get("title") or _title_from_path(p)
                    # If file starts with "# Title", use that
                    m = re.search(r"^#\s+(.+)", text, re.MULTILINE)
                    if m:
                        title = m.group(1).strip()[:80]
                    tags = meta.get("tags", [])
                    aliases = meta.get("aliases", [])
            except Exception:
                title = _title_from_path(p)
                tags = []
                aliases = []
            entries.append(DocEntry(
                path=rel,
                vault_path=vault_rel,
                title=title,
                file_type="vault" if in_vault else "guide",
                tags=tags if isinstance(tags, list) else [],
                aliases=aliases if isinstance(aliases, list) else [],
                in_vault=in_vault,
            ))
        except Exception:
            continue

    # Sort: vault first, then guides, then alphabetically
    entries.sort(key=lambda e: (0 if e.in_vault else 1, e.title.lower()))
    return entries


@router.get("/list", response_model=list[DocEntry])
async def list_docs(
    vault_only: bool = Query(False, description="Only vault (knowledge-library) files"),
    search: str | None = Query(None, description="Filter by title/tags/path"),
) -> list[DocEntry]:
    """List all docs — vault + guides. Used by Documentation page."""
    entries = _scan_docs()
    if vault_only:
        entries = [e for e in entries if e.in_vault]
    if search:
        q = search.lower()
        entries = [e for e in entries if q in e.title.lower() or q in e.path.lower() or any(q in t.lower() for t in e.tags)]
    return entries


@router.get("/file", response_model=DocContent)
async def get_doc_file(path: str = Query(..., description="Relative path from docs/ e.g. knowledge-library/index.md or guides/MUSIC_VIDEO_GUIDE.md")) -> DocContent:
    """Get raw markdown for a doc file."""
    # Sanitize
    clean = path.strip().lstrip("/").replace("\\", "/")
    if ".." in clean or clean.startswith("."):
        raise HTTPException(status_code=400, detail="Invalid path")
    full = (DOCS_ROOT / clean).resolve()
    # Ensure inside DOCS_ROOT
    try:
        full.relative_to(DOCS_ROOT.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Path escapes docs") from None

    if not full.exists() or not full.is_file():
        raise HTTPException(status_code=404, detail=f"Doc not found: {clean}")
    if full.suffix.lower() not in (".md", ".json", ".canvas"):
        raise HTTPException(status_code=400, detail="Only .md, .json and .canvas are served")

    try:
        text = full.read_text(encoding="utf-8", errors="ignore")
        meta, body = _parse_frontmatter(text)
        # Title from first H1 or filename
        m = re.search(r"^#\s+(.+)", text, re.MULTILINE)
        title = m.group(1).strip() if m else _title_from_path(full)
        tags = meta.get("tags", [])
        aliases = meta.get("aliases", [])
        return DocContent(
            path=clean,
            title=title,
            tags=tags if isinstance(tags, list) else [],
            aliases=aliases if isinstance(aliases, list) else [],
            raw_markdown=text,
            html_hint=None,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read doc: {e}") from e


@router.get("/vault", response_model=list[DocEntry])
async def list_vault() -> list[DocEntry]:
    """Shortcut: list only vault files (knowledge-library)."""
    return await list_docs(vault_only=True)


@router.get("/manifest")
async def get_manifest():
    """Shortcut: return agent.manifest.json directly for AI agents."""
    manifest_path = VAULT_ROOT / "agent.manifest.json"
    if not manifest_path.exists():
        raise HTTPException(status_code=404, detail="agent.manifest.json not found in vault")
    import json
    return json.loads(manifest_path.read_text(encoding="utf-8"))


@router.get("/prompts")
async def get_prompts():
    """Shortcut: return prompts.json directly for AI agents."""
    prompts_path = VAULT_ROOT / "prompts.json"
    if not prompts_path.exists():
        raise HTTPException(status_code=404, detail="prompts.json not found in vault")
    import json
    return json.loads(prompts_path.read_text(encoding="utf-8"))


@router.get("/codebase")
async def get_codebase():
    """Shortcut: return codebase.json directly for AI agents."""
    codebase_path = VAULT_ROOT / "codebase.json"
    if not codebase_path.exists():
        raise HTTPException(status_code=404, detail="codebase.json not found in vault")
    import json
    return json.loads(codebase_path.read_text(encoding="utf-8"))


@router.get("/api-registry")
async def get_api_registry():
    """Shortcut: return api-registry.json directly for AI agents."""
    registry_path = VAULT_ROOT / "api-registry.json"
    if not registry_path.exists():
        raise HTTPException(status_code=404, detail="api-registry.json not found in vault")
    import json
    return json.loads(registry_path.read_text(encoding="utf-8"))


@router.get("/mcp-registry")
async def get_mcp_registry():
    """Shortcut: return mcp-registry.json directly for AI agents."""
    registry_path = VAULT_ROOT / "mcp-registry.json"
    if not registry_path.exists():
        raise HTTPException(status_code=404, detail="mcp-registry.json not found in vault")
    import json
    return json.loads(registry_path.read_text(encoding="utf-8"))


@router.get("/bootstrap")
async def agent_bootstrap():
    """Single-call agent onboarding: returns manifest, codebase structure, API registry, MCP registry, and system health.
    Use this endpoint first when an agent connects — one call gives everything needed to operate."""
    import json

    # Load all registry files
    def _load_json(name: str) -> dict | None:
        p = VAULT_ROOT / name
        if p.exists():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                return None
        return None

    # Scan docs for context
    entries = _scan_docs()
    vault_entries = [e for e in entries if e.in_vault]

    # System config
    try:
        from ..core.config import config
        ports = {
            "backend": config.backend_port,
            "frontend": config.frontend_port,
            "comfyui": getattr(config, 'comfyui_port', 8188),
        }
    except Exception:
        ports = {"backend": 8000, "frontend": 5173, "comfyui": 8188}

    return {
        "version": "2026-08-24",
        "project": "Native Media AI Studio",
        "description": "Full-stack music-video creation suite: React/Vite frontend + FastAPI backend + ComfyUI + Blender + Unity MCP",
        "ports": ports,
        "manifest": _load_json("agent.manifest.json"),
        "codebase": _load_json("codebase.json"),
        "api_registry": _load_json("api-registry.json"),
        "mcp_registry": _load_json("mcp-registry.json"),
        "prompts": _load_json("prompts.json"),
        "vault_docs": [
            {"path": e.vault_path, "title": e.title, "tags": e.tags}
            for e in vault_entries
            if not e.path.endswith(".json")
        ],
        "quick_start": {
            "step_1": "POST /api/audio/analyze — upload audio file",
            "step_2": "GET /api/health/gpu — check VRAM before generation",
            "step_3": "POST /api/video/generate-section — generate video (use manifest.styles for prompt)",
            "step_4": "GET /api/jobs/{job_id} — poll until completed",
            "step_5": "GET /api/outputs — list generated files",
        },
    }


#: Cached index, keyed by a fingerprint of the corpus (file count + newest mtime +
#: total size). Rebuilt only when the docs actually change, so a query does not
#: re-read 1.8 MB - the previous implementation did that on every call, measured
#: at 547 ms.
_index_cache: tuple[tuple, "DocIndex"] | None = None


def _corpus_fingerprint() -> tuple:
    """Cheap change detector: count, newest mtime, total bytes."""
    newest = 0.0
    total = 0
    count = 0
    try:
        for p in DOCS_ROOT.rglob("*.md"):
            if ".obsidian" in p.parts or "node_modules" in p.parts:
                continue
            st = p.stat()
            newest = max(newest, st.st_mtime)
            total += st.st_size
            count += 1
    except OSError:
        return (0, 0.0, 0)
    return (count, newest, total)


def get_doc_index() -> "DocIndex":
    """Return the cached inverted index, rebuilding it if the corpus changed."""
    global _index_cache
    fp = _corpus_fingerprint()
    if _index_cache is not None and _index_cache[0] == fp:
        return _index_cache[1]

    idx = DocIndex()
    for entry in _scan_docs():
        body = ""
        full = DOCS_ROOT / entry.path
        if full.suffix.lower() == ".md" and full.exists():
            try:
                body = full.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                body = ""
        idx.add(
            path=entry.path,
            title=entry.title,
            tags=entry.tags,
            aliases=entry.aliases,
            in_vault=entry.in_vault,
            file_type=entry.file_type,
            body=body,
        )
    idx.finalize()
    _index_cache = (fp, idx)
    logger.info(
        "Doc search index built: %d docs, %d terms", idx.doc_count, idx.term_count
    )
    return idx


def invalidate_doc_index() -> None:
    """Drop the cached index; the next query rebuilds it."""
    global _index_cache
    _index_cache = None


@router.get("/search")
async def search_docs(
    q: str = Query(..., min_length=2, description="Search query"),
    scope: str = Query("all", description="Search scope: all, titles, content, vault"),
    limit: int = Query(20, ge=1, le=50, description="Max results"),
) -> list[dict]:
    """Ranked full-text search over all documentation.

    Tokenised BM25 rather than substring matching. Substring scoring was
    measured producing confidently wrong results on this corpus: `og` matched
    documents containing "log"/"dialog", `vr` matched "VRAM" and "over", `jobid`
    matched "video", and each outranked genuine matches because a rare substring
    scores higher than a common exact token. Identifiers are split on snake_case
    and camelCase so `queue_manager.py` is findable by `queue manager`.

    `scope` is accepted for backwards compatibility with the previous
    implementation; ranking no longer branches on it because the index already
    weights title, tag, alias and path terms above body prose.
    """
    return get_doc_index().search(q, limit=limit)


@router.get("/structure")
async def get_project_structure(
    depth: int = Query(3, ge=1, le=5, description="Directory depth"),
    include_files: bool = Query(True, description="Include files or just directories"),
) -> dict:
    """Return project directory tree for AI agents. Scoped to key directories."""
    root = PROJECT_ROOT

    def _tree(path: Path, current_depth: int, max_depth: int) -> dict | list | None:
        if current_depth > max_depth:
            return None

        name = path.name
        # Skip hidden, node_modules, __pycache__, .git, venv
        if name.startswith(".") or name in ("node_modules", "__pycache__", "venv", ".git", "dist", "build", ".next"):
            return None

        if path.is_file():
            if not include_files:
                return None
            return {"name": name, "type": "file", "size": path.stat().st_size}

        if path.is_dir():
            children = []
            try:
                for child in sorted(path.iterdir()):
                    result = _tree(child, current_depth + 1, max_depth)
                    if result is not None:
                        children.append(result)
            except PermissionError:
                pass
            return {"name": name, "type": "dir", "children": children}

        return None

    # Build structure for key directories
    structure = {}
    key_dirs = ["packages", "docs", "tools", "scripts", "config", ".kilo"]
    for d in key_dirs:
        dir_path = root / d
        if dir_path.exists():
            result = _tree(dir_path, 1, depth)
            if result:
                structure[d] = result

    # Add root-level files
    root_files = []
    for f in sorted(root.iterdir()):
        if f.is_file() and f.name in ("README.md", "CHANGELOG.md", "Guidelines.md", "opencode.json", "package.json"):
            root_files.append({"name": f.name, "type": "file", "size": f.stat().st_size})
    if root_files:
        structure["_root_files"] = root_files

    return {"root": str(root), "structure": structure, "depth": depth}

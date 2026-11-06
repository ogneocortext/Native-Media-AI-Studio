"""
MCP Skills HTTP exposure for the Native Media AI Studio frontend agent.

Exposes the skills folder (tools/mcp/skills/) over HTTP so the frontend
agent can discover, read, and use skills for tool-calling.

Endpoints:
  GET    /api/mcp/skills/list          List all skills with frontmatter
  GET    /api/mcp/skills/get           Get a skill's full content by URI
  GET    /api/mcp/skills/{skill}/{path} Serve a skill file (SKILL.md, references/GUIDE.md, etc.)
  POST   /api/mcp/execute-tool         Execute any tool via backend API
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from ..core.config import PROJECT_ROOT

logger = logging.getLogger(__name__)

router = APIRouter(tags=["MCP Skills"])

# Resolve skills directory - check multiple possible locations since the
# backend may run from different working directories.
_CANDIDATE_SKILLS_DIRS = [
    PROJECT_ROOT / "tools" / "mcp" / "skills",
    Path(__file__).resolve().parents[5] / "tools" / "mcp" / "skills",
    Path(r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio")
    / "tools"
    / "mcp"
    / "skills",
]

_SKILLS_DIR = None
for _cand in _CANDIDATE_SKILLS_DIRS:
    if _cand.exists():
        _SKILLS_DIR = _cand
        break

if _SKILLS_DIR is None:
    _SKILLS_DIR = _CANDIDATE_SKILLS_DIRS[0]

logger.info("MCP Skills directory: %s (exists: %s)", _SKILLS_DIR, _SKILLS_DIR.exists())

BACKEND_BASE = "http://127.0.0.1:8000"


class SkillInfo(BaseModel):
    name: str
    description: str
    version: str | None = None
    server: str | None = None
    tools: list[str] = []
    tags: list[str] = []
    uri: str
    resources: list[dict[str, Any]] = []


class SkillContent(BaseModel):
    name: str
    version: str | None = None
    server: str | None = None
    tools: list[str] = []
    tags: list[str] = []
    frontmatter: dict[str, Any]
    body: str
    resources: list[dict[str, Any]] = []


class ExecuteToolRequest(BaseModel):
    tool_name: str
    arguments: dict[str, Any] = {}


class ExecuteToolResponse(BaseModel):
    success: bool
    result: Any = None
    error: str | None = None


def _parse_frontmatter(content: str) -> tuple[dict[str, Any], str]:
    """Parse YAML frontmatter from a SKILL.md file. Returns (frontmatter, body)."""
    if not content.startswith("---\n"):
        return {}, content
    end = content.find("\n---\n", 4)
    if end == -1:
        return {}, content
    fm_text = content[4:end]
    body = content[end + 5 :]
    frontmatter: dict[str, Any] = {}
    current_key: str | None = None
    for line in fm_text.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        # Multi-line list item
        if stripped.startswith("- ") and current_key is not None:
            val = stripped[2:].strip().strip('"').strip("'")
            existing = frontmatter.get(current_key)
            if isinstance(existing, list):
                existing.append(val)
            elif existing is not None:
                frontmatter[current_key] = [existing, val]
            else:
                frontmatter[current_key] = [val]
            continue
        if ":" in stripped:
            key, _, value = stripped.partition(":")
            key = key.strip()
            value = value.strip()
            current_key = key
            if value == "":
                # Multi-line list follows
                frontmatter[key] = []
            elif value.startswith("[") and value.endswith("]"):
                inner = value[1:-1].strip()
                if inner:
                    frontmatter[key] = [v.strip().strip('"').strip("'") for v in inner.split(",")]
                else:
                    frontmatter[key] = []
            else:
                frontmatter[key] = value.strip('"').strip("'")
    return frontmatter, body


def _discover_skills() -> list[SkillInfo]:
    """Scan the skills folder and return SkillInfo for each skill."""
    skills: list[SkillInfo] = []
    if not _SKILLS_DIR.exists():
        logger.warning("Skills directory does not exist: %s", _SKILLS_DIR)
        return skills
    for skill_dir in sorted(_SKILLS_DIR.iterdir()):
        if not skill_dir.is_dir():
            continue
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.exists():
            continue
        try:
            content = skill_md.read_text(encoding="utf-8")
            frontmatter, _body = _parse_frontmatter(content)
            resources: list[dict[str, Any]] = []
            skill_md_stat = skill_md.stat()
            resources.append(
                {
                    "uri": f"skill://{skill_dir.name}/SKILL.md",
                    "name": "SKILL.md",
                    "mimeType": "text/markdown",
                    "size": skill_md_stat.st_size,
                }
            )
            refs_dir = skill_dir / "references"
            if refs_dir.exists():
                for ref_file in sorted(refs_dir.iterdir()):
                    if ref_file.is_file() and ref_file.suffix == ".md":
                        stat = ref_file.stat()
                        resources.append(
                            {
                                "uri": f"skill://{skill_dir.name}/references/{ref_file.name}",
                                "name": ref_file.name,
                                "mimeType": "text/markdown",
                                "size": stat.st_size,
                            }
                        )
            skills.append(
                SkillInfo(
                    name=frontmatter.get("name", skill_dir.name),
                    description=frontmatter.get("description", ""),
                    version=frontmatter.get("version"),
                    server=frontmatter.get("server"),
                    tools=frontmatter.get("tools", []),
                    tags=frontmatter.get("tags", []),
                    uri=f"skill://{skill_dir.name}/SKILL.md",
                    resources=resources,
                )
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to parse skill %s: %s", skill_dir.name, exc)
    return skills


async def _http_post(path: str, payload: dict[str, Any], timeout: int = 30) -> Any:
    """Make a POST request to the backend using async httpx."""
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(BACKEND_BASE + path, json=payload)
        if resp.status_code >= 400:
            return {"error": f"HTTP {resp.status_code}: {resp.text}"}
        return resp.json()


async def _http_get(path: str, timeout: int = 30) -> Any:
    """Make a GET request to the backend using async httpx."""
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.get(BACKEND_BASE + path)
        if resp.status_code >= 400:
            return {"error": f"HTTP {resp.status_code}: {resp.text}"}
        return resp.json()


def _error_response(msg: str) -> ExecuteToolResponse:
    """Helper to create a standardized error response."""
    return ExecuteToolResponse(success=False, error=msg)


@router.get("/api/mcp/skills/list", response_model=list[SkillInfo])
async def skills_list() -> list[SkillInfo]:
    """List all skills with their frontmatter metadata."""
    return _discover_skills()


@router.get("/api/mcp/skills/get", response_model=SkillContent)
async def skills_get(uri: str) -> SkillContent:
    """Get a skill's full content by URI (e.g. skill://vision/SKILL.md)."""
    match = re.match(r"^skill://([^/]+)/(.+)$", uri)
    if not match:
        raise HTTPException(status_code=400, detail=f"Invalid skill URI: {uri}")
    skill_name, rel_path = match.group(1), match.group(2)
    skill_dir = _SKILLS_DIR / skill_name
    if not skill_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Skill not found: {skill_name}")
    file_path = skill_dir / rel_path
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {rel_path}")
    try:
        content = file_path.read_text(encoding="utf-8")
        frontmatter, body = _parse_frontmatter(content)
        stat = file_path.stat()
        return SkillContent(
            name=frontmatter.get("name", skill_name),
            version=frontmatter.get("version"),
            server=frontmatter.get("server"),
            tools=frontmatter.get("tools", []),
            tags=frontmatter.get("tags", []),
            frontmatter=frontmatter,
            body=body,
            resources=[
                {
                    "uri": f"skill://{skill_name}/{rel_path}",
                    "name": rel_path,
                    "mimeType": "text/markdown",
                    "size": stat.st_size,
                }
            ],
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to read skill: {exc}") from exc


@router.get("/api/mcp/skills/{skill_name}/{path:path}")
async def skills_file(skill_name: str, path: str) -> PlainTextResponse:
    """Serve a skill file (SKILL.md, references/GUIDE.md, etc.) as plain text."""
    skill_dir = _SKILLS_DIR / skill_name
    if not skill_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Skill not found: {skill_name}")
    file_path = skill_dir / path
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    try:
        content = file_path.read_text(encoding="utf-8")
        return PlainTextResponse(content, media_type="text/markdown")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to read file: {exc}") from exc


async def _tool_list_audio_library(args: dict) -> ExecuteToolResponse:
    result = await _http_get("/api/audio/files")
    if isinstance(result, dict) and "error" in result:
        return _error_response(result["error"])
    # /api/audio/files returns {"files": [{filename, relative_path,
    # size_bytes, modified, folder}, ...]} — the old "outputs" key never
    # existed, so this tool always reported an empty library.
    raw = result.get("files") if isinstance(result, dict) else result
    files = [
        {
            "filename": o.get("filename", o.get("relative_path", "")),
            "relative_path": o.get("relative_path", ""),
            "file_type": o.get("file_type", o.get("folder", "unknown")),
            "size_bytes": o.get("size_bytes", 0),
            "modified_at": o.get("modified_at", o.get("modified", "")),
        }
        for o in (raw or [])
    ]
    return ExecuteToolResponse(
        success=True,
        result={
            "files": files,
            "count": len(files),
            "by_type": _group_by_type(files),
        },
    )


async def _tool_search_audio_library(args: dict) -> ExecuteToolResponse:
    """Search the library by cached analysis fields (tempo, key, energy, sections)."""
    filters = {
        k: args[k]
        for k in (
            "min_tempo",
            "max_tempo",
            "min_energy",
            "max_energy",
            "min_sections",
            "max_sections",
            "key",
            "limit",
        )
        if args.get(k) is not None
    }
    result = await _http_post("/api/audio/search", filters, timeout=30)
    if isinstance(result, dict) and "error" in result:
        return _error_response(result["error"])
    return ExecuteToolResponse(success=True, result=result)


async def _tool_analyze_audio(args: dict) -> ExecuteToolResponse:
    filename = args.get("filename")
    if not filename:
        return _error_response(
            "filename is required. Provide an audio filename from the library "
            "(use list_audio_library first to discover available files)."
        )
    # Try POST /api/audio/analyze first, then GET /api/analysis/{filename}
    result = await _http_post(
        "/api/audio/analyze",
        {"filename": filename},
        timeout=60,
    )
    if isinstance(result, dict) and "error" in result:
        # Fallback to GET endpoint
        result = await _http_get(f"/api/analysis/{filename}", timeout=60)
        if isinstance(result, dict) and "error" in result:
            return ExecuteToolResponse(
                success=False,
                error=f"Audio analysis failed: {result['error']}",
            )
    return ExecuteToolResponse(
        success=True, result=_enhance_audio_analysis(result, filename)
    )


async def _tool_create_music_video_plan(args: dict) -> ExecuteToolResponse:
    filename = args.get("filename")
    if not filename:
        return ExecuteToolResponse(
            success=False,
            error="filename is required. Provide an audio filename from the library.",
        )
    style = args.get("style", "")
    result = await _http_post(
        "/api/from-prompt",
        {"prompt": f"Create a music video plan for {filename}", "style": style},
        timeout=60,
    )
    if isinstance(result, dict) and "error" in result:
        return ExecuteToolResponse(success=False, error=result["error"])
    return ExecuteToolResponse(success=True, result=result)

# ── IMAGE GENERATION ───────────────────────────────────────


async def _tool_generate_image(args: dict) -> ExecuteToolResponse:
    prompt = args.get("prompt")
    if not prompt:
        return ExecuteToolResponse(
            success=False,
            error="prompt is required. Describe the image you want to generate.",
        )
    result = await _http_post(
        "/api/generate-image",
        {
            "description": args.get("prompt", ""),
            "width": args.get("width", 1024),
            "height": args.get("height", 1024),
        },
        timeout=120,
    )
    if isinstance(result, dict) and "error" in result:
        return ExecuteToolResponse(success=False, error=result["error"])
    return ExecuteToolResponse(success=True, result=result)


async def _tool_generate_video(args: dict) -> ExecuteToolResponse:
    prompt = args.get("prompt")
    if not prompt:
        return ExecuteToolResponse(
            success=False,
            error="prompt is required. Describe the video you want to generate.",
        )
    result = await _http_post(
        "/api/music-video/generate-preview",
        {
            "prompt": args.get("prompt", ""),
            "duration": args.get("duration", 4),
            "fps": args.get("fps", 24),
            "width": args.get("width", 1024),
            "height": args.get("height", 768),
            "negative_prompt": args.get("negative_prompt", ""),
        },
        timeout=120,
    )
    if isinstance(result, dict) and "error" in result:
        return ExecuteToolResponse(success=False, error=result["error"])
    return ExecuteToolResponse(success=True, result=result)


async def _tool_analyze_image(args: dict) -> ExecuteToolResponse:
    image_path = args.get("image_path")
    if not image_path:
        return ExecuteToolResponse(
            success=False,
            error="image_path is required. Provide the path or URL to an image file.",
        )
    result = await _http_post(
        "/api/analyze-visualizer",
        {
            "image_path": image_path,
            "prompt": args.get("prompt", "Describe this image in detail."),
        },
        timeout=60,
    )
    if isinstance(result, dict) and "error" in result:
        return ExecuteToolResponse(success=False, error=result["error"])
    return ExecuteToolResponse(success=True, result=result)

# ── 3D GENERATION ──────────────────────────────────────────


async def _tool_suggest_3d_prompt(args: dict) -> ExecuteToolResponse:
    idea = args.get("idea")
    if not idea:
        return ExecuteToolResponse(
            success=False,
            error="idea is required. Describe the 3D object or scene you want to create.",
        )
    result = await _http_post(
        "/api/music-video/generate-preview",
        {
            "prompt": idea,
            "category": args.get("category", "character"),
            "style": args.get("style", ""),
        },
        timeout=60,
    )
    if isinstance(result, dict) and "error" in result:
        return ExecuteToolResponse(success=False, error=result["error"])
    return ExecuteToolResponse(success=True, result=result)


async def _tool_generate_3d_concept(args: dict) -> ExecuteToolResponse:
    description = args.get("description")
    if not description:
        return ExecuteToolResponse(
            success=False,
            error="description is required. Describe the 3D concept you want to generate.",
        )
    result = await _http_post(
        "/api/generate-image",
        {
            "description": description,
            "category": args.get("category", "3d-character"),
            "width": args.get("width", 1024),
            "height": args.get("height", 1024),
        },
        timeout=120,
    )
    if isinstance(result, dict) and "error" in result:
        return ExecuteToolResponse(success=False, error=result["error"])
    return ExecuteToolResponse(success=True, result=result)


async def _tool_plan_blender_script(args: dict) -> ExecuteToolResponse:
    description = args.get("description")
    if not description:
        return ExecuteToolResponse(
            success=False,
            error="description is required. Describe what you want to build in Blender.",
        )
    result = await _http_post(
        "/api/music-video/generate-preview",
        {
            "prompt": description,
            "category": args.get("target", "mesh"),
            "style": args.get("model", "qwen3.5:4b"),
        },
        timeout=60,
    )
    if isinstance(result, dict) and "error" in result:
        return ExecuteToolResponse(success=False, error=result["error"])
    return ExecuteToolResponse(success=True, result=result)

# ── REMIX / MASHUP ─────────────────────────────────────────


async def _tool_remix_list_sources(args: dict) -> ExecuteToolResponse:
    result = await _http_get("/api/audio/remix/sources")
    if isinstance(result, dict) and "error" in result:
        return ExecuteToolResponse(success=False, error=result["error"])
    return ExecuteToolResponse(success=True, result=result)


async def _tool_remix_probe(args: dict) -> ExecuteToolResponse:
    track = args.get("track")
    if not track:
        return ExecuteToolResponse(
            success=False,
            error="track is required. Provide the name of a source track to probe.",
        )
    result = await _http_post(f"/api/audio/remix/probe?track={track}", {}, timeout=30)
    if isinstance(result, dict) and "error" in result:
        return ExecuteToolResponse(success=False, error=result["error"])
    return ExecuteToolResponse(success=True, result=result)


async def _tool_remix_from_prompt(args: dict) -> ExecuteToolResponse:
    prompt = args.get("prompt")
    if not prompt:
        return ExecuteToolResponse(
            success=False,
            error="prompt is required. Describe the mashup you want to create in natural language.",
        )
    result = await _http_post(
        "/api/from-prompt",
        {"prompt": prompt, "base_recipe": args.get("base_recipe")},
        timeout=60,
    )
    if isinstance(result, dict) and "error" in result:
        return ExecuteToolResponse(success=False, error=result["error"])
    return ExecuteToolResponse(success=True, result=result)


async def _tool_remix_preview(args: dict) -> ExecuteToolResponse:
    recipe = args.get("recipe")
    if not recipe:
        return ExecuteToolResponse(
            success=False,
            error="recipe is required. Provide a remix recipe object.",
        )
    result = await _http_post(
        "/api/preview",
        {"recipe": recipe},
        timeout=60,
    )
    if isinstance(result, dict) and "error" in result:
        return ExecuteToolResponse(success=False, error=result["error"])
    return ExecuteToolResponse(success=True, result=result)


async def _tool_remix_build(args: dict) -> ExecuteToolResponse:
    recipe = args.get("recipe")
    if not recipe:
        return ExecuteToolResponse(
            success=False,
            error="recipe is required. Provide a remix recipe object.",
        )
    result = await _http_post(
        "/api/build",
        {"recipe": recipe, "overwrite": args.get("overwrite", False)},
        timeout=120,
    )
    if isinstance(result, dict) and "error" in result:
        return ExecuteToolResponse(success=False, error=result["error"])
    return ExecuteToolResponse(success=True, result=result)


async def _tool_remix_job_status(args: dict) -> ExecuteToolResponse:
    job_id = args.get("job_id")
    if not job_id:
        return ExecuteToolResponse(
            success=False,
            error="job_id is required. Provide the job ID from a remix build or enhance call.",
        )
    result = await _http_get(f"/api/jobs/{job_id}")
    if isinstance(result, dict) and "error" in result:
        return ExecuteToolResponse(success=False, error=result["error"])
    return ExecuteToolResponse(success=True, result=result)


async def _tool_remix_enhance(args: dict) -> ExecuteToolResponse:
    name = args.get("name")
    if not name:
        return ExecuteToolResponse(
            success=False,
            error="name is required. Provide the name of an existing remix to enhance.",
        )
    result = await _http_post(
        f"/api/{name}/enhance",
        {
            "target_peak_dbfs": args.get("target_peak_dbfs", -1.0),
            "master_ceiling_dbfs": args.get("master_ceiling_dbfs", -1.0),
            "vocal_balance_db": args.get("vocal_balance_db", 0.0),
            "output_format": args.get("output_format", "wav"),
        },
        timeout=120,
    )
    if isinstance(result, dict) and "error" in result:
        return ExecuteToolResponse(success=False, error=result["error"])
    return ExecuteToolResponse(success=True, result=result)


async def _tool_remix_list(args: dict) -> ExecuteToolResponse:
    result = await _http_get("/api/list")
    if isinstance(result, dict) and "error" in result:
        return ExecuteToolResponse(success=False, error=result["error"])
    return ExecuteToolResponse(success=True, result=result)


async def _tool_remix_get_file(args: dict) -> ExecuteToolResponse:
    name = args.get("name")
    which = args.get("which")
    if not name or not which:
        return ExecuteToolResponse(
            success=False,
            error="name and which are required. which must be one of: vocals, drums, bass, other, master.",
        )
    return ExecuteToolResponse(
        success=True,
        result={"url": f"{BACKEND_BASE}/api/{name}/file/{which}"},
    )

# ── CONTEXT ────────────────────────────────────────────────


async def _tool_update_mcp_context(args: dict) -> ExecuteToolResponse:
    context = args.get("context")
    if not context:
        return ExecuteToolResponse(
            success=False,
            error="context is required. Provide a context object to merge into the shared state.",
        )
    result = await _http_post("/api/context", context, timeout=30)
    if isinstance(result, dict) and "error" in result:
        return ExecuteToolResponse(success=False, error=result["error"])
    return ExecuteToolResponse(success=True, result=result)

# ── WORKFLOW TOOLS (multi-step operations) ─────────────────


async def _tool_create_music_video_from_audio(args: dict) -> ExecuteToolResponse:
    """End-to-end: analyze audio → create plan → generate cover image."""
    filename = args.get("filename")
    if not filename:
        return ExecuteToolResponse(
            success=False,
            error="filename is required. Provide an audio filename from the library.",
        )
    style = args.get("style", "")
    # Step 1: Analyze audio
    analysis = await _http_post(
        "/api/audio/analyze",
        {"filename": filename},
        timeout=60,
    )
    if isinstance(analysis, dict) and "error" in analysis:
        return ExecuteToolResponse(
            success=False, error=f"Audio analysis failed: {analysis['error']}"
        )
    # Step 2: Create music video plan
    plan = await _http_post(
        "/api/from-prompt",
        {"prompt": f"Create a music video plan for {filename}", "style": style},
        timeout=60,
    )
    if isinstance(plan, dict) and "error" in plan:
        return ExecuteToolResponse(
            success=False, error=f"Plan creation failed: {plan['error']}"
        )
    # Step 3: Generate a concept image based on the plan
    concept_prompt = (
        f"Music video concept for {filename}: {args.get('prompt', 'cinematic music video')}"
    )
    concept = await _http_post(
        "/api/generate-image",
        {"description": concept_prompt, "width": 1024, "height": 1024},
        timeout=120,
    )
    if isinstance(concept, dict) and "error" in concept:
        return ExecuteToolResponse(
            success=False, error=f"Concept generation failed: {concept['error']}"
        )
    return ExecuteToolResponse(
        success=True,
        result={
            "filename": filename,
            "analysis": analysis,
            "plan": plan,
            "concept_image": concept,
            "workflow": "analyze → plan → concept",
        },
    )


async def _tool_create_3d_asset_from_prompt(args: dict) -> ExecuteToolResponse:
    """End-to-end: suggest prompt → generate concept image."""
    idea = args.get("idea")
    if not idea:
        return ExecuteToolResponse(
            success=False,
            error="idea is required. Describe the 3D asset you want to create.",
        )
    # Step 1: Suggest a refined prompt
    suggestion = await _http_post(
        "/api/music-video/generate-preview",
        {
            "prompt": idea,
            "category": args.get("category", "character"),
            "style": args.get("style", ""),
        },
        timeout=60,
    )
    if isinstance(suggestion, dict) and "error" in suggestion:
        return ExecuteToolResponse(
            success=False, error=f"Prompt suggestion failed: {suggestion['error']}"
        )
    # Step 2: Generate concept image
    refined_prompt = (
        suggestion.get("prompt", idea) if isinstance(suggestion, dict) else idea
    )
    concept = await _http_post(
        "/api/generate-image",
        {
            "description": refined_prompt,
            "category": args.get("category", "character"),
            "width": 1024,
            "height": 1024,
        },
        timeout=120,
    )
    if isinstance(concept, dict) and "error" in concept:
        return ExecuteToolResponse(
            success=False, error=f"Concept generation failed: {concept['error']}"
        )
    return ExecuteToolResponse(
        success=True,
        result={
            "idea": idea,
            "suggested_prompt": refined_prompt,
            "category": args.get("category", "character"),
            "concept_image": concept,
            "workflow": "suggest_prompt → generate_concept",
        },
    )


async def _tool_create_complete_music_video(args: dict) -> ExecuteToolResponse:
    """End-to-end pipeline: analyze audio → plan → generate images → create video."""
    filename = args.get("filename")
    if not filename:
        return ExecuteToolResponse(
            success=False,
            error="filename is required. Provide an audio filename from the library.",
        )
    style = args.get("style", "cinematic")
    # Step 1: Analyze audio
    analysis = await _http_post(
        "/api/audio/analyze",
        {"filename": filename},
        timeout=60,
    )
    if isinstance(analysis, dict) and "error" in analysis:
        return ExecuteToolResponse(
            success=False, error=f"Audio analysis failed: {analysis['error']}"
        )
    # Step 2: Create music video plan
    plan = await _http_post(
        "/api/from-prompt",
        {"prompt": f"Create a complete music video plan for {filename}", "style": style},
        timeout=60,
    )
    if isinstance(plan, dict) and "error" in plan:
        return ExecuteToolResponse(
            success=False, error=f"Plan creation failed: {plan['error']}"
        )
    # Step 3: Generate concept image
    concept_prompt = f"Music video concept for {filename}: {style} style"
    concept = await _http_post(
        "/api/generate-image",
        {"description": concept_prompt, "width": 1024, "height": 1024},
        timeout=120,
    )
    if isinstance(concept, dict) and "error" in concept:
        return ExecuteToolResponse(
            success=False, error=f"Concept generation failed: {concept['error']}"
        )
    # Step 4: Generate video
    video = await _http_post(
        "/api/music-video/generate-preview",
        {
            "prompt": f"Music video for {filename} in {style} style",
            "duration": args.get("duration", 4),
            "fps": 24,
            "width": 1024,
            "height": 768,
        },
        timeout=120,
    )
    if isinstance(video, dict) and "error" in video:
        return ExecuteToolResponse(
            success=False, error=f"Video generation failed: {video['error']}"
        )
    return ExecuteToolResponse(
        success=True,
        result={
            "filename": filename,
            "analysis": analysis,
            "plan": plan,
            "concept_image": concept,
            "video": video,
            "workflow": "analyze → plan → concept → video",
        },
    )


_TOOL_HANDLERS: dict[str, Any] = {
    "list_audio_library": _tool_list_audio_library,
    "search_audio_library": _tool_search_audio_library,
    "analyze_audio": _tool_analyze_audio,
    "create_music_video_plan": _tool_create_music_video_plan,
    "generate_image": _tool_generate_image,
    "generate_video": _tool_generate_video,
    "analyze_image": _tool_analyze_image,
    "suggest_3d_prompt": _tool_suggest_3d_prompt,
    "generate_3d_concept": _tool_generate_3d_concept,
    "plan_blender_script": _tool_plan_blender_script,
    "remix_list_sources": _tool_remix_list_sources,
    "remix_probe": _tool_remix_probe,
    "remix_from_prompt": _tool_remix_from_prompt,
    "remix_preview": _tool_remix_preview,
    "remix_build": _tool_remix_build,
    "remix_job_status": _tool_remix_job_status,
    "remix_enhance": _tool_remix_enhance,
    "remix_list": _tool_remix_list,
    "remix_get_file": _tool_remix_get_file,
    "update_mcp_context": _tool_update_mcp_context,
    "create_music_video_from_audio": _tool_create_music_video_from_audio,
    "create_3d_asset_from_prompt": _tool_create_3d_asset_from_prompt,
    "create_complete_music_video": _tool_create_complete_music_video,
}


@router.post("/api/mcp/execute-tool", response_model=ExecuteToolResponse)
async def execute_tool(request: ExecuteToolRequest) -> ExecuteToolResponse:
    """Execute any tool via the backend API.

    This is a unified entry point so the frontend agent can call any tool
    without knowing which backend module handles it.
    """
    tool_name = request.tool_name
    args = request.arguments

    try:
        # ── AUDIO LIBRARY ──────────────────────────────────────────
        handler = _TOOL_HANDLERS.get(tool_name)
        if handler is None:
            return ExecuteToolResponse(success=False, error=f"Unknown tool: {tool_name}")
        return await handler(args)
    except httpx.ConnectError:
        return ExecuteToolResponse(
            success=False, error="Backend not reachable at http://127.0.0.1:8000"
        )
    except Exception as exc:  # noqa: BLE001
        return ExecuteToolResponse(success=False, error=str(exc))


@router.get("/api/mcp/tools", response_model=list[dict[str, Any]])
async def tools_list() -> list[dict[str, Any]]:
    """List all available tools with detailed descriptions and parameter schemas."""
    tools = [
        # ── AUDIO LIBRARY ──────────────────────────────────────────
        {
            "name": "list_audio_library",
            "description": "List all audio tracks available in the library with file types, sizes, and modification dates. Use this to discover what audio files are available for analysis or music video creation.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
        {
            "name": "search_audio_library",
            "description": "Search the audio library by cached analysis fields: tempo range (BPM), detected key (e.g. 'E major'), average energy (0-1), and section count. Use this to find tracks matching musical criteria without analyzing every file. Call GET /api/audio/analysis-fields for the full list of queryable analysis fields.",
            "parameters": {
                "type": "object",
                "properties": {
                    "min_tempo": {"type": "number", "description": "Minimum BPM."},
                    "max_tempo": {"type": "number", "description": "Maximum BPM."},
                    "min_energy": {"type": "number", "description": "Minimum average energy (0-1)."},
                    "max_energy": {"type": "number", "description": "Maximum average energy (0-1)."},
                    "min_sections": {"type": "integer", "description": "Minimum number of detected song sections."},
                    "max_sections": {"type": "integer", "description": "Maximum number of detected song sections."},
                    "key": {"type": "string", "description": "Detected musical key, case-insensitive (e.g. 'E major', 'A minor')."},
                    "limit": {"type": "integer", "description": "Max results (default 100, cap 500).", "default": 100},
                },
                "required": [],
            },
        },
        {
            "name": "analyze_audio",
            "description": "Analyze an audio file to extract BPM, beats, energy curve, sections, and other characteristics. Returns detailed analysis including tempo, key, and structural information useful for music video synchronization.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {
                        "type": "string",
                        "description": "The filename of an audio track from the library (e.g., 'track.mp3'). Use list_audio_library first to discover available files.",
                    }
                },
                "required": ["filename"],
            },
        },
        {
            "name": "create_music_video_plan",
            "description": "Create a music video production plan from audio analysis. Recommends visual styles, scene structure, pacing, and key moments based on the audio's characteristics.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {
                        "type": "string",
                        "description": "Audio filename from the library.",
                    },
                    "style": {
                        "type": "string",
                        "description": "Visual style preference (e.g., 'cinematic', 'cyberpunk', 'retro', 'minimalist', 'energetic').",
                        "default": "",
                    },
                },
                "required": ["filename"],
            },
        },
        # ── IMAGE GENERATION ───────────────────────────────────────
        {
            "name": "generate_image",
            "description": "Generate a still image from a text prompt using Stable Diffusion. Use for creating concept art, album covers, thumbnails, or visual references.",
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {
                        "type": "string",
                        "description": "Text description of the image to generate. Be descriptive about subject, style, lighting, and mood.",
                    },
                    "negative_prompt": {
                        "type": "string",
                        "description": "Things to avoid in the image (e.g., 'blurry, low quality, distorted').",
                        "default": "",
                    },
                    "width": {
                        "type": "number",
                        "description": "Image width in pixels.",
                        "default": 1024,
                    },
                    "height": {
                        "type": "number",
                        "description": "Image height in pixels.",
                        "default": 1024,
                    },
                },
                "required": ["prompt"],
            },
        },
        {
            "name": "generate_video",
            "description": "Generate a short video clip from a text prompt using video generation models. Use for creating music video clips, B-roll, or visual content.",
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {
                        "type": "string",
                        "description": "Text description of the video content.",
                    },
                    "negative_prompt": {
                        "type": "string",
                        "description": "Things to avoid in the video.",
                        "default": "",
                    },
                    "width": {
                        "type": "number",
                        "description": "Video width in pixels.",
                        "default": 1024,
                    },
                    "height": {
                        "type": "number",
                        "description": "Video height in pixels.",
                        "default": 768,
                    },
                    "duration": {
                        "type": "number",
                        "description": "Video duration in seconds.",
                        "default": 4,
                    },
                    "fps": {
                        "type": "number",
                        "description": "Frames per second.",
                        "default": 24,
                    },
                },
                "required": ["prompt"],
            },
        },
        {
            "name": "analyze_image",
            "description": "Analyze an image using Ollama vision models. Returns description, objects, colors, composition, and mood. Useful for understanding existing visual content or planning modifications.",
            "parameters": {
                "type": "object",
                "properties": {
                    "image_path": {
                        "type": "string",
                        "description": "Path or URL to the image file to analyze.",
                    },
                    "prompt": {
                        "type": "string",
                        "description": "Specific question about the image (e.g., 'What is the dominant color?', 'Describe the lighting').",
                        "default": "Describe this image in detail.",
                    },
                },
                "required": ["image_path"],
            },
        },
        # ── 3D GENERATION ──────────────────────────────────────────
        {
            "name": "suggest_3d_prompt",
            "description": "Enhance a raw 3D idea into a detailed prompt with material, texture, lighting, and composition guidance. Helps translate vague ideas into actionable 3D generation prompts.",
            "parameters": {
                "type": "object",
                "properties": {
                    "idea": {
                        "type": "string",
                        "description": "Raw character, object, or scene idea.",
                    },
                    "category": {
                        "type": "string",
                        "description": "Asset category: character, clothing, skin_material, environment, or object.",
                        "default": "character",
                    },
                    "style": {
                        "type": "string",
                        "description": "Optional style hint (cyberpunk, fantasy, realistic, stylized, etc.).",
                        "default": "",
                    },
                },
                "required": ["idea"],
            },
        },
        {
            "name": "generate_3d_concept",
            "description": "Generate a concept image optimized for 3D conversion (Hunyuan3D-friendly). Creates a reference image that can be used as a base for 3D modeling.",
            "parameters": {
                "type": "object",
                "properties": {
                    "description": {
                        "type": "string",
                        "description": "Subject description for the concept image.",
                    },
                    "category": {
                        "type": "string",
                        "description": "Asset category: 3d-character, 3d-character-texture, 3d-clothing, 3d-skin-material, 3d-environment.",
                        "default": "3d-character",
                    },
                    "width": {
                        "type": "number",
                        "description": "Image width in pixels.",
                        "default": 1024,
                    },
                    "height": {
                        "type": "number",
                        "description": "Image height in pixels.",
                        "default": 1024,
                    },
                },
                "required": ["description"],
            },
        },
        {
            "name": "plan_blender_script",
            "description": "Generate an executable Blender Python (bpy) script from a natural-language description. Creates scripts for creating 3D models, scenes, animations, and materials.",
            "parameters": {
                "type": "object",
                "properties": {
                    "description": {
                        "type": "string",
                        "description": "What to build in Blender (e.g., 'low-poly knight with metal armor').",
                    },
                    "target": {
                        "type": "string",
                        "description": "Asset type hint: mesh, material, rig, scene, lighting, cleanup, uv.",
                        "default": "mesh",
                    },
                    "model": {
                        "type": "string",
                        "description": "Ollama text model to use for script generation.",
                        "default": "qwen3.5:4b",
                    },
                },
                "required": ["description"],
            },
        },
        # ── CONTEXT ────────────────────────────────────────────────
        {
            "name": "update_mcp_context",
            "description": "Update the shared MCP context with character, scene, audio, and visualization state so other tools and servers can read it.",
            "parameters": {
                "type": "object",
                "properties": {
                    "context": {
                        "type": "object",
                        "description": "Partial context to merge. Keys: character?, scene?, audio?, visualization?",
                    },
                },
                "required": ["context"],
            },
        },
        # ── REMIX / MASHUP ─────────────────────────────────────────
        {
            "name": "remix_list_sources",
            "description": "List tracks with separated stems and per-stem availability. Shows which tracks have vocals, drums, bass, and other stems available for remixing.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
        {
            "name": "remix_probe",
            "description": "Get tempo (BPM) and key analysis for a source track. Essential for beat-matched remixing.",
            "parameters": {
                "type": "object",
                "properties": {
                    "track": {
                        "type": "string",
                        "description": "Source track (stem directory) name to probe.",
                    }
                },
                "required": ["track"],
            },
        },
        {
            "name": "remix_from_prompt",
            "description": "Draft a mashup recipe from a natural-language sentence. Describes which stems to combine, how to mix them, and what effects to apply.",
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {
                        "type": "string",
                        "description": "Natural-language mashup request (e.g., 'combine the vocals from track A with the drums from track B').",
                    },
                    "base_recipe": {
                        "type": "object",
                        "description": "Optional existing recipe to revise or build upon.",
                    },
                },
                "required": ["prompt"],
            },
        },
        {
            "name": "remix_preview",
            "description": "Resolve a remix recipe without rendering: timeline, stretch ratios, measured levels, warnings. Use this to verify a recipe before building.",
            "parameters": {
                "type": "object",
                "properties": {
                    "recipe": {
                        "type": "object",
                        "description": "The remix recipe object to preview.",
                    }
                },
                "required": ["recipe"],
            },
        },
        {
            "name": "remix_build",
            "description": "Render a remix recipe to output/remixes/<name>/ with separated stems (vocals, drums, bass, other) and a mastered master track.",
            "parameters": {
                "type": "object",
                "properties": {
                    "recipe": {
                        "type": "object",
                        "description": "The remix recipe object with layers, gains, and timing.",
                    },
                    "overwrite": {
                        "type": "boolean",
                        "description": "Replace existing remix if it already exists.",
                        "default": False,
                    },
                },
                "required": ["recipe"],
            },
        },
        {
            "name": "remix_job_status",
            "description": "Check the status of a remix build or enhance job. Returns status (queued, running, done, failed) and progress details.",
            "parameters": {
                "type": "object",
                "properties": {
                    "job_id": {
                        "type": "string",
                        "description": "Job ID returned by remix_build or remix_enhance.",
                    }
                },
                "required": ["job_id"],
            },
        },
        {
            "name": "remix_enhance",
            "description": "Master an already-rendered remix with the Suno enhancement chain. Applies EQ, compression, limiting, and vocal balancing for professional sound.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Remix name (the output directory name).",
                    },
                    "target_peak_dbfs": {
                        "type": "number",
                        "description": "Target peak level in dBFS.",
                        "default": -1.0,
                    },
                    "master_ceiling_dbfs": {
                        "type": "number",
                        "description": "Master ceiling level in dBFS.",
                        "default": -1.0,
                    },
                    "vocal_balance_db": {
                        "type": "number",
                        "description": "Vocal balance adjustment in dB.",
                        "default": 0.0,
                    },
                    "output_format": {
                        "type": "string",
                        "description": "Output format: 'wav' or 'mp3'.",
                        "default": "wav",
                    },
                },
                "required": ["name"],
            },
        },
        {
            "name": "remix_list",
            "description": "List rendered remixes with their manifests, including stem availability and master file paths.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
        {
            "name": "remix_get_file",
            "description": "Get the playable URL for one stem (vocals, drums, bass, other) or the mastered master of a rendered remix.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Remix name.",
                    },
                    "which": {
                        "type": "string",
                        "description": "Which stem to retrieve: vocals, drums, bass, other, or master.",
                    },
                },
                "required": ["name", "which"],
            },
        },
    ]
    return tools


def _group_by_type(files: list[dict]) -> dict[str, int]:
    """Group audio files by type for summary."""
    counts: dict[str, int] = {}
    for f in files:
        ft = f.get("file_type", "unknown")
        counts[ft] = counts.get(ft, 0) + 1
    return counts


def _enhance_audio_analysis(analysis: dict, filename: str) -> dict:
    """Enhance audio analysis results with actionable insights."""
    enhanced = dict(analysis) if isinstance(analysis, dict) else {"raw": str(analysis)}
    enhanced["filename"] = filename
    enhanced["analysis_timestamp"] = __import__("datetime").datetime.now().isoformat()
    # Add actionable insights based on common audio properties
    bpm = enhanced.get("bpm") or enhanced.get("tempo")
    if bpm:
        try:
            bpm_val = float(bpm)
            if bpm_val < 80:
                enhanced["tempo_category"] = "slow"
                enhanced["suggested_style"] = "cinematic, ambient, atmospheric"
            elif bpm_val < 120:
                enhanced["tempo_category"] = "moderate"
                enhanced["suggested_style"] = "pop, rock, indie"
            else:
                enhanced["tempo_category"] = "fast"
                enhanced["suggested_style"] = "electronic, dance, energetic"
        except (ValueError, TypeError):
            pass
    return enhanced

"""
MCP Skills HTTP exposure for the Native Media AI Studio frontend agent.

Exposes the skills folder (tools/mcp/skills/) over HTTP so the frontend
agent can discover, read, and use skills for tool-calling.

Endpoints:
  GET    /api/mcp/skills/list          List all skills with frontmatter
  GET    /api/mcp/skills/get           Get a skill's full content by URI
  GET    /api/mcp/skills/{skill}/{path} Serve a skill file (SKILL.md, references/GUIDE.md, etc.)
  POST   /api/mcp/execute-tool         Execute any of the 19 ollama-tools via backend API
"""

from __future__ import annotations

import json
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
    Path(r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio") / "tools" / "mcp" / "skills",
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


@router.post("/api/mcp/execute-tool", response_model=ExecuteToolResponse)
async def execute_tool(request: ExecuteToolRequest) -> ExecuteToolResponse:
    """Execute any of the 19 ollama-tools by dispatching to the appropriate backend API.

    This is a unified entry point so the frontend agent can call any tool
    without knowing which backend module handles it.
    """
    tool_name = request.tool_name
    args = request.arguments

    try:
        if tool_name == "list_audio_library":
            result = await _http_get("/api/audio/files")
            if isinstance(result, dict) and "error" in result:
                return ExecuteToolResponse(success=False, error=result["error"])
            files = [o.get("filename", o.get("relative_path", "")) for o in result.get("outputs", [])]
            return ExecuteToolResponse(success=True, result={"files": files, "count": len(files)})

        elif tool_name == "analyze_audio":
            filename = args.get("filename")
            if not filename:
                return ExecuteToolResponse(success=False, error="filename is required")
            result = await _http_get(f"/api/audio/analysis/{filename}", timeout=60)
            if isinstance(result, dict) and "error" in result:
                return ExecuteToolResponse(success=False, error=result["error"])
            return ExecuteToolResponse(success=True, result=result)

        elif tool_name == "generate_image":
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

        elif tool_name == "generate_video":
            result = await _http_post(
                "/api/music-video/generate",
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

        elif tool_name == "remix_list_sources":
            result = await _http_get("/api/audio/remix/sources")
            if isinstance(result, dict) and "error" in result:
                return ExecuteToolResponse(success=False, error=result["error"])
            return ExecuteToolResponse(success=True, result=result)

        elif tool_name == "remix_probe":
            track = args.get("track")
            if not track:
                return ExecuteToolResponse(success=False, error="track is required")
            result = await _http_post(f"/api/audio/remix/probe?track={track}", {}, timeout=30)
            if isinstance(result, dict) and "error" in result:
                return ExecuteToolResponse(success=False, error=result["error"])
            return ExecuteToolResponse(success=True, result=result)

        elif tool_name == "remix_from_prompt":
            prompt = args.get("prompt")
            if not prompt:
                return ExecuteToolResponse(success=False, error="prompt is required")
            result = await _http_post(
                "/api/audio/remix/from-prompt",
                {"prompt": prompt, "base_recipe": args.get("base_recipe")},
                timeout=60,
            )
            if isinstance(result, dict) and "error" in result:
                return ExecuteToolResponse(success=False, error=result["error"])
            return ExecuteToolResponse(success=True, result=result)

        elif tool_name == "remix_preview":
            recipe = args.get("recipe")
            if not recipe:
                return ExecuteToolResponse(success=False, error="recipe is required")
            result = await _http_post(
                "/api/audio/remix/preview",
                {"recipe": recipe},
                timeout=60,
            )
            if isinstance(result, dict) and "error" in result:
                return ExecuteToolResponse(success=False, error=result["error"])
            return ExecuteToolResponse(success=True, result=result)

        elif tool_name == "remix_build":
            recipe = args.get("recipe")
            if not recipe:
                return ExecuteToolResponse(success=False, error="recipe is required")
            result = await _http_post(
                "/api/audio/remix/build",
                {"recipe": recipe, "overwrite": args.get("overwrite", False)},
                timeout=120,
            )
            if isinstance(result, dict) and "error" in result:
                return ExecuteToolResponse(success=False, error=result["error"])
            return ExecuteToolResponse(success=True, result=result)

        elif tool_name == "remix_job_status":
            job_id = args.get("job_id")
            if not job_id:
                return ExecuteToolResponse(success=False, error="job_id is required")
            result = await _http_get(f"/api/audio/remix/jobs/{job_id}")
            if isinstance(result, dict) and "error" in result:
                return ExecuteToolResponse(success=False, error=result["error"])
            return ExecuteToolResponse(success=True, result=result)

        elif tool_name == "remix_enhance":
            name = args.get("name")
            if not name:
                return ExecuteToolResponse(success=False, error="name is required")
            result = await _http_post(
                f"/api/audio/remix/{name}/enhance",
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

        elif tool_name == "remix_list":
            result = await _http_get("/api/audio/remix/list")
            if isinstance(result, dict) and "error" in result:
                return ExecuteToolResponse(success=False, error=result["error"])
            return ExecuteToolResponse(success=True, result=result)

        elif tool_name == "remix_get_file":
            name = args.get("name")
            which = args.get("which")
            if not name or not which:
                return ExecuteToolResponse(success=False, error="name and which are required")
            return ExecuteToolResponse(
                success=True,
                result={"url": f"{BACKEND_BASE}/api/audio/remix/{name}/file/{which}"},
            )

        elif tool_name == "update_mcp_context":
            context = args.get("context")
            if not context:
                return ExecuteToolResponse(success=False, error="context is required")
            result = await _http_post("/api/mcp_context", context, timeout=30)
            if isinstance(result, dict) and "error" in result:
                return ExecuteToolResponse(success=False, error=result["error"])
            return ExecuteToolResponse(success=True, result=result)

        elif tool_name == "analyze_image":
            image_path = args.get("image_path")
            if not image_path:
                return ExecuteToolResponse(success=False, error="image_path is required")
            result = await _http_post(
                "/api/analyze-visualizer",
                {"image_path": image_path, "prompt": args.get("prompt", "Describe this image in detail.")},
                timeout=60,
            )
            if isinstance(result, dict) and "error" in result:
                return ExecuteToolResponse(success=False, error=result["error"])
            return ExecuteToolResponse(success=True, result=result)

        elif tool_name == "suggest_3d_prompt":
            idea = args.get("idea")
            if not idea:
                return ExecuteToolResponse(success=False, error="idea is required")
            result = await _http_post(
                "/api/music-video/generate-preview",
                {"prompt": idea, "category": args.get("category", "character"), "style": args.get("style", "")},
                timeout=60,
            )
            if isinstance(result, dict) and "error" in result:
                return ExecuteToolResponse(success=False, error=result["error"])
            return ExecuteToolResponse(success=True, result=result)

        elif tool_name == "generate_3d_concept":
            description = args.get("description")
            if not description:
                return ExecuteToolResponse(success=False, error="description is required")
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

        elif tool_name == "plan_blender_script":
            description = args.get("description")
            if not description:
                return ExecuteToolResponse(success=False, error="description is required")
            result = await _http_post(
                "/api/music-video/generate-preview",
                {"prompt": description, "category": args.get("target", "mesh"), "style": args.get("model", "qwen3.5:4b")},
                timeout=60,
            )
            if isinstance(result, dict) and "error" in result:
                return ExecuteToolResponse(success=False, error=result["error"])
            return ExecuteToolResponse(success=True, result=result)

        else:
            return ExecuteToolResponse(success=False, error=f"Unknown tool: {tool_name}")

    except httpx.ConnectError:
        return ExecuteToolResponse(success=False, error="Backend not reachable at http://127.0.0.1:8000")
    except Exception as exc:  # noqa: BLE001
        return ExecuteToolResponse(success=False, error=str(exc))


@router.get("/api/mcp/tools", response_model=list[dict[str, Any]])
async def tools_list() -> list[dict[str, Any]]:
    """List all available tools with their descriptions."""
    tools = [
        {"name": "analyze_image", "description": "Analyze an image using Ollama vision model (gemma4:e2b-it-qat)."},
        {"name": "analyze_audio", "description": "Analyze an audio track to extract BPM, beats, energy, and sections."},
        {"name": "generate_image", "description": "Generate an image via ComfyUI (SDXL workflow)."},
        {"name": "generate_video", "description": "Generate a video clip via ComfyUI (Wan2.1 model)."},
        {"name": "list_audio_library", "description": "List all available audio tracks in the library."},
        {"name": "create_music_video_plan", "description": "Create a music video production plan from audio analysis."},
        {"name": "suggest_3d_prompt", "description": "Enhance a raw 3D idea into a detailed prompt with material/texture guidance."},
        {"name": "generate_3d_concept", "description": "Generate a concept image optimized for 3D conversion (Hunyuan3D-friendly)."},
        {"name": "plan_blender_script", "description": "Generate an executable Blender Python (bpy) script from a natural-language description."},
        {"name": "update_mcp_context", "description": "Update the shared MCP context (character, scene, audio, visualization state)."},
        {"name": "remix_list_sources", "description": "List tracks with separated stems and per-stem availability."},
        {"name": "remix_probe", "description": "Get tempo and advisory key for one source track."},
        {"name": "remix_from_prompt", "description": "Draft a mashup recipe from a natural-language sentence."},
        {"name": "remix_preview", "description": "Resolve a recipe without rendering: timeline, stretch ratios, measured levels, warnings."},
        {"name": "remix_build", "description": "Render a recipe to output/remixes/<name>/ with stems and master."},
        {"name": "remix_job_status", "description": "Check the status of a remix build or enhance job."},
        {"name": "remix_enhance", "description": "Master an already-rendered remix with the Suno chain."},
        {"name": "remix_list", "description": "List rendered remixes with their manifests."},
        {"name": "remix_get_file", "description": "Get the playable URL for one stem or the mastered master of a rendered remix."},
    ]
    return tools

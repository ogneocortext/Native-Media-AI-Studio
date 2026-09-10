"""
Native app open — Blender / Unity
Local-first: launches the desktop app with the selected output file.
"""

import logging
import shutil
import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ..core.config import PROJECT_ROOT, config
from ..services.go_gateway_client import proxy_request

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/native", tags=["Native Open"])

BLENDER_CANDIDATES = [
    r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe",
    r"C:\Program Files\Blender Foundation\Blender 4.5\blender.exe",
    r"C:\Program Files\Blender Foundation\Blender\blender.exe",
]
UNITY_PROJECT = PROJECT_ROOT / "unity-project-mcp"
UNITY_ASSETS_GENERATED = UNITY_PROJECT / "Assets" / "GeneratedModels"


def _resolve_output_path(relative_path: str) -> Path:
    # relative_path is like "generated_3d/foo.glb" or "video/bar.mp4" or "audio/..."
    # It is relative to config.output_dir
    p = Path(relative_path)
    # prevent traversal
    if p.is_absolute() or ".." in p.parts:
        raise HTTPException(status_code=400, detail="Invalid path")
    # try output_dir + relative_path
    candidate = config.output_dir / p
    if candidate.exists():
        return candidate
    # also try PROJECT_ROOT / relative_path (if stored as output/... )
    alt = PROJECT_ROOT / p
    if alt.exists():
        return alt
    # try output_dir / generated_3d etc with just filename
    alt2 = config.output_dir / "generated_3d" / p.name
    if alt2.exists():
        return alt2
    raise HTTPException(status_code=404, detail=f"File not found: {relative_path}")


def _find_blender() -> str | None:
    for c in BLENDER_CANDIDATES:
        if Path(c).exists():
            return c
    # check PATH
    found = shutil.which("blender")
    return found


@router.post("/open/blender")
async def open_in_blender(payload: dict):
    """
    Open a 3D model in Blender.
    Body: { "relative_path": "generated_3d/foo.glb" }  or { "path": "..." }
    Tries Blender MCP first (import into running Blender), falls back to launching Blender.
    """
    rel = payload.get("relative_path") or payload.get("path") or payload.get("filename")
    if not rel:
        raise HTTPException(status_code=400, detail="relative_path required")
    src = _resolve_output_path(rel)

    # Try Blender MCP import first (if Blender is running with the addon)
    try:
        # Lazy import to avoid hard dep
        import json
        import socket

        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(2.0)
        # Blender MCP default is 9876
        try:
            sock.connect(("127.0.0.1", 9876))
            # Minimal protocol: send execute code to import GLB
            # The addon expects JSON with type "execute_code" or similar — try both
            code = f"import bpy; bpy.ops.import_scene.gltf(filepath=r'{src.as_posix()}')"
            msg = json.dumps({"type": "execute_code", "code": code}) + "\n"
            sock.sendall(msg.encode())
            # read response (non-blocking)
            sock.settimeout(1.0)
            try:
                data = sock.recv(4096)
                if data:
                    logger.info("Blender MCP import response: %s", data[:500])
                    try:
                        import asyncio as _asyncio3

                        from ..core.database import log_native_open as _logmcp
                        await _asyncio3.to_thread(_logmcp, rel, src.name, "blender", "blender-mcp", True)
                    except Exception:
                        pass
                    return {"success": True, "method": "blender-mcp", "path": str(src), "message": "Sent to running Blender via MCP"}
            except Exception:
                pass
        finally:
            sock.close()
    except Exception as e:
        logger.debug("Blender MCP not available: %s", e)

    blender = _find_blender()
    if not blender:
        raise HTTPException(status_code=500, detail="Blender not found — install at C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe or add to PATH")

    # Launch Blender with a small Python snippet that imports the GLB
    # We write a temp .py that imports the file so Blender opens with it loaded
    try:
        import tempfile
        import textwrap
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False, encoding="utf-8") as tf:
            tf.write(textwrap.dedent(f"""
import bpy
import pathlib
path = pathlib.Path(r"{src.as_posix()}")
# clear default cube if present
try:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
except: pass
try:
    bpy.ops.import_scene.gltf(filepath=str(path))
    # frame view
    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            for region in area.regions:
                if region.type == 'WINDOW':
                    override = {{'area': area, 'region': region}}
                    try:
                        bpy.ops.view3d.view_all(override)
                    except: pass
                    break
except Exception as e:
    print("Blender import error:", e)
"""))
            script = tf.name

        # Use Popen so backend doesn't block
        proc = subprocess.Popen([blender, "--python", script, "--", str(src)], creationflags=subprocess.DETACHED_PROCESS if hasattr(subprocess, "DETACHED_PROCESS") else 0)
        # Persist to DB (applicable: audit trail, recently opened, dedup)
        try:
            import asyncio as _asyncio

            from ..core.database import log_native_open as _log
            await _asyncio.to_thread(_log, rel, src.name, "blender", "launch", True)
        except Exception as e:
            logger.debug("native open DB log skipped: %s", e)
        return {"success": True, "method": "launch", "blender": blender, "path": str(src), "pid": proc.pid, "message": "Launched Blender with model"}
    except Exception as e:
        try:
            import asyncio as _asyncio2

            from ..core.database import log_native_open as _log2
            await _asyncio2.to_thread(_log2, rel, src.name if 'src' in locals() else rel, "blender", "launch", False)
        except Exception:
            pass
        logger.error("Failed to launch Blender: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/open/unity")
async def open_in_unity(payload: dict):
    """
    Send a 3D model to Unity project.
    Body: { "relative_path": "generated_3d/foo.glb" }
    Copies into unity-project-mcp/Assets/GeneratedModels/ and triggers Unity import.
    """
    rel = payload.get("relative_path") or payload.get("path") or payload.get("filename")
    if not rel:
        raise HTTPException(status_code=400, detail="relative_path required")
    src = _resolve_output_path(rel)

    if not UNITY_PROJECT.exists():
        raise HTTPException(status_code=500, detail="Unity project not found at unity-project-mcp/")

    dest_dir = UNITY_ASSETS_GENERATED
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / src.name
    try:
        shutil.copy2(src, dest)
        logger.info("Copied %s -> %s", src, dest)
        try:
            import asyncio as _asyncio4

            from ..core.database import log_native_open as _logu
            await _asyncio4.to_thread(_logu, rel, src.name, "unity", "copy", True)
        except Exception:
            pass
    except Exception as e:
        try:
            import asyncio as _asyncio5

            from ..core.database import log_native_open as _logu2
            await _asyncio5.to_thread(_logu2, rel, src.name if 'src' in locals() else rel, "unity", "copy", False)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Copy failed: {e}")

    # Try Unity MCP refresh via go-gateway (falls back to direct HTTP if gateway is down)
    unity_refreshed = False
    try:
        # Ping Unity bridge through go-gateway
        ping_resp = await proxy_request("unity", "/api/exec", method="POST", json_body={
            "command": "editor_status",
            "parameters": {}
        })
        if ping_resp is not None and ping_resp.status_code == 200:
            unity_refreshed = True
            # Trigger AssetDatabase refresh if editor is responsive
            refresh_resp = await proxy_request("unity", "/api/exec", method="POST", json_body={
                "command": "execute_code",
                "parameters": {"code": "UnityEditor.AssetDatabase.Refresh();"}
            })
            if refresh_resp is not None and refresh_resp.status_code == 200:
                unity_refreshed = True
    except Exception as e:
        logger.debug("Unity MCP refresh via go-gateway not available: %s", e)

    return {
        "success": True,
        "method": "copy+refresh" if unity_refreshed else "copy",
        "source": str(src),
        "unity_path": str(dest.relative_to(PROJECT_ROOT)),
        "absolute_unity_path": str(dest),
        "message": "Copied to Assets/GeneratedModels — open Unity Editor at unity-project-mcp to see it" + (" (auto-refreshed)" if unity_refreshed else ""),
    }


@router.get("/open/status")
async def native_open_status():
    """Check Blender / Unity availability for the frontend to show/hide buttons."""
    blender = _find_blender()
    unity = UNITY_PROJECT.exists()
    return {
        "blender": {"available": bool(blender), "path": blender},
        "unity": {"available": unity, "project": str(UNITY_PROJECT), "generated_dir": str(UNITY_ASSETS_GENERATED)},
    }


@router.get("/open/history")
async def native_open_history(app: str | None = None, limit: int = 20):
    """Recent Blender/Unity opens from DB — powers 'recently opened' and dedup."""
    try:
        import asyncio as _asyncio6

        from ..core.database import list_native_opens
        rows = await _asyncio6.to_thread(list_native_opens, app, limit)
        return {"results": rows, "count": len(rows)}
    except Exception as e:
        return {"error": str(e), "results": []}

"""
Unity Control — web-friendly proxy to the Unity Pipeline server.

All requests are sent through the local go-gateway sidecar so the frontend
never needs to know the dynamic Unity port or eval token. The eval token
(read from the port file, with a last-known-good cache) is forwarded
through the pass-through gateway because the Pipeline server requires it
on every route. When the gateway is unavailable we fall back to hitting
the Pipeline HTTP API directly, so local development without sidecars
still works.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..core.config import PROJECT_ROOT
from ..services.go_gateway_client import proxy_request

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/unity", tags=["Unity Control"])

# Fallback: where the Unity Pipeline server writes its port + auth info.
_UNITY_PORT_FILE = (
    PROJECT_ROOT / "unity-project-mcp" / "Library" / "Pipeline" / ".unity-pipeline-port"
)


class UnityCommandRequest(BaseModel):
    command: str = Field(..., description="Unity command name, e.g. create_gameobject")
    parameters: dict[str, Any] = Field(default_factory=dict, description="Command parameters")


class UnityCommandResponse(BaseModel):
    ok: bool
    data: Any = None
    error: str | None = None


def _read_port_file() -> dict[str, Any] | None:
    try:
        raw = _UNITY_PORT_FILE.read_text(encoding="utf-8")
        return json.loads(raw)
    except Exception as exc:
        logger.debug("Unity port file unreadable: %s", exc)
        return None


# Last-known-good port-file contents. The Pipeline server requires the eval
# token on *every* route, so if the port file is transiently missing/renamed
# we can still authenticate through the gateway with the cached credentials
# instead of falsely reporting the bridge as offline.
_last_info: dict[str, Any] | None = None


def _unity_info() -> dict[str, Any] | None:
    """Fresh port-file info when readable, otherwise the last-known value."""
    global _last_info
    info = _read_port_file()
    if info:
        _last_info = info
        return info
    return _last_info


async def _proxy_or_direct(
    path: str,
    method: str = "GET",
    *,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
    timeout: float = 30.0,
) -> httpx.Response | None:
    """Try go-gateway first; fall back to direct Pipeline HTTP."""
    info = _unity_info()
    token = None
    if info:
        token = info.get("evalToken") or info.get("eval_token")

    # 1) go-gateway. The gateway is a pass-through proxy and does not inject
    #    auth, while the Pipeline server 401s every unauthenticated route —
    #    so forward the Authorization header through the gateway hop.
    gw_headers = {"Authorization": f"Bearer {token}"} if token else None
    gw = await proxy_request(
        "unity", path, method=method, params=params, json_body=json_body, headers=gw_headers
    )
    if gw is not None:
        return gw

    # 2) direct fallback
    if not info:
        return None
    port = info.get("port")
    if not port:
        return None
    url = f"http://127.0.0.1:{port}{path}"
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            return await client.request(method, url, params=params, json=json_body, headers=headers)
    except Exception as exc:
        logger.debug("Direct Unity request failed: %s", exc)
        return None


@router.get("/status")
async def unity_status() -> dict[str, Any]:
    """Return whether the Unity Pipeline server is reachable.

    Always route through `_proxy_or_direct` (go-gateway first, then the port
    file) so a missing/stale port file does not mask an otherwise reachable
    bridge. The eval token is forwarded through the pass-through gateway and
    the last-known credentials are cached, so a deleted/renamed port file
    alone does not flip an alive server to offline. Only classify
    `port_file_missing` when no credentials were ever available.
    """
    resp = await _proxy_or_direct(
        "/api/exec", method="POST", json_body={"command": "editor_status", "parameters": {}}
    )
    if resp is None:
        if not _unity_info():
            return {"online": False, "error": "port_file_missing"}
        return {"online": False, "error": "unreachable"}

    if resp.status_code == 200:
        try:
            payload = resp.json()
            return {"online": True, "status": payload}
        except Exception:
            return {"online": True, "status": None}
    return {"online": False, "error": f"http_{resp.status_code}", "detail": resp.text[:500]}


@router.get("/commands")
async def list_unity_commands() -> dict[str, Any]:
    """List available Unity Pipeline commands."""
    resp = await _proxy_or_direct("/api/commands?detail=compact")
    if resp is None:
        raise HTTPException(status_code=502, detail="Unity bridge unreachable")
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text[:500])
    return resp.json()


@router.post("/command", response_model=UnityCommandResponse)
async def execute_unity_command(req: UnityCommandRequest) -> UnityCommandResponse:
    """Execute any Unity Pipeline command."""
    resp = await _proxy_or_direct(
        "/api/exec",
        method="POST",
        json_body={"command": req.command, "parameters": req.parameters or {}},
    )
    if resp is None:
        return UnityCommandResponse(ok=False, error="Unity bridge unreachable")
    if resp.status_code != 200:
        return UnityCommandResponse(
            ok=False, error=f"Unity API error {resp.status_code}: {resp.text[:300]}"
        )

    try:
        data = resp.json()
        return UnityCommandResponse(ok=True, data=data)
    except Exception as exc:
        return UnityCommandResponse(ok=False, error=f"Invalid response: {exc}")


@router.post("/capture")
async def capture_scene(
    width: int = 1920,
    height: int = 1080,
    save_path: str = "output/unity_capture.png",
) -> dict[str, Any]:
    """Capture the Unity Scene View."""
    resp = await _proxy_or_direct(
        "/api/exec",
        method="POST",
        json_body={
            "command": "capture_scene_view",
            "parameters": {"save_path": save_path, "width": width, "height": height},
        },
    )
    if resp is None:
        raise HTTPException(status_code=502, detail="Unity bridge unreachable")
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text[:500])
    return resp.json()

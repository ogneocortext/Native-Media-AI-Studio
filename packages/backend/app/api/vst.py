from __future__ import annotations

import asyncio
import logging
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any

from fastapi import (
    APIRouter,
    File,
    HTTPException,
    Response,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from pydantic import BaseModel

from ..core.config import OUTPUT_DIR, PROJECT_ROOT
from ..services.vst_host import (
    VSTChain,
    get_vst_host,
    reset_vst_host,
)
from .audio_common import AUDIO_DIR

router = APIRouter(prefix="/api/vst", tags=["VST"])

VST_ASSETS_DIR = PROJECT_ROOT / "assets" / "vst"
VST_ASSETS_DIR.mkdir(parents=True, exist_ok=True)

logger = logging.getLogger(__name__)


# --- Request/Response Models ---


class PluginParameter(BaseModel):
    name: str
    value: float = 0.0
    min: float
    max: float
    default: float
    unit: str = ""


class PluginInfo(BaseModel):
    name: str
    path: str
    vendor: str = ""
    version: str = ""
    category: str = "effect"
    num_inputs: int = 2
    num_outputs: int = 2
    parameters: list[PluginParameter] = []
    is_valid: bool = True
    error_message: str = ""


class PresetResponse(BaseModel):
    plugin_name: str
    name: str
    parameters: dict[str, float]


def convert_plugin_info(p: Any) -> PluginInfo:
    """Convert VSTPluginInfo to API PluginInfo with proper parameter conversion."""
    # Convert parameters to PluginParameter format
    api_params = []

    # Handle both list (from scan) and dict (from cached plugin) formats
    params_source = p.parameters.values() if isinstance(p.parameters, dict) else p.parameters

    for param in params_source:
        # Handle both dict and PluginParameter formats
        if isinstance(param, dict):
            # Get value from default or default to 0.0
            val = param.get("default", param.get("value", 0.0))
            api_params.append(PluginParameter(
                name=param.get("name", ""),
                min=param.get("min", 0.0),
                max=param.get("max", 1.0),
                default=param.get("default", 0.0),
                unit=param.get("unit", ""),
                value=val,
            ))
        else:
            # Already a PluginParameter-like object
            val = getattr(param, "default", getattr(param, "value", 0.0))
            api_params.append(PluginParameter(
                name=getattr(param, "name", ""),
                min=getattr(param, "min", 0.0),
                max=getattr(param, "max", 1.0),
                default=getattr(param, "default", 0.0),
                unit=getattr(param, "unit", ""),
                value=val,
            ))

    return PluginInfo(
        name=p.name,
        path=p.path,
        vendor=p.vendor,
        version=p.version,
        category=p.category,
        num_inputs=p.num_inputs,
        num_outputs=p.num_outputs,
        parameters=api_params,
        is_valid=p.is_valid,
        error_message=p.error_message,
    )


class ChainPlugin(BaseModel):
    name: str
    parameters: dict[str, float] = {}


class ChainCreate(BaseModel):
    name: str
    plugins: list[ChainPlugin] = []
    sample_rate: int = 44100
    block_size: int = 512


class ChainResponse(BaseModel):
    name: str
    plugins: list[ChainPlugin]
    sample_rate: int
    block_size: int


class ProcessRequest(BaseModel):
    chain_name: str
    input_path: str | None = None
    output_name: str = "processed"


class ProcessResponse(BaseModel):
    input_path: str
    output_path: str
    sample_rate: int
    duration: float
    channels: int


# --- VST Plugin Endpoints ---


@router.get("/scan")
async def scan_plugins() -> dict[str, Any]:
    """Scan all VST paths for plugins."""
    host = get_vst_host()
    try:
        plugins = host.scan_vst_plugins()
        return {
            "plugins": [convert_plugin_info(p) for p in plugins],
            "count": len(plugins),
        }
    except Exception as e:
        logger.error(f"Scan failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Scan failed: {e}") from None


@router.get("/plugins")
async def list_plugins() -> dict[str, Any]:
    """List all discovered plugins."""
    host = get_vst_host()
    if not host.plugins:
        host.scan_vst_plugins()
    return {
        "plugins": [convert_plugin_info(p) for p in host.plugins.values()],
        "count": len(host.plugins),
    }


@router.get("/plugins/{plugin_name}")
async def get_plugin(plugin_name: str) -> PluginInfo:
    """Get detailed info about a specific plugin."""
    host = get_vst_host()
    host.ensure_plugins()
    if plugin_name not in host.plugins:
        raise HTTPException(status_code=404, detail=f"Plugin not found: {plugin_name}") from None
    return convert_plugin_info(host.plugins[plugin_name])


@router.get("/plugins/{plugin_name}/parameters")
async def get_plugin_parameters(plugin_name: str) -> dict[str, Any]:
    """Get parameter info for a plugin."""
    host = get_vst_host()
    host.ensure_plugins()
    if plugin_name not in host.plugins:
        raise HTTPException(status_code=404, detail=f"Plugin not found: {plugin_name}") from None

    plugin_info = host.plugins[plugin_name]
    if not plugin_info.is_valid:
        raise HTTPException(status_code=400, detail=f"Plugin not loadable: {plugin_info.error_message}") from None

    try:
        plugin = host.load_plugin(plugin_name)
        parameters = []
        for param in plugin.parameters.values():
            parameters.append({
                "name": param.name,
                "min": param.min_value,
                "max": param.max_value,
                "default": param.default_value,
                "value": param.value,
                "unit": param.label if hasattr(param, 'label') else '',
            })
        return {"parameters": parameters}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load plugin: {e}") from None


# --- Chain Management ---


@router.post("/chains")
async def create_chain(chain: ChainCreate, response: Response) -> ChainResponse:
    """Create a new VST chain."""
    host = get_vst_host()
    host.ensure_plugins()

    # Validate all plugins exist
    for plugin_data in chain.plugins:
        if plugin_data.name not in host.plugins:
            raise HTTPException(status_code=400, detail=f"Plugin not found: {plugin_data.name}") from None

    vst_chain = VSTChain(
        name=chain.name,
        plugins=[vars(p) for p in chain.plugins],
        sample_rate=chain.sample_rate,
        block_size=chain.block_size,
    )
    host.save_chain(vst_chain)

    # HTTP/2 Server Push: Preload plugin manifests for all plugins in chain
    # This only works with Hypercorn (HTTP/2 native) and when client supports push
    if hasattr(response, "push"):
        for plugin_data in chain.plugins:
            plugin_name = plugin_data.name
            if plugin_name in host.plugins:
                try:
                    # Push the plugin manifest to client
                    await response.push(
                        f"/api/vst/plugins/{plugin_name}",
                        headers={"accept": "application/json"}
                    )
                except Exception as e:
                    logger.debug(f"Failed to push manifest for {plugin_name}: {e}")

    return ChainResponse(**vars(vst_chain))


@router.get("/chains")
async def list_chains() -> dict[str, Any]:
    """List all saved chains."""
    host = get_vst_host()
    return {
        "chains": [ChainResponse(**vars(c)) for c in host.chains.values()],
        "count": len(host.chains),
    }


@router.get("/chains/{chain_name}")
async def get_chain(chain_name: str) -> ChainResponse:
    """Get a specific chain."""
    host = get_vst_host()
    chain = host.load_chain(chain_name)
    if not chain:
        raise HTTPException(status_code=404, detail=f"Chain not found: {chain_name}") from None
    return ChainResponse(**vars(chain))


@router.put("/chains/{chain_name}")
async def update_chain(chain_name: str, chain: ChainCreate) -> ChainResponse:
    """Update an existing chain."""
    host = get_vst_host()
    if chain_name not in host.chains:
        raise HTTPException(status_code=404, detail=f"Chain not found: {chain_name}") from None
    host.ensure_plugins()

    # Validate all plugins exist
    for plugin_data in chain.plugins:
        if plugin_data.name not in host.plugins:
            raise HTTPException(status_code=400, detail=f"Plugin not found: {plugin_data.name}") from None

    # A rename leaves the old dict key and its persisted file behind unless
    # the old chain is removed first.
    if chain.name != chain_name:
        host.delete_chain(chain_name)

    vst_chain = VSTChain(
        name=chain.name,
        plugins=[vars(p) for p in chain.plugins],
        sample_rate=chain.sample_rate,
        block_size=chain.block_size,
    )
    host.save_chain(vst_chain)

    return ChainResponse(**vars(vst_chain))


@router.delete("/chains/{chain_name}")
async def delete_chain(chain_name: str) -> dict[str, Any]:
    """Delete a chain."""
    host = get_vst_host()
    if host.delete_chain(chain_name):
        return {"deleted": True, "name": chain_name}
    raise HTTPException(status_code=404, detail=f"Chain not found: {chain_name}") from None


@router.get("/chains/{chain_name}/export")
async def export_chain(chain_name: str) -> dict[str, Any]:
    """Export a chain to a portable format."""
    host = get_vst_host()
    try:
        return host.export_chain(chain_name)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from None


@router.post("/chains/import")
async def import_chain(chain_data: dict[str, Any]) -> ChainResponse:
    """Import a chain from exported format."""
    host = get_vst_host()
    try:
        chain = host.import_chain(chain_data)
        return ChainResponse(**vars(chain))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to import chain: {e}") from None


# --- Audio Processing ---

@router.post("/process")
async def process_audio(request: ProcessRequest) -> ProcessResponse:
    """Process audio file through a VST chain."""
    host = get_vst_host()

    if request.chain_name not in host.chains:
        raise HTTPException(status_code=404, detail=f"Chain not found: {request.chain_name}") from None

    # Resolve input path
    if request.input_path:
        input_path = (OUTPUT_DIR / request.input_path).resolve()
    else:
        # Use first available audio file
        audio_files = list(OUTPUT_DIR.glob("*.wav"))
        if not audio_files:
            raise HTTPException(status_code=400, detail="No input file specified and no audio files found") from None
        input_path = audio_files[0]

    if not input_path.exists():
        raise HTTPException(status_code=404, detail=f"Input file not found: {input_path}") from None

    if Path(request.output_name).name != request.output_name:
        raise HTTPException(status_code=400, detail="output_name must be a plain filename") from None

    # Write under output/audio/ so results are servable via /api/audio/file/*
    # and appear in the audio library.
    output_path = AUDIO_DIR / f"{request.output_name}.wav"

    try:
        result = host.process_file(request.chain_name, input_path, output_path)
        return ProcessResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}") from None


@router.post("/process/upload")
async def process_upload(
    chain_name: str,
    file: UploadFile = File(...),
    output_name: str = "processed",
) -> ProcessResponse:
    """Upload and process audio file through a VST chain."""
    host = get_vst_host()

    if chain_name not in host.chains:
        raise HTTPException(status_code=404, detail=f"Chain not found: {chain_name}") from None

    # Save uploaded file
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
        shutil.copyfileobj(file.file, tmp)
        input_path = Path(tmp.name)

    if Path(output_name).name != output_name:
        raise HTTPException(status_code=400, detail="output_name must be a plain filename") from None

    try:
        output_path = AUDIO_DIR / f"{output_name}.wav"
        result = host.process_file(chain_name, input_path, output_path)
        return ProcessResponse(**result)
    finally:
        if input_path.exists():
            input_path.unlink()


@router.get("/parameters")
async def get_all_parameters() -> dict[str, list[PluginParameter]]:
    """Get all parameters for all loaded plugins."""
    host = get_vst_host()
    if not host.plugins:
        host.scan_vst_plugins()
    result = {}
    for name, plugin_info in host.plugins.items():
        if not plugin_info.is_valid:
            continue
        try:
            plugin = host.load_plugin(name)
            params = []
            for param in plugin.parameters.values():
                params.append(PluginParameter(
                    name=param.name,
                    value=param.value,
                    min=param.min_value,
                    max=param.max_value,
                    default=param.default_value,
                    unit=param.label if hasattr(param, 'label') else '',
                ))
            result[name] = params
        except Exception:
            continue
    return result


# --- Utility Endpoints ---

@router.get("/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok"}


@router.post("/reset")
async def reset_host():
    """Reset the VST host (clear plugins, chains, cache)."""
    reset_vst_host()
    return {"status": "reset"}


@router.websocket("/ws/{chain_name}")
async def vst_params_websocket(websocket: WebSocket, chain_name: str):
    """WebSocket endpoint for real-time VST parameter streaming."""
    await websocket.accept()
    host = get_vst_host()

    if chain_name not in host.chains:
        await websocket.close(code=4004, reason=f"Chain not found: {chain_name}")
        return

    try:
        while True:
            chain = host.chains.get(chain_name)
            if chain:
                # Get current parameters from all plugins in chain
                params = {}
                for plugin_data in chain.plugins:
                    plugin_name = plugin_data.get("name", "")
                    plugin_params = plugin_data.get("parameters", {})
                    if plugin_params:
                        params[plugin_name] = plugin_params

                await websocket.send_json({
                    "chain_name": chain_name,
                    "params": params,
                    "timestamp": time.time()
                })

            await asyncio.sleep(0.05)  # 20Hz update rate

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for chain: {chain_name}")
    except Exception as e:
        logger.error(f"WebSocket error for chain {chain_name}: {e}")
        await websocket.close(code=4000, reason=str(e))

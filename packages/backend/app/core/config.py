from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, field_validator

logger = logging.getLogger(__name__)

# Monorepo root: packages/backend/app/core/config.py -> <repo root>.
# Every other module derives its paths from this (config/, output/, storage/),
# so it must point at the repo root, NOT packages/backend.
PROJECT_ROOT = Path(__file__).resolve().parents[4]
CONFIG_DIR = PROJECT_ROOT / "config"
OUTPUT_DIR = PROJECT_ROOT / "output"


class AppConfig(BaseModel):
    # Local-first app: bind loopback by default so the API is not exposed to
    # the network. Override via config/settings.json if remote access is needed.
    backend_host: str = "127.0.0.1"
    backend_port: int = 8000
    frontend_port: int = 5173
    # Canonical realtime transport is SSE at /api/events; WebSocket at /ws
    # is a compat shim on the same port. `ws_port` is deprecated -- use
    # backend_port. Kept for config/ports.json compat.
    ws_port: int = 8000
    comfyui_url: str = "http://127.0.0.1:8188"
    comfyui_port: int = 8188
    video_editor_port: int = 8080
    comfyui_output_dir: Path | None = None  # Defaults to <PROJECT_ROOT>/../ComfyUI/output if unset
    ollama_url: str = "http://127.0.0.1:11434"
    atomic_chat_url: str = "http://127.0.0.1:1337"
    atomic_chat_enabled: bool = False
    go_dashboard_url: str = "http://127.0.0.1:3847"
    go_media_url: str = "http://127.0.0.1:3848"
    go_worker_url: str = "http://127.0.0.1:3849"
    go_gateway_url: str = "http://127.0.0.1:3850"
    go_ports_url: str = "http://127.0.0.1:3851"
    max_queue_workers: int = 1
    output_dir: Path = OUTPUT_DIR
    log_level: str = "INFO"
    default_model: str = "gemma4:e2b-it-qat"
    vision_model: str = "gemma4:e2b-it-qat"
    embedding_model: str = "nomic-embed-text:v1.5"
    # ComfyUI image-generation defaults surfaced on the Settings page.
    # Persisted with the rest of the config so the controls round-trip.
    default_workflow: str = "default"
    output_node_id: str = "9"

    model_config = ConfigDict(arbitrary_types_allowed=True)

    @field_validator("backend_port", "frontend_port", "ws_port")
    @classmethod
    def validate_port(cls, v: int) -> int:
        """Validate that port is in valid range"""
        if not (1 <= v <= 65535):
            raise ValueError(f"Port must be between 1 and 65535, got {v}")
        return v

    @field_validator("backend_host")
    @classmethod
    def validate_host(cls, v: str) -> str:
        """Validate that host is not empty"""
        if not v or not v.strip():
            raise ValueError("Host cannot be empty")
        return v.strip()

    @field_validator(
        "comfyui_url",
        "ollama_url",
        "atomic_chat_url",
        "go_dashboard_url",
        "go_media_url",
        "go_worker_url",
        "go_gateway_url",
        "go_ports_url",
    )
    @classmethod
    def validate_url(cls, v: str) -> str:
        """Validate that URL is properly formatted"""
        if not v or not v.strip():
            raise ValueError("URL cannot be empty")
        v = v.strip()
        if not v.startswith(("http://", "https://")):
            raise ValueError(f"URL must start with http:// or https://, got {v}")
        return v

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        """Validate that log level is valid"""
        valid_levels = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        v_upper = v.upper()
        if v_upper not in valid_levels:
            raise ValueError(f"Log level must be one of {valid_levels}, got {v}")
        return v_upper

    @field_validator("max_queue_workers")
    @classmethod
    def validate_workers(cls, v: int) -> int:
        """Validate that worker count is reasonable"""
        if v < 1:
            raise ValueError(f"Worker count must be at least 1, got {v}")
        if v > 10:
            logger.warning(f"Worker count {v} is high, may impact performance")
        return v


def load_config() -> AppConfig:
    # Load non-port settings from settings.json first.
    settings_file = CONFIG_DIR / "settings.json"
    data: dict[str, Any] = {}
    if settings_file.exists():
        try:
            with open(settings_file) as f:
                data = json.load(f)
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON in config file {settings_file}: {e}")
            logger.warning("Using default configuration")
        except Exception as e:
            logger.error(f"Error loading config from {settings_file}: {e}")
            logger.warning("Using default configuration")

    # config/ports.json is the single source of truth for all port/URL defaults.
    # It is written by port_manager at startup with resolved values, and also
    # contains the project-wide defaults when the backend has not yet run.
    ports_file = CONFIG_DIR / "ports.json"
    ports_data: dict | None = None
    if ports_file.exists():
        try:
            with open(ports_file) as f:
                ports_data = json.load(f)
        except Exception as e:
            logger.warning(f"Could not load port defaults from {ports_file}: {e}")

    if isinstance(ports_data, dict):
        # Ports/URLs always come from ports.json; settings.json overrides
        # are intentionally ignored for these fields to prevent drift.
        data["backend_port"] = ports_data.get("backend_port", 8000)
        data["frontend_port"] = ports_data.get("frontend_port", 5173)
        data["ws_port"] = ports_data.get("ws_port", data["backend_port"])
        data["comfyui_url"] = ports_data.get("comfyui_url", "http://127.0.0.1:8188")
        data["comfyui_port"] = ports_data.get("comfyui_port", 8188)
        data["video_editor_port"] = ports_data.get("video_editor_port", 8080)
        data["ollama_url"] = ports_data.get("ollama_url", "http://127.0.0.1:11434")
        data["atomic_chat_url"] = ports_data.get(
            "atomic_chat_url", "http://127.0.0.1:1337"
        )
        data["go_dashboard_url"] = ports_data.get(
            "go_dashboard_url", "http://127.0.0.1:3847"
        )
        data["go_media_url"] = ports_data.get("go_media_url", "http://127.0.0.1:3848")
        data["go_worker_url"] = ports_data.get("go_worker_url", "http://127.0.0.1:3849")
        data["go_gateway_url"] = ports_data.get(
            "go_gateway_url", "http://127.0.0.1:3850"
        )
        data["go_ports_url"] = ports_data.get("go_ports_url", "http://127.0.0.1:3851")

    # atomic_chat_enabled is a user feature flag saved to settings.json via
    # the settings API. Only fall back to ports.json if settings.json doesn't
    # have it, so a user's toggle survives restart.
    if "atomic_chat_enabled" not in data and isinstance(ports_data, dict):
        data["atomic_chat_enabled"] = ports_data.get("atomic_chat_enabled", False)

    return AppConfig(**data)


def save_config(config: AppConfig) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    config_file = CONFIG_DIR / "settings.json"
    try:
        # Keep runtime port/URL ownership in config/ports.json. Saving the full
        # AppConfig would reintroduce duplicate port settings and allow drift.
        settings = config.model_dump(
            exclude={
                "backend_port",
                "frontend_port",
                "ws_port",
                "comfyui_url",
                "comfyui_port",
                "video_editor_port",
                "ollama_url",
                "atomic_chat_url",
                # atomic_chat_enabled is intentionally NOT excluded here:
                # it is a user feature flag that must survive restart.  It is
                # still owned by ports.json at load time (load_config overrides
                # it from ports.json), but saving it here lets an operator's
                # settings-api change persist across restarts.
                "go_dashboard_url",
                "go_media_url",
                "go_worker_url",
                "go_gateway_url",
                "go_ports_url",
            }
        )
        with open(config_file, "w") as f:
            json.dump(settings, f, indent=2, default=str)
        logger.info(f"Configuration saved to {config_file}")
    except Exception as e:
        logger.error(f"Failed to save configuration to {config_file}: {e}")
        raise


# ---------------------------------------------------------------------------
# Config hot-reload
# ---------------------------------------------------------------------------
#
# `settings.json` is edited by the Settings page and by operators directly.
# Without hot-reload, a config change requires restarting the backend.
# These functions let an operator (or an API endpoint) reload settings from
# disk without restarting. Ports and URLs remain owned by `ports.json` and are
# not reloaded here -- changing those requires a restart anyway (the socket is
# already bound).


_CONFIG_MTIME: float | None = None


def config_changed() -> bool:
    """Return True if `settings.json` has been modified since last load.

    Used by the Settings page or an API endpoint to detect out-of-band edits
    (e.g. an operator editing `config/settings.json` with a text editor).
    """
    global _CONFIG_MTIME
    settings_file = CONFIG_DIR / "settings.json"
    try:
        mtime = settings_file.stat().st_mtime
    except FileNotFoundError:
        return False
    if _CONFIG_MTIME is None:
        _CONFIG_MTIME = mtime
        return False
    return mtime != _CONFIG_MTIME


def reload_config() -> AppConfig:
    """Re-read `settings.json` and return a fresh `AppConfig`.

    Updates the module-level `_CONFIG_MTIME` so subsequent `config_changed()`
    calls return False until the file changes again. Ports/URLs are taken from
    `ports.json` as in `load_config()`; only the settings.json-owned fields are
    refreshed.
    """
    global config, _CONFIG_MTIME

    settings_file = CONFIG_DIR / "settings.json"
    data: dict[str, Any] = {}
    if settings_file.exists():
        try:
            with open(settings_file) as f:
                data = json.load(f)
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON in config file {settings_file}: {e}")
            logger.warning("Keeping existing configuration")
            return config
        except Exception as e:
            logger.error(f"Error loading config from {settings_file}: {e}")
            logger.warning("Keeping existing configuration")
            return config

    # Preserve port/URL ownership from ports.json (same as load_config).
    ports_file = CONFIG_DIR / "ports.json"
    if ports_file.exists():
        try:
            with open(ports_file) as f:
                ports_data = json.load(f)
            if isinstance(ports_data, dict):
                data["backend_port"] = ports_data.get("backend_port", 8000)
                data["frontend_port"] = ports_data.get("frontend_port", 5173)
                data["ws_port"] = ports_data.get("ws_port", data["backend_port"])
                data["comfyui_url"] = ports_data.get("comfyui_url", "http://127.0.0.1:8188")
                data["comfyui_port"] = ports_data.get("comfyui_port", 8188)
                data["video_editor_port"] = ports_data.get("video_editor_port", 8080)
                data["ollama_url"] = ports_data.get("ollama_url", "http://127.0.0.1:11434")
                data["atomic_chat_url"] = ports_data.get("atomic_chat_url", "http://127.0.0.1:1337")
                data["atomic_chat_enabled"] = ports_data.get("atomic_chat_enabled", False)
                data["go_dashboard_url"] = ports_data.get(
                    "go_dashboard_url", "http://127.0.0.1:3847"
                )
                data["go_media_url"] = ports_data.get("go_media_url", "http://127.0.0.1:3848")
                data["go_worker_url"] = ports_data.get("go_worker_url", "http://127.0.0.1:3849")
                data["go_gateway_url"] = ports_data.get("go_gateway_url", "http://127.0.0.1:3850")
                data["go_ports_url"] = ports_data.get("go_ports_url", "http://127.0.0.1:3851")
        except Exception as e:
            logger.warning(f"Could not load port defaults from {ports_file}: {e}")

    try:
        config = AppConfig(**data)
        _CONFIG_MTIME = settings_file.stat().st_mtime if settings_file.exists() else None
        logger.info("Configuration reloaded from settings.json")
        return config
    except Exception as e:
        logger.error(f"Failed to rebuild config on reload: {e}")
        return config


config = load_config()
_CONFIG_MTIME = (
    (CONFIG_DIR / "settings.json").stat().st_mtime
    if (CONFIG_DIR / "settings.json").exists()
    else None
)

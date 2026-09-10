import json
import logging
from pathlib import Path

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
    # is a compat shim on the same port. `ws_port` is deprecated — use
    # backend_port. Kept for config/ports.json compat.
    ws_port: int = 8000
    comfyui_url: str = "http://127.0.0.1:8188"
    comfyui_port: int = 8188
    video_editor_port: int = 8080
    comfyui_output_dir: Path | None = None  # Defaults to <PROJECT_ROOT>/../ComfyUI/output if unset
    ollama_url: str = "http://127.0.0.1:11434"
    go_dashboard_url: str = "http://127.0.0.1:3847"
    go_media_url: str = "http://127.0.0.1:3848"
    go_worker_url: str = "http://127.0.0.1:3849"
    go_gateway_url: str = "http://127.0.0.1:3850"
    go_ports_url: str = "http://127.0.0.1:3851"
    max_queue_workers: int = 1
    output_dir: Path = OUTPUT_DIR
    log_level: str = "INFO"
    default_model: str = "gemma4:e2b-it-qat"
    vision_model: str = "gemma4-vision-optimized:latest"
    embedding_model: str = "nomic-embed-text:v1.5"

    model_config = ConfigDict(arbitrary_types_allowed=True)

    @field_validator('backend_port', 'frontend_port', 'ws_port')
    @classmethod
    def validate_port(cls, v: int) -> int:
        """Validate that port is in valid range"""
        if not (1 <= v <= 65535):
            raise ValueError(f'Port must be between 1 and 65535, got {v}')
        return v

    @field_validator('backend_host')
    @classmethod
    def validate_host(cls, v: str) -> str:
        """Validate that host is not empty"""
        if not v or not v.strip():
            raise ValueError('Host cannot be empty')
        return v.strip()

    @field_validator('comfyui_url', 'ollama_url', 'go_dashboard_url', 'go_media_url', 'go_worker_url', 'go_gateway_url', 'go_ports_url')
    @classmethod
    def validate_url(cls, v: str) -> str:
        """Validate that URL is properly formatted"""
        if not v or not v.strip():
            raise ValueError(f"URL cannot be empty")
        v = v.strip()
        if not v.startswith(('http://', 'https://')):
            raise ValueError(f"URL must start with http:// or https://, got {v}")
        return v

    @field_validator('log_level')
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        """Validate that log level is valid"""
        valid_levels = {'DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'}
        v_upper = v.upper()
        if v_upper not in valid_levels:
            raise ValueError(f'Log level must be one of {valid_levels}, got {v}')
        return v_upper

    @field_validator('max_queue_workers')
    @classmethod
    def validate_workers(cls, v: int) -> int:
        """Validate that worker count is reasonable"""
        if v < 1:
            raise ValueError(f'Worker count must be at least 1, got {v}')
        if v > 10:
            logger.warning(f'Worker count {v} is high, may impact performance')
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
    if ports_file.exists():
        try:
            with open(ports_file) as f:
                ports_data = json.load(f)
                if isinstance(ports_data, dict):
                    # Ports/URLs always come from ports.json; settings.json overrides
                    # are ignored for these fields to prevent drift.
                    data.setdefault("backend_port", ports_data.get("backend_port", 8000))
                    data.setdefault("frontend_port", ports_data.get("frontend_port", 5173))
                    data.setdefault("ws_port", ports_data.get("ws_port", data.get("backend_port", 8000)))
                    data.setdefault("comfyui_url", ports_data.get("comfyui_url", "http://127.0.0.1:8188"))
                    data.setdefault("comfyui_port", ports_data.get("comfyui_port", 8188))
                    data.setdefault("video_editor_port", ports_data.get("video_editor_port", 8080))
                    data.setdefault("ollama_url", ports_data.get("ollama_url", "http://127.0.0.1:11434"))
                    data.setdefault("go_dashboard_url", ports_data.get("go_dashboard_url", "http://127.0.0.1:3847"))
                    data.setdefault("go_media_url", ports_data.get("go_media_url", "http://127.0.0.1:3848"))
                    data.setdefault("go_worker_url", ports_data.get("go_worker_url", "http://127.0.0.1:3849"))
                    data.setdefault("go_gateway_url", ports_data.get("go_gateway_url", "http://127.0.0.1:3850"))
                    data.setdefault("go_ports_url", ports_data.get("go_ports_url", "http://127.0.0.1:3851"))
        except Exception as e:
            logger.warning(f"Could not load port defaults from {ports_file}: {e}")

    return AppConfig(**data)


def save_config(config: AppConfig) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    config_file = CONFIG_DIR / "settings.json"
    try:
        with open(config_file, "w") as f:
            json.dump(config.model_dump(), f, indent=2, default=str)
        logger.info(f"Configuration saved to {config_file}")
    except Exception as e:
        logger.error(f"Failed to save configuration to {config_file}: {e}")
        raise


config = load_config()

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
    # is a compat shim on the same port. `ws_port` is deprecated — use
    # backend_port. Kept for config/ports.json compat.
    ws_port: int = 8000
    comfyui_url: str = "http://127.0.0.1:8188"
    ollama_url: str = "http://127.0.0.1:11434"
    max_queue_workers: int = 1
    output_dir: Path = OUTPUT_DIR
    log_level: str = "INFO"

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

    @field_validator('comfyui_url', 'ollama_url')
    @classmethod
    def validate_url(cls, v: str) -> str:
        """Validate that URL is properly formatted"""
        if not v or not v.strip():
            raise ValueError('URL cannot be empty')
        v = v.strip()
        if not v.startswith(('http://', 'https://')):
            raise ValueError(f'URL must start with http:// or https://, got {v}')
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
    config_file = CONFIG_DIR / "settings.json"
    if config_file.exists():
        try:
            with open(config_file) as f:
                data = json.load(f)
                return AppConfig(**data)
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON in config file {config_file}: {e}")
            logger.warning("Using default configuration")
        except Exception as e:
            logger.error(f"Error loading config from {config_file}: {e}")
            logger.warning("Using default configuration")
    return AppConfig()


def save_config(config: AppConfig) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    config_file = CONFIG_DIR / "settings.json"
    try:
        with open(config_file, "w") as f:
            json.dump(config.model_dump(), f, indent=2)
        logger.info(f"Configuration saved to {config_file}")
    except Exception as e:
        logger.error(f"Failed to save configuration to {config_file}: {e}")
        raise


config = load_config()

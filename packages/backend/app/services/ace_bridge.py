"""
ACE-Step Bridge Service.

Isolates the Native Media AI Studio app from ACE-Step provider API changes.
If ACE-Step is updated by the provider (new parameter names, changed response
shapes, different model IDs), only the bridge config and this service need
updating — the rest of the app keeps calling stable methods.

Architecture:
  config/ace-step/           - Bridge directory (config, version tracking)
  tools/music-gen/server.py  - ACE-Step subprocess service (updatable via git pull)

Design follows D21 (agent handoff portability) - model-agnostic, file-based
state, checker/guard scripts as enforcement layer.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from ..core.config import PROJECT_ROOT

logger = logging.getLogger(__name__)

# Bridge directory layout
BRIDGE_DIR_NAME = "config/ace-step"
BRIDGE_CONFIG_FILE_NAME = "bridge.json"


class ACEBridgeError(Exception):
    """Raised when bridge operations fail."""


class ACEBridge:
    """
    Manages the bridge between the app and ACE-Step.

    Responsibilities:
    1. Load bridge configuration from config/ace-step/bridge.json
    2. Track ACE-Step version and model compatibility
    3. Provide parameter/response compatibility maps for the client
    4. Detect when ACE-Step has been updated by the provider
    5. Validate bridge integrity before use
    6. Report bridge status for API/health endpoints
    """

    def __init__(self):
        self.bridge_dir = PROJECT_ROOT / BRIDGE_DIR_NAME
        self.config_file = self.bridge_dir / BRIDGE_CONFIG_FILE_NAME

        self._config: dict[str, Any] | None = None
        self._param_map: dict[str, str] | None = None
        self._response_map: dict[str, str] | None = None

    # ------------------------------------------------------------------
    # Configuration
    # ------------------------------------------------------------------

    def load_config(self) -> dict[str, Any]:
        """Load bridge configuration from bridge.json."""
        if self._config is not None:
            return self._config

        if not self.config_file.exists():
            logger.warning(
                "ACE-Step bridge config not found at %s, using defaults",
                self.config_file,
            )
            self._config = {
                "bridge": {"enabled": True, "service": "ace-step"},
                "service": {
                    "base_url": "http://127.0.0.1:8201",
                    "health_timeout": 5,
                    "generate_timeout": 600,
                    "unload_timeout": 10,
                    "reload_timeout": 60,
                },
                "version": {
                    "tracked_ace_step_version": "1.5",
                    "tracked_model_id": "acestep-v15-sft",
                    "api_compatibility": "v1",
                    "provider_update_detected": False,
                },
                "compatibility": {
                    "parameter_map": {
                        "style": "captions",
                        "lyrics": "lyrics",
                        "cfg_scale": "guidance_scale",
                        "inference_steps": "inference_steps",
                        "seed": "seed",
                        "output_name": "output_name",
                    },
                    "response_map": {
                        "audio_path": "audio_path",
                        "seed": "seed",
                        "sample_rate": "sample_rate",
                        "engine": "engine",
                    },
                    "unsupported_features": [
                        "bf16_quantization",
                        "triton_compile",
                        "flash_attention",
                    ],
                },
                "startup": {
                    "verify_on_start": True,
                    "auto_detect_version": True,
                    "warn_on_version_mismatch": True,
                },
            }
            return self._config

        try:
            self._config = json.loads(self.config_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            logger.error("Failed to load ACE-Step bridge config: %s", exc)
            self._config = {}

        return self._config

    def bridge_enabled(self) -> bool:
        """Check if the bridge is enabled."""
        bridge_cfg = self.load_config()
        return bridge_cfg.get("bridge", {}).get("enabled", True)

    # ------------------------------------------------------------------
    # Service connection info
    # ------------------------------------------------------------------

    def service_base_url(self) -> str:
        """Return the ACE-Step service base URL."""
        service_cfg = self.load_config().get("service", {})
        return service_cfg.get("base_url", "http://127.0.0.1:8201")

    def service_timeout(self, operation: str) -> float:
        """Return the configured timeout (seconds) for an operation."""
        service_cfg = self.load_config().get("service", {})
        key = f"{operation}_timeout"
        return float(service_cfg.get(key, 30.0))

    # ------------------------------------------------------------------
    # Compatibility maps (consumed by ACEClient)
    # ------------------------------------------------------------------

    def param_map(self) -> dict[str, str]:
        """Return the app-facing → ACE-Step wire parameter name map.

        App code uses canonical names (``cfg_scale``). If a provider update
        renames the wire parameter, add an entry here and the client
        translates automatically.
        """
        if self._param_map is None:
            compat = self.load_config().get("compatibility", {})
            self._param_map = compat.get("parameter_map", {})
        return self._param_map

    def response_map(self) -> dict[str, str]:
        """Return the ACE-Step wire → app-facing response name map."""
        if self._response_map is None:
            compat = self.load_config().get("compatibility", {})
            self._response_map = compat.get("response_map", {})
        return self._response_map

    def unsupported_features(self) -> list[str]:
        """Return features this bridge does not support (provider may add them)."""
        compat = self.load_config().get("compatibility", {})
        return compat.get("unsupported_features", [])

    # ------------------------------------------------------------------
    # Version tracking
    # ------------------------------------------------------------------

    def tracked_version(self) -> str:
        """Return the ACE-Step version this bridge was built against."""
        version_cfg = self.load_config().get("version", {})
        return version_cfg.get("tracked_ace_step_version", "unknown")

    def tracked_model_id(self) -> str:
        """Return the model ID this bridge was built against."""
        version_cfg = self.load_config().get("version", {})
        return version_cfg.get("tracked_model_id", "unknown")

    def api_compatibility(self) -> str:
        """Return the API compatibility level this bridge targets."""
        version_cfg = self.load_config().get("version", {})
        return version_cfg.get("api_compatibility", "v1")

    def provider_update_detected(self) -> bool:
        """Return True if a provider update has been detected."""
        version_cfg = self.load_config().get("version", {})
        return bool(version_cfg.get("provider_update_detected", False))

    def set_provider_update_detected(self, detected: bool) -> None:
        """Record that a provider update has been detected (persists to config)."""
        config = self.load_config()
        version_cfg = config.setdefault("version", {})
        version_cfg["provider_update_detected"] = detected
        version_cfg["last_verified"] = self._iso_now()
        self._write_config(config)
        self._config = config

    @staticmethod
    def _iso_now() -> str:
        from datetime import datetime, timezone

        return datetime.now(timezone.utc).isoformat()

    def _write_config(self, config: dict[str, Any]) -> None:
        """Persist config back to bridge.json."""
        try:
            self.config_file.parent.mkdir(parents=True, exist_ok=True)
            self.config_file.write_text(json.dumps(config, indent=2), encoding="utf-8")
        except OSError as exc:
            logger.warning("Failed to persist ACE-Step bridge config: %s", exc)

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    def verify_bridge_integrity(self) -> dict[str, Any]:
        """Verify the bridge integrity: config exists, paths are valid, etc."""
        issues: list[str] = []
        warnings: list[str] = []

        # Check bridge config exists
        if not self.config_file.exists():
            issues.append(f"Bridge config file not found: {self.config_file}")

        # Check service script exists
        script_path = PROJECT_ROOT / self._service_script_path()
        if not script_path.exists():
            issues.append(f"ACE-Step server script not found: {script_path}")

        # Check Python interpreter for the service
        venv_path = PROJECT_ROOT / self._venv_python_path()
        if not venv_path.exists():
            warnings.append(
                f"ACE-Step venv Python not found at {venv_path}; "
                "the service may fall back to system Python"
            )

        # Check tracked version is set
        if not self.tracked_version() or self.tracked_version() == "unknown":
            warnings.append("No ACE-Step version tracked in bridge config")

        return {
            "valid": len(issues) == 0,
            "issues": issues,
            "warnings": warnings,
            "bridge_dir": str(self.bridge_dir),
            "tracked_version": self.tracked_version(),
            "tracked_model_id": self.tracked_model_id(),
            "api_compatibility": self.api_compatibility(),
            "provider_update_detected": self.provider_update_detected(),
        }

    def _service_script_path(self) -> str:
        paths = self.load_config().get("paths", {})
        return paths.get("server_script", "tools/music-gen/server.py")

    def _venv_python_path(self) -> str:
        paths = self.load_config().get("paths", {})
        return paths.get("venv_python", "tools/music-gen/ACE-Step-1.5/.venv/Scripts/python.exe")

    def get_bridge_status(self) -> dict[str, Any]:
        """Get the current bridge status for API reporting."""
        integrity = self.verify_bridge_integrity()

        return {
            "bridge_enabled": self.bridge_enabled(),
            "service": "ace-step",
            "bridge_dir": str(self.bridge_dir),
            "config_file": str(self.config_file),
            "service_base_url": self.service_base_url(),
            "tracked_version": self.tracked_version(),
            "tracked_model_id": self.tracked_model_id(),
            "api_compatibility": self.api_compatibility(),
            "provider_update_detected": self.provider_update_detected(),
            "compatibility": {
                "parameter_map": self.param_map(),
                "response_map": self.response_map(),
                "unsupported_features": self.unsupported_features(),
            },
            "startup": {
                "verify_on_start": self.load_config()
                .get("startup", {})
                .get("verify_on_start", True),
                "auto_detect_version": self.load_config()
                .get("startup", {})
                .get("auto_detect_version", True),
                "warn_on_version_mismatch": self.load_config()
                .get("startup", {})
                .get("warn_on_version_mismatch", True),
            },
            "integrity": integrity,
        }


# Global instance
ace_bridge = ACEBridge()

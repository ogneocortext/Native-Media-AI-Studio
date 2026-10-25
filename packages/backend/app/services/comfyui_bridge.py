"""
ComfyUI Bridge Service - Manages the bridge between Native Media AI Studio app
and standalone ComfyUI core.

Architecture:
  /ComfyUI/                    - ComfyUI core (standalone, updatable via git pull)
  config/comfyui/              - Bridge directory (custom nodes, workflows, config)

On ComfyUI startup, custom nodes from config/comfyui/custom_nodes/ are symlinked
into ComfyUI's custom_nodes/ directory. This keeps ComfyUI core pristine while
allowing custom modifications to live in version control.

Design follows D21 (agent handoff portability) - model-agnostic, file-based
state, checker/guard scripts as enforcement layer.
"""

from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path
from typing import Any

from ..core.config import PROJECT_ROOT
from ..core.paths import comfyui_dir

logger = logging.getLogger(__name__)

# Bridge directory layout
BRIDGE_DIR = Path("config/comfyui")
BRIDGE_CONFIG_FILE = BRIDGE_DIR / "bridge.json"
BRIDGE_CUSTOM_NODES_DIR = BRIDGE_DIR / "custom_nodes"
BRIDGE_WORKFLOWS_DIR = BRIDGE_DIR / "workflows"
BRIDGE_MODELS_DIR = BRIDGE_DIR / "models"


class ComfyUIBridgeError(Exception):
    """Raised when bridge operations fail."""


class ComfyUIBridge:
    """Manages the bridge between ComfyUI core and app customizations.

    Responsibilities:
    1. Load bridge configuration from config/comfyui/bridge.json
    2. Symlink custom nodes from bridge to ComfyUI's custom_nodes/ on startup
    3. Provide workflow templates for the app to use
    4. Track which custom nodes are installed
    5. Validate bridge integrity before ComfyUI starts
    """

    def __init__(self):
        self.comfyui_dir = comfyui_dir()
        self.comfyui_custom_nodes_dir = self.comfyui_dir / "custom_nodes"
        self.bridge_dir = PROJECT_ROOT / BRIDGE_DIR
        self.config_file = self.bridge_dir / "bridge.json"
        self.custom_nodes_source = self.bridge_dir / BRIDGE_CUSTOM_NODES_DIR
        self.workflows_dir = self.bridge_dir / BRIDGE_WORKFLOWS_DIR
        self.models_dir = self.bridge_dir / BRIDGE_MODELS_DIR

        self._config: dict[str, Any] | None = None
        self._linked_nodes: list[str] = []
        self._linked_paths: list[Path] = []

    # ------------------------------------------------------------------
    # Configuration
    # ------------------------------------------------------------------

    def load_config(self) -> dict[str, Any]:
        """Load bridge configuration from bridge.json."""
        if self._config is not None:
            return self._config

        if not self.config_file.exists():
            logger.warning(
                "Bridge config not found at %s, using defaults",
                self.config_file,
            )
            self._config = {
                "bridge": {"enabled": True},
                "paths": {
                    "custom_nodes_source": str(self.custom_nodes_source),
                    "custom_nodes_target": str(self.comfyui_custom_nodes_dir),
                },
                "custom_nodes": {"nodes": []},
                "workflows": {"workflows": []},
                "models": {"models": []},
                "startup": {
                    "link_custom_nodes": True,
                    "verify_on_start": True,
                    "auto_install_requirements": False,
                },
            }
            return self._config

        try:
            self._config = json.loads(self.config_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            logger.error("Failed to load bridge config: %s", e)
            self._config = {}

        return self._config

    def bridge_enabled(self) -> bool:
        """Check if the bridge is enabled."""
        bridge_cfg = self.load_config()
        return bridge_cfg.get("bridge", {}).get("enabled", True)

    def should_link_custom_nodes(self) -> bool:
        """Check if custom nodes should be linked on startup."""
        bridge_cfg = self.load_config()
        return bridge_cfg.get("startup", {}).get("link_custom_nodes", True)

    def should_verify_on_start(self) -> bool:
        """Check if bridge should verify integrity on start."""
        bridge_cfg = self.load_config()
        return bridge_cfg.get("startup", {}).get("verify_on_start", True)

    # ------------------------------------------------------------------
    # Custom node management
    # ------------------------------------------------------------------

    def get_configured_nodes(self) -> list[dict[str, Any]]:
        """Get the list of configured custom nodes from bridge config."""
        bridge_cfg = self.load_config()
        return bridge_cfg.get("custom_nodes", {}).get("nodes", [])

    def get_available_node_files(self) -> list[Path]:
        """Get list of custom node Python files in the bridge directory."""
        if not self.custom_nodes_source.exists():
            return []
        return sorted(
            p for p in self.custom_nodes_source.glob("*.py")
            if p.is_file() and p.name != "__init__.py"
        )

    def is_node_linked(self, node_name: str) -> bool:
        """Check if a custom node is currently linked into ComfyUI."""
        target = self.comfyui_custom_nodes_dir / node_name
        return target.exists()

    def link_node(self, node_name: str) -> bool:
        """Symlink a custom node from bridge to ComfyUI's custom_nodes/.

        Returns True if linked successfully, False otherwise.
        """
        source = self.custom_nodes_source / node_name
        target = self.comfyui_custom_nodes_dir / node_name

        if not source.exists():
            logger.error("Custom node source not found: %s", source)
            return False

        # Remove existing link/directory if present
        if target.exists() or target.is_symlink():
            if target.is_symlink():
                target.unlink()
            elif target.is_dir():
                shutil.rmtree(target)
            elif target.is_file():
                target.unlink()

        try:
            # Create symlink (Windows requires admin for symlinks, fallback to copy)
            try:
                target.symlink_to(source, target_is_directory=source.is_dir())
            except (OSError, NotImplementedError):
                # Windows may not allow symlinks without admin privileges
                # Fall back to copying the directory
                if source.is_dir():
                    shutil.copytree(source, target)
                else:
                    shutil.copy2(source, target)
            logger.info("Linked custom node: %s -> %s", source, target)
            self._linked_nodes.append(node_name)
            self._linked_paths.append(target)
            return True
        except Exception as e:
            logger.error("Failed to link custom node %s: %s", node_name, e)
            return False

    def unlink_node(self, node_name: str) -> bool:
        """Remove a custom node link from ComfyUI's custom_nodes/."""
        target = self.comfyui_custom_nodes_dir / node_name
        if not target.exists() and not target.is_symlink():
            return True  # Already not linked

        try:
            if target.is_symlink():
                target.unlink()
            elif target.is_dir():
                shutil.rmtree(target)
            elif target.is_file():
                target.unlink()
            logger.info("Unlinked custom node: %s", target)
            if node_name in self._linked_nodes:
                self._linked_nodes.remove(node_name)
            if target in self._linked_paths:
                self._linked_paths.remove(target)
            return True
        except Exception as e:
            logger.error("Failed to unlink custom node %s: %s", node_name, e)
            return False

    def link_all_configured_nodes(self) -> dict[str, Any]:
        """Link all configured custom nodes into ComfyUI."""
        nodes = self.get_configured_nodes()
        linked = []
        failed = []

        for node_config in nodes:
            node_name = node_config.get("name", "")
            source_file = node_config.get("source", "")

            # Find the actual source file
            source_path = None
            if source_file:
                candidate = self.custom_nodes_source / source_file
                if candidate.exists():
                    source_path = candidate
                else:
                    # Try searching
                    for f in self.get_available_node_files():
                        if f.name == source_file or f.stem == source_file:
                            source_path = f
                            break

            if source_path is None:
                logger.warning("Source file not found for node: %s", node_name)
                failed.append({"node": node_name, "reason": "source not found"})
                continue

            # Use the directory name as the link target name
            node_dir_name = source_path.parent.name
            if self.link_node(node_dir_name):
                linked.append(node_dir_name)
            else:
                failed.append({"node": node_name, "reason": "link failed"})

        return {
            "linked": linked,
            "failed": failed,
            "total": len(nodes),
        }

    def unlink_all_nodes(self) -> dict[str, Any]:
        """Unlink all previously linked custom nodes."""
        unlinked = []
        failed = []

        for node_name in list(self._linked_nodes):
            if self.unlink_node(node_name):
                unlinked.append(node_name)
            else:
                failed.append(node_name)

        return {
            "unlinked": unlinked,
            "failed": failed,
        }

    # ------------------------------------------------------------------
    # Workflow management
    # ------------------------------------------------------------------

    def get_workflows(self) -> list[dict[str, Any]]:
        """Get list of configured workflows from bridge config."""
        bridge_cfg = self.load_config()
        return bridge_cfg.get("workflows", {}).get("workflows", [])

    def get_workflow_file(self, workflow_id: str) -> Path | None:
        """Get the path to a workflow JSON file."""
        workflows = self.get_workflows()
        for wf in workflows:
            if wf.get("id") == workflow_id:
                filename = wf.get("file", f"{workflow_id}.json")
                path = self.workflows_dir / filename
                if path.exists():
                    return path
        return None

    def load_workflow(self, workflow_id: str) -> dict[str, Any] | None:
        """Load a workflow JSON file."""
        path = self.get_workflow_file(workflow_id)
        if path is None:
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            logger.error("Failed to load workflow %s: %s", workflow_id, e)
            return None

    def list_available_workflow_files(self) -> list[Path]:
        """List all workflow JSON files in the bridge workflows directory."""
        if not self.workflows_dir.exists():
            return []
        return sorted(self.workflows_dir.glob("*.json"))

    # ------------------------------------------------------------------
    # Model management
    # ------------------------------------------------------------------

    def get_models(self) -> list[dict[str, Any]]:
        """Get list of configured models from bridge config."""
        bridge_cfg = self.load_config()
        return bridge_cfg.get("models", {}).get("models", [])

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    def verify_bridge_integrity(self) -> dict[str, Any]:
        """Verify the bridge integrity - checks that all configured nodes
        have source files, all workflows exist, etc."""
        issues = []
        warnings = []

        # Check bridge config exists
        if not self.config_file.exists():
            issues.append("Bridge config file not found: " + str(self.config_file))

        # Check ComfyUI directory
        if not self.comfyui_dir.exists():
            issues.append("ComfyUI directory not found: " + str(self.comfyui_dir))
        elif not (self.comfyui_dir / "main.py").exists():
            issues.append("ComfyUI main.py not found in: " + str(self.comfyui_dir))

        # Check custom nodes source
        if not self.custom_nodes_source.exists():
            issues.append("Custom nodes source directory not found: " + str(self.custom_nodes_source))

        # Check configured nodes have source files
        for node in self.get_configured_nodes():
            node_name = node.get("name", "unknown")
            source_file = node.get("source", "")
            if source_file:
                candidate = self.custom_nodes_source / source_file
                if not candidate.exists():
                    issues.append(
                        f"Source file not found for node '{node_name}': {source_file}"
                    )

        # Check workflow files exist
        for wf in self.get_workflows():
            filename = wf.get("file", "")
            if filename:
                path = self.workflows_dir / filename
                if not path.exists():
                    issues.append(f"Workflow file not found: {filename}")

        return {
            "valid": len(issues) == 0,
            "issues": issues,
            "warnings": warnings,
            "bridge_dir": str(self.bridge_dir),
            "comfyui_dir": str(self.comfyui_dir),
        }

    def get_bridge_status(self) -> dict[str, Any]:
        """Get the current bridge status for API reporting."""
        integrity = self.verify_bridge_integrity()

        linked_nodes = []
        for node_name in self._linked_nodes:
            target = self.comfyui_custom_nodes_dir / node_name
            linked_nodes.append({
                "name": node_name,
                "linked": target.exists() or target.is_symlink(),
                "path": str(target),
            })

        return {
            "bridge_enabled": self.bridge_enabled(),
            "bridge_dir": str(self.bridge_dir),
            "comfyui_dir": str(self.comfyui_dir),
            "custom_nodes_source": str(self.custom_nodes_source),
            "custom_nodes_target": str(self.comfyui_custom_nodes_dir),
            "configured_nodes": len(self.get_configured_nodes()),
            "linked_nodes": linked_nodes,
            "available_workflows": len(self.get_workflows()),
            "configured_models": len(self.get_models()),
            "integrity": integrity,
            "startup": {
                "link_custom_nodes": self.should_link_custom_nodes(),
                "verify_on_start": self.should_verify_on_start(),
            },
        }


# Global instance
comfyui_bridge = ComfyUIBridge()

"""
Native Media AI Studio - Custom Agent State Management

File-based state for agent handoffs (per D21: file-based state for handoffs,
provider-agnostic). Any agent landing fresh can read the state file and
resume work without model-specific context.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

STATE_DIR = Path("output/agent-state")
STATE_DIR.mkdir(parents=True, exist_ok=True)


class AgentState:
    """Persistent agent state stored as JSON files.

    Each agent session writes a state file keyed by session ID. On resume,
    a new agent reads the latest state file and continues where the previous
    agent left off. This is the model-agnostic handoff mechanism required by
    D21.
    """

    def __init__(self, session_id: str | None = None):
        self.session_id = session_id or f"session-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"
        self.state_path = STATE_DIR / f"{self.session_id}.json"
        self.data: dict[str, Any] = {
            "session_id": self.session_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "phase": "init",  # init | analyzing | planning | generating | rendering | complete | failed
            "audio_file": None,
            "analysis": None,
            "plan": None,
            "generated_assets": [],
            "video_path": None,
            "errors": [],
            "warnings": [],
        }

    def load(self) -> "AgentState":
        """Load state from disk if a state file exists for this session."""
        if self.state_path.exists():
            self.data = json.loads(self.state_path.read_text(encoding="utf-8"))
        return self

    def save(self) -> "AgentState":
        """Persist state to disk."""
        self.data["updated_at"] = datetime.now(timezone.utc).isoformat()
        self.state_path.write_text(json.dumps(self.data, indent=2), encoding="utf-8")
        return self

    def update(self, **kwargs: Any) -> "AgentState":
        """Update state fields and persist."""
        self.data.update(kwargs)
        self.save()
        return self

    def get(self, key: str, default: Any = None) -> Any:
        return self.data.get(key, default)

    def add_error(self, message: str) -> None:
        errors = self.data.get("errors", [])
        errors.append({"time": datetime.now(timezone.utc).isoformat(), "message": message})
        self.data["errors"] = errors[-50:]  # keep last 50
        self.save()

    def add_warning(self, message: str) -> None:
        warnings = self.data.get("warnings", [])
        warnings.append({"time": datetime.now(timezone.utc).isoformat(), "message": message})
        self.data["warnings"] = warnings[-50:]
        self.save()

    def add_generated_asset(self, asset_type: str, path: str, metadata: dict | None = None) -> None:
        assets = self.data.get("generated_assets", [])
        assets.append(
            {
                "type": asset_type,
                "path": path,
                "metadata": metadata or {},
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        self.data["generated_assets"] = assets
        self.save()

    @classmethod
    def list_sessions(cls) -> list[str]:
        """List all saved session IDs."""
        return sorted(p.stem for p in STATE_DIR.glob("*.json"))

    @classmethod
    def latest(cls) -> "AgentState | None":
        """Load the most recent session state."""
        sessions = cls.list_sessions()
        if not sessions:
            return None
        return cls(sessions[-1]).load()

"""
Native Media AI Studio - Custom Agent State Management

File-based state for agent handoffs (per D21: file-based state for handoffs,
provider-agnostic). Any agent landing fresh can read the state file and
resume work without model-specific context.

Uses Pydantic v2 for validation and structured serialization.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

STATE_DIR = Path("output/agent-state")
STATE_DIR.mkdir(parents=True, exist_ok=True)


class AgentStateData(BaseModel):
    """Structured state for an agent session."""
    session_id: str
    created_at: str
    updated_at: str
    phase: str = "init"  # init | analyzing | planning | generating | rendering | complete | failed
    audio_file: str | None = None
    analysis: dict[str, Any] | None = None
    plan: dict[str, Any] | None = None
    generated_assets: list[dict[str, Any]] = Field(default_factory=list)
    video_path: str | None = None
    errors: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[dict[str, Any]] = Field(default_factory=list)
    llm_driver: str | None = None  # "atomic_chat" | "ollama" | None
    llm_iterations: int = 0
    llm_tool_calls: list[dict[str, Any]] = Field(default_factory=list)
    llm_aborted: bool = False


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
        self.data = AgentStateData(
            session_id=self.session_id,
            created_at=datetime.now(timezone.utc).isoformat(),
            updated_at=datetime.now(timezone.utc).isoformat(),
        )

    def load(self) -> AgentState:
        """Load state from disk if a state file exists for this session."""
        if self.state_path.exists():
            raw = json.loads(self.state_path.read_text(encoding="utf-8"))
            self.data = AgentStateData(**raw)
        return self

    def save(self) -> AgentState:
        """Persist state to disk."""
        self.data.updated_at = datetime.now(timezone.utc).isoformat()
        self.state_path.write_text(
            self.data.model_dump_json(indent=2), encoding="utf-8"
        )
        return self

    def update(self, **kwargs: Any) -> AgentState:
        """Update state fields and persist."""
        for key, value in kwargs.items():
            if hasattr(self.data, key):
                setattr(self.data, key, value)
            else:
                self.data.model_extra = self.data.model_extra or {}
                self.data.model_extra[key] = value
        self.save()
        return self

    def get(self, key: str, default: Any = None) -> Any:
        return getattr(self.data, key, default)

    def add_error(self, message: str) -> None:
        errors = list(self.data.errors)
        errors.append({"time": datetime.now(timezone.utc).isoformat(),
                       "message": message})
        self.data.errors = errors[-50:]  # keep last 50
        self.save()

    def add_warning(self, message: str) -> None:
        warnings = list(self.data.warnings)
        warnings.append({"time": datetime.now(timezone.utc).isoformat(),
                         "message": message})
        self.data.warnings = warnings[-50:]
        self.save()

    def add_generated_asset(self, asset_type: str, path: str,
                            metadata: dict[str, Any] | None = None) -> None:
        assets = list(self.data.generated_assets)
        assets.append({
            "type": asset_type,
            "path": path,
            "metadata": metadata or {},
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        self.data.generated_assets = assets
        self.save()

    @classmethod
    def list_sessions(cls) -> list[str]:
        """List all saved session IDs."""
        if not STATE_DIR.exists():
            return []
        return sorted(p.stem for p in STATE_DIR.glob("*.json"))

    @classmethod
    def latest(cls) -> AgentState | None:
        """Load the most recent session state."""
        sessions = cls.list_sessions()
        if not sessions:
            return None
        return cls(sessions[-1]).load()

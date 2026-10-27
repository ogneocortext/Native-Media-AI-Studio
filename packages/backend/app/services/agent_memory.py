"""
Native Media AI Studio - Agent Memory Service

Implements a dual-process memory system for the Qwen3.5-4B agent:

- System 1 (fast): retrieve relevant memories before each LLM call,
  augment the system prompt with compact context.
- System 2 (slow): after each episode, reflect on outcomes, assign
  credit to retrieved memories, and curate new learnings into memory.

All data is stored in SQLite (output/nma.db) via the existing
database module, so memory persists across agent restarts and is
available to any agent landing fresh.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from app.core.database import get_db


@dataclass
class AgentMemoryEntry:
    """A curated memory entry (semantic memory)."""
    id: str
    entry_type: str  # 'pattern' | 'failure' | 'api_note' | 'env_const' | 'learning'
    title: str
    content: str
    tags: list[str]
    credit_score: float
    usage_count: int
    last_used: str | None
    created_at: str
    updated_at: str


@dataclass
class AgentEpisode:
    """One completed agent episode (episodic memory)."""
    id: str
    session_id: str
    goal: str
    approach: str
    result: str
    success: bool
    duration_ms: int
    tools_used: list[str]
    error_message: str | None
    llm_driver: str
    iterations: int
    created_at: str


class AgentMemoryService:
    """
    Dual-process memory service for the NMA agent.

    System 1 (retrieve): get_relevant_memories() returns the top-K memory
    entries for a given task goal, ordered by credit score and usage.

    System 2 (reflect): store_episode() + record_learning() persist
    episode outcomes and extract learnings; assign_credit() updates
    credit scores based on feedback.
    """

    # Maximum memories to return per retrieval (keeps context compact for Qwen 4B)
    MAX_RETRIEVAL_RESULTS = 5

    # Minimum credit score for an entry to be eligible for retrieval
    MIN_CREDIT_FOR_RETRIEVAL = -2.0

    def __init__(self):
        pass

    # ------------------------------------------------------------------
    # System 1 -- Retrieve
    # ------------------------------------------------------------------

    def get_relevant_memories(
        self,
        goal: str,
        limit: int | None = None,
    ) -> list[AgentMemoryEntry]:
        """
        Retrieve the most relevant memory entries for a given task goal.

        Strategy (per Dual-Process Agent research):
        1. Keyword match on tags + title + content (simple but effective
           for a 4B model; no embedding dependency).
        2. Order by credit_score DESC, then usage_count DESC.
        3. Return only entries with credit_score >= MIN_CREDIT_FOR_RETRIEVAL.
        4. Increment usage_count on each retrieval.
        """
        limit = limit or self.MAX_RETRIEVAL_RESULTS

        # Simple keyword matching: split goal into keywords, match against
        # tags and title. This avoids an embedding model dependency while
        # still being useful for a small model.
        keywords = [k.strip().lower() for k in goal.split() if len(k) > 3]
        like_conditions = " OR ".join(
            "LOWER(title) LIKE ? OR LOWER(content) LIKE ? OR LOWER(tags) LIKE ?"
            for _ in keywords
        )
        params: list[str | float] = []
        for kw in keywords:
            params.extend([f"%{kw}%", f"%{kw}%", f"%{kw}%"])

        query = f"""
            SELECT id, entry_type, title, content, tags, credit_score,
                   usage_count, last_used, created_at, updated_at
            FROM agent_memory_entries
            WHERE credit_score >= ?
            {"AND (" + like_conditions + ")" if keywords else ""}
            ORDER BY credit_score DESC, usage_count DESC
            LIMIT ?
        """
        params = [self.MIN_CREDIT_FOR_RETRIEVAL] + params + [limit]

        with get_db() as conn:
            rows = conn.execute(query, params).fetchall()

        # Increment usage_count for retrieved entries
        for row in rows:
            self._increment_usage(conn, row["id"])

        return [self._row_to_memory_entry(row) for row in rows]

    def _increment_usage(self, conn, entry_id: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            """
            UPDATE agent_memory_entries
            SET usage_count = usage_count + 1,
                last_used = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (now, now, entry_id),
        )

    def _row_to_memory_entry(self, row) -> AgentMemoryEntry:
        return AgentMemoryEntry(
            id=row["id"],
            entry_type=row["entry_type"],
            title=row["title"],
            content=row["content"],
            tags=json.loads(row["tags"] or "[]"),
            credit_score=row["credit_score"],
            usage_count=row["usage_count"],
            last_used=row["last_used"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    # ------------------------------------------------------------------
    # System 2 -- Store / Reflect
    # ------------------------------------------------------------------

    def store_episode(
        self,
        session_id: str,
        goal: str,
        approach: str,
        result: str,
        success: bool,
        duration_ms: int,
        tools_used: list[str],
        error_message: str | None = None,
        llm_driver: str = "atomic_chat",
        iterations: int = 0,
    ) -> str:
        """Store a completed agent episode. Returns the episode id."""
        eid = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO agent_episodes
                (id, session_id, goal, approach, result, success,
                 duration_ms, tools_used, error_message, llm_driver,
                 iterations, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    eid, session_id, goal, approach, result,
                    1 if success else 0, duration_ms,
                    json.dumps(tools_used), error_message,
                    llm_driver, iterations, now,
                ),
            )
        return eid

    def record_learning(
        self,
        entry_type: str,
        title: str,
        content: str,
        tags: list[str] | None = None,
        credit_score: float = 0.0,
    ) -> str:
        """Record a new memory entry (semantic memory). Returns the entry id."""
        eid = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO agent_memory_entries
                (id, entry_type, title, content, tags, credit_score,
                 usage_count, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
                """,
                (
                    eid, entry_type, title, content,
                    json.dumps(tags or []), credit_score,
                    now, now,
                ),
            )
        return eid

    def assign_credit(self, entry_id: str, delta: float) -> None:
        """Adjust the credit score of a memory entry (helpful +, harmful -)."""
        with get_db() as conn:
            conn.execute(
                """
                UPDATE agent_memory_entries
                SET credit_score = credit_score + ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (delta, datetime.now(timezone.utc).isoformat(), entry_id),
            )

    def get_episode(self, episode_id: str) -> AgentEpisode | None:
        """Retrieve a single episode by id."""
        with get_db() as conn:
            row = conn.execute(
                "SELECT * FROM agent_episodes WHERE id = ?",
                (episode_id,),
            ).fetchone()
        if not row:
            return None
        return self._row_to_episode(row)

    def _row_to_episode(self, row) -> AgentEpisode:
        return AgentEpisode(
            id=row["id"],
            session_id=row["session_id"],
            goal=row["goal"],
            approach=row["approach"],
            result=row["result"],
            success=bool(row["success"]),
            duration_ms=row["duration_ms"],
            tools_used=json.loads(row["tools_used"] or "[]"),
            error_message=row["error_message"],
            llm_driver=row["llm_driver"],
            iterations=row["iterations"],
            created_at=row["created_at"],
        )

    # ------------------------------------------------------------------
    # Context building for Qwen system prompt
    # ------------------------------------------------------------------

    def build_qwen_context(self, goal: str) -> str:
        """
        Build a compact context string to prepend to the Qwen system prompt.

        Returns a memory block like:

        <MEMORY>
        Relevant past learnings:
        - [pattern] Audio analysis -> music generation: always analyze first
        - [env_const] VRAM budget for music: 6144 MB
        </MEMORY>
        """
        memories = self.get_relevant_memories(goal)
        if not memories:
            return ""

        lines = ["<MEMORY>", "Relevant past learnings:"]
        for m in memories:
            lines.append(
                f"- [{m.entry_type}] {m.title}: {m.content[:200]}"
                + (f" (credit={m.credit_score:+.1f})" if m.credit_score != 0 else "")
            )
        lines.append("</MEMORY>")
        return "\n".join(lines)

    def list_recent_episodes(self, limit: int = 10) -> list[AgentEpisode]:
        """List the most recent episodes (for System 2 reflection)."""
        with get_db() as conn:
            rows = conn.execute(
                """
                SELECT * FROM agent_episodes
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [self._row_to_episode(row) for row in rows]

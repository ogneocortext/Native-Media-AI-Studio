"""
Sub-Agent Orchestration Skill Package
"""

from .orchestrator import (
    SubAgentOrchestrator,
    TaskCard,
    AgentArtifact,
    OrchestrationResult,
    OrchestrationPattern,
    AgentStatus,
    TaskBoard,
    orchestrate,
)

__all__ = [
    "SubAgentOrchestrator",
    "TaskCard", 
    "AgentArtifact",
    "OrchestrationResult",
    "OrchestrationPattern",
    "AgentStatus",
    "TaskBoard",
    "orchestrate",
]

__version__ = "1.0.0"
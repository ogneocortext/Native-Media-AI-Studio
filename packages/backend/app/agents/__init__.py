"""
Native Media AI Studio - Custom Agent Package

Agents in this repo follow the D21 agent handoff portability rules:
- Model-agnostic behavioral instructions
- File-based state for handoffs
- Commits carry reasoning (Co-authored-by trailer)
- Checker/guard scripts as enforcement layer
"""

from app.agents.nma_agent import NMAAgent, run_pipeline
from app.agents.agent_state import AgentState

__all__ = ["NMAAgent", "run_pipeline", "AgentState"]

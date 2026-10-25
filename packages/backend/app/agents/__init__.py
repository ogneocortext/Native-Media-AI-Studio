"""
Native Media AI Studio - Custom Agent Package

Agents in this repo follow the D21 agent handoff portability rules:
- Model-agnostic behavioral instructions
- File-based state for handoffs
- Commits carry reasoning (Co-authored-by trailer)
- Checker/guard scripts as enforcement layer

Oct 2026 best practices applied:
- Async-first (asyncio + httpx) - no blocking I/O
- Retry with exponential backoff + full jitter (only retryable errors)
- Circuit breaker pattern (shared across tasks, 3 states)
- Idempotency keys (stable across attempts, tenant+operation+param hash)
- Structured logging (trace_id, request_id, agent, model, etc.)
- Pydantic v2 input/output validation
- OpenTelemetry-style tracing (trace_id/span_id correlation)
- Error classification (retryable vs non-retryable vs side-effect-unknown)
- Rate limiting (per tool, per tenant, per workflow)
- Graceful degradation / fallback chain
- No sys.path.insert hacks (proper package imports)
"""

from app.agents.agent_state import AgentState, AgentStateData
from app.agents.api_client import NMAApiClient, NMAApiError
from app.agents.nma_agent import NMAAgent, run_pipeline

__all__ = ["NMAAgent", "run_pipeline", "AgentState",
           "AgentStateData", "NMAApiClient", "NMAApiError"]

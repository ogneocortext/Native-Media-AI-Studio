# Sub-Agent Orchestration Skill

**Intelligent, automatic sub-agent management for complex tasks.**

## Overview

This skill provides autonomous sub-agent orchestration that:
- **Auto-triggers** based on task analysis (no manual keywords needed)
- **Selects optimal pattern** from 6 proven orchestration patterns
- **Manages resources** with token budgets, concurrency caps, timeboxes
- **Uses structured artifacts** for handoffs (not chat)
- **Integrates with existing skills** (line-by-line-review, current-best-practices, test-measure-improve, visual-qa-loop, dependency-management, vendor-drift)
- **Resolves conflicts** during synthesis with weighted confidence
- **Provides observability** for debugging and cost tracking
- **Prevents server overload** with circuit breakers and rate limits

## Quick Start

```python
from skills.sub_agent_orchestration import orchestrate

result = await orchestrate(
    task="Your complex task description here",
    context={"repo": "your-project", "requirements": [...]}
)
```

## Files

| File | Purpose |
|------|---------|
| `SKILL.md` | Full documentation |
| `orchestrator.py` | Runtime implementation |
| `__init__.py` | Package exports |
| `QUICK_REFERENCE.md` | One-page cheat sheet |
| `../../orchestration.yaml` | Project configuration |

## Orchestration Patterns

| Pattern | Use Case |
|---------|----------|
| Orchestrator-Worker | Clear decomposition, parallel workers |
| Sequential Pipeline | Step-by-step with dependencies |
| Concurrent | Independent parallel subtasks |
| Generator-Verifier | Quality-critical (2-3 rounds) |
| Agent Teams | Long-running independent work |
| Shared State | Collaborative research |

## Resource Protection

- Max 3 concurrent agents
- 500K token session budget
- 8-minute default timebox
- Circuit breaker after 3 failures
- Cost tracking per agent

## Integration

Automatically uses companion skills:
- `line-by-line-review` for code review/refactor
- `current-best-practices` for research tasks
- `visual-qa-loop` for UI/visual tasks
- `test-measure-improve` for implementation
- `dependency-management` for audits
- `vendor-drift` for upgrades

## Configuration

Project-specific config at `.kilo/orchestration.yaml`:
- Model assignments per agent type
- Auto-trigger patterns
- Composite workflows
- Domain → agent mappings
- Resource limits

## No Manual Triggers

The orchestrator analyzes your task and **automatically** selects agents, patterns, and skills.
# Sub-Agent Orchestration Quick Reference

## One-Liner Usage

```python
from skills.sub_agent_orchestration import orchestrate

# Automatic - no manual triggers needed
result = await orchestrate(
    task="Implement real-time audio visualization with VST plugin support",
    context={"repo": "native-media-ai-studio"}
)
```

## What Happens Automatically

| Your Task Contains | Auto-Triggers |
|-------------------|---------------|
| "review", "audit", "analyze code" | `explore` agent (very thorough, 10m) |
| "best practice", "modern", "2026" | `general` + `current-best-practices` skill (8m) |
| "verify UI", "screenshot", "visual" | `general` + `visual-qa-loop` skill (5m) |
| "API design", "backend", "FastAPI" | `backend-architect` (8m) |
| "React component", "frontend", "UI" | `frontend-architect` (10m) |
| "refactor", "modernize", "migrate" | `explore` → `general` (sequential, 15m) |
| "test", "E2E", "Playwright" | `general` + `test-measure-improve` (10m) |
| "dependency audit", "security" | `general` + `dependency-management` (5m) |
| "vendor drift", "upgrade" | `general` + `vendor-drift` (8m) |
| "VST", "plugin", "chain" | `general` + `line-by-line-review` (10m) |
| "visualizer", "shader", "Three.js" | `frontend-architect` + `visual-qa-loop` (10m) |

## Composite Workflows (Auto-Detected)

| Task Pattern | Workflow |
|-------------|----------|
| "implement feature" (full stack) | `backend-architect` + `frontend-architect` (parallel) → integration |
| "refactor legacy" | `explore` → `backend-architect` + `frontend-architect` (parallel) → implement |
| "VST feature" | `explore` → `frontend-architect` → tests |
| "visualizer feature" | `explore` → `frontend-architect` → `visual-qa-loop` |

## Result Structure

```python
result = OrchestrationResult(
    success=True,
    pattern_used=OrchestrationPattern.ORCHESTRATOR_WORKER,
    task_cards=[...],           # Subtasks created
    artifacts=[...],            # Each agent's output
    synthesis={                 # Unified result
        "summary": "...",
        "findings": [...],      # Deduplicated
        "recommendations": [...],
        "blockers": [...]
    },
    conflicts=[...],            # Any contradictions found
    total_duration_seconds=45.2,
    total_tokens=125000
)
```

## Resource Guards (Automatic)

- **Max 3 agents** running concurrently
- **500K token** session budget
- **8 min** default timebox per agent
- **Max 8 agents** per orchestration
- **Circuit breaker** after 3 failures
- **Cost tracking** per agent

## Integration with Existing Skills

| Skill | Auto-Used When |
|-------|----------------|
| `line-by-line-review` | Code review, refactor, VST tasks |
| `current-best-practices` | "best practice", "modern", "research" |
| `visual-qa-loop` | UI verification, visualizer tasks |
| `test-measure-improve` | Test, fix, implement tasks |
| `dependency-management` | Dependency audit, security |
| `vendor-drift` | Vendor upgrade, fresh pull |

## Configuration

Project config at `.kilo/orchestration.yaml`:
- Model assignments
- Auto-trigger patterns
- Composite workflows
- Domain → agent mappings
- Resource limits

## No Manual Triggers Needed

The orchestrator **analyzes your task description** and **automatically**:
1. Selects optimal orchestration pattern
2. Spawns right agents with right skills
3. Manages concurrency and timeboxes
4. Passes structured artifacts (not chat)
5. Synthesizes with conflict resolution
6. Returns unified implementation plan

---

## For Complex Tasks: Just Describe the Goal

```python
# Instead of manually coordinating:
# 1. "explore the codebase"
# 2. "backend-architect design API"  
# 3. "frontend-architect build UI"
# 4. "general write tests"
# 5. "synthesize results"

# Just say:
result = await orchestrate(
    task="Build a real-time audio visualizer that loads VST3 plugins, "
         "lets users build effect chains with drag-drop reordering, "
         "supports undo/redo, and processes audio files with the chain",
    context={
        "repo": "native-media-ai-studio",
        "requirements": [
            "React.memo for performance",
            "CSS Modules (no inline styles)",
            "Native HTML5 drag-and-drop",
            "Undo/redo with Ctrl+Z",
            "Vitest unit tests",
            "Playwright E2E tests"
        ]
    }
)
```

The orchestrator handles the rest.
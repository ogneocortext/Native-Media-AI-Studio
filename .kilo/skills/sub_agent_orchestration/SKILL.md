# Skill: sub-agent-orchestration

## Sub-Agent Orchestration System

**Purpose**: Intelligent, automatic sub-agent management that triggers the right agents at the right time, orchestrates them through proven patterns, and synthesizes their outputs without conflicts or server overload.

**Companion Skills**: `line-by-line-review`, `current-best-practices`, `test-measure-improve`, `visual-qa-loop`

---

## Core Philosophy

> **Sub-agents should be infrastructure, not interrupts.** They activate automatically when task characteristics match their specialization, run with appropriate depth/duration, share state through structured artifacts (not chat), and hand off cleanly to implementation agents.

---

## Orchestration Patterns (from 2026 research)

| Pattern | When to Use | Coordination | Latency Profile |
|---------|-------------|--------------|-----------------|
| **Orchestrator-Worker** | Clear task decomposition, bounded subtasks | Central coordinator delegates, aggregates | Low (parallel workers) |
| **Sequential Pipeline** | Step-by-step refinement, clear dependencies | Linear, deterministic | Predictable (sum of stages) |
| **Concurrent/Parallel** | Independent subtasks, same input | Fork-join, merge at end | Fastest (critical path only) |
| **Generator-Verifier** | Quality-critical output, explicit criteria | Generator → Critic (2-3 rounds) | Moderate (bounded loop) |
| **Agent Teams** | Long-running, independent, parallel work | Shared task board + artifact store | Variable (async) |
| **Shared State / Swarm** | Collaborative research, no single failure point | Decentralized, event-driven | High coordination overhead |

---

## Auto-Trigger Rules (No Manual Intervention Needed)

The orchestrator analyzes the task and **automatically** spawns sub-agents when:

```yaml
# Task characteristics that trigger sub-agents
auto_trigger:
  # Code analysis / review tasks
  - pattern: "review|audit|analyze.*code|line.by.line"
    agent: "explore"
    config: { thoroughness: "very thorough", timebox: "10m" }
    
  # Research / best practices tasks
  - pattern: "best.practices|current.trends|modern.approach|research"
    agent: "general"
    config: { use_skill: "current-best-practices", timebox: "8m" }
    
  # Visual / UI verification
  - pattern: "verify.ui|visual.regression|screenshot|looks.correct"
    agent: "general"
    config: { use_skill: "visual-qa-loop", timebox: "5m" }
    
  # Backend architecture / API design
  - pattern: "api.design|backend.arch|service.layer|database.schema"
    agent: "backend-architect"
    config: { timebox: "8m" }
    
  # Frontend component / page creation
  - pattern: "create.component|build.page|implement.ui|frontend"
    agent: "frontend-architect"
    config: { timebox: "10m" }
    
  # Complex refactoring / multi-file changes
  - pattern: "refactor.*multiple|rename.across|migrate"
    agent: "general"
    config: { use_skill: "line-by-line-review", timebox: "15m" }
    
  # Testing / E2E verification
  - pattern: "test.*e2e|playwright|integration.test"
    agent: "general"
    config: { use_skill: "test-measure-improve", timebox: "10m" }
    
  # Dependency / security audit
  - pattern: "dependency.audit|security.scan|supply.chain"
    agent: "general"
    config: { use_skill: "dependency-management", timebox: "5m" }
    
  # Vendor drift / upgrade verification
  - pattern: "upgrade.*vendor|drift.check|fresh.pull"
    agent: "general"
    config: { use_skill: "vendor-drift", timebox: "8m" }

# Composite triggers (multiple agents in sequence/parallel)
composite_triggers:
  - name: "full_feature_implementation"
    when: "new feature spanning backend + frontend + tests"
    pattern: "implement.*feature|add.*feature|build.*system"
    sequence:
      - [ "backend-architect", "frontend-architect" ]  # parallel
      - "general"  # integration verification
    timebox: "30m"
    
  - name: "legacy_refactor"
    when: "refactor touches >5 files across layers"
    pattern: "refactor.*legacy|modernize.*codebase"
    sequence:
      - "explore"  # analyze current state
      - [ "backend-architect", "frontend-architect" ]  # parallel redesign
      - "general"  # implementation with line-by-line-review
    timebox: "45m"
```

---

## Agent Lifecycle Management

### Spawn Configuration
```yaml
agent_defaults:
  # Resource limits (prevent server overload)
  max_concurrent_agents: 3           # Global cap per session
  max_tokens_per_agent: 100000       # Context window budget
  default_timebox: "8m"              # Auto-terminate if stuck
  max_retries: 1                     # One retry on failure
  
  # Model selection by agent type
  models:
    explore: "bolt-local"            # Fast, read-only
    general: "gpt-6"                 # Balanced reasoning
    "backend-architect": "gpt-6"     # Deep architecture
    "frontend-architect": "gpt-6"    # Deep frontend
    "android-engineer": "gpt-6"      # Mobile specialist
    "go-engineer": "gpt-6"           # Go specialist
    
  # Reasoning effort by task complexity
  reasoning_effort:
    quick: "low"          # Simple lookup, <2m
    standard: "medium"    # Analysis, 5-10m
    deep: "high"          # Architecture, 15m+
```

### State Management (Artifacts, Not Chat)
```python
# Shared state structure - agents communicate through artifacts
class AgentArtifact:
    """Structured handoff between agents"""
    task_id: str
    agent_id: str
    agent_type: str
    status: "pending" | "running" | "completed" | "failed" | "cancelled"
    input_ref: str           # Reference to input artifact
    output_ref: str          # Reference to output artifact
    metadata:
        started_at: datetime
        completed_at: datetime
        tokens_used: int
        model_used: str
        confidence: float    # 0-1, self-assessed
    summary: str             # One-line result for orchestrator
    findings: list[dict]     # Structured findings
    recommendations: list[str]
    blockers: list[str]      # What stopped progress
```

### Task Board Pattern (from research)
```yaml
# Shared task board - single source of truth
task_board:
  columns:
    - "todo"       # Decomposed subtasks
    - "claimed"    # Agent has picked up
    - "in_progress"
    - "review"     # Output ready for synthesis
    - "done"       # Integrated into solution
    - "blocked"    # Needs orchestrator intervention
  
  # Each card on the board
  card:
    id: "uuid"
    title: "Specific, measurable subtask"
    description: "Detailed brief with acceptance criteria"
    owner: "agent_id"
    dependencies: ["card_id"]  # Must complete first
    artifacts: []              # Output references
    acceptance: "Measurable check"
    timebox: "8m"
```

---

## Orchestration Workflows

### 1. Orchestrator-Worker (Default for Complex Tasks)
```python
async def run_orchestrator_worker(task: Task, agents: list[AgentType]) -> Result:
    # 1. Orchestrator decomposes
    decomposition = await orchestrator.decompose(task, agents)
    
    # 2. Create task board cards
    board = TaskBoard()
    for subtask in decomposition.subtasks:
        board.add_card(subtask)
    
    # 3. Dispatch workers in parallel (up to max_concurrent)
    workers = [spawn_agent(t.agent_type, t) for t in decomposition.subtasks[:3]]
    
    # 4. Monitor with timeout
    results = await asyncio.wait_for(
        asyncio.gather(*workers, return_exceptions=True),
        timeout=decomposition.timebox
    )
    
    # 5. Aggregate with conflict resolution
    return await orchestrator.synthesize(results, decomposition)
```

### 2. Generator-Verifier (Quality-Critical)
```python
async def run_generator_verifier(task: Task, criteria: list[str]) -> Result:
    for round in range(3):  # Bounded to 3 rounds max
        # Generator produces
        output = await generator_agent.run(task)
        
        # Verifier evaluates against criteria
        verdict = await verifier_agent.run({
            "output": output,
            "criteria": criteria,
            "round": round
        })
        
        if verdict.passed:
            return output
        
        # Feedback to generator
        task = task.with_feedback(verdict.issues)
    
    return output  # Best effort after 3 rounds
```

### 3. Sequential Pipeline (Deterministic Dependencies)
```python
async def run_pipeline(stages: list[PipelineStage], initial_input) -> Result:
    current = initial_input
    for stage in stages:
        current = await stage.agent.run(current, stage.config)
        # Checkpoint: validate intermediate result
        if not stage.validator(current):
            raise PipelineError(f"Stage {stage.name} validation failed")
    return current
```

---

## Conflict Resolution & Synthesis

### Merge Strategies
```python
class MergeStrategy:
    """How to combine outputs from multiple agents"""
    
    @staticmethod
    def union_findings(results: list[AgentResult]) -> Synthesis:
        """Combine all unique findings"""
        all_findings = []
        for r in results:
            all_findings.extend(r.findings)
        return deduplicate(all_findings)
    
    @staticmethod
    def weighted_confidence(results: list[AgentResult]) -> Synthesis:
        """Weight by agent confidence and domain relevance"""
        weighted = []
        for r in results:
            weight = r.confidence * r.domain_relevance
            for f in r.findings:
                weighted.append({**f, "weight": weight})
        return top_k(weighted, k=10)
    
    @staticmethod
    def conflict_detection(results: list[AgentResult]) -> list[Conflict]:
        """Find contradictory recommendations"""
        conflicts = []
        # Group by topic
        by_topic = group_by_topic([f for r in results for f in r.findings])
        for topic, findings in by_topic.items():
            if has_contradiction(findings):
                conflicts.append(Conflict(topic, findings))
        return conflicts
```

### Orchestrator Synthesis Prompt
```markdown
You are synthesizing outputs from {N} specialized agents.

**Original Task**: {task_description}
**Decomposition**: {subtask_list}

**Agent Outputs**:
{for each agent: agent_type, summary, findings, confidence, blockers}

**Your Job**:
1. Identify conflicts between agents (same topic, different conclusions)
2. Resolve conflicts using: domain expertise, confidence scores, evidence quality
3. Produce unified recommendation with clear rationale
4. Note any unresolved items needing human decision
5. Output: { structured synthesis with actionable next steps }
```

---

## Resource Protection (Server Overload Prevention)

```yaml
resource_guards:
  # Token budget per session
  session_token_budget: 500000
  per_agent_token_cap: 150000
  
  # Concurrency limits
  max_parallel_agents: 3
  max_total_agents_per_task: 8
  
  # Rate limiting
  requests_per_minute: 30
  burst_allowance: 5
  
  # Circuit breakers
  consecutive_failures_before_pause: 3
  pause_duration: "2m"
  
  # Cost tracking
  track_cost_per_agent: true
  alert_threshold_usd: 0.50
```

### Adaptive Timeboxing
```python
def calculate_timebox(task_complexity: str, agent_count: int) -> int:
    """Dynamic timebox based on complexity and parallelism"""
    base = {"quick": 2, "standard": 8, "deep": 20}[task_complexity]
    # Parallel agents share wall time, not add to it
    return min(base * 1.5, 30)  # Cap at 30 minutes
```

---

## Integration with Existing Skills

### Line-by-Line Review Integration
```yaml
# When sub-agent does code review, it uses the skill
review_workflow:
  trigger: "code changes > 50 lines OR security-sensitive files"
  agent: "general"
  skill: "line-by-line-review"
  output_artifact: "review_report.md"
  integration: "orchestrator reads review_report.md before implementation"
```

### Best Practices Integration
```yaml
# Research agents automatically use current-best-practices
research_workflow:
  trigger: "any task mentioning 'best practice', 'modern', '2026', 'latest'"
  agent: "general"
  skill: "current-best-practices"
  output_artifact: "research_findings.json"
  integration: "findings injected into implementation agent context"
```

### Test-Measure-Improve Loop
```yaml
# Implementation agents run test-measure-improve
implementation_workflow:
  trigger: "implement|fix|refactor|add feature"
  agent: "frontend-architect" | "backend-architect"
  skill: "test-measure-improve"
  loop:
    - implement change
    - run tests (vitest/playwright/pytest)
    - measure: pass/fail, coverage, performance
    - improve if needed (max 3 iterations)
  output_artifact: "implementation_report.md"
```

---

## Observability & Debugging

```python
# Every agent emits structured events
class AgentEvent:
    event_type: "spawned" | "started" | "progress" | "completed" | "failed" | "cancelled"
    timestamp: datetime
    agent_id: str
    task_id: str
    metadata: dict
    
# Real-time dashboard data
dashboard_metrics:
  - active_agents: int
  - queue_depth: int
  - avg_agent_duration: float
  - success_rate: float
  - token_usage_rate: float
  - cost_per_task: float
  - conflicts_detected: int
  - conflicts_resolved: int
```

---

## Quick Reference: When Each Pattern Applies

```
Task Analysis → Pattern Selection:

"Analyze this codebase for X"           → explore (very thorough)
"Research best practices for Y"         → general + current-best-practices
"Implement feature Z (full stack)"      → orchestrator-worker (backend + frontend parallel)
"Refactor legacy module"                → explore → general (line-by-line-review)
"Fix failing tests"                     → general (test-measure-improve)
"Verify UI looks correct"               → general (visual-qa-loop)
"Upgrade dependencies safely"           → general (vendor-drift + dependency-management)
"Design API for new service"            → backend-architect
"Build React component library"         → frontend-architect
"Investigate production bug"            → explore + general (sequential)
"Write documentation for X"             → general (with domain context)
```

---

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Fix |
|--------------|---------|-----|
| **Spawning agents for trivial tasks** | Overhead > value | Minimum task complexity threshold |
| **Unbounded agent recursion** | Infinite delegation | Max depth = 2, max agents = 8 |
| **Passing full context in handoffs** | Context window bloat | Pass artifact references only |
| **No timebox** | Agents run forever | Mandatory timebox per agent |
| **Chat-based coordination** | Information loss, hard to trace | Structured artifacts + task board |
| **Single agent doing everything** | No specialization benefit | Decompose when >3 distinct domains |
| **Ignoring conflicts** | Contradictory implementations | Mandatory conflict detection in synthesis |

---

## Configuration File (`.kilo/orchestration.yaml`)

```yaml
# Project-specific orchestration config
project: "native-media-ai-studio"

# Domain mappings for this repo
domain_agents:
  "backend/fastapi": "backend-architect"
  "frontend/react": "frontend-architect"
  "unity/csharp": "general"
  "blender/python": "general"
  "go/sidecars": "go-engineer"
  "python/ml": "general"

# Custom trigger patterns for this codebase
custom_triggers:
  - pattern: "vst|vst3|plugin|chain"
    agent: "general"
    skill: "line-by-line-review"
    context: "VST Host system in packages/frontend/src/features/vst/"
    
  - pattern: "visualizer|shader|three.js|webgl"
    agent: "frontend-architect"
    skill: "visual-qa-loop"
    context: "Unity/Three.js visualizer in unity-visualizer/ and packages/frontend/src/features/visualizer/"

# Resource limits for this project
limits:
  max_parallel_agents: 3
  session_token_budget: 500000
  default_timebox: "8m"
```

---

## Usage in Agent Code

```python
# Automatic orchestration - no manual triggers needed
from skills.sub_agent_orchestration import orchestrate

# This function analyzes the task and runs the optimal pattern
result = await orchestrate(
    task="Implement real-time audio visualization with VST plugin support",
    context={
        "repo": "native-media-ai-studio",
        "files_changed": ["packages/frontend/src/features/vst/..."],
        "requirements": ["React.memo", "drag-drop", "undo-redo", "CSS Modules", "tests"]
    }
)

# Returns synthesized result with:
# - implementation_plan
# - code_changes (by file)
# - test_plan
# - conflicts_resolved
# - artifacts (references to sub-agent outputs)
```

---

## Summary

This skill provides **autonomous sub-agent orchestration** that:

1. **Auto-triggers** based on task analysis (no manual keywords needed)
2. **Selects optimal pattern** from 6 proven orchestration patterns
3. **Manages resources** with token budgets, concurrency caps, timeboxes
4. **Uses structured artifacts** for handoffs (not chat)
5. **Integrates with existing skills** (line-by-line-review, best-practices, test-measure-improve)
6. **Resolves conflicts** during synthesis with weighted confidence
7. **Provides observability** for debugging and cost tracking
8. **Prevents server overload** with circuit breakers and rate limits

The orchestrator becomes infrastructure that silently makes the right sub-agents run at the right time with the right depth.
# Agent Profiles — Structured Capability Definitions

> **Purpose:** Single source of truth for agent capabilities, model preferences, and task routing.
> Integrates with `tools/model-reliability/roster.md` (trust tiers) and `.kilo/orchestration.yaml` (task triggers).

## Agent Type Definitions

| Agent Type | Display Name | Primary Role | Co-authored-by Trailer | Trust Tier (Default) |
|------------|--------------|--------------|------------------------|----------------------|
| `orion` | Orion | Research / Handoff | `Orion <orion@hatch.local>` | A (Delegate) |
| `ling` | Ling 3.1 Flash | Local coding (Kilo Desktop) | `Ling 3.1 Flash` | A (Delegate) |
| `kilo` | Kilo | Local coding (Kilo Desktop) | `Kilo <kilo@native-media-ai.studio>` | A (Delegate) |
| `cline` | Cline | Local coding (Cline) | `Cline <cline@cline.bot>` | B (Scoped) |
| `opencode` | opencode | Terminal coding | `opencode` | B (Scoped) |
| `gpt6` | GPT-6 | Codex desktop | `GPT-6` | C (Supervised) |
| `devin` | Devin | Cognition desktop | `Devin` | A (Delegate, executor lane) |
| `bolt-local` | Bolt Local | Read-only lookups | `Nemotron 3.5 Bolt E4B` | A (Delegate) |
| `qwen-local` | Qwen Local | Fast read-only lookups | `Local Qwen3.5-4B` | Infrastructure |

---

## Agent Capability Profiles

### Orion (Research / Handoff Agent)
```yaml
agent_type: orion
display_name: "Orion"
primary_role: "Research, planning, and agent handoff"
description: |
  Specialized in deep research, architecture planning, and creating
  structured handoffs for implementation agents. Does not write code.
capabilities:
  - Deep technical research with web search
  - Architecture decision documentation
  - Task decomposition and planning
  - Creating implementation specifications
  - Model selection and provider routing
preferred_models:
  - tier: A
    models:
      - "stepfun/step-5-preview-free" (Kilo route)
      - "nemotron-3.5-super-vl" (Kilo route)
  - tier: B
    models:
      - "deepseek-v4.1-flash-free" (opencode route)
max_concurrent_tasks: 1
task_types:
  - "research"
  - "architecture_planning"
  - "decision_logging"
  - "handoff_creation"
  - "model_selection"
excluded_task_types:
  - "code_implementation"
  - "code_review"
  - "debugging"
  - "testing"
routing_rules:
  - trigger: "research|best.practice|architecture|plan|spec"
    priority: 10
  - trigger: "model.select|provider.route"
    priority: 9
```

### Ling 3.1 Flash (Local Coding — Kilo Desktop)
```yaml
agent_type: ling
display_name: "Ling 3.1 Flash"
primary_role: "Full-stack implementation, root-causing, refactoring"
description: |
  Primary implementation agent for Kilo Desktop. Strong at root-cause
  analysis, multi-file refactoring, and implementing complex plans
  with verification. Known for thorough measurement-before-fix discipline.
capabilities:
  - Full-stack implementation (React/TypeScript, FastAPI/Python)
  - Root-cause analysis and debugging
  - Multi-file refactoring with verification
  - Test implementation (Vitest, Playwright, pytest)
  - Documentation and decision-log updates
  - Git operations and commit hygiene
preferred_models:
  - tier: A
    models:
      - "inclusionai/ling-3.1-flash" (Kilo route)
  - tier: B
    models:
      - "kilo-auto/free" (Kilo route - varies per session)
max_concurrent_tasks: 2
task_types:
  - "implementation"
  - "refactoring"
  - "debugging"
  - "testing"
  - "documentation"
  - "git_operations"
routing_rules:
  - trigger: "implement|refactor|fix|debug|test|document"
    priority: 10
  - trigger: "vst|visualizer|audio|unity|blender"
    priority: 9
  - trigger: "root.cause|measure.before"
    priority: 10
```

### Kilo (Local Coding — Kilo Desktop)
```yaml
agent_type: kilo
display_name: "Kilo"
primary_role: "Full-stack implementation, orchestration, infrastructure"
description: |
  Primary implementation agent with focus on orchestration, infrastructure,
  and cross-cutting concerns. Manages sub-agent orchestration, CI/CD,
  and system-level improvements.
capabilities:
  - Full-stack implementation
  - Sub-agent orchestration
  - Infrastructure and tooling
  - CI/CD and gate management
  - Performance optimization
  - Security and compliance
preferred_models:
  - tier: A
    models:
      - "kilo-auto/free" (Kilo route)
      - "stepfun/step-5-preview-free" (Kilo route)
  - tier: B
    models:
      - "deepseek-v4.1-flash-free" (opencode route)
max_concurrent_tasks: 3
task_types:
  - "implementation"
  - "orchestration"
  - "infrastructure"
  - "ci_cd"
  - "performance"
  - "security"
routing_rules:
  - trigger: "orchestrat|infrastructure|ci|gate|pipeline"
    priority: 10
  - trigger: "implement|refactor|fix"
    priority: 8
```

### Cline (Local Coding — Cline Desktop)
```yaml
agent_type: cline
display_name: "Cline"
primary_role: "Implementation, audit, motion/visual work"
description: |
  Strong at implementation with visual/motion focus. Good at catching
  UI bugs that reading misses. Operates with explicit verification.
capabilities:
  - Frontend implementation (React, Remotion, Three.js)
  - Visual/audio verification via browser automation
  - Motion vocabulary and effect budgets
  - Playwright test implementation
  - Mutation testing
preferred_models:
  - tier: B
    models:
      - "cline/sonnet-4.5" (Cline route)
      - "cline/sonnet-4.6" (Cline route)
  - tier: C
    models:
      - "muse-spark" (Cline route - provisional)
max_concurrent_tasks: 2
task_types:
  - "frontend_implementation"
  - "visual_verification"
  - "playwright_testing"
  - "mutation_testing"
  - "motion_design"
routing_rules:
  - trigger: "visual|ui|playwright|motion|remotion|three.js"
    priority: 10
  - trigger: "frontend|component|component"
    priority: 9
```

### opencode (Terminal Coding Agent)
```yaml
agent_type: opencode
display_name: "opencode"
primary_role: "Terminal-based implementation, benchmarks, vision pipeline"
description: |
  Terminal-native agent strong at benchmarks, vision pipeline work,
  and consolidation tasks. Runs deepseek models effectively.
capabilities:
  - Terminal-based implementation
  - Benchmarking and performance testing
  - Vision pipeline implementation
  - Consolidation and cleanup tasks
  - UX audit via browser automation
preferred_models:
  - tier: B
    models:
      - "deepseek-v4.1-flash-free" (opencode route)
      - "opencode/mimo-v2.6-flash-free" (opencode route)
  - tier: C
    models:
      - "kilo-auto/free" (opencode route - varies)
max_concurrent_tasks: 2
task_types:
  - "benchmarking"
  - "vision_pipeline"
  - "consolidation"
  - "ux_audit"
  - "terminal_automation"
routing_rules:
  - trigger: "benchmark|vision|consolidate|ux.audit|terminal"
    priority: 10
```

### GPT-6 (Codex Desktop Agent)
```yaml
agent_type: gpt6
display_name: "GPT-6"
primary_role: "Supervised implementation, documentation"
description: |
  Requires explicit execute-to-completion instruction. Tends toward
  superficial completion and menu-ending. Usable only under planner-written
  Plan with item-by-item verification.
capabilities:
  - Documentation and knowledge articles
  - Supervised boilerplate implementation
  - Mechanical edits with reviewed output
preferred_models:
  - tier: C
    models:
      - "gpt-6" (Codex route)
max_concurrent_tasks: 1
task_types:
  - "documentation"
  - "boilerplate"
  - "mechanical_edits"
routing_rules:
  - trigger: "document|boilerplate|mechanical"
    priority: 5
excluded_task_types:
  - "open_ended_refactor"
  - "architecture_decision"
  - "debugging"
```

### Devin (Cognition Desktop Agent)
```yaml
agent_type: devin
display_name: "Devin"
primary_role: "High-throughput executor on planner-written Plans"
description: |
  Demonstrated exceptional throughput on visualizer smoothness slate,
  modes, chrome decomposition, platform queue/VRAM work. Single-day
  burst sample — multi-week reliability unobserved. 30-day promo window
  to establish track record. Executor lane only.
capabilities:
  - High-volume implementation on written Plans
  - Visualizer/UI implementation
  - Platform infrastructure work
  - Same-commit ledger updates
preferred_models:
  - tier: A (Provisional - executor lane)
    models:
      - "devin" (Devin desktop)
max_concurrent_tasks: 5
task_types:
  - "high_volume_implementation"
  - "visualizer_implementation"
  - "platform_infrastructure"
  - "ledger_updates"
routing_rules:
  - trigger: "visualizer|platform|ledger|high.volume"
    priority: 9
excluded_task_types:
  - "open_ended_research"
  - "architecture_planning"
```

### Bolt Local (Read-Only Lookups)
```yaml
agent_type: bolt-local
display_name: "Nemotron 3.5 Bolt E4B (Atomic Chat)"
primary_role: "Fast read-only repo lookups, searches, summaries"
description: |
  Local model via Atomic Chat. Distinguishes PowerShell vs bash→WSL
  trap that weaker models fall into. Resolved environment variable
  tool conflicts. Max-thinking effort uneven — verify outputs.
capabilities:
  - Fast codebase search and summarization
  - Environment and shell diagnostics
  - Read-only analysis
preferred_models:
  - tier: A
    models:
      - "nemotron-3.5-super-vl" (Atomic Chat)
max_concurrent_tasks: 3
task_types:
  - "code_search"
  - "summarization"
  - "environment_diagnostics"
  - "read_only_analysis"
routing_rules:
  - trigger: "search|summarize|lookup|diagnose.env"
    priority: 10
excluded_task_types:
  - "code_implementation"
  - "code_review"
  - "testing"
```

### Qwen Local (Fast Read-Only Lookups)
```yaml
agent_type: qwen-local
display_name: "Local Qwen3.5-4B (Atomic Chat)"
primary_role: "Fast read-only repo lookups, searches, summaries"
description: |
  Local model via Atomic Chat. 4B class for synchronous callers.
  Infrastructure, not promo catalog.
capabilities:
  - Fast codebase search and summarization
  - Read-only analysis
preferred_models:
  - tier: Infrastructure
    models:
      - "qwen3.5-4b" (Atomic Chat / Ollama)
max_concurrent_tasks: 5
task_types:
  - "code_search"
  - "summarization"
  - "read_only_analysis"
routing_rules:
  - trigger: "search|summarize|lookup"
    priority: 8
excluded_task_types:
  - "code_implementation"
  - "code_review"
  - "testing"
```

---

## Model Routing Rules (Integrated with Roster)

### Trust Tier → Task Assignment
| Tier | Assignment Rule | Verification |
|------|----------------|--------------|
| **A — Delegate** | Real work, structural changes, refactors under standard rules (task files, behavior-ledger report after) | Standard |
| **B — Scoped** | Task-file items with explicit acceptance check, verified item by item. No open-ended refactors. | Item-by-item |
| **C — Supervised** | Boilerplate, docs, mechanical edits; every diff reviewed. Never accept completion at face value. | Every diff |
| **Avoid** | Do not burn sessions retrying; re-check via fresh advertised snapshot + first-contact item | N/A |
| **Untested** | First-contact rule: smallest open item in task file with known acceptance check | First-contact |

### Route-Specific Model Preferences
```yaml
route_preferences:
  kilo:
    tier_A:
      - "nemotron-3.5-super-vl"  # Distinguishes PS vs WSL trap
      - "stepfun/step-5-preview-free"  # Strongest recent streak
      - "inclusionai/ling-3.1-flash"  # Root-causing, refactoring
    tier_B:
      - "kilo-auto/free"  # Route-level trust (underlying varies)
    tier_Avoid:
      - "nvidia/nemotron-3-ultra-550b-a55b:free"
      - "nvidia/nemotron-3.5-lightning:free"
      - "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free"
      - "nvidia/nemotron-3-super-120b-a12b:free"
  
  cline:
    tier_B:
      - "cline/sonnet-4.5"  # Motion vocabulary, found real dead-UI bug
      - "cline/sonnet-4.6"  # Audit caught inverted frequency formula
    tier_C:
      - "muse-spark"  # Provisional
  
  opencode:
    tier_B:
      - "deepseek-v4.1-flash-free"  # Consolidation, benchmarks, vision
      - "opencode/mimo-v2.6-flash-free"  # UX audit, shader root-cause
  
  atomic_chat:
    tier_A:
      - "nemotron-3.5-super-vl"  # Bolt Local
    tier_Infrastructure:
      - "qwen3.5-4b"  # Qwen Local (4B class for sync callers)
      - "gemma4:e2b-it-qat"  # Vision workhorse
```

---

## Task-to-Agent Routing Matrix

| Task Category | Primary Agent | Fallback Agent | Model Tier Required |
|---------------|---------------|----------------|---------------------|
| Research / Architecture | `orion` | `kilo` | A |
| Full-stack Implementation | `ling` | `kilo` | A/B |
| Frontend / Visual / Motion | `cline` | `ling` | B |
| Terminal / Benchmark / Vision | `opencode` | `kilo` | B |
| High-volume Execution | `devin` | `ling` | A (executor) |
| Documentation / Boilerplate | `gpt6` | `kilo` | C |
| Code Search / Diagnostics | `bolt-local` | `qwen-local` | A |
| Sub-agent Orchestration | `kilo` | `orion` | A |
| Refactoring (multi-file) | `ling` | `kilo` | A |
| Debugging / Root-cause | `ling` | `opencode` | A/B |
| Testing (E2E/Playwright) | `cline` | `ling` | B |
| Model Selection / Routing | `orion` | `kilo` | A |

---

## Automated Model Selection Logic

```python
# Pseudocode for integration with orchestration.yaml
def select_model_for_task(task_type: str, agent_type: str, context: dict) -> str:
    """
    Selects the best available model based on:
    1. Agent type's preferred models
    2. Model roster trust tier (A > B > C > Avoid)
    2. Route availability (kilo, cline, opencode, atomic_chat)
    3. Task requirements (VRAM, latency, capability)
    4. Recent observed performance (from observed.jsonl)
    """
    agent_profile = AGENT_PROFILES[agent_type]
    
    # Filter by tier preference for task
    required_tier = TASK_TIER_REQUIREMENTS.get(task_type, "B")
    
    # Get preferred models for agent
    preferred = agent_profile["preferred_models"]
    
    # Filter by tier
    candidates = []
    for tier_name, models in preferred.items():
        tier_rank = TIER_RANK[tier_name]  # A=4, B=3, C=2, Avoid=0
        if tier_rank >= TIER_RANK[required_tier]:
            candidates.extend(models)
    
    # Score by recent observed performance
    scored = score_candidates(candidates, context.get("recent_outcomes", {}))
    
    return scored[0] if scored else fallback_model(agent_type)
```

---

## Integration Points

### 1. Orchestration Config (`.kilo/orchestration.yaml`)
- Add `agent_profiles` section referencing this file
- Update `auto_triggers` to use agent types from profiles
- Add `model_routing` rules using route preferences

### 2. Sub-Agent Orchestrator (`.kilo/skills/sub_agent_orchestration/`)
- Load agent profiles at startup
- Use `select_model_for_task()` when spawning agents
- Record model used in `observed.jsonl` with outcome

### 3. Model Reliability Tracker (`tools/model-reliability/`)
- Append to `observed.jsonl` automatically after each agent task
- Update `roster.md` when tier changes based on evidence
- Run `score.py` periodically to refresh rankings

### 4. AGENTS.md
- Reference this file for agent type definitions
- Keep Co-authored-by trailer table in sync
- Document first-contact rule for new models

---

## Maintenance Rules

1. **Tier Updates**: When appending to `observed.jsonl`, update affected row in `roster.md` in same commit if evidence changes tier.

2. **Staleness**: Tier whose latest evidence is older than 30 days → treated as Untested for planning.

3. **First Contact**: New model's first job = smallest open item in task file with known acceptance check.

4. **Route Keying**: Roster keys on **model + route**, not family. Same model on different routes can have different tiers.

5. **Local Models**: Qwen3.5-4B/9B, Gemma 4 via Ollama/Atomic Chat are infrastructure — routing rules in focus map §3.6.

---

## Quick Reference

```bash
# View current roster
cat tools/model-reliability/roster.md

# Score models from observed data
python tools/model-reliability/score.py

# Append observation (auto-called by orchestrator)
echo '{"date":"2026-11-08","model":"stepfun/step-5-preview-free","route":"kilo","worked":true,"note":"Task completed with all gates green"}' >> tools/model-reliability/observed.jsonl

# Check agent profile
cat .kilo/agent-profiles.md | grep -A 20 "agent_type: ling"
```
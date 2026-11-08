"""
Sub-Agent Orchestration Runtime
Provides automatic agent spawning, task decomposition, and result synthesis.
Integrates with agent profiles, model roster trust tiers, and observability.
"""

import asyncio
import json
import re
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Optional
import yaml


class AgentStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class OrchestrationPattern(Enum):
    ORCHESTRATOR_WORKER = "orchestrator_worker"
    SEQUENTIAL_PIPELINE = "sequential_pipeline"
    CONCURRENT = "concurrent"
    GENERATOR_VERIFIER = "generator_verifier"
    AGENT_TEAMS = "agent_teams"
    SHARED_STATE = "shared_state"


class TrustTier(Enum):
    A = "A"  # Delegate
    B = "B"  # Scoped
    C = "C"  # Supervised
    AVOID = "Avoid"
    UNTESTED = "Untested"
    INFRASTRUCTURE = "Infrastructure"


@dataclass
class AgentProfile:
    """Agent capability profile from agent-profiles.md"""
    agent_type: str
    description: str
    max_concurrent: int
    default_model: str
    tier_requirement: str
    excluded_tasks: list[str] = field(default_factory=list)
    capabilities: list[str] = field(default_factory=list)
    preferred_models: dict[str, list[str]] = field(default_factory=dict)


@dataclass
class AgentConfig:
    agent_type: str
    model: str = "gpt-6"
    reasoning_effort: str = "medium"
    timebox_seconds: int = 480
    max_tokens: int = 100000
    skills: list[str] = field(default_factory=list)
    domain_context: str = ""
    tier_requirement: str = "B"
    agent_profile: Optional[AgentProfile] = None


@dataclass
class TaskCard:
    id: str
    title: str
    description: str
    agent_type: str
    acceptance_criteria: str
    dependencies: list[str] = field(default_factory=list)
    timebox_seconds: int = 480
    artifacts: list[str] = field(default_factory=list)
    status: AgentStatus = AgentStatus.PENDING
    owner: Optional[str] = None
    tier_requirement: str = "B"
    required_skills: list[str] = field(default_factory=list)


@dataclass
class AgentArtifact:
    task_id: str
    agent_id: str
    agent_type: str
    status: AgentStatus
    input_ref: str
    output_ref: str
    metadata: dict = field(default_factory=dict)
    summary: str = ""
    findings: list[dict] = field(default_factory=list)
    recommendations: list[str] = field(default_factory=list)
    blockers: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)
    completed_at: Optional[datetime] = None


@dataclass
class OrchestrationResult:
    success: bool
    pattern_used: OrchestrationPattern
    task_cards: list[TaskCard]
    artifacts: list[AgentArtifact]
    synthesis: dict
    conflicts: list[dict]
    total_duration_seconds: float
    total_tokens: int
    errors: list[str] = field(default_factory=list)


class TaskBoard:
    """Shared task board for agent coordination"""
    
    def __init__(self):
        self.cards: dict[str, TaskCard] = {}
        self.columns = {
            "todo": [],
            "claimed": [],
            "in_progress": [],
            "review": [],
            "done": [],
            "blocked": []
        }
    
    def add_card(self, card: TaskCard):
        self.cards[card.id] = card
        self.columns["todo"].append(card.id)
    
    def claim_card(self, card_id: str, agent_id: str) -> bool:
        if card_id in self.columns["todo"]:
            self.columns["todo"].remove(card_id)
            self.columns["claimed"].append(card_id)
            self.cards[card_id].status = AgentStatus.RUNNING
            self.cards[card_id].owner = agent_id
            return True
        return False
    
    def start_card(self, card_id: str):
        if card_id in self.columns["claimed"]:
            self.columns["claimed"].remove(card_id)
            self.columns["in_progress"].append(card_id)
    
    def complete_card(self, card_id: str):
        for col in self.columns.values():
            if card_id in col:
                col.remove(card_id)
        self.columns["done"].append(card_id)
        self.cards[card_id].status = AgentStatus.COMPLETED
    
    def block_card(self, card_id: str):
        for col in self.columns.values():
            if card_id in col:
                col.remove(card_id)
        self.columns["blocked"].append(card_id)
        self.cards[card_id].status = AgentStatus.FAILED
    
    def get_ready_cards(self) -> list[TaskCard]:
        """Cards in todo with all dependencies met"""
        ready = []
        done_ids = set(self.columns["done"])
        for card_id in self.columns["todo"]:
            card = self.cards[card_id]
            if all(dep in done_ids for dep in card.dependencies):
                ready.append(card)
        return ready


class SubAgentOrchestrator:
    """Main orchestration engine with agent profiles, model roster, and observability"""
    
    TIER_RANK = {
        "A": 4,
        "B": 3,
        "C": 2,
        "Infrastructure": 3,
        "Untested": 1,
        "Avoid": 0
    }
    
    TASK_TIER_REQUIREMENTS = {
        "research": "A",
        "architecture_planning": "A",
        "implementation": "B",
        "refactoring": "A",
        "debugging": "A",
        "testing": "B",
        "visual_verification": "B",
        "documentation": "C",
        "boilerplate": "C",
        "code_search": "A",
        "orchestration": "A",
        "high_volume_execution": "A",
        "visual_verification": "B",
        "dependency_audit": "A",
        "vendor_upgrade": "A",
    }
    
    def __init__(self, config_path: Optional[Path] = None):
        self.config = self._load_config(config_path)
        self.agent_profiles = self._load_agent_profiles()
        self.model_scores = self._load_model_scores()
        self.task_board = TaskBoard()
        self.artifacts: dict[str, AgentArtifact] = {}
        self.session_tokens = 0
        self.session_start = datetime.now()
        self.observability_config = self.config.get("observability", {})
        self.model_reliability_config = self.config.get("model_reliability", {})
        
    def _load_config(self, config_path: Optional[Path]) -> dict:
        default_config = {
            "max_concurrent_agents": 3,
            "session_token_budget": 500000,
            "default_timebox_seconds": 480,
            "max_agents_per_task": 8,
            "max_retries": 1,
            "models": {
                "explore": "bolt-local",
                "general": "ling",
                "backend-architect": "kilo",
                "frontend-architect": "cline",
                "android-engineer": "gpt6",
                "go-engineer": "gpt6",
            },
            "reasoning_effort": {
                "quick": "low",
                "standard": "medium",
                "deep": "high"
            },
            "auto_triggers": [],
            "composite_triggers": [],
            "agent_types": {},
            "model_selection": {},
            "trust_tiers": {},
            "route_preferences": {},
            "observability": {},
            "model_reliability": {}
        }
        
        if config_path and config_path.exists():
            with open(config_path) as f:
                user_config = yaml.safe_load(f)
                default_config.update(user_config)
        
        return default_config
    
    def _load_agent_profiles(self) -> dict[str, AgentProfile]:
        """Load agent profiles from the comprehensive agent-profiles.md"""
        # These are defined in .kilo/agent-profiles.md
        # For now, return the key profiles inline
        profiles = {}
        
        profiles["orion"] = AgentProfile(
            agent_type="orion",
            description="Research / Handoff agent",
            max_concurrent=1,
            default_model="stepfun/step-5-preview-free",
            tier_requirement="A",
            excluded_tasks=["code_implementation", "code_review", "debugging", "testing"],
            capabilities=["research", "architecture_planning", "task_decomposition", "handoff_creation", "model_selection"],
            preferred_models={"A": ["stepfun/step-5-preview-free", "nemotron-3.5-super-vl"]}
        )
        
        profiles["ling"] = AgentProfile(
            agent_type="ling",
            description="Local coding (Kilo Desktop) - full-stack implementation",
            max_concurrent=2,
            default_model="inclusionai/ling-3.1-flash",
            tier_requirement="A",
            capabilities=["implementation", "refactoring", "debugging", "testing", "documentation", "git_operations"],
            preferred_models={"A": ["inclusionai/ling-3.1-flash"], "B": ["kilo-auto/free"]}
        )
        
        profiles["kilo"] = AgentProfile(
            agent_type="kilo",
            description="Local coding (Kilo Desktop) - orchestration, infrastructure",
            max_concurrent=3,
            default_model="kilo-auto/free",
            tier_requirement="A",
            capabilities=["implementation", "orchestration", "infrastructure", "ci_cd", "performance", "security"],
            preferred_models={"A": ["kilo-auto/free", "stepfun/step-5-preview-free"], "B": ["deepseek-v4.1-flash-free"]}
        )
        
        profiles["cline"] = AgentProfile(
            agent_type="cline",
            description="Local coding (Cline) - frontend, visual, motion",
            max_concurrent=2,
            default_model="cline/sonnet-4.5",
            tier_requirement="B",
            capabilities=["frontend_implementation", "visual_verification", "playwright_testing", "mutation_testing", "motion_design"],
            preferred_models={"B": ["cline/sonnet-4.5", "cline/sonnet-4.6"], "C": ["muse-spark"]}
        )
        
        profiles["opencode"] = AgentProfile(
            agent_type="opencode",
            description="Terminal coding - benchmarks, vision pipeline",
            max_concurrent=2,
            default_model="deepseek-v4.1-flash-free",
            tier_requirement="B",
            capabilities=["benchmarking", "vision_pipeline", "consolidation", "ux_audit", "terminal_automation"],
            preferred_models={"B": ["deepseek-v4.1-flash-free", "opencode/mimo-v2.6-flash-free"]}
        )
        
        profiles["gpt6"] = AgentProfile(
            agent_type="gpt6",
            description="Codex desktop - supervised boilerplate, documentation",
            max_concurrent=1,
            default_model="gpt-6",
            tier_requirement="C",
            capabilities=["documentation", "boilerplate", "mechanical_edits"],
            preferred_models={"C": ["gpt-6"]}
        )
        
        profiles["devin"] = AgentProfile(
            agent_type="devin",
            description="Cognition desktop - high-volume executor",
            max_concurrent=5,
            default_model="devin",
            tier_requirement="A",
            capabilities=["high_volume_implementation", "visualizer_implementation", "platform_infrastructure", "ledger_updates"],
            preferred_models={"A": ["devin"]}
        )
        
        profiles["bolt-local"] = AgentProfile(
            agent_type="bolt-local",
            description="Nemotron 3.5 Bolt E4B - fast read-only lookups",
            max_concurrent=3,
            default_model="nemotron-3.5-super-vl",
            tier_requirement="A",
            excluded_tasks=["code_implementation", "code_review", "testing"],
            capabilities=["code_search", "summarization", "environment_diagnostics", "read_only_analysis"],
            preferred_models={"A": ["nemotron-3.5-super-vl"]}
        )
        
        profiles["qwen-local"] = AgentProfile(
            agent_type="qwen-local",
            description="Local Qwen3.5-4B - fast read-only lookups",
            max_concurrent=5,
            default_model="qwen3.5-4b",
            tier_requirement="Infrastructure",
            capabilities=["code_search", "summarization", "read_only_analysis"],
            preferred_models={"Infrastructure": ["qwen3.5-4b", "gemma4:e2b-it-qat"]}
        )
        
        profiles["ling"] = AgentProfile(
            agent_type="ling",
            description="Local coding (Kilo Desktop) - full-stack implementation",
            max_concurrent=2,
            default_model="inclusionai/ling-3.1-flash",
            tier_requirement="A",
            capabilities=["implementation", "refactoring", "debugging", "testing", "documentation", "git_operations"],
            preferred_models={"A": ["inclusionai/ling-3.1-flash"], "B": ["kilo-auto/free"]}
        )
        
        profiles["kilo"] = AgentProfile(
            agent_type="kilo",
            description="Local coding (Kilo Desktop) - orchestration, infrastructure",
            max_concurrent=3,
            default_model="kilo-auto/free",
            tier_requirement="A",
            capabilities=["implementation", "orchestration", "infrastructure", "ci_cd", "performance", "security"],
            preferred_models={"A": ["kilo-auto/free", "stepfun/step-5-preview-free"], "B": ["deepseek-v4.1-flash-free"]}
        )
        
        profiles["cline"] = AgentProfile(
            agent_type="cline",
            description="Local coding (Cline) - frontend, visual, motion",
            max_concurrent=2,
            default_model="cline/sonnet-4.5",
            tier_requirement="B",
            capabilities=["frontend_implementation", "visual_verification", "playwright_testing", "mutation_testing", "motion_design"],
            preferred_models={"B": ["cline/sonnet-4.5", "cline/sonnet-4.6"], "C": ["muse-spark"]}
        )
        
        profiles["opencode"] = AgentProfile(
            agent_type="opencode",
            description="Terminal coding - benchmarks, vision pipeline",
            max_concurrent=2,
            default_model="deepseek-v4.1-flash-free",
            tier_requirement="B",
            capabilities=["benchmarking", "vision_pipeline", "consolidation", "ux_audit", "terminal_automation"],
            preferred_models={"B": ["deepseek-v4.1-flash-free", "opencode/mimo-v2.6-flash-free"]}
        )
        
        profiles["gpt6"] = AgentProfile(
            agent_type="gpt6",
            description="Codex desktop - supervised boilerplate, documentation",
            max_concurrent=1,
            default_model="gpt-6",
            tier_requirement="C",
            capabilities=["documentation", "boilerplate", "mechanical_edits"],
            preferred_models={"C": ["gpt-6"]}
        )
        
        profiles["devin"] = AgentProfile(
            agent_type="devin",
            description="Cognition desktop - high-volume executor",
            max_concurrent=5,
            default_model="devin",
            tier_requirement="A",
            capabilities=["high_volume_implementation", "visualizer_implementation", "platform_infrastructure", "ledger_updates"],
            preferred_models={"A": ["devin"]}
        )
        
        profiles["bolt-local"] = AgentProfile(
            agent_type="bolt-local",
            description="Nemotron 3.5 Bolt E4B - fast read-only lookups",
            max_concurrent=3,
            default_model="nemotron-3.5-super-vl",
            tier_requirement="A",
            excluded_tasks=["code_implementation", "code_review", "testing"],
            capabilities=["code_search", "summarization", "environment_diagnostics", "read_only_analysis"],
            preferred_models={"A": ["nemotron-3.5-super-vl"]}
        )
        
        profiles["qwen-local"] = AgentProfile(
            agent_type="qwen-local",
            description="Local Qwen3.5-4B - fast read-only lookups",
            max_concurrent=5,
            default_model="qwen3.5-4b",
            tier_requirement="Infrastructure",
            capabilities=["code_search", "summarization", "read_only_analysis"],
            preferred_models={"Infrastructure": ["qwen3.5-4b", "gemma4:e2b-it-qat"]}
        )
        
        return profiles
    
    def _load_model_scores(self) -> dict:
        """Load model scores from the reliability tracker"""
        scores = {}
        try:
            observed_path = Path("tools/model-reliability/observed.jsonl")
            if observed_path.exists():
                import datetime
                with open(observed_path, encoding="utf-8-sig") as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            r = json.loads(line)
                            model = r.get("model")
                            if not model:
                                continue
                            worked, date = self._parse_outcome(r)
                            if model not in scores:
                                scores[model] = {"worked": [], "failed": [], "notes": []}
                            if worked:
                                scores[model]["worked"].append(date)
                            else:
                                scores[model]["failed"].append(date)
                            if r.get("note"):
                                scores[model]["notes"].append(f"[{r.get('route', '?')}] {r['note']}")
        except Exception:
            pass
        return scores
    
    def _parse_outcome(self, r: dict):
        """Normalize old ({worked, date}) and new ({outcome, ts}) row shapes."""
        import datetime
        if "worked" in r:
            worked = bool(r["worked"])
        elif "outcome" in r:
            worked = str(r["outcome"]).lower() == "success"
        else:
            worked = True
        date = r.get("date")
        if not date and r.get("ts"):
            date = str(r["ts"])[:10]
        return worked, date
    
    def _load_config(self, config_path: Optional[Path]) -> dict:
        default_config = {
            "max_concurrent_agents": 3,
            "session_token_budget": 500000,
            "default_timebox_seconds": 480,
            "max_agents_per_task": 8,
            "max_retries": 1,
            "models": {
                "explore": "bolt-local",
                "general": "ling",
                "backend-architect": "kilo",
                "frontend-architect": "cline",
                "android-engineer": "gpt6",
                "go-engineer": "gpt6",
            },
            "reasoning_effort": {
                "quick": "low",
                "standard": "medium",
                "deep": "high"
            },
            "auto_triggers": [],
            "composite_triggers": [],
            "agent_types": {},
            "model_selection": {},
            "trust_tiers": {},
            "route_preferences": {},
            "observability": {},
            "model_reliability": {}
        }
        
        if config_path and config_path.exists():
            with open(config_path) as f:
                user_config = yaml.safe_load(f)
                default_config.update(user_config)
        
        return default_config
    
    def _get_agent_profile(self, agent_type: str) -> Optional[AgentProfile]:
        """Get agent profile by type"""
        return self.agent_profiles.get(agent_type)
    
    def _get_tier_rank(self, tier: str) -> int:
        """Get numeric rank for trust tier (higher = more trusted)"""
        tier = tier.upper() if isinstance(tier, str) else "B"
        return self.TIER_RANK.get(tier, 3)
    
    def _meets_tier_requirement(self, agent_type: str, required_tier: str) -> bool:
        """Check if agent meets required trust tier"""
        profile = self._get_agent_profile(agent_type)
        if not profile:
            return True  # Unknown agent, allow by default
        
        agent_tier = profile.tier_requirement
        agent_rank = self._get_tier_rank(agent_tier)
        required_rank = self._get_tier_rank(required_tier)
        
        return agent_rank >= required_rank
    
    def _select_best_model(self, agent_type: str, required_tier: str = "B") -> str:
        """Select best available model for agent based on tier requirement and observed scores"""
        profile = self._get_agent_profile(agent_type)
        if not profile:
            return self.config["models"].get(agent_type, "gpt-6")
        
        required_rank = self._get_tier_rank(required_tier)
        candidates = []
        
        for tier_name, models in profile.preferred_models.items():
            tier_rank = self._get_tier_rank(tier_name)
            if tier_rank >= required_rank:
                for model in models:
                    # Score by recent observed performance
                    score = self._score_model(model)
                    candidates.append((score, model))
        
        if candidates:
            candidates.sort(key=lambda x: x[0], reverse=True)
            return candidates[0][1]
        
        # Fallback to default model
        return profile.default_model
    
    def _score_model(self, model: str) -> float:
        """Score model based on observed performance (from score.py logic)"""
        if model not in self.model_scores:
            return 10.0  # Default score for unobserved
        
        score = 10.0
        data = self.model_scores[model]
        
        import datetime
        today = datetime.date.today()
        
        # Recent successes
        for date_str in data.get("worked", []):
            try:
                date = datetime.date.fromisoformat(date_str)
                days_ago = (today - date).days
                if days_ago <= 7:
                    score += 30
                elif days_ago <= 30:
                    score += 15
            except:
                pass
        
        # Recent failures
        for date_str in data.get("failed", []):
            try:
                date = datetime.date.fromisoformat(date_str)
                days_ago = (today - date).days
                if days_ago <= 7:
                    score -= 50
            except:
                pass
        
        return max(0, score)
    
    def analyze_task(self, task_description: str, context: dict = None) -> dict:
        """Analyze task and determine optimal orchestration pattern"""
        task_lower = task_description.lower()
        context = context or {}
        
        # Check composite triggers first
        for trigger in self.config.get("composite_triggers", []):
            for pattern in trigger.get("pattern", []):
                if re.search(pattern, task_lower):
                    return {
                        "pattern": OrchestrationPattern.ORCHESTRATOR_WORKER,
                        "trigger": trigger["name"],
                        "sequence": trigger.get("sequence", []),
                        "timebox": trigger.get("timebox", "30m"),
                        "required_tiers": trigger.get("required_tiers", [])
                    }
        
        # Check auto triggers BEFORE default patterns
        for trigger in self.config.get("auto_triggers", []):
            if any(p in task_lower for p in trigger.get("pattern", [])):
                config = trigger.get("config", {})
                return {
                    "pattern": OrchestrationPattern.ORCHESTRATOR_WORKER,
                    "trigger": trigger["agent"],
                    "agent": trigger["agent"],
                    "config": config,
                    "timebox": config.get("timebox", "8m"),
                    "tier_requirement": config.get("tier_requirement", "B"),
                    "required_skills": config.get("use_skill", "").split(",") if config.get("use_skill") else []
                }
        
        # Default pattern selection based on task characteristics
        if any(w in task_lower for w in ["implement", "build", "create", "add feature"]):
            if "full stack" in task_lower or ("backend" in task_lower and "frontend" in task_lower):
                return {"pattern": OrchestrationPattern.ORCHESTRATOR_WORKER, "agents": ["kilo", "cline"]}
            return {"pattern": OrchestrationPattern.ORCHESTRATOR_WORKER, "agents": ["ling"]}
        
        if any(w in task_lower for w in ["review", "audit", "analyze code"]):
            return {"pattern": OrchestrationPattern.GENERATOR_VERIFIER, "agent": "bolt-local", "config": {"thoroughness": "very thorough"}}
        
        if any(w in task_lower for w in ["refactor", "modernize", "migrate"]):
            return {"pattern": OrchestrationPattern.SEQUENTIAL_PIPELINE, "sequence": ["bolt-local", "ling"]}
        
        if any(w in task_lower for w in ["test", "verify", "e2e", "playwright"]):
            return {"pattern": OrchestrationPattern.ORCHESTRATOR_WORKER, "agent": "cline", "config": {"use_skill": "test-measure-improve"}}
        
        if any(w in task_lower for w in ["research", "best practice", "modern approach", "latest"]):
            return {"pattern": OrchestrationPattern.ORCHESTRATOR_WORKER, "agent": "orion", "config": {"use_skill": "current-best-practices"}}
        
        if any(w in task_lower for w in ["visual", "ui", "screenshot", "regression"]):
            return {"pattern": OrchestrationPattern.ORCHESTRATOR_WORKER, "agent": "cline", "config": {"use_skill": "visual-qa-loop"}}
        
        # Default
        return {"pattern": OrchestrationPattern.ORCHESTRATOR_WORKER, "agent": "ling"}
    
    def decompose_task(self, task_description: str, analysis: dict) -> list[TaskCard]:
        """Break task into subtask cards"""
        cards = []
        
        # Check for sequence (composite triggers) first
        sequence = analysis.get("sequence")
        if sequence:
            for i, step in enumerate(sequence):
                if isinstance(step, list):
                    # Parallel agents in this stage
                    for j, agent_spec in enumerate(step):
                        if isinstance(agent_spec, dict):
                            agent_type = agent_spec.get("agent")
                            task_desc = agent_spec.get("task", "")
                        else:
                            agent_type = agent_spec
                            task_desc = ""
                        
                        card = TaskCard(
                            id=str(uuid.uuid4())[:8],
                            title=f"Stage {i+1}-{j+1}: {agent_type}",
                            description=f"Parallel subtask in stage {i+1}: {task_desc}\n\nFull task: {task_description}",
                            agent_type=agent_type,
                            acceptance_criteria=f"Complete {agent_type} portion of stage {i+1}",
                            dependencies=[cards[k].id for k in range(len(cards)) if k >= len(cards) - len(step)] if i > 0 else [],
                            timebox_seconds=self.config["default_timebox_seconds"],
                            tier_requirement="A"  # Default for composite
                        )
                        cards.append(card)
                else:
                    # Single agent in this stage (could be string or dict)
                    if isinstance(step, dict):
                        agent_type = step.get("agent")
                        task_desc = step.get("task", "")
                    else:
                        agent_type = step
                        task_desc = ""
                    
                    card = TaskCard(
                        id=str(uuid.uuid4())[:8],
                        title=f"Stage {i+1}: {agent_type}",
                        description=f"Pipeline stage {i+1} of {len(sequence)}: {task_desc}\n\nFull task: {task_description}",
                        agent_type=agent_type,
                        acceptance_criteria=f"Complete stage {i+1} output for next stage",
                        dependencies=[cards[-1].id] if cards else [],
                        timebox_seconds=self.config["default_timebox_seconds"],
                        tier_requirement="A"
                    )
                    cards.append(card)
        
        elif analysis["pattern"] == OrchestrationPattern.ORCHESTRATOR_WORKER:
            agents = analysis.get("agents", [analysis.get("agent", "ling")])
            tier_req = analysis.get("tier_requirement", "B")
            skills = analysis.get("required_skills", [])
            
            for i, agent_type in enumerate(agents):
                if isinstance(agent_type, list):
                    # Parallel agents (legacy format)
                    for j, at in enumerate(agent_type):
                        card = TaskCard(
                            id=str(uuid.uuid4())[:8],
                            title=f"Parallel {i+1}-{j+1}: {at}",
                            description=f"Independent parallel subtask\n\nFull task: {task_description}",
                            agent_type=at,
                            acceptance_criteria=f"Complete {at} portion of: {task_description}",
                            timebox_seconds=self.config["default_timebox_seconds"],
                            tier_requirement=tier_req,
                            required_skills=skills
                        )
                        cards.append(card)
                else:
                    card = TaskCard(
                        id=str(uuid.uuid4())[:8],
                        title=f"{agent_type}: {task_description[:50]}",
                        description=f"Subtask for {agent_type} agent\n\nFull task: {task_description}",
                        agent_type=agent_type,
                        acceptance_criteria=f"Complete {agent_type} portion of: {task_description}",
                        timebox_seconds=self.config["default_timebox_seconds"],
                        tier_requirement=tier_req,
                        required_skills=skills
                    )
                    cards.append(card)
        
        elif analysis["pattern"] == OrchestrationPattern.SEQUENTIAL_PIPELINE:
            sequence = analysis.get("sequence", ["bolt-local", "ling"])
            for i, agent_type in enumerate(sequence):
                card = TaskCard(
                    id=str(uuid.uuid4())[:8],
                    title=f"Stage {i+1}: {agent_type}",
                    description=f"Pipeline stage {i+1} of {len(sequence)}",
                    agent_type=agent_type,
                    acceptance_criteria=f"Complete stage {i+1} output for next stage",
                    dependencies=[cards[i-1].id] if i > 0 else [],
                    timebox_seconds=self.config["default_timebox_seconds"],
                    tier_requirement="A"
                )
                cards.append(card)
        
        elif analysis["pattern"] == OrchestrationPattern.CONCURRENT:
            agents = analysis.get("agents", ["ling", "ling"])
            for i, agent_type in enumerate(agents):
                card = TaskCard(
                    id=str(uuid.uuid4())[:8],
                    title=f"Parallel {i+1}: {agent_type}",
                    description=f"Independent parallel subtask",
                    agent_type=agent_type,
                    acceptance_criteria=f"Complete independent portion",
                    timebox_seconds=self.config["default_timebox_seconds"]
                )
                cards.append(card)
        
        elif analysis["pattern"] == OrchestrationPattern.GENERATOR_VERIFIER:
            agent = analysis.get("agent", "ling")
            cards.append(TaskCard(
                id=str(uuid.uuid4())[:8],
                title="Generator",
                description=f"Generate solution for: {task_description}",
                agent_type=agent,
                acceptance_criteria="Produce working implementation",
                timebox_seconds=self.config["default_timebox_seconds"]
            ))
            cards.append(TaskCard(
                id=str(uuid.uuid4())[:8],
                title="Verifier",
                description=f"Verify generator output against criteria",
                agent_type="general",
                acceptance_criteria="All quality criteria pass",
                dependencies=[cards[0].id],
                timebox_seconds=self.config["default_timebox_seconds"]
            ))
        
        return cards
    
    async def spawn_agent(self, card: TaskCard, context: dict) -> AgentArtifact:
        """Spawn a sub-agent to execute a task card"""
        # Select best model based on tier requirement
        model = self._select_best_model(card.agent_type, card.tier_requirement)
        
        agent_id = f"{card.agent_type}-{uuid.uuid4().hex[:8]}"
        
        # Create artifact
        artifact = AgentArtifact(
            task_id=card.id,
            agent_id=agent_id,
            agent_type=card.agent_type,
            status=AgentStatus.RUNNING,
            input_ref=f"task_card_{card.id}",
            output_ref=f"artifact_{agent_id}",
            metadata={
                "model": model,
                "skills": card.required_skills,
                "timebox": card.timebox_seconds,
                "tier_requirement": card.tier_requirement,
                "confidence": 0.8
            }
        )
        
        self.artifacts[agent_id] = artifact
        self.task_board.start_card(card.id)
        
        try:
            # In real implementation, this calls the actual agent
            result = await self._execute_agent(card, context)
            
            artifact.status = AgentStatus.COMPLETED
            artifact.completed_at = datetime.now()
            artifact.summary = result.get("summary", "Completed")
            artifact.findings = result.get("findings", [])
            artifact.recommendations = result.get("recommendations", [])
            artifact.blockers = result.get("blockers", [])
            artifact.metadata["tokens_used"] = result.get("tokens_used", 0)
            self.session_tokens += artifact.metadata["tokens_used"]
            
            self.task_board.complete_card(card.id)
            
            # Observability: Auto-log outcome
            if self.observability_config.get("auto_log_outcomes", True):
                self._log_outcome(artifact, card)
            
        except Exception as e:
            artifact.status = AgentStatus.FAILED
            artifact.completed_at = datetime.now()
            artifact.blockers = [str(e)]
            self.task_board.block_card(card.id)
        
        return artifact
    
    def _log_outcome(self, artifact: AgentArtifact, card: TaskCard):
        """Auto-log outcome to observed.jsonl for model reliability tracking"""
        try:
            import datetime
            outcome = {
                "date": datetime.date.today().isoformat(),
                "model": artifact.metadata.get("model", "unknown"),
                "route": self._get_route_for_agent(artifact.agent_type),
                "worked": artifact.status == AgentStatus.COMPLETED,
                "note": artifact.summary,
                "task_type": self._infer_task_type(card),
                "agent_type": artifact.agent_type,
                "duration_seconds": 0,  # Would need timing instrumentation
                "tokens_used": artifact.metadata.get("tokens_used", 0)
            }
            
            observed_path = Path("tools/model-reliability/observed.jsonl")
            with open(observed_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(outcome) + "\n")
        except Exception:
            pass  # Don't let logging failures break orchestration
    
    def _get_route_for_agent(self, agent_type: str) -> str:
        """Map agent type to route"""
        route_map = {
            "orion": "kilo",
            "ling": "kilo",
            "kilo": "kilo",
            "cline": "cline",
            "opencode": "opencode",
            "gpt6": "codex",
            "devin": "devin",
            "bolt-local": "atomic_chat",
            "qwen-local": "atomic_chat",
        }
        return route_map.get(agent_type, "unknown")
    
    def _infer_task_type(self, card: TaskCard) -> str:
        """Infer task type from card description"""
        desc = card.description.lower()
        if "research" in desc or "architecture" in desc:
            return "research"
        elif "implement" in desc:
            return "implementation"
        elif "refactor" in desc:
            return "refactoring"
        elif "debug" in desc:
            return "debugging"
        elif "test" in desc:
            return "testing"
        elif "visual" in desc or "ui" in desc:
            return "visual_verification"
        elif "document" in desc:
            return "documentation"
        elif "search" in desc or "lookup" in desc:
            return "code_search"
        return "general"
    
    async def _execute_agent(self, card: TaskCard, context: dict) -> dict:
        """Execute agent - placeholder for actual agent invocation"""
        # This would call the actual task/agent tool
        # For now, return mock result
        profile = self._get_agent_profile(card.agent_type)
        model = self._select_best_model(card.agent_type, card.tier_requirement)
        
        return {
            "summary": f"Completed {card.title} using {model}",
            "findings": [{"topic": card.agent_type, "detail": f"Analysis complete with {profile.default_model if profile else model}"}],
            "recommendations": ["Proceed to next stage"],
            "blockers": [],
            "tokens_used": 5000
        }
    
    async def run_orchestration(self, task_description: str, context: dict = None) -> OrchestrationResult:
        """Main orchestration entry point"""
        start_time = datetime.now()
        context = context or {}
        
        # 1. Analyze task
        analysis = self.analyze_task(task_description, context)
        
        # 2. Decompose into task cards
        cards = self.decompose_task(task_description, analysis)
        for card in cards:
            self.task_board.add_card(card)
        
        # 3. Execute based on pattern
        artifacts = []
        
        if analysis["pattern"] == OrchestrationPattern.ORCHESTRATOR_WORKER:
            # Parallel execution with concurrency limit
            semaphore = asyncio.Semaphore(self.config["max_concurrent_agents"])
            
            async def run_with_limit(card):
                async with semaphore:
                    return await self.spawn_agent(card, context)
            
            tasks = [run_with_limit(card) for card in cards]
            artifacts = await asyncio.gather(*tasks, return_exceptions=True)
            artifacts = [a for a in artifacts if isinstance(a, AgentArtifact)]
        
        elif analysis["pattern"] == OrchestrationPattern.SEQUENTIAL_PIPELINE:
            # Sequential execution
            current_context = context
            for card in cards:
                artifact = await self.spawn_agent(card, current_context)
                artifacts.append(artifact)
                if artifact.output_ref:
                    current_context = {**current_context, "previous_output": artifact.output_ref}
        
        elif analysis["pattern"] == OrchestrationPattern.GENERATOR_VERIFIER:
            # Generator-Verifier loop (max 3 rounds)
            for round_num in range(3):
                gen_card = cards[0]
                gen_artifact = await self.spawn_agent(gen_card, context)
                artifacts.append(gen_artifact)
                
                ver_card = cards[1]
                ver_context = {**context, "generator_output": gen_artifact.output_ref}
                ver_artifact = await self.spawn_agent(ver_card, ver_context)
                artifacts.append(ver_artifact)
                
                if ver_artifact.metadata.get("passed", False):
                    break
                
                context = {**context, "verifier_feedback": ver_artifact.findings}
        
        # 4. Synthesize results
        synthesis = self.synthesize(artifacts, analysis)
        conflicts = self.detect_conflicts(artifacts)
        
        return OrchestrationResult(
            success=all(a.status == AgentStatus.COMPLETED for a in artifacts),
            pattern_used=analysis["pattern"],
            task_cards=cards,
            artifacts=artifacts,
            synthesis=synthesis,
            conflicts=conflicts,
            total_duration_seconds=(datetime.now() - start_time).total_seconds(),
            total_tokens=self.session_tokens
        )
    
    def synthesize(self, artifacts: list[AgentArtifact], analysis: dict) -> dict:
        """Synthesize agent outputs into unified result"""
        all_findings = []
        all_recommendations = []
        all_blockers = []
        
        for artifact in artifacts:
            if artifact.status == AgentStatus.COMPLETED:
                all_findings.extend(artifact.findings)
                all_recommendations.extend(artifact.recommendations)
                all_blockers.extend(artifact.blockers)
        
        # Deduplicate findings by topic
        seen_topics = set()
        unique_findings = []
        for f in all_findings:
            topic = f.get("topic", "unknown")
            if topic not in seen_topics:
                seen_topics.add(topic)
                unique_findings.append(f)
        
        return {
            "summary": f"Completed {len(artifacts)} agent tasks using {analysis['pattern'].value if hasattr(analysis['pattern'], 'value') else analysis['pattern']}",
            "findings": unique_findings,
            "recommendations": list(set(all_recommendations)),
            "blockers": list(set(all_blockers)),
            "agent_count": len(artifacts),
            "successful_agents": sum(1 for a in artifacts if a.status == AgentStatus.COMPLETED)
        }
    
    def detect_conflicts(self, artifacts: list[AgentArtifact]) -> list[dict]:
        """Detect contradictory findings between agents"""
        conflicts = []
        
        by_topic = {}
        for artifact in artifacts:
            for finding in artifact.findings:
                topic = finding.get("topic", "unknown")
                if topic not in by_topic:
                    by_topic[topic] = []
                by_topic[topic].append({
                    "agent": artifact.agent_id,
                    "finding": finding,
                    "confidence": artifact.metadata.get("confidence", 0.5)
                })
        
        for topic, findings in by_topic.items():
            if len(findings) > 1:
                recommendations = [f["finding"].get("recommendation") for f in findings if f["finding"].get("recommendation")]
                if len(set(recommendations)) > 1:
                    conflicts.append({
                        "topic": topic,
                        "conflicting_agents": [f["agent"] for f in findings],
                        "details": findings
                    })
        
        return conflicts


# Convenience function for easy use
async def orchestrate(task: str, context: dict = None, config_path: Path = None) -> OrchestrationResult:
    """High-level orchestration function"""
    orchestrator = SubAgentOrchestrator(config_path)
    return await orchestrator.run_orchestration(task, context)


if __name__ == "__main__":
    # Demo
    import sys
    task = sys.argv[1] if len(sys.argv) > 1 else "Implement user authentication with JWT tokens"
    result = asyncio.run(orchestrate(task))
    print(json.dumps(asdict(result), indent=2, default=str))
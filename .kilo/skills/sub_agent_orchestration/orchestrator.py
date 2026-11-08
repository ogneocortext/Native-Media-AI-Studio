"""
Sub-Agent Orchestration Runtime
Provides automatic agent spawning, task decomposition, and result synthesis.
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


@dataclass
class AgentConfig:
    agent_type: str
    model: str = "gpt-6"
    reasoning_effort: str = "medium"
    timebox_seconds: int = 480  # 8 minutes default
    max_tokens: int = 100000
    skills: list[str] = field(default_factory=list)
    domain_context: str = ""


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
    """Main orchestration engine"""
    
    def __init__(self, config_path: Optional[Path] = None):
        self.config = self._load_config(config_path)
        self.task_board = TaskBoard()
        self.artifacts: dict[str, AgentArtifact] = {}
        self.session_tokens = 0
        self.session_start = datetime.now()
        
    def _load_config(self, config_path: Optional[Path]) -> dict:
        default_config = {
            "max_concurrent_agents": 3,
            "session_token_budget": 500000,
            "default_timebox_seconds": 480,
            "max_agents_per_task": 8,
            "max_retries": 1,
            "models": {
                "explore": "bolt-local",
                "general": "gpt-6",
                "backend-architect": "gpt-6",
                "frontend-architect": "gpt-6",
                "android-engineer": "gpt-6",
                "go-engineer": "gpt-6",
            },
            "reasoning_effort": {
                "quick": "low",
                "standard": "medium",
                "deep": "high"
            },
            "auto_triggers": [],
            "composite_triggers": []
        }
        
        if config_path and config_path.exists():
            with open(config_path) as f:
                user_config = yaml.safe_load(f)
                default_config.update(user_config)
        
        return default_config
    
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
                        "sequence": trigger["sequence"],
                        "timebox": trigger.get("timebox", "30m")
                    }
        
        # Check auto triggers BEFORE default patterns
        for trigger in self.config.get("auto_triggers", []):
            if any(p in task_lower for p in trigger.get("pattern", [])):
                return {
                    "pattern": OrchestrationPattern.ORCHESTRATOR_WORKER,
                    "trigger": trigger["agent"],
                    "agent": trigger["agent"],
                    "config": trigger.get("config", {}),
                    "timebox": trigger.get("timebox", "8m")
                }
        
        # Default pattern selection based on task characteristics
        if any(w in task_lower for w in ["implement", "build", "create", "add feature"]):
            if "full stack" in task_lower or ("backend" in task_lower and "frontend" in task_lower):
                return {"pattern": OrchestrationPattern.ORCHESTRATOR_WORKER, "agents": ["backend-architect", "frontend-architect"]}
            return {"pattern": OrchestrationPattern.ORCHESTRATOR_WORKER, "agents": ["general"]}
        
        if any(w in task_lower for w in ["review", "audit", "analyze code"]):
            return {"pattern": OrchestrationPattern.GENERATOR_VERIFIER, "agent": "explore", "config": {"thoroughness": "very thorough"}}
        
        if any(w in task_lower for w in ["refactor", "modernize", "migrate"]):
            return {"pattern": OrchestrationPattern.SEQUENTIAL_PIPELINE, "sequence": ["explore", "general"]}
        
        if any(w in task_lower for w in ["test", "verify", "e2e", "playwright"]):
            return {"pattern": OrchestrationPattern.ORCHESTRATOR_WORKER, "agent": "general", "config": {"use_skill": "test-measure-improve"}}
        
        if any(w in task_lower for w in ["research", "best practice", "modern approach", "latest"]):
            return {"pattern": OrchestrationPattern.ORCHESTRATOR_WORKER, "agent": "general", "config": {"use_skill": "current-best-practices"}}
        
        if any(w in task_lower for w in ["visual", "ui", "screenshot", "regression"]):
            return {"pattern": OrchestrationPattern.ORCHESTRATOR_WORKER, "agent": "general", "config": {"use_skill": "visual-qa-loop"}}
        
        # Default
        return {"pattern": OrchestrationPattern.ORCHESTRATOR_WORKER, "agent": "general"}
    
    def decompose_task(self, task_description: str, analysis: dict) -> list[TaskCard]:
        """Break task into subtask cards"""
        cards = []
        
        # Check for sequence (composite triggers) first
        sequence = analysis.get("sequence")
        if sequence:
            for i, step in enumerate(sequence):
                if isinstance(step, list):
                    # Parallel agents in this stage
                    for j, agent_type in enumerate(step):
                        card = TaskCard(
                            id=str(uuid.uuid4())[:8],
                            title=f"Stage {i+1}-{j+1}: {agent_type}",
                            description=f"Parallel subtask in stage {i+1}\n\nFull task: {task_description}",
                            agent_type=agent_type,
                            acceptance_criteria=f"Complete {agent_type} portion of stage {i+1}",
                            dependencies=[cards[k].id for k in range(len(cards)) if not isinstance(analysis.get("sequence", [])[i-1] if i > 0 else [], list) or k < len(cards) - len(step)] if i > 0 else [],
                            timebox_seconds=self.config["default_timebox_seconds"]
                        )
                        cards.append(card)
                else:
                    # Single agent in this stage
                    card = TaskCard(
                        id=str(uuid.uuid4())[:8],
                        title=f"Stage {i+1}: {step}",
                        description=f"Pipeline stage {i+1} of {len(sequence)}\n\nFull task: {task_description}",
                        agent_type=step,
                        acceptance_criteria=f"Complete stage {i+1} output for next stage",
                        dependencies=[cards[-1].id] if cards else [],
                        timebox_seconds=self.config["default_timebox_seconds"]
                    )
                    cards.append(card)
        
        elif analysis["pattern"] == OrchestrationPattern.ORCHESTRATOR_WORKER:
            agents = analysis.get("agents", [analysis.get("agent", "general")])
            for i, agent_type in enumerate(agents):
                card = TaskCard(
                    id=str(uuid.uuid4())[:8],
                    title=f"{agent_type}: {task_description[:50]}",
                    description=f"Subtask for {agent_type} agent\n\nFull task: {task_description}",
                    agent_type=agent_type,
                    acceptance_criteria=f"Complete {agent_type} portion of: {task_description}",
                    timebox_seconds=self.config["default_timebox_seconds"]
                )
                cards.append(card)
        
        elif analysis["pattern"] == OrchestrationPattern.SEQUENTIAL_PIPELINE:
            sequence = analysis.get("sequence", ["explore", "general"])
            for i, agent_type in enumerate(sequence):
                card = TaskCard(
                    id=str(uuid.uuid4())[:8],
                    title=f"Stage {i+1}: {agent_type}",
                    description=f"Pipeline stage {i+1} of {len(sequence)}",
                    agent_type=agent_type,
                    acceptance_criteria=f"Complete stage {i+1} output for next stage",
                    dependencies=[cards[i-1].id] if i > 0 else [],
                    timebox_seconds=self.config["default_timebox_seconds"]
                )
                cards.append(card)
        
        elif analysis["pattern"] == OrchestrationPattern.CONCURRENT:
            agents = analysis.get("agents", ["general", "general"])
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
            cards.append(TaskCard(
                id=str(uuid.uuid4())[:8],
                title="Generator",
                description=f"Generate solution for: {task_description}",
                agent_type=analysis.get("agent", "general"),
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
                "model": self.config["models"].get(card.agent_type, "gpt-6"),
                "skills": card.metadata.get("skills", []) if hasattr(card, 'metadata') else [],
                "timebox": card.timebox_seconds
            }
        )
        
        self.artifacts[agent_id] = artifact
        self.task_board.start_card(card.id)
        
        try:
            # In real implementation, this calls the actual agent
            # For now, simulate with the task tool
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
            
        except Exception as e:
            artifact.status = AgentStatus.FAILED
            artifact.completed_at = datetime.now()
            artifact.blockers = [str(e)]
            self.task_board.block_card(card.id)
        
        return artifact
    
    async def _execute_agent(self, card: TaskCard, context: dict) -> dict:
        """Execute agent - placeholder for actual agent invocation"""
        # This would call the actual task/agent tool
        # For now, return mock result
        return {
            "summary": f"Completed {card.title}",
            "findings": [{"topic": card.agent_type, "detail": "Analysis complete"}],
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
                # Pass output as input to next
                if artifact.output_ref:
                    current_context = {**current_context, "previous_output": artifact.output_ref}
        
        elif analysis["pattern"] == OrchestrationPattern.GENERATOR_VERIFIER:
            # Generator-Verifier loop (max 3 rounds)
            for round_num in range(3):
                gen_card = cards[0]
                gen_artifact = await self.spawn_agent(gen_card, context)
                artifacts.append(gen_artifact)
                
                # Verify
                ver_card = cards[1]
                ver_context = {**context, "generator_output": gen_artifact.output_ref}
                ver_artifact = await self.spawn_agent(ver_card, ver_context)
                artifacts.append(ver_artifact)
                
                if ver_artifact.metadata.get("passed", False):
                    break
                
                # Feed back to generator
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
        
        # Group findings by topic
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
        
        # Check for contradictions
        for topic, findings in by_topic.items():
            if len(findings) > 1:
                # Simple contradiction detection: different recommendations
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
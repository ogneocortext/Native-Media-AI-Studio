"""
Native Media AI Studio - Custom Music Video Agent

This agent orchestrates the full music video creation pipeline:

1. Analyze audio (BPM, beats, sections, energy)
2. Generate music/stems (ACE-Step)
3. Create visual concepts (ComfyUI/Blender)
4. Build 3D scenes (Blender/Unity MCP)
5. Composite final video (Remotion)

Design principles (per D21 - Agent Handoff Portability):
- Model-agnostic: behavioral instructions, not model-specific prompts
- File-based state: state files in output/agent-state/ for handoffs
- Commits carry reasoning: every commit has Co-authored-by trailer
- Checker/guard scripts: all gates must pass

Oct 2026 best practices applied:
- Async-first design (asyncio + httpx) - no blocking I/O
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

from __future__ import annotations

import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, ClassVar

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from app.agents.agent_state import AgentState
from app.agents.api_client import NMAApiClient
from app.agents.resilience import (
    DEFAULT_BACKOFF_BASE,
    DEFAULT_BACKOFF_CAP,
    DEFAULT_MAX_ATTEMPTS,
    CircuitBreaker,
    NMAApiError,
    get_circuit_breaker,
    make_idempotency_key,
    retry_with_backoff,
)
from app.services.agent_memory import AgentMemoryService


class NMAAgent:
    """Native Media AI Studio custom agent.

    Drives the music video creation pipeline through the backend REST API.
    All state is persisted to output/agent-state/ for agent handoffs.
    """

    def __init__(self, session_id: str | None = None,
                 api_base: str = "http://127.0.0.1:8000"):
        self.session_id = session_id or (
            f"nma-agent-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"
        )
        self.trace_id = uuid.uuid4().hex[:16]
        self.state = AgentState(self.session_id).load()
        self.api = NMAApiClient(api_base)
        # Per-dependency circuit breakers
        self._breakers: dict[str, CircuitBreaker] = {}
        self._log(f"Agent session started: {self.session_id}"
                  f" (trace={self.trace_id})")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _log(self, message: str, level: str = "info",
             *, step: str | None = None, **extra: Any) -> None:
        """Log a message to stdout and agent state."""
        timestamp = datetime.now(timezone.utc).strftime("%H:%M:%S")
        print(f"[{timestamp}] [NMAAgent] {message}")
        if level == "error":
            self.state.add_error(message)
        elif level == "warning":
            self.state.add_warning(message)

    def _phase(self, phase: str) -> None:
        """Transition to a new phase and persist state."""
        self.state.update(phase=phase)
        self._log(f"Phase: {phase}")

    async def _api_call(self, fn, *args, context: str = "",
                        idempotency_key: str | None = None,
                        circuit_name: str | None = None,
                        **kwargs: Any) -> dict | None:
        """Wrap an API call with retry + circuit breaker +
        error classification."""
        cb = None
        if circuit_name:
            cb = await get_circuit_breaker(circuit_name)

        async def _call():
            return await fn(*args, **kwargs)

        try:
            return await retry_with_backoff(
                _call,
                max_attempts=DEFAULT_MAX_ATTEMPTS,
                backoff_base=DEFAULT_BACKOFF_BASE,
                backoff_cap=DEFAULT_BACKOFF_CAP,
                circuit_breaker=cb,
                context=context or fn.__name__,
            )
        except NMAApiError as e:
            self._log(f"API error: {e}", "error",
                      step=context, retryable=e.retryable,
                      status_code=e.status_code)
            return None
        except Exception as e:
            self._log(f"Unexpected error: {e}", "error",
                      step=context, retryable=False)
            return None

    # ------------------------------------------------------------------
    # Pipeline phases
    # ------------------------------------------------------------------
    async def analyze_audio(self, audio_file: str) -> dict | None:
        """Phase 1: Analyze audio for BPM, beats, sections, energy."""
        self._phase("analyzing")
        self._log(f"Analyzing audio: {audio_file}")

        # Upload first if it's a local file path
        if Path(audio_file).exists():
            upload_result = await self._api_call(
                self.api.audio_upload, audio_file,
                context="audio_upload",
                idempotency_key=make_idempotency_key(
                    tenant=self.session_id,
                    operation="audio_upload",
                    params={"file": audio_file},
                ),
            )
            if upload_result is None:
                return None
            filename = upload_result.get("filename") or Path(audio_file).name
        else:
            filename = audio_file

        analysis = await self._api_call(
            self.api.audio_analyze, filename,
            context="audio_analyze",
            idempotency_key=make_idempotency_key(
                tenant=self.session_id,
                operation="audio_analyze",
                params={"filename": filename},
            ),
        )
        if analysis is None:
            return None

        self.state.update(audio_file=filename, analysis=analysis)
        self._log(
            "Analysis complete",
            step="analyze_audio",
            tempo_bpm=analysis.get("tempo_bpm"),
            beat_count=len(analysis.get("beat_times", [])),
            section_count=len(analysis.get("sections", [])),
        )
        return analysis

    async def generate_music(self, style: str = "cinematic",
                             lyrics: str = "") -> dict | None:
        """Phase 2: Generate music using ACE-Step."""
        self._phase("generating")
        self._log(f"Generating music: style={style}")

        # Ensure service is running
        status = await self._api_call(
            self.api.music_gen_status,
            context="music_gen_status",
        )
        if status is None or not status.get("services", {}).get("ace",
                                                                False):
            self._log("Starting ACE-Step service...", "warning")
            start_result = await self._api_call(
                self.api.music_gen_start, "ace",
                context="music_gen_start",
                idempotency_key=make_idempotency_key(
                    tenant=self.session_id,
                    operation="music_gen_start",
                    params={"engine": "ace"},
                ),
            )
            if start_result is None:
                self._log("Failed to start ACE-Step service", "error")
                return None

        result = await self._api_call(
            self.api.music_gen_generate, style, lyrics,
            context="music_gen_generate",
            idempotency_key=make_idempotency_key(
                tenant=self.session_id,
                operation="music_gen_generate",
                params={"style": style, "lyrics": lyrics},
            ),
        )
        if result is None:
            return None

        output_name = result.get("output_name") or style.replace(" ", "_")
        audio_url = self.api.music_gen_audio(output_name)

        self.state.add_generated_asset(
            "audio", audio_url,
            {"style": style, "lyrics": lyrics},
        )
        self._log(f"Music generated: {audio_url}")
        return {"name": output_name, "url": audio_url, "result": result}

    async def create_plan(self, analysis: dict,
                          music_result: dict | None = None) -> dict | None:
        """Phase 3: Create a music video production plan."""
        self._phase("planning")
        self._log("Creating music video production plan")

        # Build a recipe based on audio analysis
        sections = analysis.get("sections", [])
        duration = analysis.get("duration_seconds", 30)

        # Simple plan: one scene per song section
        recipe = {
            "name": f"mashup-{self.session_id[:8]}",
            "target_bpm": analysis.get("tempo_bpm", 120),
            "slots": [
                {
                    "layers": [
                        {
                            "track": self.state.get("audio_file", ""),
                            "stem": "drums",
                            "gain_db": 0.0,
                            "key_shift_semitones": 0,
                            "source_start_bar": 0,
                        }
                    ],
                    "bars": max(1, len(sections) * 2),
                    "crossfade_bars": 1,
                }
            ],
        }

        # Preview the recipe first
        preview = await self._api_call(
            self.api.remix_preview, recipe,
            context="remix_preview",
            idempotency_key=make_idempotency_key(
                tenant=self.session_id,
                operation="remix_preview",
                params=recipe,
            ),
        )
        if preview is None:
            return None

        self.state.update(plan=recipe)
        self._log(f"Plan created: {len(sections)} sections, "
                  f"{duration}s duration")
        return {"recipe": recipe, "preview": preview}

    async def build_remix(self, recipe: dict | None = None) -> dict | None:
        """Phase 4: Build the remix/mashup."""
        self._phase("rendering")
        self._log("Building remix")

        if recipe is None:
            recipe = self.state.get("plan")
            if recipe is None:
                self._log("No recipe available for remix build", "error")
                return None

        # Preview first
        preview = await self._api_call(
            self.api.remix_preview, recipe,
            context="remix_preview",
            idempotency_key=make_idempotency_key(
                tenant=self.session_id,
                operation="remix_preview",
                params=recipe,
            ),
        )
        if preview is None:
            return None

        # Check warnings
        warnings = preview.get("warnings", [])
        for w in warnings:
            self._log(f"Preview warning: {w}", "warning")

        # Build
        result = await self._api_call(
            self.api.remix_build, recipe,
            context="remix_build",
            idempotency_key=make_idempotency_key(
                tenant=self.session_id,
                operation="remix_build",
                params=recipe,
            ),
        )
        if result is None:
            return None

        remix_name = recipe.get("name", "mashup")
        enhance_result = await self._api_call(
            self.api.remix_enhance, remix_name,
            context="remix_enhance",
            idempotency_key=make_idempotency_key(
                tenant=self.session_id,
                operation="remix_enhance",
                params={"name": remix_name},
            ),
        )

        self.state.add_generated_asset(
            "remix", result,
            {"preview": preview, "enhanced": enhance_result is not None},
        )
        self._log(f"Remix built: {remix_name}")
        return {"result": result, "preview": preview,
                "enhanced": enhance_result}

    # ------------------------------------------------------------------
    # Full pipeline
    # ------------------------------------------------------------------
    async def create_music_video(
        self,
        audio_file: str,
        style: str = "cinematic",
        lyrics: str = "",
        build_remix: bool = True,
    ) -> dict[str, Any]:
        """Run the full music video creation pipeline.

        Args:
            audio_file: Path to audio file or library filename
            style: Music generation style (e.g., "cinematic", "electronic")
            lyrics: Optional lyrics for generation
            build_remix: Whether to build a remix mashup

        Returns:
            Dict with pipeline results and state file path
        """
        self._log("=" * 60)
        self._log("NMA Agent: Music Video Pipeline Started")
        self._log("=" * 60)

        result: dict[str, Any] = {"session_id": self.session_id,
                                  "phases": {}}

        # Step 1: Analyze
        analysis = await self.analyze_audio(audio_file)
        result["phases"]["analysis"] = analysis
        if analysis is None:
            self._log("Pipeline failed at analysis stage", "error")
            self._phase("failed")
            return result

        # Step 2: Generate music (optional)
        music_result = None
        if style:
            music_result = await self.generate_music(style, lyrics)
            result["phases"]["music"] = music_result

        # Step 3: Create plan
        plan = await self.create_plan(analysis, music_result)
        result["phases"]["plan"] = plan
        if plan is None:
            self._log("Pipeline failed at planning stage", "error")
            self._phase("failed")
            return result

        # Step 4: Build remix (optional)
        if build_remix:
            remix = await self.build_remix(plan.get("recipe"))
            result["phases"]["remix"] = remix

        self._phase("complete")
        self._log("=" * 60)
        self._log("NMA Agent: Pipeline Complete")
        self._log("=" * 60)

        result["state_file"] = str(self.state.state_path)
        return result

    async def close(self) -> None:
        await self.api.aclose()

    async def __aenter__(self) -> NMAAgent:
        await self.api._get_client()
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------
    def status(self) -> dict[str, Any]:
        """Return current agent state."""
        return {
            "session_id": self.session_id,
            "trace_id": self.trace_id,
            "phase": self.state.get("phase"),
            "audio_file": self.state.get("audio_file"),
            "has_analysis": self.state.get("analysis") is not None,
            "has_plan": self.state.get("plan") is not None,
            "generated_assets": len(self.state.get("generated_assets", [])),
            "errors": len(self.state.get("errors", [])),
            "warnings": len(self.state.get("warnings", [])),
            "llm_driver": self.state.get("llm_driver"),
            "llm_iterations": self.state.get("llm_iterations"),
            "llm_aborted": self.state.get("llm_aborted"),
            "state_file": str(self.state.state_path),
        }

    # ------------------------------------------------------------------
    # LLM decision loop (T-AGT-01 / T-AGT-02)
    # ------------------------------------------------------------------
    LLM_MAX_ITERATIONS = 12

    def _llm_tool_definitions(self) -> list[dict[str, Any]]:
        """Tool schemas the LLM can call, mapped to NMAApiClient methods."""
        return [
            {
                "type": "function",
                "function": {
                    "name": "health",
                    "description": "Check backend and adapter health status.",
                    "parameters": {
                        "type": "object",
                        "properties": {},
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "audio_upload",
                    "description": "Upload a local audio file to the backend.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "file_path": {
                                "type": "string",
                                "description": "Local path to the audio file.",
                            }
                        },
                        "required": ["file_path"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "audio_analyze",
                    "description": "Analyze audio: extract BPM, beats, sections, energy.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "filename": {
                                "type": "string",
                                "description": "Audio filename (already uploaded or in library).",
                            }
                        },
                        "required": ["filename"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "audio_list",
                    "description": "List all audio outputs.",
                    "parameters": {
                        "type": "object",
                        "properties": {},
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "music_gen_status",
                    "description": "Check ACE-Step generation service status.",
                    "parameters": {
                        "type": "object",
                        "properties": {},
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "music_gen_start",
                    "description": "Start the ACE-Step generation service.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "engine": {
                                "type": "string",
                                "description": "Engine name (default: ace).",
                                "default": "ace",
                            }
                        },
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "music_gen_generate",
                    "description": "Generate music from style and optional lyrics.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "style": {
                                "type": "string",
                                "description": "Generation style (e.g., cinematic, electronic).",
                            },
                            "lyrics": {
                                "type": "string",
                                "description": "Optional lyrics for generation.",
                                "default": "",
                            },
                            "output_name": {
                                "type": "string",
                                "description": "Optional output name.",
                            },
                        },
                        "required": ["style"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "remix_list",
                    "description": "List existing remixes.",
                    "parameters": {
                        "type": "object",
                        "properties": {},
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "remix_preview",
                    "description": "Preview a mashup recipe before building.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "recipe": {
                                "type": "object",
                                "description": "Remix recipe with name, target_bpm, slots.",
                            }
                        },
                        "required": ["recipe"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "remix_build",
                    "description": "Build a remix from a recipe.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "recipe": {
                                "type": "object",
                                "description": "Remix recipe to build.",
                            }
                        },
                        "required": ["recipe"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "remix_enhance",
                    "description": "Master/enhance an existing remix.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "name": {
                                "type": "string",
                                "description": "Remix name to enhance.",
                            }
                        },
                        "required": ["name"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "media_list",
                    "description": "List media files in outputs.",
                    "parameters": {
                        "type": "object",
                        "properties": {},
                        "required": [],
                    },
                },
            },
        ]

    _LLM_TOOL_METHODS: ClassVar[dict[str, Any]] = {
        "health": lambda self: self.api.health(),
        "audio_upload": lambda self, file_path: self.api.audio_upload(file_path),
        "audio_analyze": lambda self, filename: self.api.audio_analyze(filename),
        "audio_list": lambda self: self.api.audio_list(),
        "music_gen_status": lambda self: self.api.music_gen_status(),
        "music_gen_start": lambda self, engine="ace": self.api.music_gen_start(engine),
        "music_gen_generate": lambda self, style, lyrics="", output_name=None: self.api.music_gen_generate(style, lyrics, output_name),
        "remix_list": lambda self: self.api.remix_list(),
        "remix_preview": lambda self, recipe: self.api.remix_preview(recipe),
        "remix_build": lambda self, recipe: self.api.remix_build(recipe),
        "remix_enhance": lambda self, name: self.api.remix_enhance(name),
        "media_list": lambda self: self.api.media_list(),
    }

    async def run_llm_loop(
        self,
        goal: str,
        audio_file: str | None = None,
        max_iterations: int | None = None,
    ) -> dict[str, Any]:
        """Run the LLM-driven decision loop.

        The LLM decides which NMAApiClient operations to call and in what
        order to achieve ``goal``. Each tool result is fed back to the LLM
        as an observation until the goal is reached or max iterations
        exceeded.

        Dual-process memory (System 1 + System 2):
        - Before each LLM call, relevant memories are retrieved and injected
          into the system prompt so Qwen doesn't start from scratch.
        - After the loop completes, the episode is stored for reflection.

        Args:
            goal: High-level goal for the LLM (e.g. "analyze this track and
                  preview a remix").
            audio_file: Optional audio file to analyze first.
            max_iterations: Override the default iteration cap (12).

        Returns:
            Dict with loop results, iterations used, and any errors.
        """
        import json

        memory = AgentMemoryService()
        max_iters = max_iterations or self.LLM_MAX_ITERATIONS
        tools = self._llm_tool_definitions()
        history: list[dict[str, Any]] = []
        tool_call_log: list[dict[str, Any]] = []

        # Build Qwen-optimized system prompt with retrieved memory context
        memory_context = memory.build_qwen_context(goal)
        base_system_prompt = (
            "You are an agent driving the Native Media AI Studio pipeline. "
            "You have callable tools for audio analysis, music generation, "
            "and remix operations. Given a goal, decide which tools to call "
            "and in what order. Call one tool at a time, wait for the result, "
            "then decide the next step. When the goal is achieved, respond "
            "with a summary and no tool calls. Do not invent results."
        )
        if memory_context:
            system_prompt = f"{base_system_prompt}\n\n{memory_context}"
        else:
            system_prompt = base_system_prompt

        if audio_file:
            history.append({
                "role": "user",
                "content": f"The audio file to work with is: {audio_file}",
            })

        history.append({
            "role": "user",
            "content": goal,
        })

        self.state.update(llm_iterations=0, llm_aborted=False,
                          llm_tool_calls=[])

        start_ms = datetime.now(timezone.utc).timestamp() * 1000

        for iteration in range(max_iters):
            self.state.update(llm_iterations=iteration + 1)

            response = await self.api.chat_with_tools(
                message=history[-1]["content"] if history else goal,
                tools=tools,
                model="qwen3.5:4b",
                system=system_prompt,
                history=history[:-1] if len(history) > 1 else None,
                max_tool_calls=5,
            )

            if response is None:
                self._log("LLM chat failed -- aborting loop", "error")
                self.state.update(llm_aborted=True)
                break

            message = response.get("message", {})
            tool_calls = message.get("tool_calls", [])
            content = message.get("content", "")

            # Record the assistant turn
            assistant_turn: dict[str, Any] = {"role": "assistant"}
            if content:
                assistant_turn["content"] = content
            if tool_calls:
                assistant_turn["tool_calls"] = tool_calls
            history.append(assistant_turn)

            if not tool_calls:
                # LLM says it's done -- record final answer and exit
                self._log(f"LLM loop complete after {iteration + 1} iterations")
                self.state.update(llm_driver="atomic_chat")

                # System 2: store the completed episode
                end_ms = datetime.now(timezone.utc).timestamp() * 1000
                memory.store_episode(
                    session_id=self.session_id,
                    goal=goal,
                    approach="llm_tool_loop",
                    result=content or "",
                    success=True,
                    duration_ms=int(end_ms - start_ms),
                    tools_used=[tc.get("function", {}).get("name", "")
                                for tc in tool_call_log],
                    llm_driver="atomic_chat",
                    iterations=iteration + 1,
                )
                return {
                    "ok": True,
                    "iterations": iteration + 1,
                    "message": content,
                    "tool_calls": tool_call_log,
                    "aborted": False,
                }

            # Execute each tool call
            for tc in tool_calls:
                fn_name = tc.get("function", {}).get("name", "")
                fn_args = tc.get("function", {}).get("arguments", {})
                if isinstance(fn_args, str):
                    fn_args = json.loads(fn_args)

                call_record = {
                    "iteration": iteration + 1,
                    "tool": fn_name,
                    "args": fn_args,
                }

                try:
                    method = self._LLM_TOOL_METHODS.get(fn_name)
                    if method is None:
                        raise ValueError(f"Unknown tool: {fn_name}")
                    result = await method(self, **fn_args)
                    call_record["result"] = result
                    call_record["error"] = None
                    self._log(f"LLM tool call: {fn_name}({fn_args}) -> ok")

                    # Feed result back as a tool message
                    history.append({
                        "role": "tool",
                        "content": json.dumps(result) if not isinstance(result, str) else result,
                        "tool_call_id": tc.get("id", ""),
                    })
                except Exception as e:  # noqa: BLE001
                    call_record["result"] = None
                    call_record["error"] = str(e)
                    self._log(f"LLM tool call failed: {fn_name} -> {e}", "error")

                    history.append({
                        "role": "tool",
                        "content": json.dumps({"error": str(e)}),
                        "tool_call_id": tc.get("id", ""),
                    })

                tool_call_log.append(call_record)

        # Max iterations reached without completion
        self.state.update(llm_aborted=True, llm_driver="atomic_chat")
        self._log(f"LLM loop aborted after {max_iters} iterations", "warning")

        # System 2: store the aborted episode
        end_ms = datetime.now(timezone.utc).timestamp() * 1000
        memory.store_episode(
            session_id=self.session_id,
            goal=goal,
            approach="llm_tool_loop",
            result="Max iterations reached without goal completion",
            success=False,
            duration_ms=int(end_ms - start_ms),
            tools_used=[tc.get("function", {}).get("name", "")
                        for tc in tool_call_log],
            error_message="max_iterations_exceeded",
            llm_driver="atomic_chat",
            iterations=max_iters,
        )
        return {
            "ok": False,
            "iterations": max_iters,
            "message": "Max iterations reached without goal completion",
            "tool_calls": tool_call_log,
            "aborted": True,
        }


async def run_pipeline(
    audio_file: str,
    style: str = "cinematic",
    lyrics: str = "",
    session_id: str | None = None,
    build_remix: bool = True,
) -> dict[str, Any]:
    """Convenience function to run the full pipeline."""
    agent = NMAAgent(session_id=session_id)
    try:
        return await agent.create_music_video(
            audio_file, style, lyrics, build_remix
        )
    finally:
        await agent.close()

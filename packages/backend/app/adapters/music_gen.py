"""
Music Generation adapter — manages subprocess services for YuE2 and ACE-Step.

Each engine runs as a separate FastAPI subprocess on its own port,
communicating via HTTP. The adapter coordinates with VRAM manager
to ensure safe GPU allocation.
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Optional

import aiohttp

from .base import AdapterStatus, BaseAdapter, _handle_adapter_error

logger = logging.getLogger(__name__)

# Shared aiohttp session for all adapters (created on first use)
_shared_session: Optional[aiohttp.ClientSession] = None


async def _get_shared_session() -> aiohttp.ClientSession:
    global _shared_session
    if _shared_session is None or _shared_session.closed:
        _shared_session = aiohttp.ClientSession()
    return _shared_session


async def close_shared_session():
    global _shared_session
    if _shared_session and not _shared_session.closed:
        await _shared_session.close()
    _shared_session = None

# Default ports for each engine
DEFAULT_PORTS = {
    "yue2": 8200,
    "ace": 8201,
}

# VRAM budgets per engine (in MB)
VRAM_BUDGETS = {
    "yue2": 6144,   # 6GB for Q4_0 GGUF
    "ace": 4096,    # 4GB for ACE-Step
}


class MusicGenAdapter(BaseAdapter):
    """
    Adapter for the music generation subprocess service.

    Manages lifecycle of one engine subprocess (YuE2 or ACE-Step),
    proxies requests, and coordinates VRAM allocation with the
    main backend's VRAM manager.
    """

    def __init__(
        self,
        engine: str = "yue2",
        port: Optional[int] = None,
        base_url: Optional[str] = None,
        mock_mode: bool = False,
        output_dir: str = "output/music",
    ):
        self.engine = engine
        self.port = port or DEFAULT_PORTS.get(engine, 8200)
        self.output_dir = output_dir
        url = base_url or f"http://127.0.0.1:{self.port}"
        super().__init__(base_url=url, name=f"music-gen-{engine}", mock_mode=mock_mode)

        self._process: Optional[subprocess.Popen] = None
        self._ready = False
        self._startup_timeout = 120  # seconds

    # ------------------------------------------------------------------
    # BaseAdapter interface
    # ------------------------------------------------------------------

    async def health_check(self) -> bool:
        """Check if the music-gen service is reachable."""
        if self._mock_mode:
            return True
        try:
            session = await _get_shared_session()
            async with session.get(
                f"{self.base_url}/health", timeout=aiohttp.ClientTimeout(total=5)
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    self._ready = data.get("loaded", False)
                    return True
        except Exception:
            pass
        self._ready = False
        return False

    @_handle_adapter_error()
    async def generate(self, params: dict[str, Any]) -> dict[str, Any]:
        """
        Generate music via the subprocess service.

        Args:
            params: Must contain at minimum:
                - style: str (genre, instruments, mood)
                - lyrics: str (with section tags)
            Optional:
                - cot: str ("full", "melody", "off")
                - seed: int
                - abc: str (pre-made score)
                - cfg_scale: float
                - max_new_tokens: int
                - output_name: str

        Returns:
            Dict with audio_path, seed, engine, output_name
        """
        if self._mock_mode:
            return await self._mock_generate(params)

        if not await self.health_check():
            raise RuntimeError(
                f"Music generation service not available at {self.base_url}. "
                f"Start the service first."
            )

        session = await _get_shared_session()
        async with session.post(
            f"{self.base_url}/generate",
            json=params,
            timeout=aiohttp.ClientTimeout(total=600),  # 10 min for large generations
        ) as resp:
            if resp.status != 200:
                error_text = await resp.text()
                raise RuntimeError(f"Music generation failed: {error_text}")
            return await resp.json()

    async def _mock_generate(self, params: dict[str, Any]) -> dict[str, Any]:
        """Mock generation for testing without the service."""
        return {
            "audio_path": None,
            "seed": params.get("seed", 42),
            "engine": self.engine,
            "output_name": "mock_output",
            "mock": True,
            "message": "Mock mode: no audio generated",
        }

    # ------------------------------------------------------------------
    # Service lifecycle
    # ------------------------------------------------------------------

    async def start_service(
        self,
        vram_budget_mb: Optional[int] = None,
        extra_args: Optional[list[str]] = None,
    ) -> bool:
        """
        Start the music generation subprocess.

        Args:
            vram_budget_mb: VRAM budget override (default from VRAM_BUDGETS)
            extra_args: Additional CLI arguments for the server

        Returns:
            True if service started successfully
        """
        if self._process and self._process.poll() is None:
            logger.info("Music-gen service already running (pid=%d)", self._process.pid)
            return True

        budget = vram_budget_mb or VRAM_BUDGETS.get(self.engine, 6144)
        script_dir = Path(__file__).parent.parent.parent.parent / "tools" / "music-gen"
        server_script = script_dir / "server.py"

        if not server_script.exists():
            raise FileNotFoundError(f"Server script not found: {server_script}")

        # Find the correct Python interpreter
        python_exe = self._find_python()
        if not python_exe:
            raise RuntimeError("Cannot find Python interpreter for music-gen service")

        cmd = [
            str(python_exe),
            str(server_script),
            "--port", str(self.port),
            "--engine", self.engine,
            "--vram-budget", str(budget // 1024),  # Convert to GB
            "--output-dir", self.output_dir,
        ]
        if extra_args:
            cmd.extend(extra_args)

        logger.info("Starting music-gen service: %s", " ".join(cmd))

        # Start process detached
        creationflags = 0
        if sys.platform == "win32":
            creationflags = subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS

        self._process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=creationflags,
            cwd=str(script_dir),
        )

        # Wait for service to become ready
        ready = await self._wait_for_ready()
        if ready:
            self._ready = True
            self.set_status(AdapterStatus.CONNECTED)
            logger.info("Music-gen service started (pid=%d, port=%d)",
                        self._process.pid, self.port)
        else:
            self.set_status(AdapterStatus.ERROR)
            logger.error("Music-gen service failed to start within timeout")

        return ready

    async def stop_service(self) -> bool:
        """Stop the music generation subprocess."""
        if not self._process:
            return True

        pid = self._process.pid
        logger.info("Stopping music-gen service (pid=%d)", pid)

        # Try graceful shutdown via HTTP
        try:
            session = await _get_shared_session()
            async with session.post(
                f"{self.base_url}/unload",
                timeout=aiohttp.ClientTimeout(total=10),
            ):
                pass
        except Exception:
            pass

        # Give it a moment to clean up
        await asyncio.sleep(2)

        # Graceful terminate first, then force kill if still running
        if self._process.poll() is None:
            try:
                self._process.terminate()
                try:
                    self._process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    logger.warning("Process %d did not exit after terminate, killing", pid)
                    self._process.kill()
            except Exception as e:
                logger.warning("Failed to stop music-gen process: %s", e)

        self._process = None
        self._ready = False
        self.set_status(AdapterStatus.DISCONNECTED)
        logger.info("Music-gen service stopped")
        return True

    async def _wait_for_ready(self) -> bool:
        """Wait for the service to become healthy."""
        start = time.monotonic()
        while (time.monotonic() - start) < self._startup_timeout:
            if self._process and self._process.poll() is not None:
                # Process exited — drain stderr safely using communicate()
                stderr = ""
                try:
                    _, stderr_bytes = await asyncio.wait_for(
                        asyncio.to_thread(self._process.communicate),
                        timeout=5,
                    )
                    stderr = stderr_bytes.decode(errors="replace") if stderr_bytes else ""
                except Exception as exc:
                    logger.debug("Could not read stderr from exited process: %s", exc)
                logger.error("Music-gen process exited early (code=%d): %s",
                             self._process.returncode, stderr[:500])
                return False

            try:
                session = await _get_shared_session()
                async with session.get(
                    f"{self.base_url}/health",
                    timeout=aiohttp.ClientTimeout(total=3),
                ) as resp:
                    if resp.status == 200:
                        return True
            except Exception:
                pass

            await asyncio.sleep(2)

        return False

    def _find_python(self) -> Optional[Path]:
        """Find the correct Python interpreter for the music-gen environment."""
        # Check for dedicated venv in tools/music-gen
        script_dir = Path(__file__).parent.parent.parent.parent / "tools" / "music-gen"
        venv_python = script_dir / ".venv" / "Scripts" / "python.exe"
        if venv_python.exists():
            return venv_python

        venv_python_unix = script_dir / ".venv" / "bin" / "python"
        if venv_python_unix.exists():
            return venv_python_unix

        # Check MUSIC_GEN_PYTHON env var
        env_python = os.environ.get("MUSIC_GEN_PYTHON")
        if env_python and Path(env_python).exists():
            return Path(env_python)

        # Fallback to system Python — warn because this may share deps with the backend
        logger.warning(
            "No dedicated music-gen Python environment found. "
            "Falling back to sys.executable=%s. Create a venv at "
            "tools/music-gen/.venv or set MUSIC_GEN_PYTHON to avoid conflicts.",
            sys.executable,
        )
        return Path(sys.executable)

    # ------------------------------------------------------------------
    # Convenience methods
    # ------------------------------------------------------------------

    async def generate_song(
        self,
        style: str,
        lyrics: str,
        seed: Optional[int] = None,
        cot: str = "full",
        **kwargs,
    ) -> dict[str, Any]:
        """Convenience method for song generation."""
        params = {
            "style": style,
            "lyrics": lyrics,
            "cot": cot,
            **kwargs,
        }
        if seed is not None:
            params["seed"] = seed
        return await self.generate(params)

    async def plan_score(
        self,
        style: str,
        lyrics: str,
        seed: Optional[int] = None,
    ) -> dict[str, Any]:
        """Generate score only (YuE2 only)."""
        if self.engine != "yue2":
            raise ValueError("Plan only available for YuE2 engine")

        session = await _get_shared_session()
        async with session.post(
            f"{self.base_url}/plan",
            json={"style": style, "lyrics": lyrics, "seed": seed},
            timeout=aiohttp.ClientTimeout(total=120),
        ) as resp:
            if resp.status != 200:
                error_text = await resp.text()
                raise RuntimeError(f"Plan failed: {error_text}")
            return await resp.json()

    async def render_from_score(
        self,
        abc: str,
        style: str,
        lyrics: str,
        seed: Optional[int] = None,
    ) -> dict[str, Any]:
        """Render audio from edited ABC score (YuE2 only)."""
        if self.engine != "yue2":
            raise ValueError("Score rendering only available for YuE2 engine")

        session = await _get_shared_session()
        async with session.post(
            f"{self.base_url}/render",
            json={
                "abc": abc,
                "style": style,
                "lyrics": lyrics,
                "seed": seed,
            },
            timeout=aiohttp.ClientTimeout(total=300),
        ) as resp:
            if resp.status != 200:
                error_text = await resp.text()
                raise RuntimeError(f"Render failed: {error_text}")
            return await resp.json()

    async def get_vram_usage(self) -> dict[str, Any]:
        """Get current VRAM usage from the service."""
        try:
            session = await _get_shared_session()
            async with session.get(
                f"{self.base_url}/vram",
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                if resp.status == 200:
                    return await resp.json()
        except Exception:
            pass
        return {"available": False}

    @property
    def is_running(self) -> bool:
        """Check if the subprocess is still alive."""
        return self._process is not None and self._process.poll() is None

    @property
    def pid(self) -> Optional[int]:
        """Get the subprocess PID."""
        return self._process.pid if self._process else None


# ---------------------------------------------------------------------------
# Global adapter instances
# ---------------------------------------------------------------------------

# Lazy-initialized adapters — created on first access
_yue2_adapter: Optional[MusicGenAdapter] = None
_ace_adapter: Optional[MusicGenAdapter] = None


def get_music_gen_adapter(engine: str = "yue2", **kwargs) -> MusicGenAdapter:
    """Get or create a music generation adapter for the specified engine."""
    global _yue2_adapter, _ace_adapter

    if engine == "yue2":
        if _yue2_adapter is None:
            _yue2_adapter = MusicGenAdapter(engine="yue2", **kwargs)
        return _yue2_adapter
    elif engine == "ace":
        if _ace_adapter is None:
            _ace_adapter = MusicGenAdapter(engine="ace", **kwargs)
        return _ace_adapter
    else:
        raise ValueError(f"Unknown engine: {engine}")


async def shutdown_music_gen_services():
    """Shutdown all music generation services."""
    global _yue2_adapter, _ace_adapter
    adapters = [a for a in [_yue2_adapter, _ace_adapter] if a is not None]
    for adapter in adapters:
        try:
            await adapter.stop_service()
        except Exception as e:
            logger.warning("Error stopping %s: %s", adapter.name, e)
    _yue2_adapter = None
    _ace_adapter = None

"""
Music Generation adapter — manages the ACE-Step subprocess service.

Each engine runs as a separate FastAPI subprocess on its own port,
communicating via HTTP. The adapter coordinates with VRAM manager
to ensure safe GPU allocation.
"""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import aiohttp

from ..core.config import PROJECT_ROOT
from .base import AdapterStatus, BaseAdapter, _handle_adapter_error

logger = logging.getLogger(__name__)

# Shared aiohttp session for music-gen subprocess calls, backed by the
# core.http registry ("music-gen" key: no total timeout, matching the
# previous bare-ClientSession behavior — every call site passes an
# explicit per-request timeout).
_SESSION_KEY = "music-gen"


async def _get_shared_session() -> aiohttp.ClientSession:
    from ..core import http as _http
    return await _http.get_shared_session(_SESSION_KEY, **_http.session_defaults(_SESSION_KEY))


async def close_shared_session():
    from ..core import http as _http
    await _http.close_shared_session(_SESSION_KEY)

# Default ports for each engine
DEFAULT_PORTS = {
    "ace": 8201,
}

# VRAM budgets per engine (in MB)
# Matched to this workstation: GTX 1070 Ti 8 GB / Ryzen 5 5500 / 32 GB RAM / Pascal sm_61
VRAM_BUDGETS = {
    # ACE-Step 1.5 Tier 3 (6-8 GB VRAM): 2B turbo DiT + 0.6B LM, INT8 quant,
    # CPU offload, pt backend. Flash Attention falls back to SDPA on Pascal.
    "ace": 6144,
}


class MusicGenAdapter(BaseAdapter):
    """
    Adapter for the music generation subprocess service.

    Manages lifecycle of the ACE-Step subprocess, proxies requests,
    and coordinates VRAM allocation with the main backend's VRAM manager.
    """

    def __init__(
        self,
        engine: str = "ace",
        port: int | None = None,
        base_url: str | None = None,
        mock_mode: bool = False,
        output_dir: str | None = None,
    ):
        self.engine = engine
        self.port = port or DEFAULT_PORTS.get(engine, 8201)
        # Use absolute path so the subprocess writes under the project output/
        # regardless of its CWD. Without this, relative "output/music" resolves
        # against tools/music-gen/ and the backend can never find the file.
        self.output_dir = output_dir or str(PROJECT_ROOT / "output" / "music")
        url = base_url or f"http://127.0.0.1:{self.port}"
        super().__init__(base_url=url, name=f"music-gen-{engine}", mock_mode=mock_mode)

        self._process: subprocess.Popen | None = None
        self._log_file: Any | None = None  # TextIO handle for subprocess log
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
        vram_budget_mb: int | None = None,
        extra_args: list[str] | None = None,
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

        # Note: vram_budget_mb is validated/enforced by the backend's VRAM
        # manager (begin_music_generation); the subprocess itself does not take
        # a VRAM CLI flag.
        script_dir = Path(__file__).parent.parent.parent.parent.parent / "tools" / "music-gen"
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
            "--output-dir", self.output_dir,
        ]
        if extra_args:
            cmd.extend(extra_args)

        logger.info("Starting music-gen service: %s", " ".join(cmd))

        # Start process detached
        creationflags = 0
        if sys.platform == "win32":
            creationflags = subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS

        # Pascal (sm_61) environment hardening — inherited by the subprocess
        _env = os.environ.copy()
        _env.setdefault("TORCH_CUDA_ARCH_LIST", "6.1")
        _env.setdefault("PYTORCH_CUDA_ALLOC_CONF", "max_split_size_mb:128")
        _env.setdefault("TORCHINDUCTOR_USE_TRITON", "0")

        # Route subprocess output to a log file instead of PIPE. With PIPE and no
        # reader, a chatty subprocess (~64KB on Windows) fills the OS pipe buffer
        # and deadlocks on its next write — the service then appears "stuck" and
        # times out even though it was starting fine.
        log_dir = PROJECT_ROOT / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        log_path = log_dir / f"music-gen-{self.engine}.log"
        self._log_file = open(log_path, "a", encoding="utf-8", buffering=1)

        self._process = subprocess.Popen(
            cmd,
            stdout=self._log_file,
            stderr=subprocess.STDOUT,
            creationflags=creationflags,
            cwd=str(script_dir),
            env=_env,
        )

        # Wait for service to become ready
        ready = await self._wait_for_ready()
        if ready:
            self._ready = True
            self.set_status(AdapterStatus.CONNECTED)
            logger.info("Music-gen service started (pid=%d, port=%d)",
                        self._process.pid, self.port)
        else:
            logger.error("Music-gen service failed to start within timeout "
                         "(see %s)", log_path)
            # Kill the failed subprocess so a timed-out start never leaves an
            # orphan still loading the model in the background.
            await self.stop_service()
            self.set_status(AdapterStatus.ERROR)

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
                    # Reap the killed process so it does not linger as a zombie
                    # and so the exit code is collected.
                    try:
                        self._process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        logger.error("Process %d did not exit even after kill", pid)
            except Exception as e:
                logger.warning("Failed to stop music-gen process: %s", e)

        self._process = None
        self._close_log_file()
        self._ready = False
        self.set_status(AdapterStatus.DISCONNECTED)
        logger.info("Music-gen service stopped")
        return True

    def _close_log_file(self) -> None:
        """Close the subprocess log file handle if open."""
        if self._log_file is not None:
            try:
                self._log_file.close()
            except Exception:
                pass
            self._log_file = None

    async def _wait_for_ready(self) -> bool:
        """Wait for the service to become healthy."""
        start = time.monotonic()
        while (time.monotonic() - start) < self._startup_timeout:
            if self._process and self._process.poll() is not None:
                # Process exited early. Subprocess output goes to the log file,
                # so read the tail of it for diagnostics instead of stderr pipes.
                log_tail = self._read_log_tail(max_chars=2000)
                logger.error("Music-gen process exited early (code=%d): %s",
                             self._process.returncode, log_tail)
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

    def _read_log_tail(self, max_chars: int = 2000) -> str:
        """Read the last `max_chars` of the subprocess log file."""
        log_path = PROJECT_ROOT / "logs" / f"music-gen-{self.engine}.log"
        try:
            if log_path.exists():
                text = log_path.read_text(encoding="utf-8", errors="replace")
                return text[-max_chars:]
        except Exception:
            pass
        return ""

    def _find_python(self) -> Path | None:
        """Find the correct Python interpreter for the music-gen environment."""
        # Check for ACE-Step's dedicated venv first (contains the `acestep` package)
        script_dir = Path(__file__).parent.parent.parent.parent.parent / "tools" / "music-gen"
        ace_venv_python = script_dir / "ACE-Step-1.5" / ".venv" / "Scripts" / "python.exe"
        if ace_venv_python.exists():
            return ace_venv_python

        ace_venv_python_unix = script_dir / "ACE-Step-1.5" / ".venv" / "bin" / "python"
        if ace_venv_python_unix.exists():
            return ace_venv_python_unix

        # Check for dedicated venv in tools/music-gen (legacy/fallback)
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
            "tools/music-gen/ACE-Step-1.5/.venv or set MUSIC_GEN_PYTHON to avoid conflicts.",
            sys.executable,
        )
        return Path(sys.executable)

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
    def pid(self) -> int | None:
        """Get the subprocess PID."""
        return self._process.pid if self._process else None


# ---------------------------------------------------------------------------
# Global adapter instances
# ---------------------------------------------------------------------------

# Lazy-initialized adapter — created on first access
_ace_adapter: MusicGenAdapter | None = None


def get_music_gen_adapter(engine: str = "ace", **kwargs) -> MusicGenAdapter:
    """Get or create a music generation adapter for the specified engine."""
    global _ace_adapter

    if engine == "ace":
        if _ace_adapter is None:
            _ace_adapter = MusicGenAdapter(engine="ace", **kwargs)
        return _ace_adapter
    else:
        raise ValueError(f"Unknown engine: {engine}")


def reset_music_gen_adapter(engine: str = "ace") -> None:
    """Reset the cached adapter so the next ``get_music_gen_adapter`` call
    creates a fresh instance. Mainly useful for tests.
    """
    global _ace_adapter
    if engine == "ace":
        _ace_adapter = None


async def shutdown_music_gen_services():
    """Shutdown all music generation services."""
    global _ace_adapter
    adapters = [a for a in [_ace_adapter] if a is not None]
    for adapter in adapters:
        try:
            await adapter.stop_service()
        except Exception as e:
            logger.warning("Error stopping %s: %s", adapter.name, e)
    _ace_adapter = None

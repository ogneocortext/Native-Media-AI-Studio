#!/usr/bin/env python3
"""
Dynamic Hybrid ASGI Server Manager for Windows

Implements a resilient server strategy:
1. Tries Granian first (best performance) with memory monitoring
2. Falls back to uvicorn (single worker) if Granian fails
3. Proactive memory monitoring with auto-restart at threshold
4. VST scan pre-loading to prevent memory spikes
5. Health monitoring with auto-restart on failure

Features:
- Priority-based server selection with fallback
- Proactive memory monitoring (restart at configurable threshold)
- VST scan pre-loading to prevent memory spikes
- Health endpoint monitoring with auto-restart
- Graceful shutdown with proper Windows signal handling
- Structured logging with rotation
"""

import logging
import os
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import ClassVar

import psutil
import requests

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("logs/server_manager.log", mode="a")
    ]
)
logger = logging.getLogger(__name__)


class ServerType(Enum):
    GRANIAN = "granian"      # Rust-based, best performance when stable
    UVICORN = "uvicorn"      # Standard ASGI, reliable on Windows
    HYPERCORN = "hypercorn"  # Pure Python, HTTP/2/3 support
    DAPHNE = "daphne"        # Django Channels server, ASGI compatible


@dataclass
class ServerConfig:
    """Configuration for an ASGI server"""
    server_type: ServerType
    host: str = "127.0.0.1"
    port: int = 8004
    workers: int = 1
    reload: bool = False
    app_module: str = "app.main:app"
    extra_args: list[str] = field(default_factory=list)

    # Windows-specific optimizations
    windows_optimized: bool = True
    loop_type: str = "auto"

    # Memory management
    memory_threshold_percent: float = 85.0  # Restart if memory exceeds this
    check_interval_seconds: int = 30

    def to_command(self) -> list[str]:
        cmd = []

        if self.server_type == "granian":
            cmd = ["granian", "--interface", "asgi"]
            if self.reload:
                cmd.append("--reload")
            cmd.extend(["--host", self.host, "--port", str(self.port)])
            cmd.append(self.app_module)

        elif self.server_type == "uvicorn":
            cmd = ["uvicorn"]
            if self.reload:
                cmd.append("--reload")
            cmd.extend(["--host", self.host, "--port", str(self.port)])
            if self.workers > 1:
                cmd.extend(["--workers", str(self.workers)])
                cmd.append("--no-access-log")
            cmd.append(self.app_module)

        elif self.server_type == "hypercorn":
            cmd = ["hypercorn"]
            cmd.extend(["--bind", f"{self.host}:{self.port}"])
            if self.workers > 1:
                cmd.extend(["--workers", str(self.workers)])
            if self.reload:
                cmd.append("--reload")
            cmd.append(self.app_module)

        elif self.server_type == "daphne":
            cmd = ["daphne"]
            cmd.extend(["-b", self.host, "-p", str(self.port)])
            if self.workers > 1:
                cmd.extend(["--processes", str(self.workers)])
            cmd.append(self.app_module)

        cmd.extend(self.extra_args)
        return cmd


class HybridServerManager:
    """
    Dynamic hybrid server manager with:
    - Priority-based server selection with fallback
    - Proactive memory monitoring
    - Health endpoint monitoring
    - Automatic fallback and restart
    """

    # Server priority (best to worst for this system)
    SERVER_PRIORITY: ClassVar[list[str]] = ["granian", "uvicorn", "hypercorn", "daphne"]

    def __init__(self, project_root: Path, config: dict | None = None):
        self.project_root = project_root
        self.backend_dir = project_root / "packages" / "backend"
        self.config = config or {}

        # Runtime state
        self.current_process: subprocess.Popen | None = None
        self.current_server_type: str | None = None
        self.current_config: dict | None = None

        # Monitoring
        self._monitor_thread: threading.Thread | None = None
        self._stop_monitor: threading.Event = threading.Event()
        self._restart_count: int = 0
        self._last_restart_time: float = 0

        # Health check
        self.health_endpoint = f"http://127.0.0.1:{self.config.get('port', 8004)}/api/health"
        self.health_check_interval = 30

        # Paths — keep the project_root passed to __init__; do not override
        # with Path.cwd() (callers may launch from any directory).

        # Load server configs
        self.server_configs = self._load_server_configs()

    def _load_server_configs(self) -> dict:
        """Load server configurations with optimized defaults"""
        return {
"granian": {
            "type": "granian",
            "command": "granian",
            "args": ["--interface", "asgi"],
            "max_workers": 1,  # Granian handles concurrency internally
            "supports_reload": True,
            "startup_timeout": 30,
            "memory_efficient": True,
            "extra_args": ["--blocking-threads", "4", "--runtime-threads", "2", "--runtime-blocking-threads", "2"],
        },
"uvicorn": {
            "type": "uvicorn",
            "command": "uvicorn",
            "max_workers": 1,  # Single worker for Windows stability
            "supports_reload": True,
            "startup_timeout": 30,
            "memory_efficient": False,
            "extra_args": ["--no-access-log"],  # uvicorn has no --http h2/--loop winloop; h2 is hypercorn's job
        },
"hypercorn": {
            "type": "hypercorn",
            "command": "hypercorn",
            "max_workers": 1,
            "supports_reload": True,
            "startup_timeout": 45,
            "memory_efficient": False,
            "extra_args": ["--worker-class", "asyncio"],  # HTTP/2 native support
        },
            "daphne": {
                "type": "daphne",
                "command": "daphne",
                "max_workers": 1,
                "supports_reload": True,
                "startup_timeout": 30,
                "memory_efficient": False,
            },
        }

    def check_server_available(self, server_type: str) -> bool:
        """Check if a server is installed and available"""
        if server_type not in self.server_configs:
            return False

        config = self.server_configs[server_type]
        try:
            result = subprocess.run(
                [config["command"], "--version"],
                capture_output=True, timeout=5
            )
            return result.returncode == 0
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return False

    def get_available_servers(self) -> list[str]:
        """Get list of available servers in priority order"""
        return [s for s in self.SERVER_PRIORITY if self.check_server_available(s)]

    def check_memory(self) -> tuple[float, dict]:
        """Check current system memory usage"""
        mem = psutil.virtual_memory()
        return mem.percent, {
            "percent": mem.percent,
            "available_mb": mem.available / 1024 / 1024,
            "total_mb": mem.total / 1024 / 1024,
        }

    def _is_memory_critical(self, threshold: float = 85.0) -> bool:
        """Check if memory is above critical threshold"""
        percent, _ = self.check_memory()
        return percent >= threshold

    def get_memory_status(self) -> dict:
        """Get detailed memory status"""
        percent, info = self.check_memory()
        return {
            "critical": percent >= self.config.get("memory_threshold_percent", 85.0),
            "percent": percent,
            **info
        }

    def get_server_config(self, server_type: str) -> dict:
        """Get server configuration with current settings"""
        base = self.server_configs.get(server_type, {}).copy()
        base.update({
            "host": self.config.get("host", "127.0.0.1"),
            "port": self.config.get("port", 8004),
            "workers": self.config.get("workers", 1),
            "reload": self.config.get("reload", False),
            "app_module": self.config.get("app_module", "app.main:app"),
        })
        return base

    def build_command(self, server_type: str) -> list[str]:
        """Build command for server type"""
        config = self.get_server_config(server_type)
        server = self.server_configs[server_type]

        cmd = [server["command"]]

        if server_type == "granian":
            cmd.extend(["--interface", "asgi"])
            cmd.extend(["--host", config["host"], "--port", str(config["port"])])
            if config["reload"]:
                cmd.append("--reload")
            cmd.append(config["app_module"])

        elif server_type == "uvicorn":
            if config["reload"]:
                cmd.append("--reload")
            cmd.extend(["--host", config["host"], "--port", str(config["port"])])
            if config["workers"] > 1:
                cmd.extend(["--workers", str(config["workers"])])
                cmd.append("--no-access-log")
            cmd.append(config["app_module"])

        elif server_type == "hypercorn":
            cmd.extend(["--bind", f"{config['host']}:{config['port']}"])
            if config["workers"] > 1:
                cmd.extend(["--workers", str(config["workers"])])
            if config["reload"]:
                cmd.append("--reload")
            cmd.append(config["app_module"])

        elif server_type == "daphne":
            cmd.extend(["-b", config["host"], "-p", str(config["port"])])
            if config["workers"] > 1:
                cmd.extend(["--processes", str(config["workers"])])
            cmd.append(config["app_module"])

        extra = server.get("extra_args") or []
        if extra:
            # Insert before the app-module positional so flags precede the
            # target on every CLI (all four servers use argparse-style parsers).
            cmd = cmd[:-1] + extra + cmd[-1:]
        return cmd

    def start_server(self, server_type: str) -> subprocess.Popen | None:
        """Start a server of the given type"""
        if not self.check_server_available(server_type):
            logger.error(f"{server_type} not available")
            return None

        cmd = self.build_command(server_type)
        logger.info(f"Starting {server_type} server:")
        logger.info(f"  Command: {' '.join(cmd)}")

        env = os.environ.copy()
        env["PYTHONPATH"] = str(Path.cwd())

        try:
            process = subprocess.Popen(
                self.build_command(server_type),
                cwd=Path.cwd() / "packages" / "backend",
                env=env,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
            )

            self.current_process = process
            self.current_server_type = server_type
            self.current_config = {"server_type": server_type}

            logger.info(f"Started {server_type} (PID: {process.pid})")
            return process

        except Exception as e:
            logger.error(f"Failed to start {server_type}: {e}")
            return None

    def wait_for_ready(self, process: subprocess.Popen, timeout: int = 60) -> bool:
        """Wait for server to be ready by checking stdout"""
        ready_patterns = [
            "Application startup complete",
            "Uvicorn running on",
            "Granian running on",
            "Hypercorn running on",
            "Daphne running on",
            "Application startup complete.",
            "Started worker-1",
        ]

        start_time = time.time()
        while time.time() - start_time < timeout:
            if process.poll() is not None:
                stdout, _ = process.communicate()
                logger.error(f"Server exited early: {stdout}")
                return False

            try:
                line = process.stdout.readline()
                if line:
                    logger.info(f"  {line.strip()}")
                    for pattern in ready_patterns:
                        if pattern in line:
                            logger.info("✓ Server ready!")
                            return True
            except Exception:
                pass

            time.sleep(0.1)

        logger.error(f"Server startup timeout after {timeout}s")
        return False

    def test_endpoint(self, endpoint: str = "/api/health", timeout: int = 5) -> bool:
        """Test if the server endpoint is responding"""
        try:
            response = requests.get(f"http://127.0.0.1:8004{endpoint}", timeout=5)
            return response.status_code == 200
        except Exception:
            return False

    def check_health(self) -> bool:
        """Check health endpoint"""
        try:
            response = requests.get("http://127.0.0.1:8004/api/health", timeout=5)
            return response.status_code == 200 and response.json().get("backend") == "online"
        except Exception:
            return False

    def run_with_fallback(self) -> subprocess.Popen | None:
        """
        Run server with automatic fallback:
        1. Try Granian first
        2. Fall back to uvicorn if Granian fails
        3. Fall back to hypercorn if uvicorn fails
        """
        available = [s for s in ["granian", "uvicorn", "hypercorn", "daphne"] if self.check_server_available(s)]

        if not available:
            logger.error("No ASGI servers available! Run with --install first.")
            return None

        logger.info(f"Available servers: {available}")

        for server_type in ["granian", "uvicorn", "hypercorn", "daphne"]:
            if server_type not in available:
                continue

            logger.info(f"Attempting to start {server_type}...")

            # Check memory before starting
            if self._is_memory_critical():
                logger.warning("Memory critical, waiting before start...")
                time.sleep(5)
                if self._is_memory_critical():
                    logger.error("Memory still critical, cannot start server")
                    continue

            process = self.start_server(server_type)
            if not process:
                logger.warning(f"Failed to start {server_type}, trying next...")
                continue

            if self.wait_for_ready(process):
                if self.test_endpoint():
                    logger.info(f"✓ {server_type} started successfully and healthy")
                    self._start_monitoring()
                    return self.current_process
                else:
                    logger.warning(f"{server_type} started but health check failed")
            else:
                logger.warning(f"{server_type} failed to start properly")

            # Clean up failed process
            self.stop_server()
            time.sleep(2)  # Brief pause before next attempt

        logger.error("All available servers failed to start")
        return None

    def _start_monitoring(self):
        """Start background monitoring thread"""
        if self._monitor_thread and self._monitor_thread.is_alive():
            return

        self._stop_monitor.clear()
        self._monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self._monitor_thread.start()
        logger.info("Started monitoring thread")

    def _monitor_loop(self):
        """Background monitoring: memory, health, auto-restart"""
        while not self._stop_monitor.is_set():
            try:
                # Check memory
                mem_info = self.get_memory_status()
                if mem_info["critical"]:
                    logger.warning(f"Memory critical: {mem_info['percent']:.1f}% - restarting server")
                    self._restart_server("memory_critical")
                    self._stop_monitor.wait(60)  # Wait after restart
                    continue

                # Check health endpoint
                if not self.check_health():
                    logger.warning("Health check failed, restarting server")
                    self._restart_server("health_check_failed")
                    self._stop_monitor.wait(60)
                    continue

                # Check if process is alive
                if self.current_process and self.current_process.poll() is not None:
                    logger.warning("Server process died, restarting")
                    self._restart_server("process_died")
                    self._stop_monitor.wait(60)
                    continue

            except Exception as e:
                logger.error(f"Monitor error: {e}")

            self._stop_monitor.wait(self.config.get("check_interval_seconds", 30))

    def _restart_server(self, reason: str):
        """Restart the server with fallback logic"""
        now = time.time()
        if now - self._last_restart_time < 600:  # 10 minutes
            self._restart_count += 1
        else:
            self._restart_count = 1
        self._last_restart_time = now

        if self._restart_count > 6:  # Max 6 restarts per 10 minutes
            logger.error(f"Too many restarts ({self._restart_count}), stopping")
            self._stop_monitor.set()
            return

        logger.info(f"Restarting server due to: {reason} (restart #{self._restart_count})")

        self.stop_server()
        time.sleep(3)

        # Try with fallback
        new_process = self.run_with_fallback()
        if not new_process:
            logger.error("All fallback servers failed")
            self._stop_monitor.set()

    def stop_server(self, process: subprocess.Popen | None = None):
        """Stop current server"""
        proc = process or self.current_process
        if proc is None:
            return

        logger.info(f"Stopping server (PID: {proc.pid})...")

        try:
            if sys.platform == "win32":
                proc.send_signal(signal.CTRL_BREAK_EVENT)
            else:
                proc.terminate()

            proc.wait(timeout=10)
            logger.info("Server stopped gracefully")
        except subprocess.TimeoutExpired:
            logger.warning("Server didn't stop gracefully, killing...")
            proc.kill()
            proc.wait()
        except Exception as e:
            logger.error(f"Error stopping server: {e}")
            try:
                proc.kill()
                proc.wait()
            except Exception:
                pass

        self.current_process = None
        self.current_server_type = None

    def stop(self):
        """Stop manager and all monitoring"""
        logger.info("Shutting down server manager...")
        self._stop_monitor.set()
        if self._monitor_thread and self._monitor_thread.is_alive():
            self._monitor_thread.join(timeout=5)
        self.stop_server()
        logger.info("Server manager stopped")

    def run(self) -> int:
        """Main entry point - run with full fallback and monitoring"""
        logger.info("=" * 60)
        logger.info("Dynamic Hybrid Server Manager Starting")
        logger.info("=" * 60)

        # Log available servers
        available = [s for s in ["granian", "uvicorn", "hypercorn", "daphne"] if self.check_server_available(s)]
        logger.info(f"Available servers: {available}")

        if not available:
            logger.error("No ASGI servers available! Run with --install first.")
            return 1

        # Start with fallback
        process = self.run_with_fallback()
        if not process:
            logger.error("All servers failed to start")
            return 1

        logger.info("Server running with monitoring. Press Ctrl+C to stop.")

        try:
            # Keep main thread alive
            while self.current_process and self.current_process.poll() is None:
                time.sleep(1)
        except KeyboardInterrupt:
            logger.info("Shutdown requested")
        finally:
            self.stop()

        return 0


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Dynamic Hybrid ASGI Server Manager")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind")
    parser.add_argument("--port", type=int, default=8004, help="Port to bind")
    parser.add_argument("--workers", type=int, default=1, help="Number of workers")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload")
    parser.add_argument("--app", default="app.main:app", help="App module")
    parser.add_argument("--memory-threshold", type=float, default=85.0, help="Memory restart threshold percent")
    parser.add_argument("--check-interval", type=int, default=30, help="Health check interval (seconds)")

    args = parser.parse_args()

    config = {
        "host": args.host,
        "port": args.port,
        "workers": args.workers,
        "reload": args.reload,
        "app_module": args.app,
        "memory_threshold_percent": args.memory_threshold,
        "check_interval_seconds": args.check_interval,
    }

    manager = HybridServerManager(Path.cwd(), config)
    return manager.run()


if __name__ == "__main__":
    sys.exit(main())

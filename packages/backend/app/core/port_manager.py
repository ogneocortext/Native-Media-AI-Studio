"""
Dynamic port manager - handles port discovery and assignment.
Avoids conflicts with other running services.
Implements the dynamic port resolution system per Guidelines.md section 4.1.
"""
import asyncio
import json
import logging
import os
import socket
import subprocess
import sys
from pathlib import Path
from typing import Any

from .config import PROJECT_ROOT, config

logger = logging.getLogger(__name__)

CONFIG_DIR = PROJECT_ROOT / "config"


class PortManager:
    """
    Manages dynamic port assignment for the application.
    Detects conflicts and reassigns ports when needed.
    """

    def __init__(self):
        self._config_file: Path = CONFIG_DIR / "ports.json"
        self._state_file: Path = PROJECT_ROOT / "storage" / "ports.json"
        self._ports: dict[str, int] = {}
        self._resolved_config: dict[str, Any] = {}

        # Ensure directories exist
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        self._state_file.parent.mkdir(parents=True, exist_ok=True)

        self._load_state()

    def _load_state(self):
        """Load saved port state from storage"""
        if self._state_file.exists():
            try:
                with open(self._state_file) as f:
                    self._ports = json.load(f)
            except Exception:
                self._ports = {}

    def _save_state(self):
        """Save port state to storage"""
        with open(self._state_file, 'w') as f:
            json.dump(self._ports, f, indent=2)

    def is_port_available(self, port: int, host: str = "127.0.0.1") -> bool:
        """Check if a port is available"""
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.settimeout(1)
                result = sock.connect_ex((host, port))
                return result != 0  # Non-zero means port is available (connection refused)
        except Exception:
            return False  # Error means we couldn't check - assume unavailable

    def find_available_port(self, start_port: int, max_attempts: int = 10) -> int:
        """Find an available port starting from start_port"""
        for offset in range(max_attempts):
            port = start_port + offset
            if self.is_port_available(port):
                return port
        raise RuntimeError(f"No available ports found from {start_port}")

    def cleanup_orphaned_processes(self, port: int) -> bool:
        """
        Kill orphaned Python processes from previous crashes that are
        holding the specified port.

        Never kills the current process (the running server owns the port
        once uvicorn has bound it - killing it would terminate the backend).

        Returns True if any process was killed, False otherwise.
        """
        killed = False
        own_pid = os.getpid()
        try:
            # Use netstat to find processes on the port
            result = subprocess.run(
                ['netstat', '-ano'],
                capture_output=True,
                text=True,
                timeout=10,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
            )

            for line in result.stdout.split('\n'):
                if f":{port}" in line and "LISTENING" in line:
                    parts = line.split()
                    if len(parts) >= 5:
                        try:
                            pid = int(parts[-1])
                            if pid == own_pid:
                                continue  # never kill ourselves
                            # Check if it's a Python process
                            if self._is_python_process(pid):
                                logger.warning("Killing orphaned Python process (PID: %d) on port %d", pid, port)
                                self._kill_process(pid)
                                killed = True
                        except (ValueError, IndexError):
                            pass

        except subprocess.TimeoutExpired:
            logger.warning(f"Timeout while checking port {port}")
        except Exception as e:
            logger.error(f"Error cleaning up port {port}: {e}")

        return killed

    def _is_python_process(self, pid: int) -> bool:
        """Check if the process is a Python process"""
        try:
            # Get process name on Windows
            result = subprocess.run(
                ['tasklist', '/FI', f'PID eq {pid}', '/FO', 'CSV', '/NH'],
                capture_output=True,
                text=True,
                timeout=5,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
            )

            if result.returncode == 0:
                process_info = result.stdout.strip().lower()
                # Check for python.exe or pythonw.exe
                return 'python' in process_info

            # Fallback: try wmic
            result = subprocess.run(
                ['wmic', 'process', 'where', f'ProcessId={pid}', 'get', 'name'],
                capture_output=True,
                text=True,
                timeout=5,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
            )

            if result.returncode == 0:
                return 'python' in result.stdout.lower()

        except Exception:
            pass

        return True  # Be conservative and assume it might be Python

    def _kill_process(self, pid: int):
        """Kill a process by PID"""
        try:
            subprocess.run(
                ['taskkill', '/PID', str(pid), '/F'],
                capture_output=True,
                timeout=5,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
            )
        except Exception as e:
            logger.warning(f"Failed to kill process {pid}: {e}")

    async def resolve_port(self, service: str, default_port: int) -> int:
        """
        Resolve the port for a service following the dynamic port resolution logic:
        1. Try default port first
        2. If occupied, try to kill orphaned Python processes
        3. If still occupied, find next available port
        """
        # Step 1: Try default port first
        if self.is_port_available(default_port):
            self._ports[service] = default_port
            self._save_state()
            return default_port

        # Step 2: Port is occupied - try to cleanup orphaned Python processes
        logger.info(f"Port {default_port} is occupied, attempting to clean up orphaned processes...")
        if self.cleanup_orphaned_processes(default_port):
            # Give the system a moment to release the port
            await asyncio.sleep(0.5)

            # Check again after cleanup
            if self.is_port_available(default_port):
                self._ports[service] = default_port
                self._save_state()
                return default_port

        # Step 3: Port still occupied - find next available port
        logger.info(f"Port {default_port} still occupied, finding available port...")
        new_port = self.find_available_port(default_port)
        self._ports[service] = new_port
        self._save_state()

        if new_port != default_port:
            logger.info(f"Assigned {service} to port {new_port} (default {default_port} was unavailable)")

        return new_port

    async def check_and_reserve(self, service: str, default_port: int) -> int:
        """Check if port is available, reassign if needed (legacy method)"""
        return await self.resolve_port(service, default_port)

    def get_port(self, service: str) -> int | None:
        """Get the assigned port for a service"""
        return self._ports.get(service)

    def set_port(self, service: str, port: int):
        """Manually set a port for a service"""
        self._ports[service] = port
        self._save_state()

    async def resolve_all_ports(self) -> dict[str, Any]:
        """
        Resolve all required ports and write the configuration to config/ports.json.
        Returns the full resolved port configuration.
        """
        # Resolve backend port (WebSocket runs on same port)
        backend_port = await self.resolve_port("backend", config.backend_port)

        # Frontend port is typically handled by Vite, but we store the default
        frontend_port = config.frontend_port

        # Build the resolved configuration
        # Canonical realtime transport is SSE at /api/events (EventSource).
        # WebSocket at /ws is a compatibility shim (same port as backend).
        ws_url = f"ws://localhost:{backend_port}/ws"
        events_url = f"http://localhost:{backend_port}/api/events"
        self._resolved_config = {
            "frontend_port": frontend_port,
            "backend_port": backend_port,
            # Legacy alias — prefer `events_url` / `sse_url`
            "ws_port": backend_port,
            "ws_url": ws_url,
            # Canonical
            "events_url": events_url,
            "sse_url": events_url,
        }

        # Write to config/ports.json for frontend consumption
        self.write_ports_config()

        return self._resolved_config

    def write_ports_config(self) -> None:
        """Write the resolved port configuration to config/ports.json.

        Preserves any extra keys already present in the file (e.g.
        ``comfyui_url``, ``comfyui_port``, ``video_editor_port``) so that
        frontend consumers don't lose them when the backend refreshes the file.
        """
        if not self._resolved_config:
            raise RuntimeError("No resolved configuration. Call resolve_all_ports() first.")

        CONFIG_DIR.mkdir(parents=True, exist_ok=True)

        # Start with whatever the file currently has so unrelated fields survive.
        merged: dict[str, Any] = {}
        if self._config_file.exists():
            try:
                with open(self._config_file) as f:
                    existing = json.load(f)
                    if isinstance(existing, dict):
                        merged.update(existing)
            except Exception:
                pass

        merged.update(self._resolved_config)

        # newline="\n" keeps the file LF-only so we don't churn a tracked,
        # LF-committed file with CRLF byte changes on every backend boot.
        with open(self._config_file, 'w', newline="\n") as f:
            json.dump(merged, f, indent=2)
            f.write("\n")

        logger.info(f"Port configuration written to {self._config_file}")

    def set_default_config(self) -> dict[str, Any]:
        """Record the currently-bound default ports and build a resolved config.

        Used by `app.main.lifespan` when the server was started directly via
        `uvicorn app.main:app` (no pre-resolution in ``run()``). At that point
        uvicorn has already bound ``config.backend_port``, so re-running the
        dynamic resolution would see the port "occupied" by ourselves.
        """
        backend_port = config.backend_port
        ws_url = f"ws://localhost:{backend_port}/ws"
        events_url = f"http://localhost:{backend_port}/api/events"
        self._resolved_config = {
            "frontend_port": config.frontend_port,
            "backend_port": backend_port,
            # Legacy alias — prefer `events_url` / `sse_url`
            "ws_port": backend_port,
            "ws_url": ws_url,
            # Canonical
            "events_url": events_url,
            "sse_url": events_url,
        }
        self.write_ports_config()
        return self._resolved_config

    def get_resolved_config(self) -> dict[str, Any]:
        """Get the resolved port configuration"""
        return self._resolved_config

    async def cleanup_processes(self, port: int) -> bool:
        """
        Attempt to clean up processes on a port.
        Returns True if successful.
        NOTE: This is a legacy method - use cleanup_orphaned_processes() instead.
        """
        return self.cleanup_orphaned_processes(port)


# Global port manager instance
port_manager = PortManager()

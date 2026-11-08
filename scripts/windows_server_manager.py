#!/usr/bin/env python3
"""
Windows-Compatible ASGI Server Manager
Supports multiple ASGI servers with automatic fallback and Windows-optimized configurations.
"""

import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import ClassVar


class ServerType(Enum):
    GRANIAN = "granian"      # Rust-based, best Windows performance
    HYPERCORN = "hypercorn"  # Pure Python, HTTP/2/3 support
    UVICORN = "uvicorn"      # Standard ASGI, Windows compatible but multiprocess issues
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
    loop_type: str = "auto"  # auto, asyncio, uvloop, winloop, rloop

    def to_command(self) -> list[str]:
        """Generate command line arguments"""
        cmd = []

        if self.server_type == ServerType.GRANIAN:
            cmd = ["granian", "--interface", "asgi"]
            if self.reload:
                cmd.append("--reload")
            cmd.extend(["--host", self.host, "--port", str(self.port)])
            if self.workers > 1:
                cmd.extend(["--workers", str(self.workers)])
            cmd.append(self.app_module)

        elif self.server_type == ServerType.HYPERCORN:
            cmd = ["hypercorn"]
            cmd.extend(["--bind", f"{self.host}:{self.port}"])
            if self.workers > 1:
                cmd.extend(["--workers", str(self.workers)])
            if self.reload:
                cmd.append("--reload")
            cmd.append(self.app_module)

        elif self.server_type == ServerType.UVICORN:
            cmd = ["uvicorn"]
            if self.reload:
                cmd.append("--reload")
            cmd.extend(["--host", self.host, "--port", str(self.port)])
            if self.workers > 1:
                cmd.extend(["--workers", str(self.workers)])
            # Windows: use spawn (default), avoid multiprocess issues
            if self.workers > 1:
                cmd.append("--no-access-log")  # Reduce overhead
            cmd.append(self.app_module)

        elif self.server_type == ServerType.DAPHNE:
            cmd = ["daphne"]
            cmd.extend(["-b", self.host, "-p", str(self.port)])
            if self.workers > 1:
                cmd.extend(["--processes", str(self.workers)])
            cmd.append(self.app_module)

        cmd.extend(self.extra_args)
        return cmd


class WindowsServerManager:
    """Manages ASGI servers with Windows-optimized configurations"""

    # Priority order for Windows (best to worst)
    SERVER_PRIORITY: ClassVar[list[ServerType]] = [
        ServerType.GRANIAN,    # Best: Rust, native Windows, single binary
        ServerType.HYPERCORN,  # Good: Pure Python, HTTP/2/3, Windows native
        ServerType.UVICORN,    # Standard: Works but multiprocess issues
        ServerType.DAPHNE,     # Fallback: Django Channels server
    ]

    def __init__(self, project_root: Path):
        self.project_root = project_root
        self.backend_dir = project_root / "packages" / "backend"
        self.current_process: subprocess.Popen | None = None
        self.current_server: ServerType | None = None

    def check_server_available(self, server_type: ServerType) -> bool:
        """Check if a server is installed and available"""
        try:
            if server_type == ServerType.GRANIAN:
                result = subprocess.run(["granian", "--version"], capture_output=True, timeout=5)
            elif server_type == ServerType.HYPERCORN:
                result = subprocess.run(["hypercorn", "--version"], capture_output=True, timeout=5)
            elif server_type == ServerType.UVICORN:
                result = subprocess.run(["uvicorn", "--version"], capture_output=True, timeout=5)
            elif server_type == ServerType.DAPHNE:
                result = subprocess.run(["daphne", "--version"], capture_output=True, timeout=5)
            else:
                return False
            return result.returncode == 0
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return False

    def get_available_servers(self) -> list[ServerType]:
        """Get list of available servers in priority order"""
        return [s for s in self.SERVER_PRIORITY if self.check_server_available(s)]

    def get_best_server(self) -> ServerType | None:
        """Get the best available server for Windows"""
        available = self.get_available_servers()
        return available[0] if available else None

    def create_server_config(self, server_type: ServerType, **kwargs) -> ServerConfig:
        """Create optimized config for a server type on Windows"""
        config = ServerConfig(
            server_type=server_type,
            **kwargs
        )

        # Windows-specific optimizations
        if config.windows_optimized:
            if server_type == ServerType.UVICORN:
                # Uvicorn on Windows: single worker avoids multiprocess issues
                if config.workers > 1:
                    config.workers = 1
            elif server_type == ServerType.GRANIAN:
                # Granian handles workers natively on Windows
                pass
            elif server_type == ServerType.HYPERCORN:
                # Hypercorn handles workers on Windows
                pass

        return config

    def start_server(self, config: ServerConfig) -> subprocess.Popen:
        """Start the server with the given configuration"""
        cmd = config.to_command()
        print(f"Starting {config.server_type.value} server:")
        print(f"  Command: {' '.join(cmd)}")
        print(f"  Working dir: {self.backend_dir}")

        # Set up environment
        env = os.environ.copy()
        env["PYTHONPATH"] = str(self.project_root)

        # Windows: use creation flags for proper process group handling
        creationflags = 0
        if sys.platform == "win32":
            creationflags = subprocess.CREATE_NEW_PROCESS_GROUP

        process = subprocess.Popen(
            cmd,
            cwd=self.backend_dir,
            env=env,
            creationflags=creationflags,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace"
        )

        self.current_process = process
        self.current_server = config.server_type
        return process

    def wait_for_ready(self, process: subprocess.Popen, timeout: int = 30) -> bool:
        """Wait for server to be ready by checking stdout for startup message"""
        start_time = time.time()
        ready_patterns = [
            "Application startup complete",
            "Uvicorn running on",
            "Granian running on",
            "Hypercorn running on",
            "Daphne running on",
            "Application startup complete.",
            "Started worker-1",  # Granian worker ready
        ]

        while time.time() - start_time < timeout:
            if process.poll() is not None:
                # Process exited
                stdout, _ = process.communicate()
                print(f"Server exited early: {stdout}")
                return False

            # Read available output
            try:
                line = process.stdout.readline()
                if line:
                    print(f"  {line.strip()}")
                    for pattern in ready_patterns:
                        if pattern in line:
                            print("  ✓ Server ready!")
                            return True
            except Exception:
                pass

            time.sleep(0.1)

        print(f"  ✗ Server startup timeout after {timeout}s")
        return False

    def test_endpoint(self, host: str, port: int, endpoint: str = "/api/health", timeout: int = 5) -> bool:
        """Test if the server endpoint is responding"""
        import requests
        url = f"http://{host}:{port}{endpoint}"
        try:
            response = requests.get(url, timeout=timeout)
            return response.status_code == 200
        except Exception:
            return False

    def stop_server(self, process: subprocess.Popen | None = None):
        """Stop the server gracefully"""
        proc = process or self.current_process
        if proc is None:
            return

        print(f"Stopping server (PID: {proc.pid})...")

        if sys.platform == "win32":
            # Windows: use CTRL_BREAK_EVENT for graceful shutdown
            try:
                proc.send_signal(signal.CTRL_BREAK_EVENT)
            except AttributeError:
                proc.terminate()
        else:
            proc.terminate()

        try:
            proc.wait(timeout=10)
            print("Server stopped gracefully")
        except subprocess.TimeoutExpired:
            print("Server didn't stop gracefully, killing...")
            proc.kill()
            proc.wait()
            print("Server killed")


def install_servers():
    """Install recommended servers for Windows"""
    servers = [
        ("granian", "granian"),
        ("hypercorn", "hypercorn[standard]"),
        ("uvicorn", "uvicorn[standard]"),
        ("daphne", "daphne"),
    ]

    for name, package in servers:
        print(f"Installing {name}...")
        try:
            subprocess.run([sys.executable, "-m", "pip", "install", package],
                         check=True, capture_output=True, text=True)
            print(f"  ✓ {name} installed")
        except subprocess.CalledProcessError as e:
            print(f"  ✗ {name} failed: {e.stderr}")


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Windows ASGI Server Manager")
    parser.add_argument("--install", action="store_true", help="Install recommended servers")
    parser.add_argument("--server", choices=["granian", "hypercorn", "uvicorn", "daphne", "auto"],
                       default="auto", help="Server to use")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind")
    parser.add_argument("--port", type=int, default=8004, help="Port to bind")
    parser.add_argument("--workers", type=int, default=1, help="Number of workers")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload")
    parser.add_argument("--app", default="app.main:app", help="App module")
    parser.add_argument("--test", action="store_true", help="Test endpoint after start")
    parser.add_argument("--timeout", type=int, default=30, help="Startup timeout")

    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent
    manager = WindowsServerManager(project_root)

    if args.install:
        install_servers()
        return

    # Determine server
    if args.server == "auto":
        server_type = manager.get_best_server()
        if not server_type:
            print("No servers available! Run with --install first.")
            return
        print(f"Auto-selected: {server_type.value}")
    else:
        server_type = ServerType(args.server)
        if not manager.check_server_available(server_type):
            print(f"{server_type.value} not installed! Run with --install")
            return

    # Create config
    config = manager.create_server_config(
        server_type,
        host=args.host,
        port=args.port,
        workers=args.workers,
        reload=args.reload,
        app_module=args.app,
    )

    # Start server
    process = manager.start_server(config)

    # Wait for ready
    if manager.wait_for_ready(process, timeout=args.timeout):
        print("✓ Server started successfully")

        if args.test:
            print("Testing endpoint...")
            if manager.test_endpoint(args.host, args.port):
                print("✓ Endpoint responding")
            else:
                print("✗ Endpoint not responding")
    else:
        print("✗ Server failed to start")
        return

    # Keep running
    print("\nServer running. Press Ctrl+C to stop.")
    try:
        process.wait()
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        manager.stop_server(process)


if __name__ == "__main__":
    main()

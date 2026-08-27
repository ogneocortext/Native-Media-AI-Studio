"""
ComfyUI process manager.
Handles starting, stopping, and updating ComfyUI headlessly.
"""

import asyncio
import logging
import os
import subprocess
import sys
import time
from pathlib import Path

import aiohttp

from ..core.config import PROJECT_ROOT

logger = logging.getLogger(__name__)

# ComfyUI lives beside the repo root (sibling directory), e.g.
# "D:\\Backup of Important Data for Windows 11 Upgrade\\ComfyUI".
COMFYUI_DIR = PROJECT_ROOT.parent / "ComfyUI"
COMFYUI_MAIN = COMFYUI_DIR / "main.py"
DEFAULT_PORT = 8188

# Use the main project venv which has compatible PyTorch+CUDA
VENV_PYTHON = PROJECT_ROOT / "venv" / "Scripts" / "python.exe"
if not VENV_PYTHON.exists():
    # Fall back to backend venv
    VENV_PYTHON = PROJECT_ROOT / "runtime" / "venvs" / ".venvs" / "venv_backend" / "Scripts" / "python.exe"

# Extra args for compatibility with GTX 10-series GPUs
EXTRA_ARGS = ["--disable-pinned-memory"]

# Git executable path (Windows typically installs to C:\Program Files\Git\cmd\git.exe)
GIT_EXECUTABLE = "git"
# Common git locations on Windows
_GIT_PATHS = [
    r"C:\Program Files\Git\cmd\git.exe",
    r"C:\Program Files (x86)\Git\cmd\git.exe",
    r"C:\Git\cmd\git.exe",
]


def _find_git() -> str:
    """Find the git executable on the system."""
    # First try the PATH
    try:
        result = subprocess.run(
            ["git", "--version"],
            capture_output=True,
            timeout=5,
        )
        if result.returncode == 0:
            return "git"
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    # Try common locations
    for path in _GIT_PATHS:
        if os.path.isfile(path):
            return path

    return "git"  # Fallback to PATH


class ComfyUIManager:
    """Manages the ComfyUI process lifecycle."""

    def __init__(self):
        self._process: subprocess.Popen | None = None
        self._port = DEFAULT_PORT
        self._start_time: float | None = None

    def is_installed(self) -> bool:
        """Check if ComfyUI is installed."""
        return COMFYUI_DIR.exists() and COMFYUI_MAIN.exists()

    def is_running(self) -> bool:
        """Check if ComfyUI is running (either managed or external)."""
        # Check if we started the process
        if self._process is not None:
            return self._process.poll() is None
        
        # Also check if ComfyUI is running on the port (external process)
        try:
            import urllib.request
            req = urllib.request.Request(f"http://127.0.0.1:{self._port}/system_stats")
            with urllib.request.urlopen(req, timeout=2) as resp:
                return resp.status == 200
        except Exception:
            return False

    def get_version(self) -> dict:
        """Get ComfyUI version info from git."""
        if not self.is_installed():
            return {"installed": False}

        result = {"installed": True, "path": str(COMFYUI_DIR)}

        try:
            # Get current commit
            commit = subprocess.run(
                ["git", "log", "--oneline", "-1"],
                capture_output=True, text=True, cwd=str(COMFYUI_DIR)
            )
            if commit.returncode == 0:
                result["commit"] = commit.stdout.strip()

            # Get tag/describe
            describe = subprocess.run(
                ["git", "describe", "--tags", "--always"],
                capture_output=True, text=True, cwd=str(COMFYUI_DIR)
            )
            if describe.returncode == 0:
                result["version"] = describe.stdout.strip()

            # Get branch
            branch = subprocess.run(
                ["git", "branch", "--show-current"],
                capture_output=True, text=True, cwd=str(COMFYUI_DIR)
            )
            if branch.returncode == 0:
                result["branch"] = branch.stdout.strip()

            # Check if behind remote
            subprocess.run(
                ["git", "fetch", "--quiet"],
                capture_output=True, cwd=str(COMFYUI_DIR)
            )
            ahead_behind = subprocess.run(
                ["git", "rev-list", "--left-right", "--count", "origin/master...HEAD"],
                capture_output=True, text=True, cwd=str(COMFYUI_DIR)
            )
            if ahead_behind.returncode == 0:
                parts = ahead_behind.stdout.strip().split("\t")
                if len(parts) == 2:
                    result["behind_remote"] = int(parts[0]) if parts[0].isdigit() else 0
                    result["ahead_of_remote"] = int(parts[1]) if parts[1].isdigit() else 0
                    result["up_to_date"] = result["behind_remote"] == 0

        except Exception as e:
            result["error"] = str(e)

        return result

    async def _check_cuda(self) -> dict:
        """Check if CUDA is available for ComfyUI.

        Returns:
            Dict with 'available' boolean and 'error' message if not available
        """
        try:
            python_exe = str(VENV_PYTHON) if VENV_PYTHON.exists() else sys.executable
            result = await asyncio.create_subprocess_exec(
                python_exe,
                "-c",
                "import torch; print('cuda_available:', torch.cuda.is_available()); print('device_count:', torch.cuda.device_count())",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await result.communicate()
            output = stdout.decode("utf-8", errors="replace").strip()

            if "cuda_available: True" in output:
                return {"available": True}
            else:
                error_msg = stderr.decode("utf-8", errors="replace").strip()[-200:]
                return {
                    "available": False,
                    "error": error_msg or "PyTorch CUDA not available",
                }
        except Exception as e:
            return {
                "available": False,
                "error": str(e),
            }

    async def start(self, port: int = DEFAULT_PORT, extra_args: list[str] | None = None) -> dict:
        """Start ComfyUI headlessly in the background.

        Args:
            port: Port to run ComfyUI on
            extra_args: Additional command-line arguments for ComfyUI

        Returns:
            Dict with status and message
        """
        if not self.is_installed():
            return {
                "success": False,
                "message": f"ComfyUI not installed at {COMFYUI_DIR}",
            }

        if self.is_running():
            return {
                "success": False,
                "message": f"ComfyUI is already running (PID {self._process.pid})",
            }

        # Check for CUDA availability first
        cuda_check = await self._check_cuda()
        if not cuda_check["available"]:
            return {
                "success": False,
                "message": "CUDA not available — ComfyUI requires an NVIDIA GPU with CUDA support",
                "detail": cuda_check["error"],
                "suggestion": "ComfyUI requires an NVIDIA GPU. Without CUDA, image generation will not work. You can still use other features like Music Video (FFmpeg), Audio Analysis, and Ollama.",
            }

        self._port = port

        # Build command
        python_exe = str(VENV_PYTHON) if VENV_PYTHON.exists() else sys.executable
        cmd = [
            python_exe, str(COMFYUI_MAIN),
            "--port", str(port),
            "--preview-method", "auto",
            "--lowvram",
        ]
        cmd.extend(EXTRA_ARGS)

        try:
            # Start headlessly (no window on Windows)
            startupinfo = None
            creation_flags = 0
            if sys.platform == "win32":
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                startupinfo.wShowWindow = 0  # SW_HIDE
                # CREATE_NEW_PROCESS_GROUP makes the child independent of parent
                creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP

            # Use subprocess.DEVNULL for stdout/stderr to prevent blocking
            self._process = subprocess.Popen(
                cmd,
                cwd=str(COMFYUI_DIR),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                startupinfo=startupinfo,
                creationflags=creation_flags,
            )
            self._start_time = time.time()

            # Wait a moment and check if it started successfully
            await asyncio.sleep(3)
            if self._process.poll() is not None:
                return {
                    "success": False,
                    "message": f"ComfyUI exited immediately (code {self._process.returncode})",
                    "hint": "Check that all required Python packages are installed in the venv",
                }

            return {
                "success": True,
                "message": f"ComfyUI started on port {port} (PID {self._process.pid})",
                "pid": self._process.pid,
                "port": port,
                "url": f"http://127.0.0.1:{port}",
            }

        except Exception as e:
            return {
                "success": False,
                "message": f"Failed to start ComfyUI: {str(e)}",
            }

    def stop(self) -> dict:
        """Stop the running ComfyUI process.

        Returns:
            Dict with status and message
        """
        if not self.is_running():
            return {
                "success": False,
                "message": "ComfyUI is not running",
            }

        try:
            pid = self._process.pid
            # Terminate the process
            self._process.terminate()

            # Wait up to 10 seconds for graceful shutdown
            try:
                self._process.wait(timeout=10)
                return {
                    "success": True,
                    "message": f"ComfyUI stopped (PID {pid})",
                    "pid": pid,
                }
            except subprocess.TimeoutExpired:
                # Force kill
                self._process.kill()
                self._process.wait(timeout=5)
                return {
                    "success": True,
                    "message": f"ComfyUI force-killed (PID {pid})",
                    "pid": pid,
                }

        except Exception as e:
            return {
                "success": False,
                "message": f"Error stopping ComfyUI: {str(e)}",
            }
        finally:
            self._process = None
            self._start_time = None

    async def update(self) -> dict:
        """Update ComfyUI via git pull.
        
        Uses ComfyUI's own git repository for updates.

        Returns:
            Dict with status and update details
        """
        logger.info("ComfyUI update requested")
        
        if not self.is_installed():
            logger.warning("ComfyUI not installed at %s", COMFYUI_DIR)
            return {
                "success": False,
                "message": f"ComfyUI not installed at {COMFYUI_DIR}",
            }

        was_running = self.is_running()
        logger.info("ComfyUI was_running=%s", was_running)

        # Stop if running
        if was_running:
            add_msg = " (was running, will restart)"
        else:
            add_msg = ""

        try:
            # Find git executable
            git_exe = _find_git()
            logger.info("Using git executable: %s", git_exe)

            # Check if git is available
            git_check = await asyncio.create_subprocess_exec(
                git_exe, "--version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await git_check.communicate()
            if git_check.returncode != 0:
                error_msg = stderr.decode("utf-8", errors="replace").strip()
                return {
                    "success": False,
                    "message": "Git is not available on this system",
                    "errors": error_msg,
                    "hint": "Install Git to enable ComfyUI updates",
                }

            # Check if this is a git repo
            git_dir = COMFYUI_DIR / ".git"
            if not git_dir.exists():
                return {
                    "success": False,
                    "message": "ComfyUI is not a git repository",
                    "hint": "Manual reinstallation required for updates",
                }

            # Git pull
            logger.info("Running git pull in %s", COMFYUI_DIR)
            # Build PATH with common git locations for Windows
            git_path_extra = r";C:\Program Files\Git\cmd;C:\Program Files\Git\mingw64\bin;C:\Program Files (x86)\Git\cmd"
            pull_result = await asyncio.create_subprocess_exec(
                git_exe, "pull",
                cwd=str(COMFYUI_DIR),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={**os.environ, "PATH": os.environ.get("PATH", "") + git_path_extra}
            )
            stdout, stderr = await pull_result.communicate()

            output = stdout.decode("utf-8", errors="replace").strip()
            errors = stderr.decode("utf-8", errors="replace").strip()

            logger.info("Git pull result: returncode=%d, output=%s", pull_result.returncode, output[:200])

            if pull_result.returncode != 0:
                return {
                    "success": False,
                    "message": "Git pull failed",
                    "output": output,
                    "errors": errors,
                    "hint": "Try resolving merge conflicts or run 'git pull' manually in the ComfyUI directory",
                }

            # Get new version info
            version = self.get_version()

            # Restart if it was running
            restart_result = None
            if was_running:
                restart = await self.start(port=self._port)
                restart_result = restart

            return {
                "success": True,
                "message": f"ComfyUI updated successfully{add_msg}",
                "output": output,
                "version": version,
                "was_running": was_running,
                "restarted": restart_result,
            }

        except FileNotFoundError as e:
            logger.error("Git not found: %s", e, exc_info=True)
            return {
                "success": False,
                "message": "Git executable not found",
                "errors": str(e),
                "hint": "Install Git and ensure it's in your system PATH",
            }
        except Exception as e:
            logger.error("Error updating ComfyUI: %s", e, exc_info=True)
            import traceback
            tb = traceback.format_exc()
            return {
                "success": False,
                "message": f"Error updating ComfyUI: {str(e)}",
                "errors": str(e),
                "traceback": tb,
                "hint": "Check the logs for more details",
            }

    def get_status(self) -> dict:
        """Get current ComfyUI status.

        Returns:
            Dict with status information
        """
        running = self.is_running()
        version = self.get_version()

        status = {
            "installed": self.is_installed(),
            "running": running,
            "port": self._port,
            "url": f"http://127.0.0.1:{self._port}",
            "version": version,
        }

        if running:
            status["pid"] = self._process.pid
            if self._start_time:
                status["uptime_seconds"] = round(time.time() - self._start_time, 1)

        return status

    async def generate_video(
        self,
        prompt: str,
        width: int,
        height: int,
        duration: int,
        section: str,
        audio_path: str,
    ) -> str | None:
        """Generate video via ComfyUI HTTP API. Returns path to output video or None."""
        base_url = f"http://127.0.0.1:{self._port}"

        # Use a single shared session for all requests in this method
        async with aiohttp.ClientSession() as session:
            # Check if ComfyUI is reachable
            try:
                async with session.get(f"{base_url}/system_stats", timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    if resp.status != 200:
                        logger.warning("ComfyUI not reachable")
                        return None
            except Exception as e:
                logger.warning(f"ComfyUI connection failed: {e}")
                return None

            # Build a simple text-to-video workflow using the /prompt endpoint
            # Uses a basic KSampler with a text prompt
            workflow = {
                "3": {
                    "class_type": "KSampler",
                    "inputs": {
                        "seed": 42,
                        "steps": 20,
                        "cfg": 7.0,
                        "sampler_name": "euler",
                        "scheduler": "normal",
                        "denoise": 1.0,
                        "model": ["4", 0],
                        "positive": ["6", 0],
                        "negative": ["7", 0],
                        "latent_image": ["5", 0],
                    },
                },
                "4": {
                    "class_type": "CheckpointLoaderSimple",
                    "inputs": {"ckpt_name": "model.safetensors"},
                },
                "5": {
                    "class_type": "EmptyLatentImage",
                    "inputs": {"width": width, "height": height, "batch_size": 1, "length": duration * 24},
                },
                "6": {
                    "class_type": "CLIPTextEncode",
                    "inputs": {"text": prompt, "clip": ["4", 1]},
                },
                "7": {
                    "class_type": "CLIPTextEncode",
                    "inputs": {"text": "blurry, bad quality, distorted", "clip": ["4", 1]},
                },
            }

            try:
                # Enqueue prompt
                payload = {
                    "prompt": workflow,
                    "extra_data": {},
                }
                async with session.post(
                    f"{base_url}/prompt",
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as resp:
                    if resp.status != 200:
                        logger.error(f"Failed to enqueue prompt: {resp.status}")
                        return None
                    result = await resp.json()
                    prompt_id = result.get("prompt_id")
                    if not prompt_id:
                        logger.error("No prompt_id returned")
                        return None

                # Poll for completion (max 10 minutes)
                max_polls = 120  # 120 * 5s = 10 minutes
                for _ in range(max_polls):
                    await asyncio.sleep(5)
                    async with session.get(
                        f"{base_url}/history/{prompt_id}",
                        timeout=aiohttp.ClientTimeout(total=10),
                    ) as resp:
                        if resp.status != 200:
                            continue
                        history = await resp.json()
                        if prompt_id in history:
                            outputs = history[prompt_id].get("outputs", {})
                            for node_id, output in outputs.items():
                                if "gifs" in output:
                                    for gif in output["gifs"]:
                                        video_path = gif.get("filename")
                                        if video_path:
                                            # Download the video
                                            async with session.get(
                                                f"{base_url}/view?filename={video_path}",
                                                timeout=aiohttp.ClientTimeout(total=60),
                                            ) as video_resp:
                                                if video_resp.status == 200:
                                                    data = await video_resp.read()
                                                    output_path = PROJECT_ROOT / "output" / "video" / f"{section}_{prompt_id[:8]}.mp4"
                                                    output_path.parent.mkdir(parents=True, exist_ok=True)
                                                    with open(output_path, "wb") as f:
                                                        f.write(data)
                                                    return str(output_path)
                logger.error("ComfyUI generation timed out")
                return None
            except Exception as e:
                logger.error(f"ComfyUI generation failed: {e}")
                return None


# Global instance
comfyui_manager = ComfyUIManager()

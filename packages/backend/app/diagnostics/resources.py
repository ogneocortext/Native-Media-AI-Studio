"""
Resource monitoring and warning system.
Monitors VRAM, system memory, and disk usage, broadcasting warnings via SSE.
"""

import asyncio
import logging
from dataclasses import dataclass
from enum import Enum
from typing import Any

import psutil

from ..sse.handler import sse_manager

logger = logging.getLogger(__name__)


class ResourceType(str, Enum):
    """Types of resources to monitor"""
    MEMORY = "memory"
    VRAM = "vram"
    DISK = "disk"


class WarningLevel(str, Enum):
    """Severity levels for resource warnings"""
    WARNING = "warning"
    CRITICAL = "critical"


@dataclass
class ResourceThresholds:
    """Thresholds for resource warnings"""
    # Memory thresholds (percentage)
    memory_warning: float = 80.0
    memory_critical: float = 90.0

    # Disk thresholds (percentage)
    disk_warning: float = 85.0
    disk_critical: float = 95.0

    # VRAM thresholds (percentage) - for GTX 1070 Ti with 8GB
    # High VRAM usage alone is often just desktop compositor + driver caching;
    # warn on usage level but only raise critical when usage is extreme AND
    # the GPU is actually under heavy compute load.
    vram_warning: float = 92.0
    vram_critical: float = 98.0

    # GPU compute utilization (%) that must accompany high VRAM for a
    # critical VRAM warning (avoids false positives from idle desktop GPU).
    vram_critical_utilization: float = 70.0

    # GPU temperature (C) at which VRAM warning is escalated to critical
    vram_critical_temperature: float = 85.0


class ResourceMonitor:
    """
    Monitors system resources and broadcasts warnings via SSE.
    Implements system.resource_warning per Guidelines.md section 3.2.
    """

    def __init__(self, thresholds: ResourceThresholds | None = None):
        self.thresholds = thresholds or ResourceThresholds()
        self._last_warnings: dict[ResourceType, WarningLevel] = {}
        self._gpustat_available = False
        self._nvml_available = False

        # Try to import GPU monitoring libraries
        self._init_gpu_monitoring()

    def _init_gpu_monitoring(self):
        """Initialize GPU monitoring if libraries are available"""
        # Try gpustat first (easier to use)
        try:
            import gpustat
            self._gpustat_available = True
            logger.info("GPU monitoring enabled via gpustat")
        except ImportError:
            pass

        # Always initialize NVML as fallback/for snapshots (even if gpustat available)
        try:
            import pynvml
            pynvml.nvmlInit()
            self._nvml_available = True
            if not self._gpustat_available:
                logger.info("GPU monitoring enabled via pynvml")
        except (ImportError, Exception) as e:
            if not self._gpustat_available:
                logger.warning(f"GPU monitoring not available: {e}")

    async def check_memory(self) -> dict[str, Any] | None:
        """Check system memory usage"""
        mem = psutil.virtual_memory()

        if mem.percent >= self.thresholds.memory_critical:
            return {
                "type": ResourceType.MEMORY,
                "level": WarningLevel.CRITICAL,
                "message": f"System memory critical: {mem.percent:.1f}% used",
                "current_value": mem.percent,
                "threshold": self.thresholds.memory_critical,
                "unit": "percent"
            }
        elif mem.percent >= self.thresholds.memory_warning:
            return {
                "type": ResourceType.MEMORY,
                "level": WarningLevel.WARNING,
                "message": f"System memory high: {mem.percent:.1f}% used",
                "current_value": mem.percent,
                "threshold": self.thresholds.memory_warning,
                "unit": "percent"
            }
        return None

    async def check_disk(self) -> dict[str, Any] | None:
        """Check disk usage"""
        try:
            disk = psutil.disk_usage('.')
            percent = disk.percent

            if percent >= self.thresholds.disk_critical:
                return {
                    "type": ResourceType.DISK,
                    "level": WarningLevel.CRITICAL,
                    "message": f"Disk space critical: {percent:.1f}% used",
                    "current_value": percent,
                    "threshold": self.thresholds.disk_critical,
                    "unit": "percent"
                }
            elif percent >= self.thresholds.disk_warning:
                return {
                    "type": ResourceType.DISK,
                    "level": WarningLevel.WARNING,
                    "message": f"Disk space low: {percent:.1f}% used",
                    "current_value": percent,
                    "threshold": self.thresholds.disk_warning,
                    "unit": "percent"
                }
        except Exception as e:
            logger.warning(f"Failed to check disk usage: {e}")

        return None

    async def check_vram(self) -> dict[str, Any] | None:
        """Check VRAM usage if GPU monitoring is available"""
        if not self._gpustat_available and not self._nvml_available:
            return None

        try:
            if self._gpustat_available:
                return await self._check_vram_gpustat()
            elif self._nvml_available:
                return await self._check_vram_nvml()
        except Exception as e:
            logger.warning(f"Failed to check VRAM: {e}")

        return None

    async def _check_vram_gpustat(self) -> dict[str, Any] | None:
        """Check VRAM using gpustat. Only raises critical when VRAM is extreme
        AND the GPU is under heavy compute load or high temperature."""
        import gpustat

        stats = gpustat.GPUStatCollection.new_query()
        if not stats.gpus:
            return None

        # Check primary GPU (index 0)
        gpu = stats.gpus[0]
        memory_used = gpu.memory_used
        memory_total = gpu.memory_total

        if memory_total == 0:
            return None

        percent = (memory_used / memory_total) * 100

        if percent < self.thresholds.vram_warning:
            return None

        # gpustat provides utilization and temperature alongside memory.
        gpu_util = getattr(gpu, 'utilization', 0) or 0
        temperature = getattr(gpu, 'temperature', 0) or 0

        # Only escalate to critical if VRAM is extreme AND GPU is busy or hot.
        is_critical = (
            percent >= self.thresholds.vram_critical
            and (
                gpu_util >= self.thresholds.vram_critical_utilization
                or temperature >= self.thresholds.vram_critical_temperature
            )
        )

        if is_critical:
            return {
                "type": ResourceType.VRAM,
                "level": WarningLevel.CRITICAL,
                "message": f"VRAM critical: {memory_used}MB / {memory_total}MB ({percent:.1f}%), GPU {gpu_util}%, {temperature}C",
                "current_value": percent,
                "threshold": self.thresholds.vram_critical,
                "unit": "percent",
                "details": {
                    "used_mb": memory_used,
                    "total_mb": memory_total,
                    "gpu_utilization": gpu_util,
                    "temperature_c": temperature,
                }
            }
        elif percent >= self.thresholds.vram_warning:
            return {
                "type": ResourceType.VRAM,
                "level": WarningLevel.WARNING,
                "message": f"VRAM high: {memory_used}MB / {memory_total}MB ({percent:.1f}%), GPU {gpu_util}%, {temperature}C",
                "current_value": percent,
                "threshold": self.thresholds.vram_warning,
                "unit": "percent",
                "details": {
                    "used_mb": memory_used,
                    "total_mb": memory_total,
                    "gpu_utilization": gpu_util,
                    "temperature_c": temperature,
                }
            }
        return None

    async def _check_vram_nvml(self) -> dict[str, Any] | None:
        """Check VRAM using pynvml. Only raises critical when VRAM is extreme
        AND the GPU is under heavy compute load or high temperature."""
        import pynvml

        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        info = pynvml.nvmlDeviceGetMemoryInfo(handle)

        memory_used = info.used // (1024 * 1024)  # Convert to MB
        memory_total = info.total // (1024 * 1024)

        if memory_total == 0:
            return None

        percent = (memory_used / memory_total) * 100

        if percent < self.thresholds.vram_warning:
            return None

        # Gather compute utilization and temperature to decide severity.
        try:
            util = pynvml.nvmlDeviceGetUtilizationRates(handle)
            gpu_util = util.gpu
        except Exception:
            gpu_util = 0

        try:
            temperature = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
        except Exception:
            temperature = 0

        # Only escalate to critical if VRAM is extreme AND GPU is busy or hot.
        is_critical = (
            percent >= self.thresholds.vram_critical
            and (
                gpu_util >= self.thresholds.vram_critical_utilization
                or temperature >= self.thresholds.vram_critical_temperature
            )
        )

        if is_critical:
            return {
                "type": ResourceType.VRAM,
                "level": WarningLevel.CRITICAL,
                "message": f"VRAM critical: {memory_used}MB / {memory_total}MB ({percent:.1f}%), GPU {gpu_util}%, {temperature}C",
                "current_value": percent,
                "threshold": self.thresholds.vram_critical,
                "unit": "percent",
                "details": {
                    "used_mb": memory_used,
                    "total_mb": memory_total,
                    "gpu_utilization": gpu_util,
                    "temperature_c": temperature,
                }
            }
        elif percent >= self.thresholds.vram_warning:
            return {
                "type": ResourceType.VRAM,
                "level": WarningLevel.WARNING,
                "message": f"VRAM high: {memory_used}MB / {memory_total}MB ({percent:.1f}%), GPU {gpu_util}%, {temperature}C",
                "current_value": percent,
                "threshold": self.thresholds.vram_warning,
                "unit": "percent",
                "details": {
                    "used_mb": memory_used,
                    "total_mb": memory_total,
                    "gpu_utilization": gpu_util,
                    "temperature_c": temperature,
                }
            }
        return None

    async def _get_gpu_processes(self) -> list[dict[str, Any]]:
        """Get list of processes using the GPU with their memory usage.
        Uses nvidia-smi as primary source (works without admin).
        Per-process memory requires NVML accounting mode (admin needed)."""
        processes = []
        memory_available = False

        try:
            import subprocess
            result = subprocess.run(
                ["nvidia-smi", "--query-compute-apps=pid,used_memory,process_name",
                 "--format=csv,noheader"],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0 and result.stdout.strip():
                for line in result.stdout.strip().split("\n"):
                    parts = [p.strip() for p in line.split(",")]
                    if len(parts) >= 3:
                        try:
                            pid = int(parts[0])
                            mem_str = parts[1]
                            name = parts[2] if parts[2] != "[Insufficient Permissions]" else None
                            mem_mb = None
                            if mem_str not in ("[N/A]", ""):
                                try:
                                    mem_mb = int(mem_str.replace(" MiB", "").strip())
                                    memory_available = True
                                except ValueError:
                                    pass
                            processes.append({
                                "pid": pid,
                                "used_mb": mem_mb,
                                "name": name or "unknown",
                                "kind": "compute",
                            })
                        except ValueError:
                            pass
        except Exception:
            pass

        if not processes and self._nvml_available:
            try:
                import pynvml
                handle = pynvml.nvmlDeviceGetHandleByIndex(0)
                try:
                    procs = pynvml.nvmlDeviceGetComputeRunningProcesses_v2(handle)
                    for p in procs:
                        mem = p.usedGpuMemory
                        mem_mb = (mem // (1024 * 1024)) if mem and mem > 0 else None
                        if mem_mb and mem_mb > 0:
                            memory_available = True
                        processes.append({
                            "pid": p.pid,
                            "used_mb": mem_mb,
                            "kind": "compute",
                        })
                    gfx = pynvml.nvmlDeviceGetGraphicsRunningProcesses_v2(handle)
                    for p in gfx:
                        mem = p.usedGpuMemory
                        mem_mb = (mem // (1024 * 1024)) if mem and mem > 0 else None
                        if mem_mb and mem_mb > 0:
                            memory_available = True
                        if not any(existing["pid"] == p.pid for existing in processes):
                            processes.append({
                                "pid": p.pid,
                                "used_mb": mem_mb,
                                "kind": "graphics",
                            })
                except (AttributeError, Exception):
                    try:
                        import pynvml
                        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
                        for p in pynvml.nvmlDeviceGetComputeRunningProcesses(handle):
                            processes.append({"pid": p.pid, "used_mb": None, "kind": "compute"})
                        for p in pynvml.nvmlDeviceGetGraphicsRunningProcesses(handle):
                            if not any(existing["pid"] == p.pid for existing in processes):
                                processes.append({"pid": p.pid, "used_mb": None, "kind": "graphics"})
                    except Exception:
                        pass
            except Exception:
                pass

        if not memory_available:
            try:
                import subprocess
                result = subprocess.run(
                    ["nvidia-smi", "--query-compute-apps=pid,used_memory", "--format=csv,noheader"],
                    capture_output=True, text=True, timeout=5
                )
                if result.returncode == 0 and result.stdout.strip():
                    for line in result.stdout.strip().split("\n"):
                        parts = [p.strip() for p in line.split(",")]
                        if len(parts) >= 2 and parts[1] not in ("[N/A]", ""):
                            try:
                                int(parts[1].replace(" MiB", ""))
                                memory_available = True
                                break
                            except ValueError:
                                pass
            except Exception:
                pass

        return processes, memory_available

    async def _enrich_process_names(self, processes: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Add process names via nvidia-smi if not already populated."""
        needs_names = any(p.get("name") in (None, "unknown") for p in processes)
        if not needs_names:
            return processes

    async def get_gpu_processes_human(self) -> list[dict[str, Any]]:
        """Get per-process GPU memory usage via Windows Performance Counters.

        Works on Windows 10/11 with WDDM (GeForce) without admin privileges.
        Returns list of {pid, name, mem_mb} sorted by memory descending."""
        processes = []
        try:
            import win32pdh
            from ctypes import windll, wintypes, byref, Structure, WinError

            # Query "Dedicated Usage" for all GPU processes
            counter_path = r"\GPU Process Memory(*)\Dedicated Usage"

            hq = win32pdh.OpenQuery()
            try:
                hc = win32pdh.AddCounter(hq, counter_path)
                try:
                    win32pdh.CollectQueryData(hq)
                    items = win32pdh.GetFormattedCounterArray(hc, win32pdh.PDH_FMT_LONG)
                    for instance, mem_bytes in items.items():
                        pid_str = instance.split("_")[1] if "_" in instance else None
                        if not pid_str:
                            continue
                        try:
                            pid = int(pid_str)
                        except ValueError:
                            continue
                        if mem_bytes <= 0 or mem_bytes >= 2**31:
                            continue
                        mem_mb = max(0, mem_bytes // (1024 * 1024))
                        name = self._get_process_name(pid)
                        processes.append({"pid": pid, "name": name, "mem_mb": mem_mb})
                finally:
                    win32pdh.RemoveCounter(hc)
            finally:
                win32pdh.CloseQuery(hq)
        except Exception as e:
            logger.debug(f"GPU process counter query failed: {e}")

        processes.sort(key=lambda p: p["mem_mb"], reverse=True)
        return processes

    @staticmethod
    def _get_process_name(pid: int) -> str:
        """Get process name from PID. Uses CreateToolhelp32Snapshot (works for protected processes)."""
        try:
            import ctypes
            from ctypes import wintypes

            class PROCESSENTRY32(ctypes.Structure):
                _fields_ = [("dwSize", ctypes.c_ulong), ("cntUsage", ctypes.c_ulong),
                            ("th32ProcessID", ctypes.c_ulong), ("th32DefaultHeapID", ctypes.POINTER(ctypes.c_ulong)),
                            ("th32ModuleID", ctypes.c_ulong), ("cntThreads", ctypes.c_ulong),
                            ("th32ParentProcessID", ctypes.c_ulong), ("pcPriClassBase", ctypes.c_long),
                            ("dwFlags", ctypes.c_ulong), ("szExeFile", ctypes.c_char * 260)]

            TH32CS_SNAPPROCESS = 0x00000002
            hSnapshot = ctypes.windll.kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
            if hSnapshot == -1:
                return f"PID {pid}"
            try:
                pe32 = PROCESSENTRY32()
                pe32.dwSize = ctypes.sizeof(PROCESSENTRY32)
                if ctypes.windll.kernel32.Process32First(hSnapshot, ctypes.byref(pe32)):
                    while True:
                        if pe32.th32ProcessID == pid:
                            name = pe32.szExeFile.decode("utf-8", errors="ignore")
                            return name
                        if not ctypes.windll.kernel32.Process32Next(hSnapshot, ctypes.byref(pe32)):
                            break
            finally:
                ctypes.windll.kernel32.CloseHandle(hSnapshot)
        except Exception:
            pass
        return f"PID {pid}"
        try:
            import subprocess
            result = subprocess.run(
                ["nvidia-smi", "--query-compute-apps=pid,process_name", "--format=csv,noheader"],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0:
                name_map = {}
                for line in result.stdout.strip().split("\n"):
                    if "," in line:
                        pid_str, _, name = line.partition(",")
                        try:
                            name_map[int(pid_str.strip())] = name.strip()
                        except ValueError:
                            pass
                for proc in processes:
                    if proc.get("name") in (None, "unknown"):
                        proc["name"] = name_map.get(proc["pid"], "unknown")
        except Exception:
            pass
        return processes

    async def get_gpu_snapshot(self) -> dict[str, Any]:
        """Get a full GPU snapshot for visibility: memory, utilization,
        temperature, and per-process breakdown."""
        snapshot: dict[str, Any] = {"available": False}

        if not self._nvml_available:
            return snapshot

        try:
            import pynvml
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)

            mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
            util = pynvml.nvmlDeviceGetUtilizationRates(handle)
            temp = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)

            processes, memory_available = await self._get_gpu_processes()
            processes = await self._enrich_process_names(processes)
            snapshot = {
                "available": True,
                "name": pynvml.nvmlDeviceGetName(handle),
                "memory_used_mb": mem.used // (1024 * 1024),
                "memory_free_mb": mem.free // (1024 * 1024),
                "memory_total_mb": mem.total // (1024 * 1024),
                "memory_percent": round((mem.used / mem.total) * 100, 1) if mem.total else 0,
                "gpu_utilization": util.gpu,
                "memory_controller_utilization": util.memory,
                "temperature_c": temp,
                "processes": processes,
                "memory_available": memory_available,
            }
        except Exception as e:
            logger.warning(f"Failed to get GPU snapshot: {e}")

        return snapshot

    async def check_all(self) -> list[dict[str, Any]]:
        """Check all resources and return list of warnings"""
        warnings = []

        # Check memory
        mem_warning = await self.check_memory()
        if mem_warning:
            warnings.append(mem_warning)

        # Check disk
        disk_warning = await self.check_disk()
        if disk_warning:
            warnings.append(disk_warning)

        # Check VRAM
        vram_warning = await self.check_vram()
        if vram_warning:
            # Include process breakdown (with names) in warning details for visibility
            processes, _ = await self._get_gpu_processes()
            vram_warning["details"]["processes"] = await self._enrich_process_names(processes)
            warnings.append(vram_warning)

        # VRAM Manager: Check and prevent OOM
        from ..services.vram_manager import vram_manager
        oom_prevention = await vram_manager.check_and_prevent_oom()
        if oom_prevention:
            warnings.append({
                "type": "vram",
                "level": "critical",
                "message": f"VRAM OOM prevention triggered: {oom_prevention['action']}",
                "action": oom_prevention,
            })

        return warnings

    async def broadcast_warnings(self, warnings: list[dict[str, Any]]):
        """Broadcast resource warnings via SSE"""
        for warning in warnings:
            resource_type = warning["type"]
            level = warning["level"]

            # Only broadcast if warning level changed or is critical
            last_level = self._last_warnings.get(resource_type)
            if last_level != level or level == WarningLevel.CRITICAL:
                await sse_manager.broadcast("system.resource_warning", warning)
                logger.warning(f"Resource warning broadcast: {warning['message']}")
                self._last_warnings[resource_type] = level

            # Clear warning if resolved
            if level != WarningLevel.CRITICAL and resource_type in self._last_warnings:
                del self._last_warnings[resource_type]


# Global resource monitor instance
resource_monitor = ResourceMonitor()


async def resource_monitoring_loop(interval_seconds: float = 10.0):
    """
    Background loop that monitors resources and broadcasts warnings.
    
    Args:
        interval_seconds: How often to check resources (default: 10 seconds)
    """
    logger.info(f"Resource monitoring started (interval: {interval_seconds}s)")

    while True:
        try:
            warnings = await resource_monitor.check_all()
            if warnings:
                await resource_monitor.broadcast_warnings(warnings)
        except Exception as e:
            logger.error(f"Error in resource monitoring loop: {e}")

        await asyncio.sleep(interval_seconds)

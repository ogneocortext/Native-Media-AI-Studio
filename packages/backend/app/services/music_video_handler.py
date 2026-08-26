"""Music video generation handler - processes music video jobs with audio analysis and video composition."""

import asyncio
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from ..core.config import PROJECT_ROOT
from ..models.job import Job, JobType
from ..services.audio_analyzer import AudioAnalyzer, extract_amplitude_envelope_simple

OUTPUT_DIR = PROJECT_ROOT / "output" / "video"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

PREVIEW_DIR = PROJECT_ROOT / "output" / "previews"
PREVIEW_DIR.mkdir(parents=True, exist_ok=True)


class MusicVideoHandler:
    """
    Handler for music video generation jobs.

    Processes music video jobs by:
    1. Analyzing audio for beat markers and features
    2. Generating visualization frames based on style config
    3. Compositing frames with audio into final video (via FFmpeg)
    """

    def __init__(self, analyzer: AudioAnalyzer | None = None):
        self.analyzer = analyzer or AudioAnalyzer()

    async def process_job(self, job: Job) -> dict[str, Any]:
        """Process a music video generation job."""
        print(f"DEBUG: process_job called for {job.id} v3", flush=True)
        import logging
        import traceback as tb_module
        logger = logging.getLogger(__name__)
        logger.info("DEBUG: process_job info log for %s v3", job.id)
        try:
            return await self._process_job_inner(job)
        except Exception as e:
            print(f"DEBUG: process_job FAILED for {job.id}: {e}", flush=True)
            logger.error("DEBUG: process_job failed for %s: %s\n%s", job.id, repr(e), tb_module.format_exc())
            raise

    async def _process_job_inner(self, job: Job) -> dict[str, Any]:
        """Inner implementation of job processing."""
        import logging
        logger = logging.getLogger(__name__)

        params = job.params
        # Check if this is a preview job (handle both string and enum comparison)
        is_preview = job.job_type == "music_video_preview" or job.job_type == JobType.MUSIC_VIDEO_PREVIEW
        logger.info("Processing job %s: is_preview=%s, job_type=%s", job.id, is_preview, job.job_type)

        audio_path = params.get("audio_path")
        logger.info("audio_path: '%s', is_preview: %s", audio_path, is_preview)

        # Preview jobs don't require audio — they generate from text prompt only
        if not is_preview and not audio_path:
            raise ValueError("audio_path is required")

        if audio_path and not Path(audio_path).exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        method = params.get("method", "visualization")

        # Update progress
        await self._update_progress(job, 0.1, "Analyzing audio features...")

        # Analyze audio (skip for preview jobs without audio)
        if audio_path:
            try:
                analysis = extract_amplitude_envelope_simple(audio_path)
            except Exception:
                analysis = {
                    "audio_file": audio_path,
                    "duration_seconds": params.get("duration_seconds", 60),
                    "tempo_bpm": 120,
                    "amplitude_envelope": [0.5] * 60,
                    "beat_times": [],
                    "num_beats": 0,
                }
        else:
            # Preview job without audio — use defaults
            analysis = {
                "audio_file": "",
                "duration_seconds": params.get("duration", 5),
                "tempo_bpm": 120,
                "amplitude_envelope": [0.5] * 60,
                "beat_times": [],
                "num_beats": 0,
            }

        await self._update_progress(job, 0.3, "Generating visualization frames...")

        # Determine output settings
        viz_config = params.get("visualization", {})
        resolution = viz_config.get("resolution", "1080p")
        fps = viz_config.get("fps", 30)
        duration_str = viz_config.get("duration", "60s")

        # Parse duration
        if duration_str == "full":
            duration_seconds = analysis.get("duration_seconds", 60)
        else:
            duration_seconds = int(duration_str.replace("s", ""))

        # Cap preview duration
        if is_preview:
            duration_seconds = min(duration_seconds, 5)
            resolution = "480p"  # Lower res for faster preview
            fps = 12

        # Resolution to dimensions
        res_map = {"480p": (854, 480), "720p": (1280, 720), "1080p": (1920, 1080), "4k": (3840, 2160)}
        width, height = res_map.get(resolution, (854, 480))

        await self._update_progress(job, 0.5, "Rendering video frames...")

        # Generate video using FFmpeg with visualization
        output_filename = f"{job.id[:8]}_{'preview' if is_preview else 'music_video'}.mp4"
        output_path = (PREVIEW_DIR if is_preview else OUTPUT_DIR) / output_filename

        # Check if ffmpeg is available
        ffmpeg_cmd = self._find_ffmpeg()

        if not ffmpeg_cmd:
            raise RuntimeError(
                "FFmpeg not found in PATH. Install FFmpeg (https://ffmpeg.org/download.html) and ensure 'ffmpeg' is in PATH. "
            )

        try:
            await self._render_with_ffmpeg(
                job, audio_path, output_path, width, height, fps, duration_seconds, analysis, viz_config, method
            )
        except Exception as e:
            logger.error("FFmpeg rendering failed for job %s: %s", job.id, str(e))
            raise RuntimeError(f"Video rendering failed: {str(e)[:500]}") from e

        await self._update_progress(job, 1.0, "Music video complete")

        return {
            "output_path": str(output_path),
            "output_filename": output_filename,
            "duration_seconds": duration_seconds,
            "resolution": f"{width}x{height}",
            "fps": fps,
            "tempo_bpm": analysis.get("tempo_bpm", 0),
            "num_beats": analysis.get("num_beats", 0),
            "style": viz_config.get("style", "abstract"),
        }

    async def _update_progress(self, job: Job, progress: float, message: str):
        """Update job progress via the queue manager."""
        from ..queue.manager import queue_manager
        await queue_manager.update_job(
            job.id, progress=progress, message=message
        )

    def _find_ffmpeg(self) -> str | None:
        """Find ffmpeg executable."""
        for name in ["ffmpeg", "ffmpeg.exe"]:
            cmd = shutil.which(name)
            if cmd:
                return cmd
        return None

    async def _render_with_ffmpeg(
        self,
        job: Job,
        audio_path: str,
        output_path: Path,
        width: int,
        height: int,
        fps: int,
        duration: float,
        analysis: dict,
        viz_config: dict,
        method: str = "visualization",
    ):
        """Render video using FFmpeg with visualization filters."""
        style = viz_config.get("style", "waveform")

        if method == "comfyui":
            return await self._render_with_comfyui(job, audio_path, output_path, width, height, duration, analysis)

        # Encoding: use CRF for size/quality (was ultrafast → 772MB for 4:24)
        # Add -t to respect requested duration (was rendering full 4:24 for every 5s request → timeout)
        vcodec_args = ["-c:v", "libx264", "-crf", "23", "-preset", "fast", "-pix_fmt", "yuv420p", "-maxrate", "8M", "-bufsize", "16M"]
        acodec_args = ["-c:a", "aac", "-b:a", "192k"]
        # Use -t to limit to requested duration (avoid 4:24 full render for 5s preview)
        duration_args = ["-t", str(duration)] if duration and duration < 60 else []

        # For preview jobs without audio, generate a test pattern video
        if not audio_path:
            cmd = [
                self._find_ffmpeg(),
                "-y",
                "-f", "lavfi",
                "-i", f"testsrc=duration={duration}:size={width}x{height}:rate={fps}",
                "-f", "lavfi",
                "-i", f"sine=frequency=440:duration={duration}",
                *vcodec_args,
                *acodec_args,
                *duration_args,
                "-shortest",
                "-movflags", "+faststart",
                str(output_path),
            ]
        elif style == "waveform":
            vf_filter = f"[0:a]showwaves=s={width}x{height}:mode=cline:rate={fps}:colors=#8b5cf6|#06b6d4:scale=sqrt[vid]"
            input_args = ["-i", audio_path]
            cmd = [
                self._find_ffmpeg(),
                "-y",
                *input_args,
                "-filter_complex", vf_filter,
                "-map", "[vid]",
                "-map", "0:a",
                *vcodec_args,
                *acodec_args,
                *duration_args,
                "-shortest",
                "-movflags", "+faststart",
                str(output_path),
            ]
        elif style == "spectrum":
            vf_filter = f"[0:a]showspectrum=s={width}x{height}:mode=combined:color=intensity:scale=log[vid]"
            input_args = ["-i", audio_path]
            cmd = [
                self._find_ffmpeg(),
                "-y",
                *input_args,
                "-filter_complex", vf_filter,
                "-map", "[vid]",
                "-map", "0:a",
                *vcodec_args,
                *acodec_args,
                *duration_args,
                "-shortest",
                "-movflags", "+faststart",
                str(output_path),
            ]
        else:
            # abstract — now energy/beat-reactive + genre-aware + efficient
            # Palette selection based on style/section/energy; contrast/sat driven by analysis energy
            PALETTES = {
                "waveform": "#8b5cf6|#06b6d4",
                "spectrum": "#ff00ff|#00ffff",
                "abstract": "#ff00ff|#00ffff|#ffaa00|#ff0000",
                "particles": "#ff3366|#33ff99|#3366ff",
                "geometric": "#ffaa00|#ff00aa|#00aaff",
                "chorus": "#ff0055|#ffaa00|#ffff00",  # high-energy
                "verse": "#6d28d9|#0ea5e9|#14b8a6",  # mid
                "bridge": "#1e3a8a|#3b82f6|#93c5fd",  # low/blue
            }
            # Pick palette by explicit style, else by section energy
            section = str(job.params.get("section", "")).lower() if isinstance(job.params.get("section"), str) else ""
            if style in PALETTES:
                palette = PALETTES[style]
            elif section in PALETTES:
                palette = PALETTES[section]
            else:
                # Fallback by energy: high→chorus, mid→verse, low→bridge
                energy_peek = float(analysis.get("energy_curve", [0.5])[0]) if isinstance(analysis.get("energy_curve"), list) and analysis.get("energy_curve") else 0.5
                if energy_peek > 0.65:
                    palette = PALETTES["chorus"]
                elif energy_peek < 0.35:
                    palette = PALETTES["bridge"]
                else:
                    palette = PALETTES["abstract"]

            energy = float(analysis.get("energy_curve", [0.5])[0]) if isinstance(analysis.get("energy_curve"), list) and analysis.get("energy_curve") else 0.5
            # Map 0-1 energy → 1.2-1.6 contrast, 1.4-1.9 saturation
            contrast = 1.2 + energy * 0.4
            saturation = 1.4 + energy * 0.5
            # Use p2p for full-screen, beat-reactive via energy-driven eq
            vf_filter = f"[0:a]showwaves=s={width}x{height}:mode=p2p:rate={fps}:colors={palette}:scale=sqrt,format=yuv420p,eq=contrast={contrast:.2f}:saturation={saturation:.2f}:brightness=0.03[vid]"
            input_args = ["-i", audio_path]
            cmd = [
                self._find_ffmpeg(),
                "-y",
                *input_args,
                "-filter_complex", vf_filter,
                "-map", "[vid]",
                "-map", "0:a",
                *vcodec_args,
                *acodec_args,
                *duration_args,
                "-shortest",
                "-movflags", "+faststart",
                str(output_path),
            ]

        try:
            # Stream FFmpeg stderr to parse frame progress and update job
            import re

            total_frames = int(duration * fps) if duration and fps else 0
            # Use -progress pipe:1 for machine-readable, but we parse frame= lines from stderr
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            # Read stderr streaming (FFmpeg uses \r for progress, not \n) while process runs, update progress 0.5→1.0
            stderr_chunks = []
            frame_re = re.compile(r"frame=\s*(\d+)")
            time_re = re.compile(r"time=\s*(\d+):(\d+):(\d+\.\d+)")

            async def _read_stderr():
                buffer = ""
                while True:
                    chunk = await process.stderr.read(1024)
                    if not chunk:
                        break
                    text = chunk.decode(errors="replace")
                    stderr_chunks.append(text)
                    buffer += text
                    # FFmpeg progress uses \r to overwrite line, so split on both \r and \n
                    parts = re.split(r"[\r\n]+", buffer)
                    # Keep last incomplete part in buffer
                    buffer = parts[-1]
                    for line in parts[:-1]:
                        if not line.strip():
                            continue
                        # Parse frame for progress
                        m = frame_re.search(line)
                        if m and total_frames > 0:
                            try:
                                frame = int(m.group(1))
                                frac = max(0.0, min(1.0, frame / max(1, total_frames)))
                                prog = 0.5 + 0.5 * frac
                                # Throttle updates: only every ~2% or 30 frames
                                if not hasattr(_read_stderr, "_last_prog"):
                                    _read_stderr._last_prog = 0.5  # type: ignore
                                if prog - _read_stderr._last_prog >= 0.02 or frame % 30 == 0:  # type: ignore
                                    _read_stderr._last_prog = prog  # type: ignore
                                    await self._update_progress(job, prog, f"Rendering frame {frame}/{total_frames} ({int(frac*100)}%)")
                            except Exception:
                                pass
                        else:
                            # Fallback: parse time=
                            tm = time_re.search(line)
                            if tm and duration:
                                try:
                                    h, mm, ss = tm.groups()
                                    secs = int(h) * 3600 + int(mm) * 60 + float(ss)
                                    frac = max(0.0, min(1.0, secs / max(1.0, duration)))
                                    prog = 0.5 + 0.5 * frac
                                    if not hasattr(_read_stderr, "_last_prog_t"):
                                        _read_stderr._last_prog_t = 0.5  # type: ignore
                                    if prog - _read_stderr._last_prog_t >= 0.02:  # type: ignore
                                        _read_stderr._last_prog_t = prog  # type: ignore
                                        await self._update_progress(job, prog, f"Rendering {int(secs)}s / {int(duration)}s ({int(frac*100)}%)")
                                except Exception:
                                    pass

            # Wait for process with timeout, concurrently reading stderr
            try:
                await asyncio.wait_for(
                    asyncio.gather(_read_stderr(), process.wait()), timeout=max(duration * 3, 90)
                )
            except asyncio.TimeoutError:
                try:
                    process.kill()
                except Exception:
                    pass
                raise RuntimeError(f"FFmpeg rendering timed out after {max(duration*3,90)}s")

            # Collect remaining stderr
            try:
                # Ensure process terminated
                await process.wait()
            except Exception:
                pass
            # Also collect stdout (not needed)
            try:
                stdout = await process.stdout.read() if process.stdout else b""
            except Exception:
                stdout = b""
            stderr_text = "".join(stderr_chunks)
            if process.returncode != 0:
                tail = stderr_text[-1500:] if len(stderr_text) > 1500 else stderr_text
                import logging as _logging

                _logging.getLogger(__name__).error("FFmpeg full stderr:\n%s", stderr_text)
                raise RuntimeError(f"FFmpeg failed: {tail}")
        except asyncio.TimeoutError:
            raise
        except Exception as e:
            # Surface any other error from streaming
            if "FFmpeg failed" in str(e) or "timed out" in str(e):
                raise
            raise RuntimeError(f"FFmpeg failed: {e}") from e

    async def _render_with_comfyui(self, job: Job, audio_path: str, output_path: Path, width: int, height: int, duration: float, analysis: dict) -> None:
        """Render video using ComfyUI for AI-generated content."""
        await self._update_progress(job, 0.5, "Generating video with ComfyUI...")

        try:
            from ..services.comfyui_manager import ComfyUIManager
            manager = ComfyUIManager()

            prompt = job.params.get("prompt", "Music video visualization")
            section = job.params.get("section", "full")

            result = await manager.generate_video(
                prompt=prompt,
                width=width,
                height=height,
                duration=int(duration),
                section=section,
                audio_path=audio_path,
            )

            if result and Path(result).exists():
                import shutil
                shutil.move(str(result), str(output_path))
            else:
                raise RuntimeError("ComfyUI generation failed")
        except ImportError:
            raise RuntimeError("ComfyUI manager not available")
        except Exception as e:
            raise RuntimeError(f"ComfyUI generation failed: {e}")

    def _build_visualization_filter(self, style: str, color_scheme: str, width: int, height: int) -> str:
        """Build FFmpeg filter string for the visualization style."""
        # Use testsrc as input and apply color/effects based on style
        # These are simplified but reliable filters that work with FFmpeg 8.x
        if style == "waveform":
            return (
                f"geq=lum='128+127*sin(X/30+T*2)*cos(Y/20+T*1.5)':"
                f"cb=128:cr=128,"
                f"format=yuv420p[outv]"
            )
        elif style == "particles":
            return (
                f"geq=lum='255*abs(sin(X/20+T*3)*cos(Y/15+T*2))':"
                f"cb=128:cr=128,"
                f"format=yuv420p[outv]"
            )
        elif style == "geometric":
            return (
                f"geq=lum='if(bitor(lt(mod(X+T*50,100),50),lt(mod(Y+T*30,100),50)),255,50)':"
                f"cb=128:cr=128,"
                f"format=yuv420p[outv]"
            )
        else:  # abstract
            return (
                f"geq=lum='128+127*sin(X/30+T*2)*cos(Y/20+T*1.5)':"
                f"cb='128+127*sin(X/25+T)':"
                f"cr='128+127*cos(Y/25+T)',"
                f"format=yuv420p[outv]"
            )

    async def _create_placeholder_output(self, job: Job, output_path: Path, analysis: dict):
        """Create a placeholder output file when ffmpeg is not available."""
        placeholder = {
            "job_id": job.id,
            "status": "placeholder",
            "message": "FFmpeg not available. Install FFmpeg to generate actual video.",
            "analysis": analysis,
            "params": job.params,
        }
        # Write a JSON sidecar with analysis data
        sidecar_path = output_path.with_suffix(".json")
        with open(sidecar_path, "w") as f:
            json.dump(placeholder, f, indent=2)


class MusicVideoPreviewHandler(MusicVideoHandler):
    """Handler for music video preview jobs (shorter, lower quality)."""

    async def process_job(self, job: Job) -> dict[str, Any]:
        """Process a preview job (5-second low-res draft)."""
        return await super().process_job(job)


# Handler instances
music_video_handler = MusicVideoHandler()
music_video_preview_handler = MusicVideoPreviewHandler()

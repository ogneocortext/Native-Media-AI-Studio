"""Queue handler for LIPSYNC jobs (D8, D42).

Lip-syncs a video clip (or still portrait) to an audio track using the local
MuseTalk adapter. Long-running work goes through the queue, never ad-hoc
threads. For songs, pass the isolated vocals stem as audio_path — the full
mix syncs markedly worse (research notes, D42).
"""

import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class LipSyncHandler:
    """Processes LIPSYNC jobs via the local MuseTalk adapter."""

    async def process_job(self, job: Any) -> dict[str, Any]:
        """Process a lip-sync job."""
        try:
            return await self._process_job_inner(job)
        except Exception as e:
            import traceback as tb_module

            logger.error(
                "process_job failed for %s: %s\n%s",
                getattr(job, "id", "?"),
                repr(e),
                tb_module.format_exc(),
            )
            raise

    async def _process_job_inner(self, job: Any) -> dict[str, Any]:
        """Inner implementation of lip-sync job processing."""
        from .lipsync import LipSyncNotConfiguredError, MuseTalkAdapter

        params = job.params or {}
        video_path = params.get("video_path")
        image_path = params.get("image_path")
        audio_path = params.get("audio_path")
        section = params.get("section", "chorus")

        source = video_path or image_path
        if not source:
            raise ValueError("video_path or image_path is required")
        if not audio_path:
            raise ValueError("audio_path is required (isolated vocals recommended)")
        if not Path(source).is_file():
            raise FileNotFoundError(f"Source not found: {source}")
        if not Path(audio_path).is_file():
            raise FileNotFoundError(f"Audio not found: {audio_path}")

        adapter = MuseTalkAdapter()
        try:
            status = adapter.check_installation()
        except Exception:
            status = {"installed": False, "message": "check failed"}
        if not status["installed"]:
            raise LipSyncNotConfiguredError(
                "MuseTalk is not ready on this machine: "
                + status.get("message", "unknown")
                + " — see config/lipsync.json"
            )

        output_path = params.get("output_path")
        if not output_path:
            from ..core.config import PROJECT_ROOT as _PR

            out_dir = _PR / "output" / "video"
            out_dir.mkdir(parents=True, exist_ok=True)
            stem = Path(source).stem.replace(" ", "_")
            output_path = str(out_dir / f"{stem}_lipsync_{job.id[:8]}.mp4")

        def _progress(frac: float, message: str) -> None:
            # Best-effort progress; the queue broadcasts job state separately.
            logger.info("lipsync %s: %.0f%% %s", job.id[:8], frac * 100, message)

        result = await adapter.lipsync(
            video_path=source,
            audio_path=audio_path,
            output_path=output_path,
            progress_cb=_progress,
        )
        result["section"] = section
        result["job_id"] = job.id
        return result


# Handler instance (mirrors music_video_handler convention)
lipsync_handler = LipSyncHandler()

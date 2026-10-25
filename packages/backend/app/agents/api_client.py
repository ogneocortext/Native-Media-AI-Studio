"""
Native Media AI Studio - Agent API Client

Thin wrapper around the backend REST API for agent use. All endpoints follow
the /api/ prefix convention. Errors raise RuntimeError with the response body
so the agent can decide whether to retry, skip, or abort.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any


class NMAApiError(RuntimeError):
    """Raised when the backend API returns an error response."""


class NMAApiClient:
    """Client for the Native Media AI Studio backend API.

    All methods raise NMAApiError on non-2xx responses. The agent layer
    decides how to handle errors (retry, skip, abort, or report).
    """

    def __init__(self, base_url: str = "http://127.0.0.1:8000", timeout: int = 30):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _request(self, method: str, path: str, data: dict | None = None) -> dict[str, Any]:
        """Make an HTTP request to the backend API."""
        url = f"{self.base_url}{path}"
        headers = {"Content-Type": "application/json"}
        body = None
        if data is not None:
            body = json.dumps(data).encode("utf-8")

        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8")
                if not raw:
                    return {}
                return json.loads(raw)
        except urllib.error.HTTPError as e:
            body_text = e.read().decode("utf-8", errors="replace")
            raise NMAApiError(f"{method} {path} -> HTTP {e.code}: {body_text}") from e
        except Exception as e:
            raise NMAApiError(f"{method} {path} -> {type(e).__name__}: {e}") from e

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------
    def health(self) -> dict[str, Any]:
        return self._request("GET", "/api/health")

    # ------------------------------------------------------------------
    # Audio
    # ------------------------------------------------------------------
    def audio_upload(self, file_path: str) -> dict[str, Any]:
        """Upload an audio file. Returns upload metadata including filename."""
        import mimetypes

        path = Path(file_path)
        if not path.exists():
            raise NMAApiError(f"Audio file not found: {file_path}")

        boundary = "----nma-agent-upload"
        body_parts = [
            f"--{boundary}".encode(),
            f'Content-Disposition: form-data; name="file"; filename="{path.name}"'.encode(),
            f"Content-Type: {mimetypes.guess_type(str(path))[0] or 'audio/wav'}".encode(),
            b"",
            path.read_bytes(),
            f"--{boundary}--".encode(),
        ]
        body = b"\r\n".join(body_parts)

        req = urllib.request.Request(
            f"{self.base_url}/api/audio/upload",
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8")
                if not raw:
                    return {}
                return json.loads(raw)
        except urllib.error.HTTPError as e:
            body_text = e.read().decode("utf-8", errors="replace")
            raise NMAApiError(f"POST /api/audio/upload -> HTTP {e.code}: {body_text}") from e

    def audio_analyze(self, filename: str) -> dict[str, Any]:
        """Run audio analysis on a file. Returns tempo, beats, sections, energy."""
        return self._request("POST", f"/api/audio/analysis?filename={filename}")

    def audio_list(self) -> dict[str, Any]:
        """List all audio outputs."""
        return self._request("GET", "/api/outputs")

    # ------------------------------------------------------------------
    # Music Generation
    # ------------------------------------------------------------------
    def music_gen_status(self) -> dict[str, Any]:
        return self._request("GET", "/api/music-gen/status")

    def music_gen_start(self, engine: str = "ace") -> dict[str, Any]:
        return self._request("POST", "/api/music-gen/start", {"engine": engine})

    def music_gen_stop(self) -> dict[str, Any]:
        return self._request("POST", "/api/music-gen/stop")

    def music_gen_generate(
        self,
        style: str,
        lyrics: str = "",
        output_name: str | None = None,
    ) -> dict[str, Any]:
        data: dict[str, Any] = {"engine": "ace", "style": style, "lyrics": lyrics}
        if output_name:
            data["output_name"] = output_name
        return self._request("POST", "/api/music-gen/generate", data)

    def music_gen_audio(self, name: str) -> str:
        """Return the playable URL for a generated audio file."""
        return f"{self.base_url}/api/music-gen/audio/{name}"

    # ------------------------------------------------------------------
    # Remix
    # ------------------------------------------------------------------
    def remix_list(self) -> dict[str, Any]:
        return self._request("GET", "/api/audio/remix/")

    def remix_preview(self, recipe: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/audio/remix/preview", recipe)

    def remix_build(self, recipe: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/audio/remix/build", recipe)

    def remix_enhance(self, name: str) -> dict[str, Any]:
        return self._request("POST", f"/api/audio/remix/{name}/enhance")

    # ------------------------------------------------------------------
    # Media Library
    # ------------------------------------------------------------------
    def media_list(self) -> dict[str, Any]:
        return self._request("GET", "/api/outputs")

    def media_delete(self, relative_path: str) -> dict[str, Any]:
        return self._request("DELETE", f"/api/outputs/{relative_path}")

    def media_rename(self, relative_path: str, new_name: str) -> dict[str, Any]:
        return self._request(
            "POST", f"/api/outputs/{relative_path}/rename", {"new_name": new_name}
        )


from pathlib import Path

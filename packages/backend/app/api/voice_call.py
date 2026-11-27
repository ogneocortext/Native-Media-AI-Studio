"""Studio call service -- ``/api/voice/call``.

Shared line-state model (single source of truth, one backend process):

    idle -> ringing -> connected -> ended -> idle

Maya places a call; Nate's side rings; he answers; two-way communication:

  - Maya's voice -> Pocket TTS -> PCM16 mono 24 kHz streamed to Nate's speakers
  - Nate's mic   -> PCM16 mono 16 kHz  -> faster-whisper STT -> transcript text to Maya

Either side can end; the line returns to idle. A frontend reload mid-call returns
the line to idle within a few seconds (disconnect grace) instead of ringing
forever.

Transport is a single WebSocket on the existing backend (no new server or port
beyond Pocket's 8811), following the ``/api/voice/live`` pattern.

The Pocket Bearer token is server-side only (config/tts.json
``pocket.token_file`` or the ``POCKET_TTS_TOKEN`` env var); it is never logged
and never reaches the browser.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

import httpx
import numpy as np
import torch
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..core import tts_settings
from ..core.cors import is_origin_allowed
from . import voice_pocket as _vp

if TYPE_CHECKING:
    from collections.abc import Callable

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Voice Call"])

IDLE = "idle"
RINGING = "ringing"
CONNECTED = "connected"
ENDED = "ended"

ALL_STATES = (IDLE, RINGING, CONNECTED, ENDED)

# How long the line stays ringing/connected after a client disconnects before
# the server forces it back to idle. Covers a frontend reload mid-call.
DISCONNECT_GRACE_SECONDS = 4.0

# VAD / STT: Nate's mic arrives at 16 kHz (same as the live-duplex cascade).
VAD_CHUNK = 512  # silero expects 512 samples @ 16 kHz (32 ms per chunk)
VAD_SR = 16000
SPEECH_THRESHOLD = 0.5
ENDPOINT_SILENCE_MS = 800.0
MIN_UTTERANCE_MS = 250.0
CHUNK_MS = VAD_CHUNK / VAD_SR * 1000.0

# TTS voice used for Maya's line unless the caller overrides it.
_DEFAULT_VOICE = "maya-blend65"

_whisper_model: Any = None
_whisper_lock = asyncio.Lock()
_vad: Any = None


async def _load_whisper(cfg: dict[str, Any]):
    """Lazy-load faster-whisper once per process (model load is seconds)."""
    global _whisper_model
    async with _whisper_lock:
        if _whisper_model is not None:
            return _whisper_model
        from faster_whisper import WhisperModel  # noqa: PLC0415 - heavy import

        name = str(cfg.get("stt_model") or "base")
        device = str(cfg.get("stt_device") or "cuda")
        compute = str(cfg.get("stt_compute_type") or "int8")
        logger.info(
            "Loading faster-whisper %s on %s/%s for call STT", name, device, compute
        )
        _whisper_model = await asyncio.to_thread(
            WhisperModel, name, device=device, compute_type=compute
        )
        return _whisper_model


def _load_vad():
    from silero_vad import load_silero_vad  # noqa: PLC0415 - lazy, tiny onnx

    return load_silero_vad(onnx=True)


def _is_private_origin(origin: str) -> bool:
    """True when *origin* is a loopback/Tailscale/private LAN origin.

    The Studio is tailnet-only, so a call WebSocket may arrive from a
    Tailscale magic-DNS name (``*.ts.net``) or a Tailscale/CGNAT/LAN address
    (e.g. ``100.95.60.73``) rather than 127.0.0.1. Those are private networks,
    not the public internet, so they are in scope for this packet.
    """
    try:
        parsed = urlparse(origin)
        host = (parsed.hostname or "").lower()
    except Exception:
        return False
    if not host:
        return False
    if host in {"localhost", "127.0.0.1", "::1"}:
        return True
    if host.endswith(".ts.net"):
        return True
    parts = host.split(".")
    if len(parts) == 4 and all(p.isdigit() for p in parts):
        try:
            a, b = int(parts[0]), int(parts[1])
        except ValueError:
            return False
        if a == 10:
            return True
        if a == 172 and 16 <= b <= 31:
            return True
        if a == 192 and b == 168:
            return True
        # Tailscale CGNAT range 100.64.0.0/10.
        if a == 100 and 64 <= b <= 127:
            return True
    return False


def _origin_allowed(origin: str) -> bool:
    if not origin:
        return True  # same-origin / non-browser clients
    return is_origin_allowed(origin) or _is_private_origin(origin)


class NateStt:
    """Buffers Nate's mic PCM and emits completed utterances as transcripts."""

    def __init__(self, on_transcript: Callable[[str], Any]):
        self._on_transcript = on_transcript
        self._vad: Any = None
        self._pcm = bytearray()
        self._in_speech = False
        self._silence_ms = 0.0
        self._speech_total_ms = 0.0
        self._utterance = bytearray()

    async def feed(self, data: bytes) -> None:
        if self._vad is None:
            self._vad = await asyncio.to_thread(_load_vad)
        self._pcm += data
        chunk_bytes = VAD_CHUNK * 2
        while len(self._pcm) >= chunk_bytes:
            raw = bytes(self._pcm[:chunk_bytes])
            del self._pcm[:chunk_bytes]
            await self._vad_chunk(raw)

    async def _vad_chunk(self, raw: bytes) -> None:
        if self._vad is None:
            return
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        x = torch.from_numpy(samples).unsqueeze(0)
        with torch.no_grad():
            prob = float(self._vad(x, VAD_SR).reshape(-1)[0].item())
        speech = prob >= SPEECH_THRESHOLD
        if speech:
            if not self._in_speech:
                self._in_speech = True
                self._silence_ms = 0.0
                self._speech_total_ms = 0.0
                self._utterance.clear()
            self._speech_total_ms += CHUNK_MS
            self._utterance += raw
            self._silence_ms = 0.0
        elif self._in_speech:
            self._silence_ms += CHUNK_MS
            if self._silence_ms >= ENDPOINT_SILENCE_MS:
                await self._finish()

    async def _finish(self) -> None:
        self._in_speech = False
        self._silence_ms = 0.0
        pcm = bytes(self._utterance)
        self._utterance.clear()
        total_ms = self._speech_total_ms
        self._speech_total_ms = 0.0
        if total_ms < MIN_UTTERANCE_MS:
            return
        text = await self._transcribe(pcm)
        if text:
            try:
                if asyncio.iscoroutinefunction(self._on_transcript):
                    await self._on_transcript(text)
                else:
                    self._on_transcript(text)
            except Exception as exc:  # noqa: BLE001 - never kill the STT pump
                logger.warning("Call STT transcript delivery failed: %s", exc)

    async def _transcribe(self, pcm_i16: bytes) -> str:
        cfg = tts_settings.live()
        model = await _load_whisper(cfg)
        audio = np.frombuffer(pcm_i16, dtype=np.int16).astype(np.float32) / 32768.0
        try:
            segments, _info = await asyncio.to_thread(
                model.transcribe, audio, beam_size=1, vad_filter=False
            )
            return " ".join(seg.text for seg in segments).strip()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Call STT failed: %s", exc)
            return ""


class CallLine:
    """One shared call line. All mutations go through :meth:`_apply`."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self.state = IDLE
        self.caller: str | None = None
        self.callee: str | None = None
        self.version = 0
        self.started_at: float | None = None
        self.answered_at: float | None = None
        self.ended_at: float | None = None
        self._clients: dict[str, WebSocket] = {}
        self._teardown_task: asyncio.Task[None] | None = None

    # -- snapshot -----------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "caller": self.caller,
            "callee": self.callee,
            "version": self.version,
            "started_at": self.started_at,
            "answered_at": self.answered_at,
            "ended_at": self.ended_at,
        }

    # -- broadcasting -------------------------------------------------------

    async def _broadcast(self, event: dict[str, Any]) -> None:
        text = json.dumps(event)
        dead: list[str] = []
        for role, ws in list(self._clients.items()):
            try:
                await ws.send_text(text)
            except Exception:  # noqa: BLE001 - drop dead sockets
                dead.append(role)
        for role in dead:
            self._clients.pop(role, None)

    async def _send_text(self, role: str, event: dict[str, Any]) -> None:
        ws = self._clients.get(role)
        if ws is None:
            return
        try:
            await ws.send_text(json.dumps(event))
        except Exception:  # noqa: BLE001
            self._clients.pop(role, None)

    async def _send_audio(self, role: str, chunk: bytes) -> None:
        ws = self._clients.get(role)
        if ws is None:
            return
        try:
            await ws.send_bytes(chunk)
        except Exception:  # noqa: BLE001
            self._clients.pop(role, None)

    # -- teardown / reconnect ----------------------------------------------

    def _cancel_teardown(self) -> None:
        if self._teardown_task is not None and not self._teardown_task.done():
            self._teardown_task.cancel()
            self._teardown_task = None

    async def _teardown_after_grace(self, role: str) -> None:
        """If the disconnected role does not reconnect within grace, go idle."""
        try:
            await asyncio.sleep(DISCONNECT_GRACE_SECONDS)
        except asyncio.CancelledError:
            return
        async with self._lock:
            if self.state == IDLE or role in self._clients:
                return
        await self._apply_and_broadcast(ENDED)
        await asyncio.sleep(0.3)
        await self._apply_and_broadcast(IDLE)

    def _note_disconnect(self, role: str | None) -> None:
        if role is None:
            return
        if self.state not in (RINGING, CONNECTED):
            return
        self._cancel_teardown()
        self._teardown_task = asyncio.create_task(self._teardown_after_grace(role))

    # -- state mutations ----------------------------------------------------

    def _apply(self, new_state: str, *, caller: str | None = None, callee: str | None = None) -> dict[str, Any]:
        """Assumes the lock is held. Mutates state and returns the snapshot."""
        self.state = new_state
        self.version += 1
        now = time.time()
        if new_state == RINGING:
            self.started_at = now
            if caller:
                self.caller = caller
            if callee:
                self.callee = callee
        elif new_state == CONNECTED:
            self.answered_at = now
        elif new_state == ENDED:
            self.ended_at = now
        elif new_state == IDLE:
            self.started_at = None
            self.answered_at = None
            self.ended_at = None
            self.caller = None
            self.callee = None
        return self.snapshot()

    async def _apply_and_broadcast(
        self, new_state: str, *, caller: str | None = None, callee: str | None = None
    ) -> dict[str, Any]:
        async with self._lock:
            snap = self._apply(new_state, caller=caller, callee=callee)
        await self._broadcast({"type": "state", **snap})
        logger.info(
            "call state %s (v%s) caller=%s callee=%s",
            new_state,
            self.version,
            self.caller,
            self.callee,
        )
        return snap

    async def register(self, role: str, ws: WebSocket) -> dict[str, Any]:
        """A client identifies as maya or nate; cancels any pending teardown."""
        if role not in ("maya", "nate"):
            raise ValueError(f"unknown call role: {role!r}")
        async with self._lock:
            self._clients[role] = ws
        self._cancel_teardown()
        snap = self.snapshot()
        await ws.send_text(json.dumps({"type": "state", **snap}))
        return snap

    async def handle_disconnect(self, role: str | None, ws: WebSocket) -> None:
        async with self._lock:
            if self._clients.get(role) is not ws:
                return
            del self._clients[role]
            active = self.state in (RINGING, CONNECTED)
        if not active:
            return
        self._note_disconnect(role)

    async def _error(self, ws: WebSocket, message: str) -> None:
        for _role, client_ws in list(self._clients.items()):
            if client_ws is ws:
                await self._send_text(_role, {"type": "error", "message": message})
                break

    # -- call control -------------------------------------------------------

    async def place(self, role: str, ws: WebSocket) -> None:
        if role != "maya":
            await self._error(ws, "only maya can place a call")
            return
        async with self._lock:
            if self.state != IDLE:
                await self._error(ws, f"cannot place a call while {self.state}")
                return
            snap = self._apply(RINGING, caller="maya", callee="nate")
        await self._broadcast({"type": "state", **snap})

    async def answer(self, role: str, ws: WebSocket) -> None:
        if role != "nate":
            await self._error(ws, "only nate can answer the call")
            return
        async with self._lock:
            if self.state != RINGING:
                await self._error(ws, f"cannot answer while {self.state}")
                return
            snap = self._apply(CONNECTED)
        await self._broadcast({"type": "state", **snap})

    async def end(self, role: str, ws: WebSocket) -> None:
        async with self._lock:
            if self.state not in (RINGING, CONNECTED):
                await self._error(ws, f"cannot end a call while {self.state}")
                return
            snap = self._apply(ENDED)
        await self._broadcast({"type": "state", **snap})
        await asyncio.sleep(0.3)
        await self._apply_and_broadcast(IDLE)

    # -- audio directions ---------------------------------------------------

    async def speak(self, text: str, voice: str, ws: WebSocket) -> None:
        """Maya's line: Pocket TTS -> streamed to Nate's speakers."""
        async with self._lock:
            if self.state != CONNECTED:
                await self._error(ws, "cannot speak while not connected")
                return
        asyncio.create_task(self._stream_tts(text, voice))

    async def _stream_tts(self, text: str, voice: str) -> None:
        token = _vp._token()
        if token is None:
            await self._broadcast(
                {
                    "type": "error",
                    "message": "Pocket TTS is not configured -- is the token set?",
                }
            )
            return
        base = _vp._base_url()
        client = httpx.AsyncClient(timeout=_vp._timeout())
        try:
            req = client.build_request(
                "POST",
                f"{base}/speech",
                json={"text": text, "voice": voice or _DEFAULT_VOICE},
                headers=_vp._auth_headers(token),
            )
            resp = await client.send(req, stream=True)
            if resp.status_code != 200:
                await self._broadcast(
                    {
                        "type": "error",
                        "message": f"Pocket TTS speak failed (upstream {resp.status_code})",
                    }
                )
                await resp.aclose()
                return
            async for chunk in resp.aiter_bytes():
                await self._send_audio("nate", chunk)
        except httpx.HTTPError as exc:  # noqa: BLE001
            logger.warning("Call TTS to Nate failed: %s", exc)
            await self._broadcast(
                {"type": "error", "message": "Pocket TTS is unreachable."}
            )
        finally:
            await client.aclose()


call_line = CallLine()


# -- routes -----------------------------------------------------------------


@router.get("/api/voice/call/state")
async def call_state() -> dict[str, Any]:
    """Current shared line state (single source of truth for both sides)."""
    return call_line.snapshot()


@router.websocket("/api/voice/call")
async def call_ws(websocket: WebSocket) -> None:
    """Call signaling + audio: control JSON frames, PCM16 binary both ways."""

    origin = websocket.headers.get("origin", "")
    if origin and not _origin_allowed(origin):
        await websocket.close(code=4001, reason="Origin not allowed")
        return

    await websocket.accept()

    role: str | None = None
    stt: NateStt | None = None

    async def deliver_transcript(text: str) -> None:
        await call_line._send_text("maya", {"type": "transcript", "text": text})

    try:
        while True:
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            data = msg.get("bytes")
            if data:
                # PCM16 mono 16 kHz mic audio from Nate (only while connected).
                if role == "nate" and call_line.state == CONNECTED:
                    if stt is None:
                        stt = NateStt(deliver_transcript)
                    await stt.feed(data)
                continue
            text = msg.get("text")
            if not text:
                continue
            try:
                ctrl = json.loads(text)
            except json.JSONDecodeError:
                continue
            kind = ctrl.get("type")
            if kind == "hello":
                role = ctrl.get("role")
                if role in ("maya", "nate"):
                    await call_line.register(role, websocket)
            elif kind == "place":
                await call_line.place(role, websocket)
            elif kind == "answer":
                await call_line.answer(role, websocket)
            elif kind == "end":
                await call_line.end(role, websocket)
            elif kind == "speak":
                await call_line.speak(
                    str(ctrl.get("text") or ""),
                    str(ctrl.get("voice") or _DEFAULT_VOICE),
                    websocket,
                )
            else:
                logger.warning("Unknown call control: %r", kind)
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001
        logger.warning("Call receiver ended: %s", exc)
    finally:
        await call_line.handle_disconnect(role, websocket)
